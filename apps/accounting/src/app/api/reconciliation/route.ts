import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  accountingClients,
  bankTransactions,
  getDatabase,
  invoicePaymentMatches,
  invoices,
} from "@beezops/database";
import { authOptions } from "../../../auth";
import { getWorkspaceForUser } from "../../../tenant-service";

function fieldValue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function amountUnits(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 10000) : 0;
}

function amountString(units: number): string {
  return (units / 10000).toFixed(4);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view reconciliation." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ invoices: [], transactions: [], matches: [] });
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) return NextResponse.json({ invoices: [], transactions: [], matches: [] });

  const database = getDatabase();
  const [client] = await database
    .select({ id: accountingClients.id })
    .from(accountingClients)
    .where(and(
      eq(accountingClients.id, clientId),
      eq(accountingClients.organizationId, workspace.id),
      eq(accountingClients.status, "active"),
    ))
    .limit(1);
  if (!client) return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });

  const invoiceRows = await database
    .select({ id: invoices.id, sourceVersion: invoices.sourceVersion, extractedData: invoices.extractedData, status: invoices.status })
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, workspace.id),
      eq(invoices.accountingClientId, client.id),
    ))
    .orderBy(desc(invoices.updatedAt));
  const transactionRows = await database
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
    ))
    .orderBy(desc(bankTransactions.transactionDate));
  const matches = await database
    .select({
      id: invoicePaymentMatches.id,
      invoiceId: invoicePaymentMatches.invoiceId,
      bankTransactionId: invoicePaymentMatches.bankTransactionId,
      matchedAmount: invoicePaymentMatches.matchedAmount,
      status: invoicePaymentMatches.status,
      rationale: invoicePaymentMatches.rationale,
      evidence: invoicePaymentMatches.evidence,
      createdAt: invoicePaymentMatches.createdAt,
      invoiceSourceVersion: invoicePaymentMatches.invoiceSourceVersion,
      transactionDate: bankTransactions.transactionDate,
      transactionAmount: bankTransactions.amount,
      transactionCurrency: bankTransactions.currency,
      counterparty: bankTransactions.counterparty,
      reference: bankTransactions.reference,
    })
    .from(invoicePaymentMatches)
    .innerJoin(bankTransactions, and(
      eq(invoicePaymentMatches.bankTransactionId, bankTransactions.id),
      eq(invoicePaymentMatches.organizationId, bankTransactions.organizationId),
    ))
    .innerJoin(invoices, and(
      eq(invoicePaymentMatches.invoiceId, invoices.id),
      eq(invoicePaymentMatches.organizationId, invoices.organizationId),
    ))
    .where(and(
      eq(invoicePaymentMatches.organizationId, workspace.id),
      eq(invoicePaymentMatches.clientId, client.id),
      eq(invoicePaymentMatches.invoiceSourceVersion, invoices.sourceVersion),
    ))
    .orderBy(desc(invoicePaymentMatches.createdAt));

  const paidByInvoice = new Map<string, number>();
  const allocatedByTransaction = new Map<string, number>();
  for (const match of matches) {
    if (match.status !== "confirmed") continue;
    const units = amountUnits(match.matchedAmount);
    paidByInvoice.set(match.invoiceId, (paidByInvoice.get(match.invoiceId) ?? 0) + units);
    allocatedByTransaction.set(match.bankTransactionId, (allocatedByTransaction.get(match.bankTransactionId) ?? 0) + units);
  }

  const invoiceSummaries = invoiceRows.map((invoice) => {
    const amount = invoice.extractedData ? fieldValue(invoice.extractedData.totalAmount) : null;
    const currency = invoice.extractedData ? fieldValue(invoice.extractedData.currency) : null;
    const totalUnits = amount ? amountUnits(amount) : 0;
    const paidUnits = paidByInvoice.get(invoice.id) ?? 0;
    const dueUnits = Math.max(0, totalUnits - paidUnits);
    return {
      id: invoice.id,
      supplierName: invoice.extractedData ? fieldValue(invoice.extractedData.supplierName) : null,
      invoiceNumber: invoice.extractedData ? fieldValue(invoice.extractedData.invoiceNumber) : null,
      invoiceDate: invoice.extractedData ? fieldValue(invoice.extractedData.invoiceDate) : null,
      totalAmount: amount,
      currency,
      extractedStatus: invoice.status,
      paidAmount: amountString(paidUnits),
      amountDue: amountString(dueUnits),
      paymentStatus: totalUnits <= 0 ? "not_ready" : dueUnits === 0 ? "paid" : paidUnits > 0 ? "partially_paid" : "unpaid",
    };
  });
  const transactions = transactionRows.map((transaction) => {
    const totalUnits = amountUnits(transaction.amount);
    const allocatedUnits = allocatedByTransaction.get(transaction.id) ?? 0;
    return {
      ...transaction,
      allocatedAmount: amountString(allocatedUnits),
      availableAmount: amountString(Math.max(0, totalUnits - allocatedUnits)),
    };
  });
  return NextResponse.json({ invoices: invoiceSummaries, transactions, matches });
}
