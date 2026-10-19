"use client";

import { useCallback, useEffect, useState } from "react";

interface ClientOption {
  id: string;
  legalName: string;
}

interface InvoiceSummary {
  id: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  currency: string | null;
  extractedStatus: string;
  paidAmount: string;
  amountDue: string;
  paymentStatus: string;
}

interface BankTransactionRow {
  id: string;
  transactionDate: string;
  direction: string;
  amount: string;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  memo: string | null;
  allocatedAmount: string;
  availableAmount: string;
}

interface PaymentSuggestion {
  id: string;
  invoiceId: string;
  bankTransactionId: string;
  matchedAmount: string;
  status: string;
  rationale: string;
  evidence: { items?: string[] };
  transactionDate: string;
  transactionAmount: string;
  transactionCurrency: string;
  counterparty: string | null;
  reference: string | null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

async function fileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export function ReconciliationWorkspace() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [transactions, setTransactions] = useState<BankTransactionRow[]>([]);
  const [matches, setMatches] = useState<PaymentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/clients", { cache: "no-store" });
    const payload = (await response.json()) as { clients?: ClientOption[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load clients.");
    const rows = payload.clients ?? [];
    setClients(rows);
    setClientId((current) => current && rows.some((client) => client.id === current) ? current : rows[0]?.id ?? "");
  }, []);

  const loadReconciliation = useCallback(async (selectedClientId: string) => {
    if (!selectedClientId) {
      setInvoices([]);
      setTransactions([]);
      setMatches([]);
      return;
    }
    const response = await fetch(`/api/reconciliation?clientId=${encodeURIComponent(selectedClientId)}`, { cache: "no-store" });
    const payload = await response.json() as { invoices?: InvoiceSummary[]; transactions?: BankTransactionRow[]; matches?: PaymentSuggestion[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load reconciliation data.");
    setInvoices(payload.invoices ?? []);
    setTransactions(payload.transactions ?? []);
    const suggestions = payload.matches ?? [];
    setMatches(suggestions);
    setAllocations(Object.fromEntries(suggestions.map((match) => [match.id, match.matchedAmount])));
  }, []);

  useEffect(() => {
    void loadClients().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load clients.");
    }).finally(() => setLoading(false));
  }, [loadClients]);

