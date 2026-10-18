"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function WorkspaceSetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not create your workspace.");
      router.replace("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create your workspace.");
      setSaving(false);
    }
  }

  return (
    <form className="workspace-setup-form" onSubmit={submit}>
      <label htmlFor="workspace-name">Workspace name</label>
      <input
        id="workspace-name"
        name="name"
        autoComplete="organization"
        maxLength={200}
        minLength={2}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Acme Finance"
      />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-link setup-submit" type="submit" disabled={saving}>
        {saving ? "Creating workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
