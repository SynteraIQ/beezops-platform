import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  accountingClients,
  agentRuns,
  bankTransactions,
  getDatabase,
  invoicePaymentMatches,
  invoices,
} from "@beezops/database";
import { authOptions } from "../../../../auth";
import { getWorkspaceForUser } from "../../../../tenant-service";
import {
  paymentReconciliationPromptVersion,
  paymentReconciliationTool,
} from "@beezops/domain-accounting/tools/payment-reconciliation";

interface ReconciliationRunRequest {
  invoiceId?: unknown;
}

function fieldValue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function toUnits(value: string): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 10000) : null;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in before reconciling an invoice." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });

  let body: ReconciliationRunRequest;
  try {
    body = (await request.json()) as ReconciliationRunRequest;
  } catch {
    return NextResponse.json({ error: "Choose an invoice to reconcile." }, { status: 400 });
  }
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  if (!invoiceId) return NextResponse.json({ error: "Choose an invoice to reconcile." }, { status: 400 });

  const database = getDatabase();
  const [invoice] = await database
    .select({ id: invoices.id, sourceVersion: invoices.sourceVersion, clientId: invoices.accountingClientId, extractedData: invoices.extractedData })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, workspace.id)))
    .limit(1);
  if (!invoice) return NextResponse.json({ error: "Invoice not found in this workspace." }, { status: 404 });
  if (!invoice.clientId || !invoice.extractedData) return NextResponse.json({ error: "Assign a client and extract the invoice before reconciling." }, { status: 409 });

  const amountDue = fieldValue(invoice.extractedData.totalAmount);
  const currency = fieldValue(invoice.extractedData.currency)?.toUpperCase() ?? null;
  const invoiceNumber = fieldValue(invoice.extractedData.invoiceNumber);
  const supplierName = fieldValue(invoice.extractedData.supplierName);
  const invoiceUnits = amountDue ? toUnits(amountDue) : null;
  if (invoiceUnits === null || invoiceUnits <= 0 || !currency) {
    return NextResponse.json({ error: "Invoice amount and currency are needed before reconciliation." }, { status: 409 });
  }
  const [client] = await database
    .select({ id: accountingClients.id })
    .from(accountingClients)
    .where(and(
      eq(accountingClients.id, invoice.clientId),
      eq(accountingClients.organizationId, workspace.id),
      eq(accountingClients.status, "active"),
    ))
    .limit(1);
  if (!client) return NextResponse.json({ error: "The invoice client is no longer available." }, { status: 409 });

  const priorConfirmedMatches = await database
    .select({ matchedAmount: invoicePaymentMatches.matchedAmount })
    .from(invoicePaymentMatches)
    .where(and(
      eq(invoicePaymentMatches.organizationId, workspace.id),
      eq(invoicePaymentMatches.invoiceId, invoice.id),
      eq(invoicePaymentMatches.invoiceSourceVersion, invoice.sourceVersion),
      eq(invoicePaymentMatches.status, "confirmed"),
    ));
  const paidUnits = priorConfirmedMatches.reduce((total, match) => total + (toUnits(match.matchedAmount) ?? 0), 0);
  const outstandingUnits = Math.max(0, invoiceUnits - paidUnits);
  if (outstandingUnits === 0) return NextResponse.json({ error: "This invoice is already fully allocated to confirmed payments." }, { status: 409 });

  const [run] = await database
    .insert(agentRuns)
    .values({
      organizationId: workspace.id,
      productKey: "accounting",
      agentKey: "invoice-payment-reconciliation",
      status: "running",
      promptVersion: paymentReconciliationPromptVersion,
      agentVersion: "1",
      sourceType: "invoice",
      sourceId: invoice.id,
      startedAt: new Date(),
    })
    .returning({ id: agentRuns.id });
  if (!run) return NextResponse.json({ error: "Could not start reconciliation." }, { status: 500 });

  try {
    const transactions = await database
      .select({
        id: bankTransactions.id,
        transactionDate: bankTransactions.transactionDate,
        direction: bankTransactions.direction,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
        counterparty: bankTransactions.counterparty,
        reference: bankTransactions.reference,
        memo: bankTransactions.memo,
      })
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.organizationId, workspace.id),
        eq(bankTransactions.clientId, client.id),
        eq(bankTransactions.direction, "debit"),
        eq(bankTransactions.currency, currency),
      ))
      .orderBy(desc(bankTransactions.transactionDate))
      .limit(100);

    const existingAllocations = await database
      .select({ bankTransactionId: invoicePaymentMatches.bankTransactionId, matchedAmount: invoicePaymentMatches.matchedAmount })
      .from(invoicePaymentMatches)
      .where(and(
        eq(invoicePaymentMatches.organizationId, workspace.id),
        eq(invoicePaymentMatches.status, "confirmed"),
      ));
    const priorSuggestions = await database
      .select({ bankTransactionId: invoicePaymentMatches.bankTransactionId })
      .from(invoicePaymentMatches)
      .where(and(
        eq(invoicePaymentMatches.organizationId, workspace.id),
        eq(invoicePaymentMatches.invoiceId, invoice.id),
        eq(invoicePaymentMatches.invoiceSourceVersion, invoice.sourceVersion),
      ));
    const previouslyEvaluatedTransactions = new Set(priorSuggestions.map((match) => match.bankTransactionId));
    const allocatedByTransaction = new Map<string, number>();
    for (const allocation of existingAllocations) {
      allocatedByTransaction.set(
        allocation.bankTransactionId,
        (allocatedByTransaction.get(allocation.bankTransactionId) ?? 0) + (toUnits(allocation.matchedAmount) ?? 0),
      );
    }
    const availableTransactions = transactions.flatMap((transaction) => {
      if (previouslyEvaluatedTransactions.has(transaction.id)) return [];
      const transactionUnits = toUnits(transaction.amount);
      if (transactionUnits === null) return [];
      const availableUnits = transactionUnits - (allocatedByTransaction.get(transaction.id) ?? 0);
      if (availableUnits <= 0) return [];
      return [{ transaction, availableUnits }];
    });
    const invoiceDate = fieldValue(invoice.extractedData.invoiceDate);
    const recommendations = await paymentReconciliationTool.execute({
      invoice: {
        id: invoice.id,
        invoiceNumber,
        supplierName,
        invoiceDate,
        currency,
        amountDue: (outstandingUnits / 10000).toFixed(4),
      },
      transactions: availableTransactions.map(({ transaction, availableUnits }) => ({
        id: transaction.id,
        transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
        direction: "debit" as const,
        amount: transaction.amount,
        availableAmount: (availableUnits / 10000).toFixed(4),
        currency: transaction.currency,
        counterparty: transaction.counterparty,
        reference: transaction.reference,
        memo: transaction.memo,
      })),
    });
    let remainingUnits = outstandingUnits;
    const candidates = recommendations.candidates.flatMap((candidate) => {
      const transaction = availableTransactions.find((item) => item.transaction.id === candidate.transactionId)?.transaction;
      const matchedUnits = toUnits(candidate.matchedAmount);
      if (!transaction || matchedUnits === null || matchedUnits <= 0 || matchedUnits > remainingUnits) return [];
      remainingUnits -= matchedUnits;
      return [{ transaction, matchedUnits, rationale: candidate.rationale, confidence: candidate.confidence, evidence: candidate.evidence }];
    });

    await database.transaction(async (transaction) => {
      if (candidates.length > 0) {
        await transaction.insert(invoicePaymentMatches).values(candidates.map((candidate) => ({
          organizationId: workspace.id,
          productKey: "accounting",
          agentRunId: run.id,
          clientId: client.id,
          invoiceId: invoice.id,
          invoiceSourceVersion: invoice.sourceVersion,
          bankTransactionId: candidate.transaction.id,
          matchedAmount: (candidate.matchedUnits / 10000).toFixed(4),
          status: "suggested",
          rationale: candidate.rationale,
          confidence: String(candidate.confidence),
          evidence: { items: candidate.evidence },
        })));
      }
      await transaction.update(agentRuns).set({
        status: "completed",
        modelKey: recommendations.modelKey,
        result: { candidateCount: candidates.length, invoiceId: invoice.id },
        completedAt: new Date(),
      }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
    });
    console.info("[accounting:reconciliation] AI-assisted candidate search completed", {
      organizationId: workspace.id,
      invoiceId: invoice.id,
      runId: run.id,
      candidateCount: candidates.length,
      modelKey: recommendations.modelKey,
    });
    return NextResponse.json({ runId: run.id, candidateCount: candidates.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reconcile the invoice.";
    await database.update(agentRuns).set({
      status: "failed",
      errorCode: "RECONCILIATION_FAILED",
      errorSummary: message.slice(0, 1000),
      completedAt: new Date(),
    }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
    console.error("[accounting:reconciliation] Candidate search failed", { organizationId: workspace.id, invoiceId, runId: run.id, error: message });
    return NextResponse.json({ error: "Could not reconcile the invoice.", runId: run.id }, { status: 500 });
  }
}
