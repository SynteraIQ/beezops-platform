import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  accountingClients,
  bankTransactions,
  getDatabase,
  invoicePaymentMatches,
  invoices,
  learningEvents,
} from "@beezops/database";
import { authOptions } from "../../../../../auth";
import { getWorkspaceForUser } from "../../../../../tenant-service";

type MatchRouteContext = {
  params: Promise<{ matchId: string }>;
};

interface ReviewMatchRequest {
  action?: unknown;
  matchedAmount?: unknown;
}

function toUnits(value: string): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 10000) : null;
}

function fieldValue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function PATCH(request: NextRequest, context: MatchRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to review a payment match." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });
  const { matchId } = await context.params;

  let body: ReviewMatchRequest;
  try {
    body = (await request.json()) as ReviewMatchRequest;
  } catch {
    return NextResponse.json({ error: "Choose whether to confirm or reject this match." }, { status: 400 });
  }
  const action = body.action === "confirm" || body.action === "reject" ? body.action : null;
  const amountValue = typeof body.matchedAmount === "string" || typeof body.matchedAmount === "number" ? String(body.matchedAmount).trim() : "";
  if (!action || (action === "confirm" && !amountValue)) {
    return NextResponse.json({ error: "Provide an allocation amount and decision." }, { status: 400 });
  }

  const database = getDatabase();
  const [match] = await database
    .select({
      id: invoicePaymentMatches.id,
      invoiceId: invoicePaymentMatches.invoiceId,
      bankTransactionId: invoicePaymentMatches.bankTransactionId,
      clientId: invoicePaymentMatches.clientId,
      agentRunId: invoicePaymentMatches.agentRunId,
      invoiceSourceVersion: invoicePaymentMatches.invoiceSourceVersion,
      matchedAmount: invoicePaymentMatches.matchedAmount,
      status: invoicePaymentMatches.status,
    })
    .from(invoicePaymentMatches)
    .where(and(
      eq(invoicePaymentMatches.id, matchId),
      eq(invoicePaymentMatches.organizationId, workspace.id),
      eq(invoicePaymentMatches.status, "suggested"),
    ))
    .limit(1);
  if (!match) return NextResponse.json({ error: "This payment suggestion is no longer available." }, { status: 404 });

  const [[invoice], [bankTransaction], [client]] = await Promise.all([
    database.select({ id: invoices.id, sourceVersion: invoices.sourceVersion, clientId: invoices.accountingClientId, extractedData: invoices.extractedData })
      .from(invoices)
      .where(and(eq(invoices.id, match.invoiceId), eq(invoices.organizationId, workspace.id)))
      .limit(1),
    database.select({ id: bankTransactions.id, clientId: bankTransactions.clientId, direction: bankTransactions.direction, amount: bankTransactions.amount, currency: bankTransactions.currency })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, match.bankTransactionId), eq(bankTransactions.organizationId, workspace.id)))
      .limit(1),
    database.select({ id: accountingClients.id })
      .from(accountingClients)
      .where(and(eq(accountingClients.id, match.clientId), eq(accountingClients.organizationId, workspace.id), eq(accountingClients.status, "active")))
      .limit(1),
  ]);
  if (!invoice || !bankTransaction || !client || invoice.clientId !== match.clientId || bankTransaction.clientId !== match.clientId || bankTransaction.direction !== "debit") {
    return NextResponse.json({ error: "Invoice, transaction, or client scope no longer matches." }, { status: 409 });
  }
  if (invoice.sourceVersion !== match.invoiceSourceVersion) {
    return NextResponse.json({ error: "This suggestion refers to an older version of the invoice. Run reconciliation again." }, { status: 409 });
  }
  let normalizedMatchedAmount: string | null = null;
  if (action === "confirm") {
    const matchedUnits = toUnits(amountValue);
    const invoiceTotal = invoice.extractedData ? fieldValue(invoice.extractedData.totalAmount) : null;
    const invoiceCurrency = invoice.extractedData ? fieldValue(invoice.extractedData.currency)?.toUpperCase() : null;
    const transactionCurrency = bankTransaction.currency.toUpperCase();
    if (matchedUnits === null || matchedUnits <= 0 || !invoiceTotal || !invoiceCurrency || invoiceCurrency !== transactionCurrency) {
      return NextResponse.json({ error: "The amount or currency is invalid for this payment." }, { status: 400 });
    }
    const [invoiceAllocations, transactionAllocations] = await Promise.all([
      database.select({ matchedAmount: invoicePaymentMatches.matchedAmount }).from(invoicePaymentMatches).where(and(
        eq(invoicePaymentMatches.organizationId, workspace.id),
        eq(invoicePaymentMatches.invoiceId, invoice.id),
        eq(invoicePaymentMatches.invoiceSourceVersion, invoice.sourceVersion),
        eq(invoicePaymentMatches.status, "confirmed"),
      )),
      database.select({ matchedAmount: invoicePaymentMatches.matchedAmount }).from(invoicePaymentMatches).where(and(
        eq(invoicePaymentMatches.organizationId, workspace.id),
        eq(invoicePaymentMatches.bankTransactionId, bankTransaction.id),
        eq(invoicePaymentMatches.status, "confirmed"),
      )),
    ]);
    const invoicePaid = invoiceAllocations.reduce((sum, allocation) => sum + (toUnits(allocation.matchedAmount) ?? 0), 0);
    const transactionAllocated = transactionAllocations.reduce((sum, allocation) => sum + (toUnits(allocation.matchedAmount) ?? 0), 0);
    const invoiceDue = (toUnits(invoiceTotal) ?? 0) - invoicePaid;
    const transactionAvailable = (toUnits(bankTransaction.amount) ?? 0) - transactionAllocated;
    if (matchedUnits > invoiceDue || matchedUnits > transactionAvailable) {
      return NextResponse.json({ error: "The allocation exceeds the invoice balance or unallocated transaction amount." }, { status: 409 });
    }
    normalizedMatchedAmount = (matchedUnits / 10000).toFixed(4);
  }

  const now = new Date();
  const updated = await database.transaction(async (transaction) => {
    const [reviewed] = await transaction
      .update(invoicePaymentMatches)
      .set({
        status: action === "confirm" ? "confirmed" : "rejected",
        matchedAmount: normalizedMatchedAmount ?? match.matchedAmount,
        reviewedByUserId: userId,
        reviewedAt: now,
      })
      .where(and(
        eq(invoicePaymentMatches.id, match.id),
        eq(invoicePaymentMatches.organizationId, workspace.id),
        eq(invoicePaymentMatches.status, "suggested"),
      ))
      .returning({ id: invoicePaymentMatches.id });
    if (!reviewed) throw new Error("This payment suggestion was already reviewed.");
    await transaction.insert(learningEvents).values({
      organizationId: workspace.id,
      productKey: "accounting",
      agentRunId: match.agentRunId,
      eventType: "invoice_payment_match_reviewed",
      sourceType: "invoice",
      sourceId: invoice.id,
      subjectType: "bank_transaction",
      subjectId: bankTransaction.id,
      actorUserId: userId,
      proposedValue: { bankTransactionId: bankTransaction.id, matchedAmount: match.matchedAmount },
      finalValue: action === "confirm" ? { bankTransactionId: bankTransaction.id, matchedAmount: normalizedMatchedAmount ?? amountValue } : null,
      details: { decision: action },
      occurredAt: now,
    });
    return reviewed;
  });
  return NextResponse.json({ matchId: updated.id, status: action === "confirm" ? "confirmed" : "rejected" });
}
