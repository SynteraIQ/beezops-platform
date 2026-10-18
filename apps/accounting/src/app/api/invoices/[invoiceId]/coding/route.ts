import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  accountingClients,
  agentRuns,
  clientGlAccounts,
  getDatabase,
  invoiceLineCodingSuggestions,
  invoices,
  learningEvents,
} from "@beezops/database";
import { glCodingPromptVersion, glCodingTool } from "@beezops/domain-accounting/tools/gl-coding";
import { authOptions } from "../../../../../auth";
import { getWorkspaceForUser } from "../../../../../tenant-service";

type InvoiceCodingRouteContext = {
  params: Promise<{ invoiceId: string }>;
};

interface ReviewCodingRequest {
  suggestionId?: unknown;
  action?: unknown;
  glAccountId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldValue(value: unknown): string | null {
  if (!isRecord(value) || typeof value.value !== "string" || !value.value.trim()) return null;
  return value.value.trim();
}

export async function GET(_request: NextRequest, context: InvoiceCodingRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view coding recommendations." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ suggestions: [] });
  const { invoiceId } = await context.params;
  const database = getDatabase();
  const [invoice] = await database
    .select({ sourceVersion: invoices.sourceVersion })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, workspace.id)))
    .limit(1);
  if (!invoice) return NextResponse.json({ error: "Invoice not found in this workspace." }, { status: 404 });
  const [run] = await database
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.organizationId, workspace.id),
      eq(agentRuns.productKey, "accounting"),
      eq(agentRuns.agentKey, "invoice-gl-coding"),
      eq(agentRuns.sourceType, "invoice"),
      eq(agentRuns.sourceId, invoiceId),
      eq(agentRuns.status, "completed"),
    ))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  if (!run) return NextResponse.json({ suggestions: [] });

  const suggestions = await database
    .select({
      id: invoiceLineCodingSuggestions.id,
      lineIndex: invoiceLineCodingSuggestions.lineIndex,
      recommendedGlAccountId: invoiceLineCodingSuggestions.recommendedGlAccountId,
      approvedGlAccountId: invoiceLineCodingSuggestions.approvedGlAccountId,
      rationale: invoiceLineCodingSuggestions.rationale,
      evidence: invoiceLineCodingSuggestions.evidence,
      confidence: invoiceLineCodingSuggestions.confidence,
      status: invoiceLineCodingSuggestions.status,
      accountCode: clientGlAccounts.code,
      accountName: clientGlAccounts.name,
    })
    .from(invoiceLineCodingSuggestions)
    .leftJoin(clientGlAccounts, eq(invoiceLineCodingSuggestions.recommendedGlAccountId, clientGlAccounts.id))
    .where(and(
      eq(invoiceLineCodingSuggestions.organizationId, workspace.id),
      eq(invoiceLineCodingSuggestions.invoiceId, invoiceId),
      eq(invoiceLineCodingSuggestions.invoiceSourceVersion, invoice.sourceVersion),
      eq(invoiceLineCodingSuggestions.agentRunId, run.id),
    ))
    .orderBy(invoiceLineCodingSuggestions.lineIndex);
  return NextResponse.json({ runId: run.id, suggestions });
}

