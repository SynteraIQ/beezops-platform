"use client";

import { useCallback, useEffect, useState } from "react";

interface ClientRecord {
  id: string;
  legalName: string;
  billingAddress: Record<string, unknown>;
}

interface GlAccountRecord {
  id: string;
  code: string;
  name: string;
  accountType: string | null;
  description: string | null;
}

export function ClientDirectory() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClients = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      const payload = (await response.json()) as { clients?: ClientRecord[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load clients.");
      setClients(payload.clients ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load clients.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  if (loading) return <p className="client-directory-state">Loading clients…</p>;
  return (
    <div className="workspace-content client-directory">
      <section className="section-heading">
        <div><span className="section-kicker">CLIENT MASTER DATA</span><h2>Clients and charts of accounts</h2></div>
        <button className="secondary-button" type="button" onClick={() => void loadClients()}>Refresh</button>
      </section>
      {error ? <p className="invoice-error">{error}</p> : null}
      {clients.length === 0 ? (
        <section className="empty-panel page-empty"><div className="empty-symbol">⌂</div><strong>No clients yet</strong><p>Extract an invoice, review its Bill To details, then choose “Create from Bill To” to add the client.</p></section>
      ) : clients.map((client) => (
        <ClientCard key={client.id} client={client} />
      ))}
    </div>
  );
}

function ClientCard({ client }: { client: ClientRecord }) {
  const [accounts, setAccounts] = useState<GlAccountRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAccounts() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}/accounts`, { cache: "no-store" });
      const payload = (await response.json()) as { accounts?: GlAccountRecord[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load the client chart of accounts.");
      setAccounts(payload.accounts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the client chart of accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function addAccount() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, accountType, description }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not add the GL account.");
      setCode("");
      setName("");
      setAccountType("");
      setDescription("");
      setNotice("GL account added to this client’s chart.");
      await loadAccounts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add the GL account.");
      setLoading(false);
    }
  }

  const address = typeof client.billingAddress.formatted === "string" ? client.billingAddress.formatted : "";
  return (
    <article className="client-card">
      <div className="client-card-heading">
        <div><span className="section-kicker">CLIENT</span><h3>{client.legalName}</h3>{address ? <p>{address}</p> : <p>Billing address not provided</p>}</div>
        <button className="secondary-button" type="button" onClick={() => {
          const next = !showAccounts;
          setShowAccounts(next);
          if (next) void loadAccounts();
        }}>{showAccounts ? "Hide chart" : "Open chart of accounts"}</button>
      </div>
      {showAccounts ? (
        <div className="client-chart">
          <div className="client-chart-heading"><strong>Chart of accounts</strong><button className="secondary-button" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? "Cancel" : "Add GL account"}</button></div>
          {loading ? <p className="client-directory-state">Loading chart…</p> : null}
          {!loading && accounts.length === 0 ? <p className="client-directory-state">No GL accounts yet. Add this client’s accounts before requesting coding suggestions.</p> : null}
          {accounts.length > 0 ? (
            <div className="client-account-list">
              {accounts.map((account) => (
                <div className="client-account-row" key={account.id}><code>{account.code}</code><strong>{account.name}</strong><span>{account.accountType ?? "Unclassified"}</span>{account.description ? <small>{account.description}</small> : null}</div>
              ))}
            </div>
          ) : null}
          {showForm ? (
            <div className="client-account-form">
              <label>GL code<input value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} /></label>
              <label>Account name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={240} /></label>
              <label>Account type<input value={accountType} onChange={(event) => setAccountType(event.target.value)} maxLength={80} placeholder="Optional" /></label>
              <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="Optional guidance for coding" /></label>
              <button className="primary-button" type="button" onClick={() => void addAccount()} disabled={loading || !code.trim() || name.trim().length < 2}>Save GL account</button>
            </div>
          ) : null}
          {notice ? <p className="invoice-client-message">{notice}</p> : null}
          {error ? <p className="invoice-client-error">{error}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
