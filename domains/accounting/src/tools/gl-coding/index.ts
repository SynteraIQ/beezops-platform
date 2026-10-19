import type { ToolDefinition } from "@beezops/tools";

export const glCodingPromptVersion = "gl-coding.v1";

export interface GlCodingAccount {
  code: string;
  name: string;
  accountType: string | null;
  description: string | null;
}

export interface GlCodingLine {
  lineIndex: number;
  description: string;
  amount: string | null;
}

export interface GlCodingInput {
  supplierName: string | null;
  lines: GlCodingLine[];
  accounts: GlCodingAccount[];
}

export interface GlCodingRecommendation {
  lineIndex: number;
  accountCode: string | null;
  rationale: string;
  confidence: number | null;
  evidence: string[];
}

export interface GlCodingOutput {
  recommendations: GlCodingRecommendation[];
  modelKey: string;
}

export class GlCodingProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GlCodingProviderError";
  }
}

const glCodingInstructions = `Recommend one GL account for each invoice line using only the supplied client chart of accounts. Never invent a code. Use the line description, amount, supplier name, account name, and account description as evidence. Return null for accountCode when no account is adequately supported. Return one result for each supplied lineIndex. Rationale must be concise and evidence-linked. This is a recommendation only; a person must approve or change it. Do not infer client identity, tax treatment, or payment status.`;

const glCodingSchema = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineIndex: { type: "integer" },
          accountCode: { type: ["string", "null"] },
          rationale: { type: "string" },
          confidence: { type: ["number", "null"] },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["lineIndex", "accountCode", "rationale", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseText(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return "";
  const parts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseRecommendations(value: unknown, input: GlCodingInput): GlCodingRecommendation[] {
  if (!isRecord(value) || !Array.isArray(value.recommendations)) {
    throw new Error("The GL coding response did not match the recommendation schema.");
  }
  const allowedCodes = new Set(input.accounts.map((account) => account.code));
  const lineIndexes = new Set(input.lines.map((line) => line.lineIndex));
  const recommendations = value.recommendations.flatMap((item): GlCodingRecommendation[] => {
    if (!isRecord(item)
      || typeof item.lineIndex !== "number"
      || !lineIndexes.has(item.lineIndex)
      || !(item.accountCode === null || (typeof item.accountCode === "string" && allowedCodes.has(item.accountCode)))
      || typeof item.rationale !== "string"
      || !(item.confidence === null || (typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1))
      || !Array.isArray(item.evidence)
      || !item.evidence.every((evidence) => typeof evidence === "string")) return [];
    return [{
      lineIndex: item.lineIndex,
      accountCode: item.accountCode,
      rationale: item.rationale,
      confidence: item.confidence,
      evidence: item.evidence,
    }];
  });
  if (recommendations.length !== input.lines.length) {
    throw new Error("The GL coding response did not return a valid recommendation for each invoice line.");
  }
  return recommendations;
}

export async function recommendGlCoding(input: GlCodingInput): Promise<GlCodingOutput> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new GlCodingProviderError("OPENAI_API_KEY is not configured.", 401);
  const modelKey = process.env.OPENAI_MODEL?.trim();
  if (!modelKey) throw new GlCodingProviderError("OPENAI_MODEL is not configured.", 500);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelKey,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: glCodingInstructions + "\n\n" + JSON.stringify(input) }],
      }],
      text: {
        format: { type: "json_schema", name: "gl_coding_recommendations", strict: true, schema: glCodingSchema },
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("[accounting:gl-coding] OpenAI request failed", { status: response.status, modelKey });
    throw new GlCodingProviderError("The coding recommendation provider returned an error.", response.status);
  }
  const output = responseText(await response.json());
  if (!output) throw new Error("The coding recommendation provider returned no structured result.");
  return { recommendations: parseRecommendations(JSON.parse(output) as unknown, input), modelKey };
}

export const glCodingTool: ToolDefinition<GlCodingInput, GlCodingOutput> = {
  id: "accounting.invoice.recommend-gl-coding",
  version: glCodingPromptVersion,
  description: "Recommend GL accounts for invoice lines using the selected client chart of accounts.",
  execute: recommendGlCoding,
};