export async function POST(_request: NextRequest, context: InvoiceCodingRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in before requesting GL coding recommendations." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });
  const { invoiceId } = await context.params;
  const database = getDatabase();
  const [invoice] = await database
    .select({ id: invoices.id, sourceVersion: invoices.sourceVersion, clientId: invoices.accountingClientId, extractedData: invoices.extractedData })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, workspace.id)))
    .limit(1);
  if (!invoice) return NextResponse.json({ error: "Invoice not found in this workspace." }, { status: 404 });
  if (!invoice.clientId) return NextResponse.json({ error: "Assign this invoice to a client before requesting GL coding." }, { status: 409 });
  if (!invoice.extractedData || !Array.isArray(invoice.extractedData.lineItems)) {
    return NextResponse.json({ error: "Extract invoice line items before requesting GL coding." }, { status: 409 });
  }

  const [client] = await database
    .select({ id: accountingClients.id, legalName: accountingClients.legalName })
    .from(accountingClients)
    .where(and(
      eq(accountingClients.id, invoice.clientId),
      eq(accountingClients.organizationId, workspace.id),
      eq(accountingClients.status, "active"),
    ))
    .limit(1);
  if (!client) return NextResponse.json({ error: "The invoice client is no longer available." }, { status: 409 });

  const lines = invoice.extractedData.lineItems.flatMap((item, lineIndex) => {
    if (!isRecord(item)) return [];
    const description = fieldValue(item.description);
    if (!description) return [];
    return [{ lineIndex, description, amount: fieldValue(item.amount) }];
  });
  if (lines.length !== invoice.extractedData.lineItems.length) {
    return NextResponse.json({ error: "Every invoice line needs a readable description before coding can be recommended." }, { status: 409 });
  }

  const accounts = await database
    .select({
      id: clientGlAccounts.id,
      code: clientGlAccounts.code,
      name: clientGlAccounts.name,
      accountType: clientGlAccounts.accountType,
      description: clientGlAccounts.description,
    })
    .from(clientGlAccounts)
    .where(and(
      eq(clientGlAccounts.organizationId, workspace.id),
      eq(clientGlAccounts.clientId, client.id),
      eq(clientGlAccounts.status, "active"),
    ));
  if (accounts.length === 0) return NextResponse.json({ error: "Add this client’s chart of accounts before requesting coding." }, { status: 409 });

  const now = new Date();
  const [run] = await database
    .insert(agentRuns)
    .values({
      organizationId: workspace.id,
      productKey: "accounting",
      agentKey: "invoice-gl-coding",
      status: "running",
      promptVersion: glCodingPromptVersion,
      agentVersion: "1",
      sourceType: "invoice",
      sourceId: invoice.id,
      startedAt: now,
    })
    .returning({ id: agentRuns.id });
  if (!run) return NextResponse.json({ error: "Could not start the coding recommendation run." }, { status: 500 });

  try {
    const recommendations = await glCodingTool.execute({
      supplierName: fieldValue(invoice.extractedData.supplierName),
      lines,
      accounts: accounts.map(({ code, name, accountType, description }) => ({ code, name, accountType, description })),
    });
    const createdAt = new Date();
    await database.transaction(async (transaction) => {
      await transaction.insert(invoiceLineCodingSuggestions).values(recommendations.recommendations.map((recommendation) => {
        const account = accounts.find((candidate) => candidate.code === recommendation.accountCode);
        return {
          organizationId: workspace.id,
          productKey: "accounting",
          agentRunId: run.id,
          invoiceId: invoice.id,
          invoiceSourceVersion: invoice.sourceVersion,
          clientId: client.id,
          lineIndex: recommendation.lineIndex,
          recommendedGlAccountId: account?.id ?? null,
          rationale: recommendation.rationale,
          evidence: { excerpts: recommendation.evidence },
          confidence: recommendation.confidence === null ? null : String(recommendation.confidence),
          modelKey: recommendations.modelKey,
          promptVersion: glCodingPromptVersion,
          status: "suggested",
          createdAt,
        };
      }));
      await transaction.update(agentRuns).set({
        status: "completed",
        modelKey: recommendations.modelKey,
        result: { suggestionCount: recommendations.recommendations.length },
        completedAt: new Date(),
      }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
    });
    return NextResponse.json({ runId: run.id, recommendations: recommendations.recommendations }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GL coding recommendation failed.";
    await database.update(agentRuns).set({
      status: "failed",
      errorCode: "GL_CODING_FAILED",
      errorSummary: message.slice(0, 1000),
      completedAt: new Date(),
    }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
    console.error("[accounting:gl-coding] Recommendation run failed", { organizationId: workspace.id, invoiceId, runId: run.id, error: message });
    return NextResponse.json({ error: "Could not create GL coding recommendations.", runId: run.id }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest, context: InvoiceCodingRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to review a coding recommendation." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });
  const { invoiceId } = await context.params;

  let body: ReviewCodingRequest;
  try {
    body = (await request.json()) as ReviewCodingRequest;
  } catch {
    return NextResponse.json({ error: "Provide a coding recommendation decision." }, { status: 400 });
  }
  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId.trim() : "";
  const action = body.action === "approve" || body.action === "reject" ? body.action : null;
  const glAccountId = typeof body.glAccountId === "string" ? body.glAccountId.trim() : "";
  if (!suggestionId || !action || (action === "approve" && !glAccountId)) {
    return NextResponse.json({ error: "Choose a client GL account and approve, or reject the suggestion." }, { status: 400 });
  }

  const database = getDatabase();
  const [suggestion] = await database
    .select({
      id: invoiceLineCodingSuggestions.id,
      clientId: invoiceLineCodingSuggestions.clientId,
      recommendedGlAccountId: invoiceLineCodingSuggestions.recommendedGlAccountId,
      lineIndex: invoiceLineCodingSuggestions.lineIndex,
      agentRunId: invoiceLineCodingSuggestions.agentRunId,
      rationale: invoiceLineCodingSuggestions.rationale,
      confidence: invoiceLineCodingSuggestions.confidence,
      invoiceSourceVersion: invoiceLineCodingSuggestions.invoiceSourceVersion,
    })
    .from(invoiceLineCodingSuggestions)
    .where(and(
      eq(invoiceLineCodingSuggestions.id, suggestionId),
      eq(invoiceLineCodingSuggestions.invoiceId, invoiceId),
      eq(invoiceLineCodingSuggestions.organizationId, workspace.id),
      eq(invoiceLineCodingSuggestions.status, "suggested"),
    ))
    .limit(1);
  if (!suggestion) return NextResponse.json({ error: "This coding suggestion is no longer available for review." }, { status: 404 });

  const [invoice] = await database
    .select({ sourceVersion: invoices.sourceVersion })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, workspace.id)))
    .limit(1);
  if (!invoice || invoice.sourceVersion !== suggestion.invoiceSourceVersion) {
    return NextResponse.json({ error: "This suggestion refers to an older version of the invoice. Request coding again." }, { status: 409 });
  }

  let selectedAccount: { id: string; code: string; name: string } | null = null;
  if (action === "approve") {
    const [account] = await database
      .select({ id: clientGlAccounts.id, code: clientGlAccounts.code, name: clientGlAccounts.name })
      .from(clientGlAccounts)
      .where(and(
        eq(clientGlAccounts.id, glAccountId),
        eq(clientGlAccounts.organizationId, workspace.id),
        eq(clientGlAccounts.clientId, suggestion.clientId),
        eq(clientGlAccounts.status, "active"),
      ))
      .limit(1);
    if (!account) return NextResponse.json({ error: "Choose an active GL account from this client’s chart." }, { status: 400 });
    selectedAccount = account;
  }

  const now = new Date();
  await database.transaction(async (transaction) => {
    await transaction.update(invoiceLineCodingSuggestions).set({
      status: action === "approve" ? "approved" : "rejected",
      approvedGlAccountId: selectedAccount?.id ?? null,
      reviewedByUserId: userId,
      reviewedAt: now,
    }).where(and(
      eq(invoiceLineCodingSuggestions.id, suggestion.id),
      eq(invoiceLineCodingSuggestions.organizationId, workspace.id),
    ));
    await transaction.insert(learningEvents).values({
      organizationId: workspace.id,
      productKey: "accounting",
      agentRunId: suggestion.agentRunId,
      eventType: "gl_coding_recommendation_reviewed",
      sourceType: "invoice",
      sourceId: invoiceId,
      subjectType: "invoice_line",
      subjectId: invoiceId + ":" + suggestion.lineIndex,
      actorUserId: userId,
      proposedValue: suggestion.recommendedGlAccountId,
      finalValue: selectedAccount?.id ?? null,
      details: { decision: action, confidence: suggestion.confidence, rationale: suggestion.rationale },
      occurredAt: now,
    });
  });
  return NextResponse.json({ suggestionId: suggestion.id, status: action === "approve" ? "approved" : "rejected", account: selectedAccount });
}
