"use client";

import Nango from "@nangohq/frontend";
import { useCallback, useEffect, useState } from "react";

type ConnectionState = "loading" | "connected" | "not-connected" | "not-configured" | "reauthorization-required" | "error";

interface StatusResponse {
  state?: ConnectionState;
  error?: string;
}

export function GoogleDriveConnect() {
  const [state, setState] = useState<ConnectionState>("loading");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const refreshStatus = useCallback(async () => {
    const response = await fetch("/api/connections/google-drive/sync", { method: "POST", cache: "no-store" });
    const result = (await response.json()) as StatusResponse;
    if (!response.ok || !result.state) throw new Error(result.error ?? "Could not load connection status.");
    setState(result.state);
  }, []);

  useEffect(() => {
    void refreshStatus().catch(() => setState("error"));
  }, [refreshStatus]);

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
            setState("connected");
            setBusy(false);
            await refreshStatus().catch(() => setState("error"));
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

  const connected = state === "connected";
  const statusLabels: Record<ConnectionState, string> = {
    loading: "Checking…",
    connected: "Connected",
    "not-connected": "Not connected",
    "not-configured": "Setup required",
    "reauthorization-required": "Reconnect required",
    error: "Status unavailable",
  };
  const statusLabel = statusLabels[state];

  return (
    <>
      <span className={`status-pill ${connected ? "status-on" : "status-off"}`} aria-live="polite">
        {statusLabel}
      </span>
      <button
        className="secondary-button"
        type="button"
        onClick={connectGoogleDrive}
        disabled={busy || state === "loading" || state === "not-configured"}
      >
        {busy ? "Connecting…" : connected ? "Connect another account" : "Connect Google Drive"}
      </button>
      {errorMessage ? <span className="connection-error" role="alert">{errorMessage}</span> : null}
    </>
  );
}
