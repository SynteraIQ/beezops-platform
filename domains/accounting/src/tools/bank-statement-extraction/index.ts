import type { ToolDefinition } from "@beezops/tools";

export const bankStatementExtractionPromptVersion = "bank-statement-extraction.v1";

export interface BankStatementPdfInput {
  base64: string;
  fileName: string;
}

export interface BankStatementTransaction {
  transactionDate: string;
  direction: "debit" | "credit";
  amount: string;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  memo: string | null;
}

export interface BankStatementExtractionOutput {
  transactions: BankStatementTransaction[];
  modelKey: string;
}

export class BankStatementExtractionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BankStatementExtractionError";
  }
}

const extractionInstructions = `Extract every transaction row from this bank statement into normalized data. Return only transaction-level fields. Exclude account numbers, opening/closing balances, account-holder details, page totals, and non-transaction headings. Direction is debit when money leaves the account and credit when money enters it. Use YYYY-MM-DD dates, positive decimal amount strings without currency symbols or separators, and a three-letter ISO currency code. Preserve counterparty, reference, and memo text exactly when printed; use null when absent. Never infer missing values. The output is draft data for a person to review.`;

const extractionSchema = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          transactionDate: { type: "string" },
          direction: { type: "string", enum: ["debit", "credit"] },
          amount: { type: "string" },
          currency: { type: "string" },
          counterparty: { type: ["string", "null"] },
          reference: { type: ["string", "null"] },
          memo: { type: ["string", "null"] },
        },
        required: ["transactionDate", "direction", "amount", "currency", "counterparty", "reference", "memo"],
        additionalProperties: false,
      },
    },
  },
  required: ["transactions"],
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

function optionalText(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value.trim().slice(0, 2000) || null : null;
}

function parseTransactions(value: unknown): BankStatementTransaction[] {
  if (!isRecord(value) || !Array.isArray(value.transactions) || value.transactions.length === 0) {
    throw new Error("No transaction rows were extracted from this PDF.");
  }
  return value.transactions.flatMap((item): BankStatementTransaction[] => {
    if (!isRecord(item)
      || typeof item.transactionDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.transactionDate)
      || Number.isNaN(Date.parse(item.transactionDate + "T00:00:00Z"))
      || (item.direction !== "debit" && item.direction !== "credit")
      || typeof item.amount !== "string"
      || !/^\d+(\.\d{1,4})?$/.test(item.amount)
      || !/^[A-Z]{3}$/.test(typeof item.currency === "string" ? item.currency : "")) return [];
    return [{
      transactionDate: item.transactionDate,
      direction: item.direction,
      amount: Number(item.amount).toFixed(4),
      currency: item.currency as string,
      counterparty: optionalText(item.counterparty),
      reference: optionalText(item.reference),
      memo: optionalText(item.memo),
    }];
  });
}

export async function extractBankStatementPdf(input: BankStatementPdfInput): Promise<BankStatementExtractionOutput> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new BankStatementExtractionError("OPENAI_API_KEY is not configured.", 401);
  const modelKey = process.env.OPENAI_MODEL?.trim();
  if (!modelKey) throw new BankStatementExtractionError("OPENAI_MODEL is not configured.", 500);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelKey,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: extractionInstructions },
            { type: "input_file", filename: input.fileName.toLowerCase().endsWith(".pdf") ? input.fileName : "bank-statement.pdf", file_data: "data:application/pdf;base64," + input.base64 },
          ],
        }],
        text: { format: { type: "json_schema", name: "bank_statement_transactions", strict: true, schema: extractionSchema } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new BankStatementExtractionError("Bank statement extraction timed out. Try again, or import a CSV statement.", 504);
    }
    throw new BankStatementExtractionError("Could not reach the bank statement extraction provider. Try again.", 502);
  }
  if (!response.ok) {
    console.error("[accounting:bank-statement] OpenAI extraction request failed", { status: response.status, modelKey });
    throw new BankStatementExtractionError("The bank statement extraction provider returned an error.", response.status);
  }
  const output = responseText(await response.json());
  if (!output) throw new Error("The extraction provider returned no structured transactions.");
  const transactions = parseTransactions(JSON.parse(output) as unknown);
  if (!transactions.length) throw new Error("The extracted transaction rows did not pass validation.");
  return { transactions, modelKey };
}

export const bankStatementExtractionTool: ToolDefinition<BankStatementPdfInput, BankStatementExtractionOutput> = {
  id: "accounting.bank-statement.extract",
  version: bankStatementExtractionPromptVersion,
  description: "Extract normalized transaction rows from a bank statement PDF for human-reviewed reconciliation.",
  execute: extractBankStatementPdf,
};
