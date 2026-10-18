"use client";

import { useCallback, useEffect, useState } from "react";

interface AgentRun {
  id: string;
  invoiceId: string;
  workflowRunId: string | null;
  sourceFileName: string;
  triggerSource: string;
  status: string;
  modelKey: string | null;
  promptVersion: string;
  schemaVersion: string;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function statusLabel(status: string): string {
  if (status === "ready_for_matching") return "Extraction complete";
  if (status === "needs_review") return "Needs review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function durationLabel(run: AgentRun): string | null {
  if (!run.startedAt || !run.completedAt) return null;
  const durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} sec`;
}

export function AutomationRuns({ onViewInvoice, onViewInvoices }: {
  onViewInvoice: (invoiceId: string) => void;
  onViewInvoices: () => void;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/automations/runs", { cache: "no-store" });
      const payload = await response.json() as { runs?: AgentRun[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load invoice processing runs.");
      setRuns(payload.runs ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load invoice processing runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  return (
    <section className="agent-runs-panel" aria-labelledby="processing-runs-heading">
      <div className="agent-runs-header">
        <div>
          <span className="section-kicker">PROCESSING HISTORY</span>
          <h2 id="processing-runs-heading">Invoice processing runs</h2>
          <p>Each row is one invoice extraction attempt, including retries.</p>
        </div>
        <button className="agent-runs-refresh" type="button" onClick={() => void loadRuns()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="agent-runs-message agent-runs-error" role="alert">{error}</p> : null}
      {loading && runs.length === 0 && !error ? <p className="agent-runs-message">Loading processing runs…</p> : null}
      {!loading && runs.length === 0 && !error ? (
        <div className="agent-runs-empty">
          <strong>No processing runs yet</strong>
          <span>Use Manual Extract on a PDF invoice to create the first run.</span>
          <button className="agent-run-view-invoice" type="button" onClick={onViewInvoices}>Open invoices <span aria-hidden="true">↗</span></button>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="agent-runs-list">
          {runs.map((run) => {
            const duration = durationLabel(run);
            return (
              <article className="agent-run-row" key={run.id}>
                <div className="agent-run-main">
                  <div className="agent-run-title">
                    <strong title={run.sourceFileName}>{run.sourceFileName}</strong>
                    <span className={`agent-run-status agent-run-status-${run.status}`}>{statusLabel(run.status)}</span>
                  </div>
                  <div className="agent-run-meta">
                    <span>{formatDate(run.createdAt)}</span>
                    <span>{run.triggerSource.replaceAll("_", " ")}</span>
                    {duration ? <span>{duration}</span> : null}
                    {run.modelKey ? <span>{run.modelKey}</span> : null}
                  </div>
                  <div className="agent-run-versions">Prompt {run.promptVersion} · Schema {run.schemaVersion}</div>
                  {run.errorSummary ? <p className="agent-run-error-detail">{run.errorSummary}</p> : null}
                </div>
                <div className="agent-run-id">
                  <span>Workflow run</span>
                  <code>{run.workflowRunId ?? "Starting…"}</code>
                  <button className="agent-run-view-invoice" type="button" onClick={() => onViewInvoice(run.invoiceId)}>View invoice <span aria-hidden="true">↗</span></button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <div className="agent-runs-footer">Showing up to 100 recent attempts for this workspace.</div>
    </section>
  );
}
