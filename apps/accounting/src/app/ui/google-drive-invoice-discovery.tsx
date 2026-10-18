"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

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
  error?: string;
}

type LoadState = "loading" | "ready" | "error";
type ActionState = "idle" | "saving" | "syncing";

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
  const [connectionId, setConnectionId] = useState("");
  const [connectionState, setConnectionState] = useState<LoadState>("loading");
  const [selectedFolderPath, setSelectedFolderPath] = useState<DriveFolder[]>([]);
  const [pickerPath, setPickerPath] = useState<DriveFolder[]>([]);
  const [pickerFolders, setPickerFolders] = useState<DriveFolder[]>([]);
  const [pickerSelection, setPickerSelection] = useState<DriveFolder | null>(null);
  const [folderState, setFolderState] = useState<LoadState>("ready");
  const [folderError, setFolderError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
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
      setSources(result.sources ?? []);
    } catch (error) {
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
      setActionMessage(`Sync complete: ${result.discoveredCount ?? 0} files found · ${result.newCount ?? 0} new · ${result.changedCount ?? 0} changed · ${result.unchangedCount ?? 0} unchanged.`);
      await loadSources();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sync this source.");
    } finally {
      setActionState("idle");
    }
  }

  const selectedFolder = selectedFolderPath[selectedFolderPath.length - 1];
  const selectedFolderLabel = selectedFolderPath.map((folder) => folder.name).join(" / ");
  const pickerTarget = pickerSelection ?? pickerPath[pickerPath.length - 1];

  return (
    <div className="workspace-content">
      <section className="discovery-card">
        <div className="discovery-heading">
          <div>
            <span className="section-kicker">DOCUMENT SOURCES · GOOGLE DRIVE</span>
            <h2>Connect an invoice folder</h2>
            <p>Save a Drive folder once, then sync its file IDs and modification times when you choose. File contents and file names aren’t stored.</p>
          </div>
          <span className="discovery-mark" aria-hidden="true">▱</span>
        </div>

        {connectionState === "ready" && connections.length > 0 ? (
          <div className="drive-account-picker">
            <label htmlFor="drive-account">Connected account</label>
            <select id="drive-account" value={connectionId} onChange={(event) => void chooseConnection(event.target.value)}>
              {connections.map((connection) => (
                <option key={connection.connectionId} value={connection.connectionId}>
                  Google Drive · {connection.connectionId.slice(-8)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {connectionState === "loading" ? <p className="discovery-empty">Loading connected accounts…</p> : null}
        {connectionState === "error" ? <div className="discovery-message discovery-error" role="alert"><p>Could not load Google Drive connections. Refresh the page to try again.</p></div> : null}
        {connectionState === "ready" && connections.length === 0 ? (
          <div className="discovery-empty">No active Google Drive account is connected. <Link href="/connections">Open Connections ↗</Link></div>
        ) : null}

        {connectionId ? (
          <>
            <div className="selected-drive-folder">
              <div className="selected-drive-folder-icon" aria-hidden="true">▰</div>
              <div className="selected-drive-folder-copy">
                <span>{selectedFolder ? "SELECTED FOLDER" : "INVOICE SOURCE FOLDER"}</span>
                <strong>{selectedFolder ? selectedFolder.name : "No folder selected"}</strong>
                {selectedFolder ? <small>{selectedFolderLabel}</small> : <small>Browse Drive and choose where invoice files are kept.</small>}
              </div>
              <button className="secondary-button" type="button" ref={browseButtonRef} onClick={() => void openPicker()}>
                Browse Drive
              </button>
            </div>
            <button className="primary-link source-save-button" type="button" onClick={() => void saveSelectedFolder()} disabled={!selectedFolder || actionState !== "idle"}>
              {actionState === "saving" ? "Saving folder…" : "Save folder"}
            </button>
          </>
        ) : null}
      </section>

      {actionError ? <section className="discovery-message discovery-error" role="alert"><p>{actionError}</p></section> : null}
      {actionMessage ? <section className="discovery-message discovery-success" role="status"><p>{actionMessage}</p></section> : null}

      <section className="discovery-results">
        <div className="discovery-results-heading">
          <div><span className="section-kicker">SAVED SOURCES</span><h2>Invoice folders</h2></div>
          <span className="result-count">{sources.length}</span>
        </div>
        {sources.length === 0 ? (
          <div className="discovery-empty">No folders saved yet. Browse Drive and save the folder where invoices arrive.</div>
        ) : (
          <div className="invoice-file-list">
            {sources.map((source) => (
              <article className="invoice-file-row" key={source.id}>
                <div className="invoice-file-icon" aria-hidden="true">▰</div>
                <div className="invoice-file-copy">
                  <strong>{source.name}</strong>
                  <span>{source.path} <i>·</i> {formatDate(source.lastSyncedAt)}</span>
                  {source.connectionStatus !== "active" ? <span className="source-warning">Drive account disconnected. Reconnect it to sync.</span> : null}
                </div>
                <button className="secondary-button" type="button" onClick={() => void syncSource(source.id)} disabled={actionState !== "idle" || source.connectionStatus !== "active"}>
                  {actionState === "syncing" ? "Syncing…" : "Sync now"}
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="discovery-privacy">Sync checks up to 100 direct files per folder. It records provider file IDs and modification timestamps for deduplication; it does not download documents or classify invoice content. The saved folder label and path are retained so you can recognize the source.</p>
      </section>

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
