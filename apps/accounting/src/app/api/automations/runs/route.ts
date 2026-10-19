import { and, desc, eq, or } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { agentRuns, getDatabase, invoiceExtractionAttempts, invoices } from "@beezops/database";
import { authOptions } from "../../../../auth";
import { getWorkspaceForUser } from "../../../../tenant-service";

export async function GET() {
  try {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view agent runs." }, { status: 401 });

  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ runs: [] });

  const rows = await getDatabase()
    .select({
      id: invoiceExtractionAttempts.id,
      invoiceId: invoiceExtractionAttempts.invoiceId,
      workflowRunId: invoiceExtractionAttempts.workflowRunId,
      sourceFileName: invoices.sourceFileName,
      triggerSource: invoiceExtractionAttempts.triggerSource,
      status: invoiceExtractionAttempts.status,
      modelKey: invoiceExtractionAttempts.modelKey,
      promptVersion: invoiceExtractionAttempts.promptVersion,
      schemaVersion: invoiceExtractionAttempts.schemaVersion,
      errorSummary: invoiceExtractionAttempts.errorSummary,
      startedAt: invoiceExtractionAttempts.startedAt,
      completedAt: invoiceExtractionAttempts.completedAt,
      createdAt: invoiceExtractionAttempts.createdAt,
    })
    .from(invoiceExtractionAttempts)
    .innerJoin(invoices, and(
      eq(invoiceExtractionAttempts.invoiceId, invoices.id),
      eq(invoiceExtractionAttempts.organizationId, invoices.organizationId),
    ))
    .where(eq(invoiceExtractionAttempts.organizationId, workspace.id))
    .orderBy(desc(invoiceExtractionAttempts.createdAt))
    .limit(100);

  const extractionRows = rows.map((run) => ({ ...run, runType: "invoice_extraction" }));

  const agentRows = await getDatabase()
    .select({
      id: agentRuns.id,
      agentKey: agentRuns.agentKey,
      invoiceId: agentRuns.sourceId,
      workflowRunId: agentRuns.id,
      sourceFileName: invoices.sourceFileName,
      status: agentRuns.status,
      modelKey: agentRuns.modelKey,
      promptVersion: agentRuns.promptVersion,
      errorSummary: agentRuns.errorSummary,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .innerJoin(invoices, and(
      eq(agentRuns.sourceId, invoices.id),
      eq(agentRuns.organizationId, invoices.organizationId),
    ))
    .where(and(
      eq(agentRuns.organizationId, workspace.id),
      eq(agentRuns.productKey, "accounting"),
      or(
        eq(agentRuns.agentKey, "invoice-gl-coding"),
        eq(agentRuns.agentKey, "invoice-payment-reconciliation"),
      ),
    ))
    .orderBy(desc(agentRuns.createdAt))
    .limit(100);

  const codingRows = agentRows.map(({ agentKey, ...run }) => ({
    ...run,
    triggerSource: "agent_reasoning",
    schemaVersion: "not_applicable",
    runType: agentKey === "invoice-payment-reconciliation" ? "reconciliation" : "gl_coding",
  }));

  const statementRows = await getDatabase()
    .select({
      id: agentRuns.id,
      agentKey: agentRuns.agentKey,
      result: agentRuns.result,
      workflowRunId: agentRuns.id,
      status: agentRuns.status,
      modelKey: agentRuns.modelKey,
      promptVersion: agentRuns.promptVersion,
      errorSummary: agentRuns.errorSummary,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.organizationId, workspace.id),
      eq(agentRuns.productKey, "accounting"),
      or(
        eq(agentRuns.agentKey, "bank-statement-extraction"),
        eq(agentRuns.agentKey, "bank-statement-import"),
      ),
    ))
    .orderBy(desc(agentRuns.createdAt))
    .limit(100);

  const bankRows = statementRows.map(({ agentKey, result, ...run }) => ({
    ...run,
    invoiceId: null,
    sourceFileName: typeof result?.sourceFileName === "string" ? result.sourceFileName : "Bank statement",
    triggerSource: "bank_statement",
    schemaVersion: "not_applicable",
    runType: agentKey === "bank-statement-extraction" ? "bank_statement_extraction" : "bank_statement_import",
  }));

  const runs = [...extractionRows, ...codingRows, ...bankRows]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 100);

  return NextResponse.json({ runs });
  } catch (error) {
    console.error("[accounting:agent-runs] Failed to load runs", error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : { error: String(error) });
    return NextResponse.json({ error: "Could not load agent runs." }, { status: 500 });
  }
}
