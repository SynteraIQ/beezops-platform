"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CanonicalInvoice } from "../../types/invoice";

interface DriveConnection {
  connectionId: string;
  status: string;
}

interface DriveFolder {
  id: string;
  name: string;
}

interface DriveSource {
  id: string;
  connectionId: string;
  name: string;
  path: string;
  provider: "google-drive";
  status: string;
  lastSyncedAt: string | null;
  connectionStatus: string;
  files?: DriveFile[];
  filesError?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  extraction?: ExtractedInvoice;
}

interface ExtractedInvoice {
  runId: string;
  invoice: CanonicalInvoice;
}

interface DiscoveryResponse {
  connections?: DriveConnection[];
  folders?: DriveFolder[];
  sources?: DriveSource[];
  source?: DriveSource;
  discoveredCount?: number;
  newCount?: number;
  changedCount?: number;
  unchangedCount?: number;
  syncedAt?: string;
  files?: DriveFile[];
  runId?: string;
  invoice?: CanonicalInvoice;
  error?: string;
}

type LoadState = "loading" | "ready" | "error";
type ActionState = "idle" | "saving" | "syncing" | "extracting";

function formatDate(value: string | null) {
  if (!value) return "Never synced";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Never synced"
    : `Last synced ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

export function GoogleDriveInvoiceDiscovery() {
  const [connections, setConnections] = useState<DriveConnection[]>([]);
  const [sources, setSources] = useState<DriveSource[]>([]);
  const [filesBySource, setFilesBySource] = useState<Record<string, DriveFile[]>>({});
  const [extractedByFile, setExtractedByFile] = useState<Record<string, ExtractedInvoice>>({});
  const [connectionId, setConnectionId] = useState("");
  const [connectionState, setConnectionState] = useState<LoadState>("loading");
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState<DriveFolder[]>([]);
  const [pickerPath, setPickerPath] = useState<DriveFolder[]>([]);
  const [pickerFolders, setPickerFolders] = useState<DriveFolder[]>([]);
  const [pickerSelection, setPickerSelection] = useState<DriveFolder | null>(null);
  const [folderState, setFolderState] = useState<LoadState>("ready");
  const [folderError, setFolderError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [extractingFileKey, setExtractingFileKey] = useState("");
  const [activeTab, setActiveTab] = useState<"invoices" | "sources">("invoices");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const pickerDialogRef = useRef<HTMLElement>(null);

  const loadFolders = useCallback(async (selectedConnectionId: string, parentFolderId: string) => {
    setFolderState("loading");
    setFolderError("");
    setPickerSelection(null);
    try {
      const response = await fetch("/api/invoices/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: selectedConnectionId, parentFolderId }),
        cache: "no-store",
      });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not browse Google Drive folders.");
      setPickerFolders(result.folders ?? []);
      setFolderState("ready");
    } catch (error) {
      setPickerFolders([]);
      setFolderError(error instanceof Error ? error.message : "Could not browse Google Drive folders.");
      setFolderState("error");
    }
  }, []);

  const loadConnections = useCallback(async () => {
    setConnectionState("loading");
    try {
      const response = await fetch("/api/connections/google-drive/status", { cache: "no-store" });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not load Google Drive connections.");
      const activeConnections = (result.connections ?? []).filter((item) => item.status === "active");
      setConnections(activeConnections);
      setConnectionState("ready");
      setConnectionId(activeConnections[0]?.connectionId ?? "");
    } catch {
      setConnections([]);
      setConnectionState("error");
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const response = await fetch("/api/invoices/sources", { cache: "no-store" });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not load saved sources.");
      const loadedSources = result.sources ?? [];
      setSources(loadedSources);
      setFilesBySource(Object.fromEntries(
        loadedSources
          .filter((source) => source.files)
          .map((source) => [source.id, source.files ?? []]),
      ));
      setSourcesLoaded(true);
    } catch (error) {
      setSourcesLoaded(true);
      setActionError(error instanceof Error ? error.message : "Could not load saved sources.");
    }
  }, []);

  useEffect(() => {
    void loadConnections();
    void loadSources();
  }, [loadConnections, loadSources]);

  useEffect(() => {
    if (pickerOpen) pickerDialogRef.current?.focus();
    else browseButtonRef.current?.focus();
  }, [pickerOpen]);

  async function openPicker() {
    if (!connectionId) return;
    setPickerOpen(true);
    setPickerPath([]);
    await loadFolders(connectionId, "root");
  }

  async function browseInto(folder: DriveFolder) {
    const nextPath = [...pickerPath, folder];
    setPickerPath(nextPath);
    setPickerSelection(null);
    await loadFolders(connectionId, folder.id);
  }

  async function navigateToBreadcrumb(index: number) {
    const nextPath = index < 0 ? [] : pickerPath.slice(0, index + 1);
    setPickerPath(nextPath);
    setPickerSelection(null);
    await loadFolders(connectionId, nextPath[nextPath.length - 1]?.id ?? "root");
  }

  function closePicker() {
    setPickerOpen(false);
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") closePicker();
  }

  function selectFolder() {
    const folder = pickerSelection ?? pickerPath[pickerPath.length - 1];
    if (!folder) return;
    setSelectedFolderPath(pickerSelection ? [...pickerPath, pickerSelection] : pickerPath);
    setActionMessage("");
    setActionError("");
    closePicker();
  }

  function chooseConnection(selectedConnectionId: string) {
    setConnectionId(selectedConnectionId);
    setSelectedFolderPath([]);
    setPickerPath([]);
    setActionMessage("");
    setActionError("");
    setPickerOpen(false);
  }

  async function saveSelectedFolder() {
    const selectedFolder = selectedFolderPath[selectedFolderPath.length - 1];
    if (!connectionId || !selectedFolder || actionState !== "idle") return;

    setActionState("saving");
    setActionMessage("");
    setActionError("");
    try {
      const response = await fetch("/api/invoices/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          folderId: selectedFolder.id,
          name: selectedFolder.name,
          path: selectedFolderPath.map((folder) => folder.name).join(" / "),
        }),
        cache: "no-store",
      });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not save this folder.");
      setActionMessage(`Saved “${selectedFolder.name}” as a document source.`);
      setSelectedFolderPath([]);
      await loadSources();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save this folder.");
    } finally {
      setActionState("idle");
    }
  }

  async function syncSource(sourceId: string) {
    if (actionState !== "idle") return;
    setActionState("syncing");
    setActionMessage("");
    setActionError("");
    try {
      const response = await fetch(`/api/invoices/sources/${encodeURIComponent(sourceId)}/sync`, {
        method: "POST",
        cache: "no-store",
      });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not sync this source.");
      setFilesBySource((current) => ({ ...current, [sourceId]: result.files ?? [] }));
      setExtractedByFile((current) => {
        const next = { ...current };
        for (const file of result.files ?? []) {
          const fileKey = `${sourceId}:${file.id}`;
          if (file.extraction) next[fileKey] = file.extraction;
          else delete next[fileKey];
        }
        return next;
      });
      setActionMessage(`Sync complete: ${result.discoveredCount ?? 0} files found · ${result.newCount ?? 0} new · ${result.changedCount ?? 0} changed · ${result.unchangedCount ?? 0} unchanged.`);
      await loadSources();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sync this source.");
    } finally {
      setActionState("idle");
    }
  }

  async function syncAllSources() {
    const activeSources = sources.filter((source) => source.connectionStatus === "active");
    if (actionState !== "idle" || activeSources.length === 0) return;
    setActionState("syncing");
    setActionMessage("");
    setActionError("");
    let totalFiles = 0;
    try {
      for (const source of activeSources) {
        const response = await fetch(`/api/invoices/sources/${encodeURIComponent(source.id)}/sync`, {
          method: "POST",
          cache: "no-store",
        });
        const result = (await response.json()) as DiscoveryResponse;
        if (!response.ok) throw new Error(result.error ?? `Could not sync ${source.name}.`);
        const files = result.files ?? [];
        totalFiles += files.filter((file) => file.mimeType === "application/pdf").length;
        setFilesBySource((current) => ({ ...current, [source.id]: files }));
        setExtractedByFile((current) => {
          const next = { ...current };
          for (const file of files) {
            const fileKey = `${source.id}:${file.id}`;
            if (file.extraction) next[fileKey] = file.extraction;
            else delete next[fileKey];
          }
          return next;
        });
      }
      setActionMessage(`Sync complete · ${totalFiles} PDF${totalFiles === 1 ? "" : "s"} found across ${activeSources.length} source${activeSources.length === 1 ? "" : "s"}.`);
      await loadSources();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sync invoice sources.");
    } finally {
      setActionState("idle");
    }
  }

  async function extractInvoice(source: DriveSource, file: DriveFile) {
    if (actionState !== "idle" || file.mimeType !== "application/pdf") return;
    const fileKey = `${source.id}:${file.id}`;
    setExtractingFileKey(fileKey);
    setActionState("extracting");
    setActionMessage("");
    setActionError("");
    try {
      const response = await fetch("/api/invoices/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, fileId: file.id }),
        cache: "no-store",
      });
      const result = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not extract this invoice.");
      if (!result.runId || !result.invoice) throw new Error("The extraction did not return an invoice record.");
      const extraction = { runId: result.runId, invoice: result.invoice };
      setExtractedByFile((current) => ({ ...current, [fileKey]: extraction }));
      setActionMessage(`Extracted “${file.name}” and saved its canonical invoice record for review.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not extract this invoice.");
    } finally {
      setExtractingFileKey("");
      setActionState("idle");
    }
  }

  const selectedFolder = selectedFolderPath[selectedFolderPath.length - 1];
  const selectedFolderLabel = selectedFolderPath.map((folder) => folder.name).join(" / ");
  const pickerTarget = pickerSelection ?? pickerPath[pickerPath.length - 1];
  const invoiceFiles = sources
    .flatMap((source) => (filesBySource[source.id] ?? [])
      .filter((file) => file.mimeType === "application/pdf")
      .map((file) => ({
        source,
        file,
        extraction: extractedByFile[`${source.id}:${file.id}`] ?? file.extraction,
      })))
    .filter(({ source, file, extraction }) => {
      const query = searchQuery.trim().toLocaleLowerCase();
      const matchesQuery = !query || [file.name, source.name, source.path, extraction?.invoice.supplierName, extraction?.invoice.invoiceNumber]
        .some((value) => value?.toLocaleLowerCase().includes(query));
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "extracted" && Boolean(extraction))
        || (statusFilter === "needs-extraction" && !extraction);
      return matchesQuery && matchesStatus;
    })
    .sort((left, right) => (right.file.modifiedTime ?? "").localeCompare(left.file.modifiedTime ?? ""));
  const scannedSourceCount = Object.keys(filesBySource).length;
  const activeSourceCount = sources.filter((source) => source.connectionStatus === "active").length;

  return (
    <div className="workspace-content">
      {actionError ? <section className="discovery-message discovery-error" role="alert"><p>{actionError}</p></section> : null}
      {actionMessage ? <section className="discovery-message discovery-success" role="status"><p>{actionMessage}</p></section> : null}

      <div className="invoice-page-tabs" role="tablist" aria-label="Invoice workspace">
        <button id="invoices-tab" className={activeTab === "invoices" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "invoices"} aria-controls="invoices-panel" onClick={() => setActiveTab("invoices")}>
          Invoices <span>{invoiceFiles.length}</span>
        </button>
        <button id="sources-tab" className={activeTab === "sources" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "sources"} aria-controls="sources-panel" onClick={() => setActiveTab("sources")}>
          Sources <span>{sources.length}</span>
        </button>
      </div>

      {activeTab === "invoices" ? <section className="discovery-results invoice-queue" id="invoices-panel" role="tabpanel" aria-labelledby="invoices-tab">
        <div className="discovery-results-heading">
          <div><span className="section-kicker">INVOICE WORK QUEUE</span><h2>Discovered invoices</h2></div>
          <div className="invoice-queue-actions"><span className="result-count">{invoiceFiles.length}</span><button className="secondary-button" type="button" onClick={() => void syncAllSources()} disabled={actionState !== "idle" || activeSourceCount === 0}>{actionState === "syncing" ? "Syncing…" : "Sync sources"}</button></div>
        </div>
        <div className="invoice-list-controls">
          <label className="invoice-search"><span aria-hidden="true">⌕</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search invoice, supplier, or source" aria-label="Search invoices" /></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter invoices by extraction status">
            <option value="all">All statuses</option>
            <option value="needs-extraction">Needs extraction</option>
            <option value="extracted">Extracted</option>
          </select>
        </div>
        {connectionState === "loading" ? <div className="discovery-empty">Loading connected accounts…</div> : null}
        {connectionState === "error" ? <div className="discovery-message discovery-error" role="alert"><p>Could not load Google Drive connections. Refresh the page to try again.</p></div> : null}
        {connectionState === "ready" && connections.length === 0 ? (
          <div className="discovery-empty">Connect Google Drive to discover invoices. <Link href="/connections">Open Connections ↗</Link></div>
        ) : null}
        {!sourcesLoaded ? <div className="discovery-empty">Loading saved invoice sources…</div> : null}
        {sourcesLoaded && sources.length === 0 && connections.length > 0 ? (
          <div className="discovery-empty">No invoice sources yet. Add a Drive folder in the <button className="inline-tab-link" type="button" onClick={() => setActiveTab("sources")}>Sources tab</button>.</div>
        ) : null}
        {sourcesLoaded && sources.length > 0 && scannedSourceCount === 0 ? (
          <div className="discovery-empty">Your folders are ready. Open the <button className="inline-tab-link" type="button" onClick={() => setActiveTab("sources")}>Sources tab</button> to sync one.</div>
        ) : null}
        {scannedSourceCount > 0 && invoiceFiles.length === 0 ? (
          <div className="discovery-empty">No PDFs match this view. Try another filter or sync a folder with PDF invoices.</div>
        ) : null}
        {invoiceFiles.length > 0 ? (
          <div className="invoice-table-wrap">
            <table className="invoice-table">
              <thead><tr><th>Invoice</th><th>Supplier</th><th>Invoice date</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {invoiceFiles.map(({ source, file, extraction }) => {
                  const fileKey = `${source.id}:${file.id}`;
                  return (
                    <tr key={fileKey}>
                      <td>
                        <div className="invoice-table-file"><strong>{file.name}</strong><span>{source.path}</span></div>
                        {extraction ? (
                          <details className="invoice-details">
                            <summary>View extracted fields · run {extraction.runId.slice(0, 8)}</summary>
                            <div className="invoice-extraction-result">
                              <dl>
                                <div><dt>Jurisdiction</dt><dd>{extraction.invoice.jurisdictionCountryCode ?? "Not determined"}</dd></div>
                                <div><dt>Billed to</dt><dd>{extraction.invoice.buyerName ?? "Not found"}</dd></div>
                                <div><dt>Ship to</dt><dd>{extraction.invoice.shipToName ?? "Not found"}</dd></div>
                                <div><dt>Due date</dt><dd>{extraction.invoice.dueDate ?? "Not found"}</dd></div>
                                <div><dt>Subtotal</dt><dd>{extraction.invoice.subtotal ?? "Not found"}</dd></div>
                                <div><dt>Tax</dt><dd>{extraction.invoice.taxTotal ?? "Not found"}</dd></div>
                                <div><dt>Discount</dt><dd>{extraction.invoice.discountTotal ?? "Not found"}</dd></div>
                              </dl>
                              {extraction.invoice.supplierTaxIdentifiers.length > 0 || extraction.invoice.buyerTaxIdentifiers.length > 0 ? <div className="invoice-tax-identifiers">
                                {extraction.invoice.supplierTaxIdentifiers.map((identifier, index) => <span key={`supplier-${index}`}>Supplier {identifier.scheme ?? "tax ID"}: {identifier.value ?? "Not found"}</span>)}
                                {extraction.invoice.buyerTaxIdentifiers.map((identifier, index) => <span key={`buyer-${index}`}>Buyer {identifier.scheme ?? "tax ID"}: {identifier.value ?? "Not found"}</span>)}
                              </div> : null}
                              {extraction.invoice.taxComponents.length ? <div className="invoice-tax-components"><strong>Tax breakdown</strong><ul>{extraction.invoice.taxComponents.map((tax, index) => <li key={`${fileKey}-tax-${index}`}>{tax.label ?? "Tax"}{tax.rate ? ` · ${tax.rate}%` : ""} · {tax.amount ?? "Amount not found"}{tax.jurisdiction ? ` · ${tax.jurisdiction}` : ""}</li>)}</ul></div> : null}
                              {extraction.invoice.lineItems.length ? <ul>{extraction.invoice.lineItems.map((lineItem, index) => <li key={`${fileKey}-${index}`}>{lineItem.description ?? "Line item"}{lineItem.code ? ` · ${lineItem.codeSystem ?? "Code"} ${lineItem.code}` : ""} · {lineItem.amount ?? "Amount not found"}</li>)}</ul> : <small>No line items were extracted.</small>}
                              {extraction.invoice.evidence.length ? <details className="invoice-evidence"><summary>Evidence · {extraction.invoice.evidence.length} fields</summary><ul>{extraction.invoice.evidence.map((item, index) => <li key={`${fileKey}-evidence-${index}`}><strong>{item.field}</strong>: “{item.quote}”{item.page ? ` · page ${item.page}` : ""}</li>)}</ul></details> : null}
                            </div>
                          </details>
                        ) : null}
                      </td>
                      <td><div className="invoice-table-value">{extraction?.invoice.supplierName ?? "—"}<small>{extraction?.invoice.invoiceNumber ?? "Not extracted"}</small></div></td>
                      <td>{extraction?.invoice.invoiceDate ?? "—"}</td>
                      <td>{extraction?.invoice.total ? `${extraction.invoice.total} ${extraction.invoice.currency ?? ""}`.trim() : "—"}</td>
                      <td><span className={`invoice-status-pill ${extraction ? "complete" : "pending"}`}>{extraction ? "Extracted" : "Needs extraction"}</span></td>
                      <td><button className="secondary-button" type="button" onClick={() => void extractInvoice(source, file)} disabled={actionState !== "idle" || source.connectionStatus !== "active"}>{extractingFileKey === fileKey ? "Extracting…" : extraction ? "Extract again" : "Extract invoice"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="discovery-privacy">Sync checks up to 100 direct files per folder. Extracting a PDF sends that selected file to OpenAI and saves the canonical fields as an agent run; the original remains in Drive.</p>
      </section> : null}

      {activeTab === "sources" ? <section className="source-management-card" id="sources-panel" role="tabpanel" aria-labelledby="sources-tab">
        <div className="source-management-heading">
          <div><span className="section-kicker">INTAKE CONFIGURATION</span><h2>Invoice sources</h2><p>Choose which Drive folders to scan. Sync runs only when you ask it to.</p></div>
        </div>
        <div className="source-management-body">
          {connectionState === "loading" ? <div className="discovery-empty">Loading connected accounts…</div> : null}
          {connectionState === "error" ? <div className="discovery-message discovery-error" role="alert"><p>Could not load Google Drive connections. Refresh the page to try again.</p></div> : null}
          {connectionState === "ready" && connections.length === 0 ? (
            <div className="discovery-empty">No active Google Drive account is connected. <Link href="/connections">Open Connections ↗</Link></div>
          ) : null}
          {connectionState === "ready" && connections.length > 0 ? (
            <div className="drive-account-picker">
              <label htmlFor="drive-account">Connected account</label>
              <select id="drive-account" value={connectionId} onChange={(event) => void chooseConnection(event.target.value)}>
                {connections.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>Google Drive · {connection.connectionId.slice(-8)}</option>)}
              </select>
            </div>
          ) : null}
          {connectionId ? (
            <div className="source-add-row">
              <div className="selected-drive-folder-copy">
                <span>{selectedFolder ? "SELECTED FOLDER" : "ADD A FOLDER"}</span>
                <strong>{selectedFolder ? selectedFolder.name : "Choose an invoice folder"}</strong>
                <small>{selectedFolder ? selectedFolderLabel : "Browse Drive, select a folder, then save it as a source."}</small>
              </div>
              <div className="source-add-actions">
                <button className="secondary-button" type="button" ref={browseButtonRef} onClick={() => void openPicker()}>Browse Drive</button>
                <button className="primary-link" type="button" onClick={() => void saveSelectedFolder()} disabled={!selectedFolder || actionState !== "idle"}>{actionState === "saving" ? "Saving…" : "Add source"}</button>
              </div>
            </div>
          ) : null}
          {sourcesLoaded && sources.length === 0 && connections.length > 0 ? <div className="source-empty">No folders added yet.</div> : null}
          {sources.length > 0 ? (
            <div className="source-list">
              {sources.map((source) => (
                <article className="source-list-row" key={source.id}>
                  <div className="source-list-copy"><strong>{source.name}</strong><span>{source.path} · {formatDate(source.lastSyncedAt)}</span>{source.connectionStatus !== "active" ? <small className="source-warning">Drive account disconnected. Reconnect it to sync.</small> : null}{source.filesError ? <small className="source-warning">{source.filesError}</small> : null}</div>
                  <div className="source-row-actions">
                    {filesBySource[source.id] ? <span>{filesBySource[source.id].filter((file) => file.mimeType === "application/pdf").length} PDFs found</span> : null}
                    <button className="secondary-button" type="button" onClick={() => void syncSource(source.id)} disabled={actionState !== "idle" || source.connectionStatus !== "active"}>{actionState === "syncing" ? "Syncing…" : "Sync now"}</button>
                  </div>
                  {filesBySource[source.id]?.length === 0 ? <small className="invoice-source-empty-hint">No direct files found. Sync checks this folder, not its subfolders.</small> : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section> : null}

      {pickerOpen ? (
        <div className="drive-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
          <section
            className="drive-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-picker-title"
            tabIndex={-1}
            ref={pickerDialogRef}
            onKeyDown={handlePickerKeyDown}
          >
            <header className="drive-picker-header">
              <div><span className="section-kicker">GOOGLE DRIVE</span><h2 id="drive-picker-title">Select a folder</h2></div>
              <button className="drive-picker-close" type="button" onClick={closePicker} aria-label="Close folder picker">×</button>
            </header>
            <nav className="drive-breadcrumb" aria-label="Google Drive folder path">
              <button type="button" onClick={() => void navigateToBreadcrumb(-1)}>My Drive</button>
              {pickerPath.map((folder, index) => (
                <span className="drive-crumb" key={folder.id}>
                  <i aria-hidden="true">/</i>
                  <button type="button" onClick={() => void navigateToBreadcrumb(index)} aria-current={index === pickerPath.length - 1 ? "location" : undefined}>{folder.name}</button>
                </span>
              ))}
            </nav>
            <div className="drive-picker-list" aria-label="Folders">
              {folderState === "loading" ? <p className="connection-list-empty">Loading folders…</p> : null}
              {folderState === "error" ? <p className="connection-list-empty" role="alert">{folderError}</p> : null}
              {folderState === "ready" && pickerFolders.length === 0 ? <p className="connection-list-empty">No folders at this location.</p> : null}
              {folderState === "ready" && pickerFolders.map((folder) => (
                <div className={`drive-picker-folder-row ${pickerSelection?.id === folder.id ? "selected" : ""}`} key={folder.id}>
                  <button
                    className="drive-picker-folder-select"
                    type="button"
                    onClick={() => setPickerSelection(folder)}
                    onDoubleClick={() => void browseInto(folder)}
                    aria-pressed={pickerSelection?.id === folder.id}
                  >
                    <span className="drive-folder-icon" aria-hidden="true">▰</span><strong>{folder.name}</strong>
                  </button>
                  <button className="drive-picker-open-button" type="button" onClick={() => void browseInto(folder)} aria-label={`Open ${folder.name}`}>
                    Open ›
                  </button>
                </div>
              ))}
            </div>
            <footer className="drive-picker-footer">
              <span>{pickerTarget ? `Selected: ${pickerTarget.name}` : "Select a folder, or open one to browse inside."}</span>
              <div><button className="picker-cancel-button" type="button" onClick={closePicker}>Cancel</button><button className="primary-link" type="button" onClick={selectFolder} disabled={!pickerTarget || folderState !== "ready"}>Select folder</button></div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
