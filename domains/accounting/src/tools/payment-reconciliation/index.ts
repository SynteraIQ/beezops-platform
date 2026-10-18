import type { ToolDefinition } from "@beezops/tools";

export const paymentReconciliationPromptVersion = "payment-reconciliation.v1";

export interface ReconciliationInvoice {
  id: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
  currency: string;
  amountDue: string;
}

export interface ReconciliationTransaction {
  id: string;
  transactionDate: string;
  direction: "debit";
  amount: string;
  availableAmount: string;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  memo: string | null;
}

export interface PaymentReconciliationInput {
  invoice: ReconciliationInvoice;
  transactions: ReconciliationTransaction[];
}

export interface PaymentCandidate {
  transactionId: string;
  matchedAmount: string;
  confidence: number;
  rationale: string;
  evidence: string[];
}

export interface PaymentReconciliationOutput {
  candidates: PaymentCandidate[];
  modelKey: string;
}

export class PaymentReconciliationProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PaymentReconciliationProviderError";
  }
}

const reconciliationInstructions = `Find bank transactions that may pay the supplied open invoice. Compare invoice number, amount due, currency, supplier, and invoice date with each transaction's date, amount available, counterparty, reference, and memo. Return only supported candidates, ranked strongest first. Invoice and transaction currencies must match. Do not invent evidence or IDs. A candidate's matchedAmount must not exceed either amountDue or availableAmount. This is a recommendation only: never state that the invoice is paid or that a payment is confirmed. A person reviews every candidate. If no transaction is supported, return an empty list.`;

const reconciliationSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          matchedAmount: { type: "string" },
          confidence: { type: "number" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["transactionId", "matchedAmount", "confidence", "rationale", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  const parts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseCandidates(value: unknown, input: PaymentReconciliationInput): PaymentCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.candidates)) throw new Error("The reconciliation response did not match its schema.");
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]));
  const seen = new Set<string>();
  return value.candidates.flatMap((item): PaymentCandidate[] => {
    if (!isRecord(item)
      || typeof item.transactionId !== "string"
      || seen.has(item.transactionId)
      || !transactions.has(item.transactionId)
      || typeof item.matchedAmount !== "string"
      || !/^\d+(\.\d{1,4})?$/.test(item.matchedAmount)
      || typeof item.confidence !== "number"
      || item.confidence < 0 || item.confidence > 1
      || typeof item.rationale !== "string"
      || !Array.isArray(item.evidence)
      || !item.evidence.every((entry) => typeof entry === "string")) return [];
    const transaction = transactions.get(item.transactionId);
    if (!transaction || transaction.currency !== input.invoice.currency) return [];
    const proposed = Number(item.matchedAmount);
    if (!Number.isFinite(proposed) || proposed <= 0
      || proposed > Number(input.invoice.amountDue)
      || proposed > Number(transaction.availableAmount)) return [];
    seen.add(item.transactionId);
    return [{
      transactionId: item.transactionId,
      matchedAmount: proposed.toFixed(4),
      confidence: item.confidence,
      rationale: item.rationale.slice(0, 2000),
      evidence: item.evidence.slice(0, 12).map((entry) => entry.slice(0, 500)),
    }];
  });
}

export async function reconcileInvoicePayments(input: PaymentReconciliationInput): Promise<PaymentReconciliationOutput> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new PaymentReconciliationProviderError("OPENAI_API_KEY is not configured.", 401);
  const modelKey = process.env.OPENAI_MODEL?.trim();
  if (!modelKey) throw new PaymentReconciliationProviderError("OPENAI_MODEL is not configured.", 500);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelKey,
      input: [{ role: "user", content: [{ type: "input_text", text: reconciliationInstructions + "\n\n" + JSON.stringify(input) }] }],
      text: { format: { type: "json_schema", name: "invoice_payment_candidates", strict: true, schema: reconciliationSchema } },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("[accounting:reconciliation] OpenAI matching request failed", { status: response.status, modelKey });
    throw new PaymentReconciliationProviderError("The reconciliation provider returned an error.", response.status);
  }
  const output = responseText(await response.json());
  if (!output) throw new Error("The reconciliation provider returned no structured result.");
  return { candidates: parseCandidates(JSON.parse(output) as unknown, input), modelKey };
}

export const paymentReconciliationTool: ToolDefinition<PaymentReconciliationInput, PaymentReconciliationOutput> = {
  id: "accounting.invoice.reconcile-payment",
  version: paymentReconciliationPromptVersion,
  description: "Rank bank statement transactions that may pay an invoice, with human-reviewed evidence.",
  execute: reconcileInvoicePayments,
};