  useEffect(() => {
    if (!clientId) return;
    void loadReconciliation(clientId).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load reconciliation data.");
    });
  }, [clientId, loadReconciliation]);

  async function importStatement() {
    if (!file || !clientId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const content = isPdf ? { pdfBase64: await fileAsBase64(file) } : { csvText: await file.text() };
      const response = await fetch("/api/reconciliation/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, fileName: file.name, ...content }),
        signal: AbortSignal.timeout(120_000),
      });
      const payload = await response.json() as { transactionCount?: number; error?: string };
      if (response.status === 409 && payload.error?.includes("already been imported")) {
        setFile(null);
        setNotice("This statement was already imported. Refreshing the transaction list.");
        setBusy(false);
        try {
          await loadReconciliation(clientId);
        } catch {
          setError("The statement was already imported, but the transaction list could not refresh. Reload the page to see it.");
        }
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Could not import the bank statement.");
      setFile(null);
      setNotice(`${payload.transactionCount ?? 0} transactions imported. The source file is not retained.`);
      setBusy(false);
      try {
        await loadReconciliation(clientId);
      } catch {
        setError("The statement was imported, but the transaction list could not refresh. Reload the page to see it.");
      }
    } catch (importError) {
      const timedOut = importError instanceof DOMException && importError.name === "TimeoutError";
      setError(timedOut
        ? "The import request timed out. The statement may still have been imported; reload Transactions before retrying."
        : importError instanceof Error ? importError.message : "Could not import the bank statement.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsvTemplate() {
    const contents = "date,direction,amount,currency,counterparty,reference,memo\n2026-10-01,debit,1250.00,USD,Example Vendor,INV-1001,Invoice payment\n";
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bank-statement-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function findCandidates(invoiceId: string) {
    setBusyId(invoiceId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/reconciliation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const payload = await response.json() as { candidateCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not find payment candidates.");
      setNotice(`${payload.candidateCount ?? 0} candidate transaction${payload.candidateCount === 1 ? "" : "s"} ranked from invoice and bank details. Review the evidence before confirming.`);
      await loadReconciliation(clientId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not find payment candidates.");
    } finally {
      setBusyId("");
    }
  }

  async function reviewMatch(match: PaymentSuggestion, action: "confirm" | "reject") {
    setBusyId(match.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/reconciliation/matches/${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, matchedAmount: allocations[match.id] ?? match.matchedAmount }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save the payment review.");
      setNotice(action === "confirm" ? "Payment allocation confirmed." : "Payment candidate rejected.");
      await loadReconciliation(clientId);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not save the payment review.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <p className="client-directory-state">Loading reconciliation…</p>;
  return (
    <div className="workspace-content reconciliation-workspace">
      {clients.length > 0 ? (
        <section className="reconciliation-card">
          <label className="reconciliation-client-select">Client
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.legalName}</option>)}
            </select>
          </label>
          <div className="reconciliation-import">
            <div><strong>Import a bank statement</strong><span>Upload a CSV or PDF. PDFs are sent to OpenAI for transaction extraction; transaction details are also sent to OpenAI to rank invoice matches. The source file is discarded after import, while normalized transactions remain available for reconciliation. Review every suggested match before confirming.</span></div>
            <button className="text-button" type="button" onClick={() => void downloadCsvTemplate()}>Download CSV template</button>
            <input type="file" accept=".csv,text/csv,.pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <button className="primary-button" type="button" onClick={() => void importStatement()} disabled={busy || !file || (file.name.toLowerCase().endsWith(".pdf") ? file.size > 2_500_000 : file.size > 2_000_000)}>{busy ? "Importing…" : "Import statement"}</button>
            {file && file.size > (file.name.toLowerCase().endsWith(".pdf") ? 2_500_000 : 2_000_000) ? <small>Maximum size is 2.5 MB for PDFs and 2 MB for CSV files.</small> : null}
          </div>
        </section>
      ) : (
        <section className="empty-panel page-empty"><div className="empty-symbol">◇</div><strong>Create a client first</strong><p>Assign an invoice to a client from the Invoices page before importing that client’s statement.</p></section>
      )}
      {notice ? <p className="invoice-client-message">{notice}</p> : null}
      {error ? <p className="invoice-client-error" role="alert">{error}</p> : null}
      {clients.length > 0 ? (
        <>
          <section className="reconciliation-card">
            <div className="section-heading"><div><span className="section-kicker">INVOICE BALANCES</span><h2>Payable invoices</h2></div></div>
            {invoices.length === 0 ? <p className="client-directory-state">No invoices are assigned to this client yet.</p> : (
              <div className="reconciliation-invoice-list">
                {invoices.map((invoice) => (
                  <article className="reconciliation-invoice-row" key={invoice.id}>
                    <div><strong>{invoice.supplierName ?? "Supplier not extracted"}</strong><span>{invoice.invoiceNumber ?? "No invoice number"}{invoice.invoiceDate ? ` · ${invoice.invoiceDate}` : ""}</span></div>
                    <span>{invoice.paidAmount} / {invoice.totalAmount ?? "—"} {invoice.currency ?? ""}</span>
                    <span className={`reconciliation-status reconciliation-status-${invoice.paymentStatus}`}>{invoice.paymentStatus.replaceAll("_", " ")}</span>
                    <button className="secondary-button" type="button" onClick={() => void findCandidates(invoice.id)} disabled={busyId === invoice.id || invoice.paymentStatus === "paid" || !invoice.totalAmount || !invoice.currency}>{busyId === invoice.id ? "Checking…" : "Find payment"}</button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="reconciliation-card">
            <div className="section-heading"><div><span className="section-kicker">HUMAN CONFIRMATION</span><h2>Payment candidates</h2></div></div>
            {matches.filter((match) => match.status === "suggested").length === 0 ? <p className="client-directory-state">No suggested payment candidates. Run “Find payment” on an invoice with an imported statement.</p> : (
              <div className="reconciliation-match-list">
                {matches.filter((match) => match.status === "suggested").map((match) => {
                  const invoice = invoices.find((item) => item.id === match.invoiceId);
                  return (
                    <article className="reconciliation-match-row" key={match.id}>
                      <div><strong>{invoice?.supplierName ?? "Invoice"} · {invoice?.invoiceNumber ?? ""}</strong><span>{formatDate(match.transactionDate)} · {match.counterparty ?? match.reference ?? "Bank debit"} · {match.transactionAmount} {match.transactionCurrency}</span><small>{match.rationale}</small>{match.evidence.items?.map((item, index) => <small key={index}>Evidence: {item}</small>)}</div>
                      <label>Allocate
                        <input value={allocations[match.id] ?? match.matchedAmount} onChange={(event) => setAllocations((current) => ({ ...current, [match.id]: event.target.value }))} inputMode="decimal" />
                      </label>
                      <div className="reconciliation-match-actions">
                        <button className="primary-button" type="button" onClick={() => void reviewMatch(match, "confirm")} disabled={busyId === match.id}>{busyId === match.id ? "Saving…" : "Confirm"}</button>
                        <button className="secondary-button" type="button" onClick={() => void reviewMatch(match, "reject")} disabled={busyId === match.id}>Reject</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section className="reconciliation-card">
            <div className="section-heading"><div><span className="section-kicker">IMPORTED BANK DATA</span><h2>Transactions</h2></div></div>
            {transactions.length === 0 ? <p className="client-directory-state">No statement transactions imported for this client.</p> : (
              <div className="reconciliation-transaction-list">
                {transactions.map((transaction) => (
                  <div className="reconciliation-transaction-row" key={transaction.id}><span>{formatDate(transaction.transactionDate)}</span><strong>{transaction.counterparty ?? "Counterparty not provided"}</strong><span>{transaction.reference ?? transaction.memo ?? "No reference"}</span><span>{transaction.direction} · {transaction.amount} {transaction.currency}</span><span>Available {transaction.availableAmount}</span></div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
