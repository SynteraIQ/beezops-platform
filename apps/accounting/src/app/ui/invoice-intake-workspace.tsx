"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  connectionId: string;
  sourceFileId: string;
  sourceFileName: string;
  status: string;
  extractedData: Record<string, unknown> | null;
  validationIssues: unknown[];
  updatedAt: string;
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

function statusLabel(status: string): string {
  if (status === "ready_for_matching") return "Extraction complete";
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
      await Promise.all([loadInvoices(), loadConnections()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load invoice workspace.");
    } finally {
      setLoading(false);
    }
  }, [loadConnections, loadInvoices]);

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

  async function startExtraction(file: DriveFile, targetConnectionId = connectionId) {
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
                const busy = busyFileId === file.id || existingInvoice?.status === "queued" || existingInvoice?.status === "processing";
                return (
                  <article className={`invoice-result-card ${existingInvoice?.id === selectedInvoiceId ? "invoice-result-selected" : ""}`} id={existingInvoice ? `invoice-${existingInvoice.id}` : undefined} key={file.id}>
                    <div className="invoice-file-row">
                      <div className="invoice-file-copy">
                        <strong>{file.name}</strong>
                        <span>{file.mimeType === "application/pdf" ? "PDF" : file.mimeType}{file.modifiedTime ? " · Modified " + new Date(file.modifiedTime).toLocaleDateString() : ""}{file.size ? " · " + (Number(file.size) / 1024).toFixed(0) + " KB" : ""}</span>
                      </div>
                      {existingInvoice ? <span className={"invoice-status invoice-status-" + existingInvoice.status}>{statusLabel(existingInvoice.status)}</span> : null}
                      <button
                        className="secondary-button invoice-extract-button"
                        type="button"
                        disabled={busy || !supportsManualExtraction}
                        title={supportsManualExtraction ? undefined : "Manual extraction currently supports PDF invoices."}
                        onClick={() => void startExtraction(file)}
                      >
                        {busy ? "Processing…" : !supportsManualExtraction ? "PDF required" : existingInvoice?.status === "failed" ? "Retry extraction" : existingInvoice ? "Extract again" : "Manual Extract"}
                      </button>
                    </div>
                    {existingInvoice ? <InvoiceDetails invoice={existingInvoice} expanded={existingInvoice.id === selectedInvoiceId} /> : null}
                  </article>
                );
              })}
              {invoices.filter((invoice) => !files.some((file) => file.id === invoice.sourceFileId)).map((invoice) => (
                <article className={`invoice-result-card ${invoice.id === selectedInvoiceId ? "invoice-result-selected" : ""}`} id={`invoice-${invoice.id}`} key={invoice.id}>
                  <div className="invoice-file-row">
                    <div className="invoice-file-copy"><strong>{invoice.sourceFileName}</strong><span>Previously processed · file is not in the current folder view</span></div>
                    <span className={"invoice-status invoice-status-" + invoice.status}>{statusLabel(invoice.status)}</span>
                    {invoice.status === "failed" ? (
                      <button
                        className="secondary-button invoice-extract-button"
                        type="button"
                        disabled={busyFileId === invoice.sourceFileId}
                        onClick={() => void startExtraction({
                          id: invoice.sourceFileId,
                          name: invoice.sourceFileName,
                          mimeType: "application/pdf",
                          modifiedTime: "",
                          version: "",
                          size: null,
                          webViewLink: null,
                        }, invoice.connectionId)}
                      >
                        {busyFileId === invoice.sourceFileId ? "Processing…" : "Retry extraction"}
                      </button>
                    ) : null}
                  </div>
                  <InvoiceDetails invoice={invoice} expanded={invoice.id === selectedInvoiceId} />
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

function InvoiceDetails({ invoice, expanded = false }: { invoice: InvoiceRecord; expanded?: boolean }) {
  const reviewFields = fieldsNeedingReview(invoice.validationIssues);
  const issues = invoice.validationIssues.map((issue) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) return "";
    const message = (issue as Record<string, unknown>).message;
    return typeof message === "string" ? message : "";
  }).filter(Boolean);
  return (
    <>
      {reviewFields.length > 0 ? (
        <p className="invoice-missing-fields"><strong>Needs review:</strong> {reviewFields.join(", ")}</p>
      ) : null}
      <details className="invoice-result-details" open={expanded}>
        <summary>View extracted fields and evidence</summary>
        <div className="invoice-result-fields">
          <Field label="Supplier" detail={readField(invoice.extractedData?.supplierName)} />
          <Field label="Invoice number" detail={readField(invoice.extractedData?.invoiceNumber)} />
          <Field label="Invoice date" detail={readField(invoice.extractedData?.invoiceDate)} />
          <Field label="Due date" detail={readField(invoice.extractedData?.dueDate)} />
          <Field label="Currency" detail={readField(invoice.extractedData?.currency)} />
          <Field label="Subtotal" detail={readField(invoice.extractedData?.subtotal)} />
          <Field label="Tax" detail={readField(invoice.extractedData?.taxAmount)} />
          <Field label="Total" detail={readField(invoice.extractedData?.totalAmount)} />
        </div>
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
