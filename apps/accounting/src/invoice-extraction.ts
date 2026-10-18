import type { JsonObject, JsonValue } from "@beezops/database";

export const invoiceExtractionPromptVersion = "invoice-extraction.v2";
export const invoiceExtractionSchemaVersion = "canonical-invoice.v2";

type FieldAvailability = "provided" | "not_present" | "unreadable";

export interface ExtractedInvoiceField {
  value: string | null;
  availability: FieldAvailability;
  confidence: number | null;
  evidence: string | null;
  page: number | null;
}

export interface ExtractedInvoice {
  supplierName: ExtractedInvoiceField;
  invoiceNumber: ExtractedInvoiceField;
  invoiceDate: ExtractedInvoiceField;
  dueDate: ExtractedInvoiceField;
  currency: ExtractedInvoiceField;
  subtotal: ExtractedInvoiceField;
  taxAmount: ExtractedInvoiceField;
  totalAmount: ExtractedInvoiceField;
  lineItems: Array<{
    description: ExtractedInvoiceField;
    quantity: ExtractedInvoiceField;
    unitPrice: ExtractedInvoiceField;
    amount: ExtractedInvoiceField;
  }>;
}

export interface InvoiceValidationIssue {
  code: string;
  field: string;
  message: string;
}

export class ExtractionProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ExtractionProviderError";
  }
}

const fieldSchema = {
  type: "object",
  properties: {
    value: { type: ["string", "null"] },
    availability: { type: "string", enum: ["provided", "not_present", "unreadable"] },
    confidence: { type: ["number", "null"] },
    evidence: { type: ["string", "null"] },
    page: { type: ["integer", "null"] },
  },
  required: ["value", "availability", "confidence", "evidence", "page"],
  additionalProperties: false,
};

const invoiceSchema = {
  type: "object",
  properties: {
    supplierName: fieldSchema,
    invoiceNumber: fieldSchema,
    invoiceDate: fieldSchema,
    dueDate: fieldSchema,
    currency: fieldSchema,
    subtotal: fieldSchema,
    taxAmount: fieldSchema,
    totalAmount: fieldSchema,
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: fieldSchema,
          quantity: fieldSchema,
          unitPrice: fieldSchema,
          amount: fieldSchema,
        },
        required: ["description", "quantity", "unitPrice", "amount"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "supplierName",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "currency",
    "subtotal",
    "taxAmount",
    "totalAmount",
    "lineItems",
  ],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isInvoiceField(value: unknown): value is ExtractedInvoiceField {
  if (!isRecord(value)) return false;
  const validAvailability = value.availability === "provided"
    || value.availability === "not_present"
    || value.availability === "unreadable";
  return validAvailability
    && isNullableString(value.value)
    && (value.availability === "provided" ? typeof value.value === "string" && value.value.trim().length > 0 : value.value === null)
    && (value.confidence === null || (typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1))
    && isNullableString(value.evidence)
    && (value.page === null || (typeof value.page === "number" && Number.isInteger(value.page) && value.page >= 1));
}

function isLineItem(value: unknown): value is ExtractedInvoice["lineItems"][number] {
  if (!isRecord(value)) return false;
  return isInvoiceField(value.description)
    && isInvoiceField(value.quantity)
    && isInvoiceField(value.unitPrice)
    && isInvoiceField(value.amount);
}

function parseInvoice(value: unknown): ExtractedInvoice {
  if (!isRecord(value)
    || !isInvoiceField(value.supplierName)
    || !isInvoiceField(value.invoiceNumber)
    || !isInvoiceField(value.invoiceDate)
    || !isInvoiceField(value.dueDate)
    || !isInvoiceField(value.currency)
    || !isInvoiceField(value.subtotal)
    || !isInvoiceField(value.taxAmount)
    || !isInvoiceField(value.totalAmount)
    || !Array.isArray(value.lineItems)
    || !value.lineItems.every(isLineItem)) {
    throw new Error("The extraction response did not match the canonical invoice schema.");
  }
  return value as unknown as ExtractedInvoice;
}

function buildValidationIssues(invoice: ExtractedInvoice): InvoiceValidationIssue[] {
  const issues: InvoiceValidationIssue[] = [];
  const requiredFields: Array<[keyof Pick<ExtractedInvoice, "supplierName" | "invoiceNumber" | "invoiceDate" | "currency" | "totalAmount">, string]> = [
    ["supplierName", "supplier_name"],
    ["invoiceNumber", "invoice_number"],
    ["invoiceDate", "invoice_date"],
    ["currency", "currency"],
    ["totalAmount", "total_amount"],
  ];
  for (const [key, fieldName] of requiredFields) {
    if (invoice[key].availability !== "provided" || !invoice[key].value?.trim()) {
      issues.push({
        code: "required_field_missing",
        field: fieldName,
        message: "Could not confidently extract " + fieldName.replaceAll("_", " ") + ".",
      });
    }
  }
  for (const field of ["invoiceDate", "dueDate"] as const) {
    const value = invoice[field].value;
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      issues.push({
        code: "invalid_date_format",
        field: field === "invoiceDate" ? "invoice_date" : "due_date",
        message: "Date must be represented as YYYY-MM-DD.",
      });
    }
  }
  for (const field of ["subtotal", "taxAmount", "totalAmount"] as const) {
    const value = invoice[field].value;
    if (value && !/^-?\d+(\.\d{1,4})?$/.test(value)) {
      const fieldName = field.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
      issues.push({ code: "invalid_amount_format", field: fieldName, message: "Amount must be a decimal number without a currency symbol." });
    }
  }
  const currency = invoice.currency.value;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    issues.push({ code: "invalid_currency_format", field: "currency", message: "Currency must use a three-letter code." });
  }
  return issues;
}

