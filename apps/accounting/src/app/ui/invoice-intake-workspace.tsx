"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { isInvoiceExtractionStuck } from "../../invoice-extraction-status";
import { AutomationRuns } from "./automation-runs";

interface GoogleDriveConnection {
  connectionId: string;
  status: string;
  createdAt: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version: string;
  size: string | null;
  webViewLink: string | null;
}

interface DriveFolder {
  id: string;
  name: string;
}

interface InvoiceSourceFolder {
  id: string;
  path: string;
}

interface InvoiceRecord {
  id: string;
  accountingClientId: string | null;
  connectionId: string;
  sourceFileId: string;
  sourceFileName: string;
  status: string;
  extractedData: Record<string, unknown> | null;
  validationIssues: unknown[];
  updatedAt: string;
}

interface AccountingClientRecord {
  id: string;
  legalName: string;
  billingAddress: Record<string, unknown>;
  status: string;
}

interface GlAccountOption {
  id: string;
  code: string;
  name: string;
}

interface LineCodingSuggestion {
  id: string;
  lineIndex: number;
  recommendedGlAccountId: string | null;
  approvedGlAccountId: string | null;
  rationale: string;
  evidence: { excerpts?: string[] };
  confidence: string | null;
  status: string;
  accountCode: string | null;
  accountName: string | null;
}

interface FieldDetail {
  value: string;
  evidence: string;
  confidence: number | null;
  page: number | null;
}

function readField(field: unknown): FieldDetail {
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return { value: "No value returned", evidence: "", confidence: null, page: null };
  }
  const record = field as Record<string, unknown>;
  const value = typeof record.value === "string" && record.value.trim() ? record.value : null;
  const emptyValue = record.availability === "not_present"
    ? "Not present on invoice"
    : record.availability === "unreadable"
      ? "Present but unreadable"
      : "No value returned";
  return {
    value: value ?? emptyValue,
    evidence: typeof record.evidence === "string" ? record.evidence : "",
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    page: typeof record.page === "number" ? record.page : null,
  };
}

function rawFieldValue(field: unknown): string {
  if (typeof field !== "object" || field === null || Array.isArray(field)) return "";
  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
}

function statusLabel(status: string, updatedAt: string): string {
  if (status === "ready_for_matching") return "Extraction complete";
  if (isInvoiceExtractionStuck(status, updatedAt)) return "Not responding · retry available";
  return status.replaceAll("_", " ");
}

function fieldsNeedingReview(issues: unknown[]): string[] {
  const labels: Record<string, string> = {
    supplier_name: "Supplier",
    invoice_number: "Invoice number",
    invoice_date: "Invoice date",
    currency: "Currency",
    total_amount: "Total",
  };
  return issues.flatMap((issue) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) return [];
    const record = issue as Record<string, unknown>;
    if (record.code !== "required_field_missing" || typeof record.field !== "string") return [];
    return [labels[record.field] ?? record.field];
  });
}

