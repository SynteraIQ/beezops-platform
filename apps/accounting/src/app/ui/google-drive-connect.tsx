"use client";

import Nango from "@nangohq/frontend";
import { useCallback, useEffect, useState } from "react";

type ConnectionState = "loading" | "connected" | "not-connected" | "not-configured" | "reauthorization-required" | "error";
type ProviderConnectionStatus = "active" | "disconnected" | "reauthorization_required";

interface GoogleDriveConnection {
  connectionId: string;
  status: ProviderConnectionStatus;
  createdAt: string;
  lastSyncedAt: string | null;
}

interface ConnectionsResponse {
  state?: ConnectionState;
  connections?: GoogleDriveConnection[];
  error?: string;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function GoogleDriveConnect() {
  const [state, setState] = useState<ConnectionState>("loading");
  const [connections, setConnections] = useState<GoogleDriveConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const refreshConnections = useCallback(async () => {
    const response = await fetch("/api/connections/google-drive/sync", { method: "POST", cache: "no-store" });
    const result = (await response.json()) as ConnectionsResponse;
    if (!response.ok || !result.state) throw new Error(result.error ?? "Could not load Google Drive connections.");
    setState(result.state);
    setConnections(result.connections ?? []);
  }, []);

  useEffect(() => {
    void refreshConnections().catch(() => setState("error"));
  }, [refreshConnections]);

  async function connectGoogleDrive() {
    setBusy(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/connections/google-drive/session", { method: "POST" });
      const result = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !result.token) {
        throw new Error(result.error ?? "Could not start Google Drive authorization.");
      }

      const connectUi = new Nango().openConnectUI({
        sessionToken: result.token,
        onEvent: async (event) => {
          if (event.type === "connect") {
            setBusy(false);
            await refreshConnections().catch(() => setState("error"));
          } else if (event.type === "error") {
            setErrorMessage(event.payload.errorMessage);
            setBusy(false);
          } else if (event.type === "close") {
            setBusy(false);
          }
        },
      });
      connectUi.open();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not connect Google Drive.");
      setBusy(false);
    }
  }

  async function disconnectGoogleDrive(connection: GoogleDriveConnection) {
    const confirmed = window.confirm(
      `Disconnect Google Drive connection ${connection.connectionId}? BeezOps will remove its Nango authorization. You can reconnect later.`,
    );
    if (!confirmed) return;

    setDisconnectingId(connection.connectionId);
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/connections/google-drive/${encodeURIComponent(connection.connectionId)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not disconnect Google Drive.");
      await refreshConnections();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not disconnect Google Drive.");
    } finally {
      setDisconnectingId(null);
    }
  }

  const visibleConnections = connections.filter((connection) => connection.status !== "disconnected");
  const connected = state === "connected";
  const statusLabels: Record<ConnectionState, string> = {
    loading: "Checking…",
    connected: "Connected",
    "not-connected": "Not connected",
    "not-configured": "Setup required",
    "reauthorization-required": "Reconnect required",
    error: "Status unavailable",
  };

  const connectionStatusLabels: Record<ProviderConnectionStatus, string> = {
    active: "Connected",
    disconnected: "Disconnected",
    reauthorization_required: "Reconnect required",
  };

  return (
    <div className="google-drive-connections">
      <div className="google-drive-actions">
        <span className={`status-pill ${connected ? "status-on" : "status-off"}`} aria-live="polite">
          {statusLabels[state]}
        </span>
        <button
          className="secondary-button"
          type="button"
          onClick={connectGoogleDrive}
          disabled={busy || state === "loading" || state === "not-configured"}
        >
          {busy ? "Connecting…" : connected ? "Connect another account" : "Connect Google Drive"}
        </button>
      </div>

      {errorMessage ? <span className="connection-error" role="alert">{errorMessage}</span> : null}

      <section className="connection-list" aria-label="Google Drive connections">
        <div className="connection-list-heading">
          <h3>Connected accounts</h3>
          <span>{visibleConnections.length}</span>
        </div>
        {state === "loading" ? <p className="connection-list-empty">Loading connections…</p> : null}
        {state === "error" ? <p className="connection-list-empty">Could not load the connection list. Refresh the page to try again.</p> : null}
        {state !== "loading" && state !== "error" && visibleConnections.length === 0 ? (
          <p className="connection-list-empty">No Google Drive accounts are connected to this workspace.</p>
        ) : null}
        {visibleConnections.map((connection) => {
          const isDisconnecting = disconnectingId === connection.connectionId;
          const canDisconnect = connection.status !== "disconnected";
          return (
            <article className="connection-row" key={connection.connectionId}>
              <div className="connection-row-copy">
                <div className="connection-row-title">
                  <strong>Google Drive account</strong>
                  <span className={`status-pill ${connection.status === "active" ? "status-on" : "status-off"}`}>
                    {connectionStatusLabels[connection.status]}
                  </span>
                </div>
                <span className="connection-id">Connection ID · {connection.connectionId}</span>
                <span className="connection-date">Added {formatDate(connection.createdAt)}</span>
              </div>
              {canDisconnect ? (
                <button
                  className="disconnect-button"
                  type="button"
                  onClick={() => void disconnectGoogleDrive(connection)}
                  disabled={busy || disconnectingId !== null}
                >
                  {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