function outputTextFromResponse(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  const textParts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }
  return textParts.join("\n");
}

export function toJsonObject(invoice: ExtractedInvoice): JsonObject {
  return JSON.parse(JSON.stringify(invoice)) as JsonObject;
}

export function validationIssuesToJson(issues: InvoiceValidationIssue[]): JsonValue[] {
  return issues.map((issue) => ({
    code: issue.code,
    field: issue.field,
    message: issue.message,
  }));
}

export async function extractInvoicePdf(input: {
  base64: string;
  fileName: string;
}): Promise<{ invoice: ExtractedInvoice; issues: InvoiceValidationIssue[]; modelKey: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new ExtractionProviderError("OPENAI_API_KEY is not configured.", 401);
  const modelKey = process.env.OPENAI_MODEL?.trim();
  if (!modelKey) throw new ExtractionProviderError("OPENAI_MODEL is not configured.", 500);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelKey,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the invoice into the supplied schema. Do not infer missing values. For each field, set availability to provided when the invoice contains a readable value, not_present only when the invoice clearly does not state the field, and unreadable when the field appears but its value cannot be read. Use a non-empty value only when availability is provided; otherwise value must be null. Amounts must be decimal strings without currency symbols. Dates must use YYYY-MM-DD. Currency must use an ISO 4217 three-letter code. For provided fields, include a short exact supporting text excerpt and page number when available. Confidence is a number from 0 to 1 or null. Preserve line items when readable.",
          },
          {
            type: "input_file",
            filename: "invoice.pdf",
            file_data: "data:application/pdf;base64," + input.base64,
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "canonical_invoice",
          strict: true,
          schema: invoiceSchema,
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("[accounting:invoice-intake] OpenAI extraction request failed", {
      status: response.status,
      modelKey,
    });
    throw new ExtractionProviderError("The invoice extraction provider returned an error.", response.status);
  }
  const payload: unknown = await response.json();
  const output = outputTextFromResponse(payload);
  if (!output) throw new Error("The extraction provider returned no structured invoice.");
  const invoice = parseInvoice(JSON.parse(output) as unknown);
  return { invoice, issues: buildValidationIssues(invoice), modelKey };
}