export function InvoiceIntakeWorkspace() {
  const [activeTab, setActiveTab] = useState<"invoices" | "runs">("invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [connections, setConnections] = useState<GoogleDriveConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [folderPath, setFolderPath] = useState<DriveFolder[]>([{ id: "root", name: "My Drive" }]);
  const [sourceFolder, setSourceFolder] = useState<InvoiceSourceFolder | null>(null);
  const [configuringFolder, setConfiguringFolder] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [clients, setClients] = useState<AccountingClientRecord[]>([]);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadInvoices = useCallback(async () => {
    const response = await fetch("/api/invoices", { cache: "no-store" });
    const payload = (await response.json()) as { invoices?: InvoiceRecord[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load invoices.");
    setInvoices(payload.invoices ?? []);
  }, []);

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/clients", { cache: "no-store" });
    const payload = (await response.json()) as { clients?: AccountingClientRecord[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load clients.");
    setClients(payload.clients ?? []);
  }, []);

  const loadConnections = useCallback(async () => {
    const response = await fetch("/api/connections/google-drive/status", { cache: "no-store" });
    const payload = (await response.json()) as { connections?: GoogleDriveConnection[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load Google Drive connections.");
    const activeConnections = (payload.connections ?? []).filter((connection) => connection.status === "active");
    const folderPreferences = await Promise.all(activeConnections.map(async (connection) => {
      try {
        const folderResponse = await fetch(
          "/api/invoices/source-folder?connectionId=" + encodeURIComponent(connection.connectionId),
          { cache: "no-store" },
        );
        if (!folderResponse.ok) return { connectionId: connection.connectionId, hasFolder: false };
        const folderPayload = (await folderResponse.json()) as { folder?: InvoiceSourceFolder | null };
        return { connectionId: connection.connectionId, hasFolder: Boolean(folderPayload.folder) };
      } catch {
        return { connectionId: connection.connectionId, hasFolder: false };
      }
    }));
    const preferredConnectionId = folderPreferences.find((preference) => preference.hasFolder)?.connectionId
      ?? activeConnections[0]?.connectionId
      ?? "";
    setConnections(activeConnections);
    setConnectionId((current) => current && activeConnections.some((item) => item.connectionId === current)
      ? current
      : preferredConnectionId);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadInvoices(), loadConnections(), loadClients()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load invoice workspace.");
    } finally {
      setLoading(false);
    }
  }, [loadClients, loadConnections, loadInvoices]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadFolderContents = useCallback(async (targetConnectionId: string, folderId: string) => {
    setLoadingFiles(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/invoices/files?connectionId=" + encodeURIComponent(targetConnectionId) + "&folderId=" + encodeURIComponent(folderId),
        { cache: "no-store" },
      );
      const payload = (await response.json()) as { files?: DriveFile[]; folders?: DriveFolder[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not browse Google Drive.");
      setFiles(payload.files ?? []);
      setFolders(payload.folders ?? []);
      setNotice((payload.folders?.length ?? 0) + " folders and " + (payload.files?.length ?? 0) + " files found.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not browse Google Drive.");
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const loadConfiguredFolder = useCallback(async (targetConnectionId: string) => {
    const response = await fetch(
      "/api/invoices/source-folder?connectionId=" + encodeURIComponent(targetConnectionId),
      { cache: "no-store" },
    );
    const payload = (await response.json()) as { folder?: InvoiceSourceFolder | null; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the invoice source folder.");
    const configured = payload.folder ?? null;
    setSourceFolder(configured);
    setConfiguringFolder(false);
    if (!configured) {
      setFiles([]);
      setFolders([]);
      return;
    }
    const pathParts = configured.path.split("/").filter(Boolean);
    const folderName = pathParts[pathParts.length - 1] ?? configured.path;
    setFolderPath([{ id: "root", name: "My Drive" }, { id: configured.id, name: folderName }]);
    await loadFolderContents(targetConnectionId, configured.id);
  }, [loadFolderContents]);

  useEffect(() => {
    if (!connectionId) {
      setSourceFolder(null);
      setFiles([]);
      setFolders([]);
      return;
    }
    void loadConfiguredFolder(connectionId).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load the invoice source folder.");
    });
  }, [connectionId, loadConfiguredFolder]);

  useEffect(() => {
    if (!invoices.some((invoice) => invoice.status === "queued" || invoice.status === "processing")) return;
    const timer = window.setInterval(() => {
      void loadInvoices().catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not refresh invoice status.");
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [invoices, loadInvoices]);

  useEffect(() => {
    if (!selectedInvoiceId || activeTab !== "invoices") return;
    document.getElementById(`invoice-${selectedInvoiceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeTab, invoices, selectedInvoiceId]);

  async function browseDriveFiles(folderId = folderPath[folderPath.length - 1]?.id ?? "root") {
    if (!connectionId) {
      setError("Connect Google Drive before browsing invoice files.");
      return;
    }
    await loadFolderContents(connectionId, folderId);
  }

  function openFolder(folder: DriveFolder) {
    const nextPath = [...folderPath, folder];
    setFolderPath(nextPath);
    void browseDriveFiles(folder.id);
  }

  function goToFolder(index: number) {
    const nextPath = folderPath.slice(0, index + 1);
    setFolderPath(nextPath);
    void browseDriveFiles(nextPath[nextPath.length - 1]?.id ?? "root");
  }

  async function saveCurrentFolder() {
    if (!connectionId) return;
    const currentFolder = folderPath[folderPath.length - 1];
    if (!currentFolder) return;
    setLoadingFiles(true);
    setError("");
    try {
      const response = await fetch("/api/invoices/source-folder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          folderId: currentFolder.id,
          folderPath: folderPath.map((folder) => folder.name).filter((name) => name !== "My Drive").join(" / ") || "My Drive",
        }),
      });
      const payload = (await response.json()) as { folder?: InvoiceSourceFolder; error?: string };
      if (!response.ok || !payload.folder) throw new Error(payload.error ?? "Could not save the invoice folder.");
      setSourceFolder(payload.folder);
      setConfiguringFolder(false);
      setNotice("Invoice folder saved. Its PDF files are listed below.");
      await loadFolderContents(connectionId, payload.folder.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the invoice folder.");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function startExtraction(file: DriveFile, targetConnectionId = connectionId, retryStuck = false) {
    if (!targetConnectionId) return;
    setBusyFileId(file.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/invoices/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: targetConnectionId,
          fileId: file.id,
          requestId: crypto.randomUUID(),
          retryStuck,
        }),
      });
      const payload = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not start extraction.");
      setNotice("Invoice extraction started. This page will update as the workflow progresses.");
      await loadInvoices();
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Could not start extraction.");
    } finally {
      setBusyFileId(null);
    }
  }

  return (
    <div className="workspace-content invoice-intake">
      <div className="invoice-tabs" role="tablist" aria-label="Invoice workspace">
        <button className={activeTab === "invoices" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "invoices"} onClick={() => setActiveTab("invoices")}>Invoices</button>
        <button className={activeTab === "runs" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "runs"} onClick={() => setActiveTab("runs")}>Processing runs</button>
      </div>
      {activeTab === "invoices" ? (
      <section className="invoice-source-card">
        <div className="section-heading">
          <div><span className="section-kicker">INVOICE INTAKE & EXTRACTION · V1</span><h2>Invoice source folder</h2></div>
        </div>
        <p className="invoice-source-copy">Choose a connected Drive account and set its invoice folder once. PDFs in that folder appear below with a Manual Extract action. The original stays in Drive; a temporary copy is sent to OpenAI for extraction. BeezOps stores extracted fields, evidence, validation issues, and run metadata.</p>
        {connections.length > 0 ? (
          <div className="invoice-source-controls">
            <label>
              Google Drive account
              <select value={connectionId} onChange={(event) => {
                setConnectionId(event.target.value);
                setFolderPath([{ id: "root", name: "My Drive" }]);
                setSourceFolder(null);
                setConfiguringFolder(false);
                setFiles([]);
                setFolders([]);
              }}>
                {connections.map((connection) => (
                  <option key={connection.connectionId} value={connection.connectionId}>
                    Connected account · {connection.connectionId.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
            {sourceFolder && !configuringFolder ? (
              <div className="invoice-selected-folder">
                <span>Configured invoice folder</span>
                <strong>{sourceFolder.path}</strong>
                <button className="secondary-button invoice-folder-change" type="button" disabled={loadingFiles || loading} onClick={() => {
                  setConfiguringFolder(true);
                  setFolderPath([{ id: "root", name: "My Drive" }]);
                  void browseDriveFiles("root");
                }}>{loadingFiles ? "Browsing…" : "Browse"}</button>
              </div>
            ) : !configuringFolder ? (
              <button className="primary-link invoice-action-button" type="button" onClick={() => {
                setConfiguringFolder(true);
                setFolderPath([{ id: "root", name: "My Drive" }]);
                void browseDriveFiles("root");
              }} disabled={loadingFiles || loading}>
                {loadingFiles ? "Browsing Drive…" : "Browse"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="invoice-connection-empty"><span>No active Google Drive connection.</span><Link href="/connections">Connect Google Drive ↗</Link></div>
        )}
        {notice ? <p className="invoice-notice" role="status">{notice}</p> : null}
        {error ? <p className="invoice-error" role="alert">{error}</p> : null}
        {configuringFolder ? (
          <nav className="invoice-folder-path" aria-label="Google Drive folder path">
            {folderPath.map((folder, index) => (
              <span key={folder.id}>
                {index > 0 ? <b aria-hidden="true">/</b> : null}
                <button type="button" onClick={() => goToFolder(index)} disabled={loadingFiles}>{folder.name}</button>
              </span>
            ))}
          </nav>
        ) : null}
        {configuringFolder ? (
          <button className="secondary-button invoice-use-folder" type="button" onClick={() => void saveCurrentFolder()} disabled={loadingFiles || !connectionId}>
            Use “{folderPath[folderPath.length - 1]?.name ?? "My Drive"}” as invoice folder
          </button>
        ) : null}
        {configuringFolder && folders.length > 0 ? (
          <div className="invoice-folder-list">
            {folders.map((folder) => (
              <button className="invoice-folder-row" key={folder.id} type="button" disabled={loadingFiles} onClick={() => openFolder(folder)}>
                <span aria-hidden="true">▰</span><strong>{folder.name}</strong><span>Open folder ↗</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="invoice-folder-invoices">
            <div className="section-heading"><div><span className="section-kicker">{configuringFolder ? "BROWSING GOOGLE DRIVE" : "INVOICE SOURCE"}</span><h2>Invoices</h2></div><button className="secondary-button" type="button" onClick={() => {
              if (connectionId) {
                const folderId = configuringFolder ? folderPath[folderPath.length - 1]?.id : sourceFolder?.id;
                if (folderId) void loadFolderContents(connectionId, folderId);
              }
              void loadInvoices();
            }} disabled={loading || loadingFiles}>Refresh</button></div>
            {loading || loadingFiles ? <p className="invoice-no-files">Loading Drive files…</p> : null}
            {!loading && files.length === 0 && invoices.length === 0 ? (
              <p className="invoice-no-files">{configuringFolder ? "No files in this folder. Open a folder above or choose this folder as the invoice source." : sourceFolder ? "No files were found in the configured folder." : "Choose a Drive folder above to see its files."}</p>
            ) : null}
            <div className="invoice-result-list">
              {files.map((file) => {
                const existingInvoice = invoices.find((invoice) => invoice.sourceFileId === file.id);
                const supportsManualExtraction = file.mimeType === "application/pdf";
                const stuck = existingInvoice ? isInvoiceExtractionStuck(existingInvoice.status, existingInvoice.updatedAt) : false;
                const busy = busyFileId === file.id || ((existingInvoice?.status === "queued" || existingInvoice?.status === "processing") && !stuck);
                return (
                  <article className={`invoice-result-card ${existingInvoice?.id === selectedInvoiceId ? "invoice-result-selected" : ""}`} id={existingInvoice ? `invoice-${existingInvoice.id}` : undefined} key={file.id}>
                    <div className="invoice-file-row">
                      <div className="invoice-file-copy">
                        <strong>{file.name}</strong>
                        <span>{file.mimeType === "application/pdf" ? "PDF" : file.mimeType}{file.modifiedTime ? " · Modified " + new Date(file.modifiedTime).toLocaleDateString() : ""}{file.size ? " · " + (Number(file.size) / 1024).toFixed(0) + " KB" : ""}</span>
                      </div>
                      {existingInvoice ? <span className={"invoice-status invoice-status-" + existingInvoice.status}>{statusLabel(existingInvoice.status, existingInvoice.updatedAt)}</span> : null}
                      <button
                        className="secondary-button invoice-extract-button"
                        type="button"
                        disabled={busy || !supportsManualExtraction}
                        title={supportsManualExtraction ? undefined : "Manual extraction currently supports PDF invoices."}
                        onClick={() => void startExtraction(file, connectionId, stuck)}
                      >
                        {busy ? "Processing…" : !supportsManualExtraction ? "PDF required" : existingInvoice ? "Extract again" : "Manual Extract"}
                      </button>
                    </div>
                    {existingInvoice ? <InvoiceDetails invoice={existingInvoice} clients={clients} onClientUpdated={() => void Promise.all([loadInvoices(), loadClients()])} expanded={existingInvoice.id === selectedInvoiceId} /> : null}
                  </article>
                );
              })}
              {invoices.filter((invoice) => !files.some((file) => file.id === invoice.sourceFileId)).map((invoice) => (
                <article className={`invoice-result-card ${invoice.id === selectedInvoiceId ? "invoice-result-selected" : ""}`} id={`invoice-${invoice.id}`} key={invoice.id}>
                  <div className="invoice-file-row">
                    <div className="invoice-file-copy"><strong>{invoice.sourceFileName}</strong><span>Previously processed · file is not in the current folder view</span></div>
                    <span className={"invoice-status invoice-status-" + invoice.status}>{statusLabel(invoice.status, invoice.updatedAt)}</span>
                    {invoice.status === "failed" || invoice.status === "ready_for_matching" || invoice.status === "needs_review" || isInvoiceExtractionStuck(invoice.status, invoice.updatedAt) ? (
                      <button
                        className="secondary-button invoice-extract-button"
                        type="button"
                        disabled={busyFileId === invoice.sourceFileId || ((invoice.status === "queued" || invoice.status === "processing") && !isInvoiceExtractionStuck(invoice.status, invoice.updatedAt))}
                        onClick={() => void startExtraction({
                          id: invoice.sourceFileId,
                          name: invoice.sourceFileName,
                          mimeType: "application/pdf",
                          modifiedTime: "",
                          version: "",
                          size: null,
                          webViewLink: null,
                        }, invoice.connectionId, isInvoiceExtractionStuck(invoice.status, invoice.updatedAt))}
                      >
                        {busyFileId === invoice.sourceFileId ? "Processing…" : "Extract again"}
                      </button>
                    ) : null}
                  </div>
                  <InvoiceDetails invoice={invoice} clients={clients} onClientUpdated={() => void Promise.all([loadInvoices(), loadClients()])} expanded={invoice.id === selectedInvoiceId} />
                </article>
              ))}
            </div>
          </div>
      </section>
      ) : (
        <AutomationRuns
          onViewInvoice={(invoiceId) => {
            setSelectedInvoiceId(invoiceId);
            setActiveTab("invoices");
          }}
          onViewInvoices={() => {
            setSelectedInvoiceId(null);
            setActiveTab("invoices");
          }}
        />
      )}

    </div>
  );
}

function ClientResolution({ invoice, clients, onSaved }: { invoice: InvoiceRecord; clients: AccountingClientRecord[]; onSaved: () => void }) {
  const billToName = rawFieldValue(invoice.extractedData?.billToName).trim();
  const billToAddress = rawFieldValue(invoice.extractedData?.billToAddress).trim();
  const exactMatches = billToName
    ? clients.filter((client) => client.legalName.trim().toLocaleLowerCase() === billToName.toLocaleLowerCase())
    : [];
  const exactMatchId = exactMatches.length === 1 ? exactMatches[0].id : "";
  const [selectedClientId, setSelectedClientId] = useState(invoice.accountingClientId ?? exactMatchId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(billToName);
  const [newAddress, setNewAddress] = useState(billToAddress);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedClientId(invoice.accountingClientId ?? exactMatchId);
  }, [exactMatchId, invoice.accountingClientId]);

  async function assignClient() {
    if (!selectedClientId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/client`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not assign the client.");
      setMessage("Invoice assigned to client.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not assign the client.");
    } finally {
      setBusy(false);
    }
  }

  async function createClient() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, legalName: newName, billingAddress: newAddress }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not create the client.");
      setCreating(false);
      setMessage("Client created and invoice assigned.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create the client.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="invoice-client-resolution" aria-label="Client assignment">
      <div className="invoice-client-resolution-heading">
        <div><strong>Client</strong><span>Bill To is a suggestion; confirm the client for this invoice.</span></div>
        {exactMatches.length > 0 ? <span className="invoice-client-match-label">Possible match</span> : null}
      </div>
      <div className="invoice-client-resolution-controls">
        <select aria-label="Assign invoice to client" value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)} disabled={busy || clients.length === 0}>
          <option value="">{clients.length ? "Choose a client" : "No clients created yet"}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.legalName}</option>
          ))}
        </select>
        <button className="secondary-button" type="button" onClick={() => void assignClient()} disabled={busy || !selectedClientId || selectedClientId === invoice.accountingClientId}>
          {busy && selectedClientId ? "Saving…" : "Assign"}
        </button>
        <button className="secondary-button" type="button" onClick={() => {
          setNewName(billToName);
          setNewAddress(billToAddress);
          setCreating((current) => !current);
          setError("");
          setMessage("");
        }} disabled={busy || !billToName}>
          {creating ? "Cancel" : "Create from Bill To"}
        </button>
      </div>
      {creating ? (
        <div className="invoice-client-create-form">
          <label>Legal name<input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={300} /></label>
          <label>Billing address<textarea value={newAddress} onChange={(event) => setNewAddress(event.target.value)} maxLength={2000} rows={3} /></label>
          <button className="primary-button" type="button" onClick={() => void createClient()} disabled={busy || newName.trim().length < 2}>
            {busy ? "Creating…" : "Confirm and create client"}
          </button>
        </div>
      ) : null}
      {message ? <p className="invoice-client-message">{message}</p> : null}
      {error ? <p className="invoice-client-error">{error}</p> : null}
    </section>
  );
}

function InvoiceCodingPanel({ invoice }: { invoice: InvoiceRecord }) {
  const [accounts, setAccounts] = useState<GlAccountOption[]>([]);
  const [suggestions, setSuggestions] = useState<LineCodingSuggestion[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busySuggestionId, setBusySuggestionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const hasLines = Boolean(invoice.extractedData && Array.isArray(invoice.extractedData.lineItems) && invoice.extractedData.lineItems.length > 0);

  const loadCodingContext = useCallback(async () => {
    if (!invoice.accountingClientId) return;
    const [accountResponse, suggestionResponse] = await Promise.all([
      fetch(`/api/clients/${encodeURIComponent(invoice.accountingClientId)}/accounts`, { cache: "no-store" }),
      fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/coding`, { cache: "no-store" }),
    ]);
    const accountPayload = (await accountResponse.json()) as { accounts?: GlAccountOption[]; error?: string };
    const suggestionPayload = (await suggestionResponse.json()) as { suggestions?: LineCodingSuggestion[]; error?: string };
    if (!accountResponse.ok) throw new Error(accountPayload.error ?? "Could not load client GL accounts.");
    if (!suggestionResponse.ok) throw new Error(suggestionPayload.error ?? "Could not load coding recommendations.");
    const loadedSuggestions = suggestionPayload.suggestions ?? [];
    setAccounts(accountPayload.accounts ?? []);
    setSuggestions(loadedSuggestions);
    setSelectedAccounts(Object.fromEntries(loadedSuggestions.map((item) => [item.id, item.recommendedGlAccountId ?? ""])));
  }, [invoice.accountingClientId, invoice.id]);

  useEffect(() => {
    if (!invoice.accountingClientId || !hasLines) return;
    void loadCodingContext().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load coding recommendations.");
    });
  }, [hasLines, invoice.accountingClientId, loadCodingContext]);

  async function recommendCoding() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/coding`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not generate coding recommendations.");
      await loadCodingContext();
      setNotice("Recommendations saved as an agent run. Review each line before accepting it.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not generate coding recommendations.");
    } finally {
      setLoading(false);
    }
  }

  async function reviewSuggestion(suggestion: LineCodingSuggestion, action: "approve" | "reject") {
    setBusySuggestionId(suggestion.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}/coding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          action,
          glAccountId: selectedAccounts[suggestion.id] ?? suggestion.recommendedGlAccountId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save your coding decision.");
      await loadCodingContext();
      setNotice(action === "approve" ? "Coding approved and review feedback recorded." : "Suggestion rejected and review feedback recorded.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not save your coding decision.");
    } finally {
      setBusySuggestionId("");
    }
  }

  if (!hasLines) return null;
  return (
    <section className="invoice-coding-panel">
      <div className="invoice-coding-heading"><div><strong>GL coding</strong><span>{invoice.accountingClientId ? "Recommendations use this client’s chart of accounts." : "Assign a client before requesting coding."}</span></div>
        <button className="secondary-button" type="button" onClick={() => void recommendCoding()} disabled={loading || !invoice.accountingClientId || accounts.length === 0}>{loading ? "Reasoning…" : suggestions.length ? "Generate again" : "Suggest GL accounts"}</button>
      </div>
      {!invoice.accountingClientId ? <p className="invoice-client-error">Assign this invoice to a client to ground coding in its chart of accounts.</p> : null}
      {invoice.accountingClientId && accounts.length === 0 ? <p className="client-directory-state">Add accounts in Clients before requesting a recommendation.</p> : null}
      {suggestions.map((suggestion) => (
        <div className="invoice-coding-row" key={suggestion.id}>
          <div className="invoice-coding-reason"><strong>Line {suggestion.lineIndex + 1}: {codingAccountLabel(suggestion, accounts)}</strong><span>{lineDescription(invoice, suggestion.lineIndex)}</span><span>{suggestion.rationale}</span>{suggestion.confidence ? <small>{Math.round(Number(suggestion.confidence) * 100)}% confidence</small> : null}</div>
          {suggestion.status === "suggested" ? (
            <div className="invoice-coding-actions">
              <select aria-label={`GL account for line ${suggestion.lineIndex + 1}`} value={selectedAccounts[suggestion.id] ?? ""} onChange={(event) => setSelectedAccounts((current) => ({ ...current, [suggestion.id]: event.target.value }))}>
                <option value="">Choose account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
              </select>
              <button className="secondary-button" type="button" onClick={() => void reviewSuggestion(suggestion, "approve")} disabled={busySuggestionId === suggestion.id || !selectedAccounts[suggestion.id]}>{busySuggestionId === suggestion.id ? "Saving…" : "Approve"}</button>
              <button className="secondary-button" type="button" onClick={() => void reviewSuggestion(suggestion, "reject")} disabled={busySuggestionId === suggestion.id}>Reject</button>
            </div>
          ) : <span className={`invoice-coding-status invoice-coding-status-${suggestion.status}`}>{suggestion.status.replaceAll("_", " ")}</span>}
        </div>
      ))}
      {notice ? <p className="invoice-client-message">{notice}</p> : null}
      {error ? <p className="invoice-client-error">{error}</p> : null}
    </section>
  );
}

function lineDescription(invoice: InvoiceRecord, lineIndex: number): string {
  const lineItems = invoice.extractedData?.lineItems;
  if (!Array.isArray(lineItems)) return "Invoice line";
  return rawFieldValue(lineItems[lineIndex] && typeof lineItems[lineIndex] === "object" && !Array.isArray(lineItems[lineIndex])
    ? (lineItems[lineIndex] as Record<string, unknown>).description
    : null) || "Invoice line";
}

function codingAccountLabel(suggestion: LineCodingSuggestion, accounts: GlAccountOption[]): string {
  if (suggestion.status === "approved") {
    const approved = accounts.find((account) => account.id === suggestion.approvedGlAccountId);
    return approved ? approved.code + " · " + approved.name : "Approved account";
  }
  return suggestion.accountCode
    ? suggestion.accountCode + (suggestion.accountName ? " · " + suggestion.accountName : "")
    : "No account suggested";
}

function InvoiceDetails({ invoice, clients, onClientUpdated, expanded = false }: { invoice: InvoiceRecord; clients: AccountingClientRecord[]; onClientUpdated: () => void; expanded?: boolean }) {
  const reviewFields = fieldsNeedingReview(invoice.validationIssues);
  const issues = invoice.validationIssues.map((issue) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) return "";
    const message = (issue as Record<string, unknown>).message;
    return typeof message === "string" ? message : "";
  }).filter(Boolean);
  const taxRows = Array.isArray(invoice.extractedData?.taxBreakdown)
    ? invoice.extractedData.taxBreakdown.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    : [];
  return (
    <>
      {reviewFields.length > 0 ? (
        <p className="invoice-missing-fields"><strong>Needs review:</strong> {reviewFields.join(", ")}</p>
      ) : null}
      <details className="invoice-result-details" open={expanded}>
        <summary>View extracted fields and evidence</summary>
        <ClientResolution invoice={invoice} clients={clients} onSaved={onClientUpdated} />
        <div className="invoice-result-fields">
          <Field label="Supplier" detail={readField(invoice.extractedData?.supplierName)} />
          <Field label="Bill To" detail={readField(invoice.extractedData?.billToName)} />
          <Field label="Bill To address" detail={readField(invoice.extractedData?.billToAddress)} />
          <Field label="Invoice number" detail={readField(invoice.extractedData?.invoiceNumber)} />
          <Field label="Invoice date" detail={readField(invoice.extractedData?.invoiceDate)} />
          <Field label="Due date" detail={readField(invoice.extractedData?.dueDate)} />
          <Field label="Currency" detail={readField(invoice.extractedData?.currency)} />
          <Field label="Subtotal" detail={readField(invoice.extractedData?.subtotal)} />
          <Field label="Tax" detail={readField(invoice.extractedData?.taxAmount)} />
          <Field label="Total" detail={readField(invoice.extractedData?.totalAmount)} />
        </div>
        {taxRows.length > 0 ? (
          <div className="invoice-tax-breakdown">
            <strong>Tax breakdown</strong>
            {taxRows.map((row, rowIndex) => {
              const taxes = Array.isArray(row.taxes)
                ? row.taxes.filter((tax): tax is Record<string, unknown> => typeof tax === "object" && tax !== null && !Array.isArray(tax))
                : [];
              return (
                <div className="invoice-tax-row" key={rowIndex}>
                  <Field label="HSN/SAC" detail={readField(row.hsnSac)} />
                  <Field label="Taxable value" detail={readField(row.taxableAmount)} />
                  {taxes.map((tax, taxIndex) => (
                    <div className="invoice-tax-component" key={taxIndex}>
                      <Field label="Printed tax label" detail={readField(tax.printedLabel)} />
                      <Field label="Tax type" detail={readField(tax.taxType)} />
                      <Field label="Rate" detail={readField(tax.ratePercent)} />
                      <Field label="Tax amount" detail={readField(tax.amount)} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
        {invoice.extractedData && Array.isArray(invoice.extractedData.lineItems) && invoice.extractedData.lineItems.length > 0 ? (
          <div className="invoice-line-items">
            <strong>Extracted line items</strong>
            {(invoice.extractedData.lineItems as unknown[]).map((lineItem, index) => {
              if (typeof lineItem !== "object" || lineItem === null || Array.isArray(lineItem)) return null;
              const row = lineItem as Record<string, unknown>;
              return (
                <div className="invoice-line-item" key={index}>
                  <Field label="Description" detail={readField(row.description)} />
                  <Field label="Quantity" detail={readField(row.quantity)} />
                  <Field label="Unit price" detail={readField(row.unitPrice)} />
                  <Field label="Amount" detail={readField(row.amount)} />
                </div>
              );
            })}
          </div>
        ) : null}
        <InvoiceCodingPanel invoice={invoice} />
        {issues.length > 0 ? <ul className="invoice-issues">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}
      </details>
    </>
  );
}

function Field({ label, detail }: { label: string; detail: FieldDetail }) {
  return (
    <div className="invoice-result-field">
      <span>{label}</span>
      <strong>{detail.value}</strong>
      {detail.evidence ? <small>“{detail.evidence}”{detail.page ? " · page " + detail.page : ""}</small> : <small>No source excerpt returned</small>}
      {detail.confidence !== null ? <em>{Math.round(detail.confidence * 100)}% model confidence</em> : null}
    </div>
  );
}
