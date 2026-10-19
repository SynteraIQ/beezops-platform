import type { JsonObject, JsonValue } from "@beezops/database";
import type { ToolDefinition } from "@beezops/tools";

export const invoiceExtractionPromptVersion = "invoice-extraction.v5";
export const invoiceExtractionSchemaVersion = "canonical-invoice.v4";

const invoiceExtractionInstructions = `Extract the invoice into the supplied schema. Do not infer missing values. For each field, set availability to provided when the invoice contains a readable value, not_present only when the invoice clearly does not state the field, and unreadable when the field appears but its value cannot be read. Use a non-empty value only when availability is provided; otherwise value must be null.

Amounts and rates must be decimal strings without currency symbols; a printed rate of 9% is represented as 9. Dates must use YYYY-MM-DD. Currency must use an ISO 4217 three-letter code. For provided fields, include a short exact supporting text excerpt and page number when available. Confidence is a number from 0 to 1 or null. Preserve line items when readable.

Extract detailed tax table rows into taxBreakdown, including HSN/SAC, taxable amount, each printed tax label exactly as shown, its normalized tax type when clear, rate, and amount. For GST invoices, preserve labels such as "CGST OUTPUT 9%" and "SGST OUTPUT 9%" exactly in printedLabel; when the tax type is clear, normalize taxType to "CGST" or "SGST". Also capture IGST, UTGST, cess, or other printed tax components when present. Keep the printed label separate from normalized tax type. Do not assume the invoice is governed by GST or infer tax types, rates, or amounts when the document does not make them clear.

Extract the Bill To name and address exactly as printed when present. Preserve the full address as one readable field; do not treat it as verified client identity and do not infer missing address components.

Do not include bold subtotal or total rows as additional taxBreakdown entries; use the invoice-level subtotal, taxAmount, and totalAmount fields for those totals. The invoice-level taxAmount remains the printed invoice tax total, not a model-calculated total.`;

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
  billToName: ExtractedInvoiceField;
  billToAddress: ExtractedInvoiceField;
  invoiceNumber: ExtractedInvoiceField;
  invoiceDate: ExtractedInvoiceField;
  dueDate: ExtractedInvoiceField;
  currency: ExtractedInvoiceField;
  subtotal: ExtractedInvoiceField;
  taxAmount: ExtractedInvoiceField;
  totalAmount: ExtractedInvoiceField;
  taxBreakdown: Array<{
    hsnSac: ExtractedInvoiceField;
    taxableAmount: ExtractedInvoiceField;
    taxes: Array<{
      printedLabel: ExtractedInvoiceField;
      taxType: ExtractedInvoiceField;
      ratePercent: ExtractedInvoiceField;
      amount: ExtractedInvoiceField;
    }>;
  }>;
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

export interface InvoiceExtractionInput {
  base64: string;
}

export interface InvoiceExtractionOutput {
  invoice: ExtractedInvoice;
  issues: InvoiceValidationIssue[];
  modelKey: string;
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
    billToName: fieldSchema,
    billToAddress: fieldSchema,
    invoiceNumber: fieldSchema,
    invoiceDate: fieldSchema,
    dueDate: fieldSchema,
    currency: fieldSchema,
    subtotal: fieldSchema,
    taxAmount: fieldSchema,
    totalAmount: fieldSchema,
    taxBreakdown: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hsnSac: fieldSchema,
          taxableAmount: fieldSchema,
          taxes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                printedLabel: fieldSchema,
                taxType: fieldSchema,
                ratePercent: fieldSchema,
                amount: fieldSchema,
              },
              required: ["printedLabel", "taxType", "ratePercent", "amount"],
              additionalProperties: false,
            },
          },
        },
        required: ["hsnSac", "taxableAmount", "taxes"],
        additionalProperties: false,
      },
    },
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
    "billToName",
    "billToAddress",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "currency",
    "subtotal",
    "taxAmount",
    "totalAmount",
    "taxBreakdown",
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

function invoiceSchemaIssuePaths(value: unknown): string[] {
  if (!isRecord(value)) return ["invoice"];

  const issues: string[] = [];
  const invoiceFields = [
    "supplierName",
    "billToName",
    "billToAddress",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "currency",
    "subtotal",
    "taxAmount",
    "totalAmount",
  ] as const;
  for (const field of invoiceFields) {
    if (!isInvoiceField(value[field])) issues.push(`invoice.${field}`);
  }

  if (!Array.isArray(value.taxBreakdown)) {
    issues.push("invoice.taxBreakdown");
  } else {
    value.taxBreakdown.forEach((row, rowIndex) => {
      const rowPath = `invoice.taxBreakdown.${rowIndex}`;
      if (!isRecord(row)) {
        issues.push(rowPath);
        return;
      }
      if (!isInvoiceField(row.hsnSac)) issues.push(`${rowPath}.hsnSac`);
      if (!isInvoiceField(row.taxableAmount)) issues.push(`${rowPath}.taxableAmount`);
      if (!Array.isArray(row.taxes)) {
        issues.push(`${rowPath}.taxes`);
        return;
      }
      row.taxes.forEach((tax, taxIndex) => {
        const taxPath = `${rowPath}.taxes.${taxIndex}`;
        if (!isRecord(tax)) {
          issues.push(taxPath);
          return;
        }
        if (!isInvoiceField(tax.printedLabel)) issues.push(`${taxPath}.printedLabel`);
        if (!isInvoiceField(tax.taxType)) issues.push(`${taxPath}.taxType`);
        if (!isInvoiceField(tax.ratePercent)) issues.push(`${taxPath}.ratePercent`);
        if (!isInvoiceField(tax.amount)) issues.push(`${taxPath}.amount`);
      });
    });
  }

  if (!Array.isArray(value.lineItems)) {
    issues.push("invoice.lineItems");
  } else {
    value.lineItems.forEach((lineItem, lineIndex) => {
      const linePath = `invoice.lineItems.${lineIndex}`;
      if (!isRecord(lineItem)) {
        issues.push(linePath);
        return;
      }
      if (!isInvoiceField(lineItem.description)) issues.push(`${linePath}.description`);
      if (!isInvoiceField(lineItem.quantity)) issues.push(`${linePath}.quantity`);
      if (!isInvoiceField(lineItem.unitPrice)) issues.push(`${linePath}.unitPrice`);
      if (!isInvoiceField(lineItem.amount)) issues.push(`${linePath}.amount`);
    });
  }

  return issues;
}

function parseInvoice(value: unknown): ExtractedInvoice {
  const issuePaths = invoiceSchemaIssuePaths(value);
  if (issuePaths.length > 0) {
    console.error("[accounting:invoice-intake] Structured extraction failed canonical schema validation", {
      invalidFieldPaths: issuePaths,
    });
    throw new Error(`The extraction response did not match the canonical invoice schema. Invalid fields: ${issuePaths.join(", ")}.`);
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
  let extractedTaxTotal = 0;
  let hasCompleteTaxBreakdown = invoice.taxBreakdown.length > 0;
  invoice.taxBreakdown.forEach((row, rowIndex) => {
    const taxableAmount = row.taxableAmount.value;
    const taxableValue = taxableAmount && /^-?\d+(\.\d{1,4})?$/.test(taxableAmount) ? Number(taxableAmount) : null;
    if (row.taxes.length === 0) hasCompleteTaxBreakdown = false;
    if (row.taxableAmount.availability === "provided" && taxableValue === null) {
      issues.push({
        code: "invalid_amount_format",
        field: `tax_breakdown.${rowIndex}.taxable_amount`,
        message: "Taxable value must be a decimal number without a currency symbol.",
      });
    }
    row.taxes.forEach((tax, taxIndex) => {
      const amount = tax.amount.value;
      const taxAmount = amount && /^-?\d+(\.\d{1,4})?$/.test(amount) ? Number(amount) : null;
      const rate = tax.ratePercent.value;
      const rateValue = rate && /^-?\d+(\.\d{1,4})?$/.test(rate) ? Number(rate) : null;
      if (taxAmount !== null) {
        extractedTaxTotal += taxAmount;
      } else {
        hasCompleteTaxBreakdown = false;
        if (tax.amount.availability === "provided") {
          issues.push({
            code: "invalid_amount_format",
            field: `tax_breakdown.${rowIndex}.taxes.${taxIndex}.amount`,
            message: "Tax amount must be a decimal number without a currency symbol.",
          });
        }
      }
      if (tax.ratePercent.availability === "provided" && rateValue === null) {
        issues.push({
          code: "invalid_rate_format",
          field: `tax_breakdown.${rowIndex}.taxes.${taxIndex}.rate_percent`,
          message: "Tax rate must be a decimal percentage without a percent sign.",
        });
      }
      if (taxableValue !== null && taxAmount !== null && rateValue !== null) {
        const expectedAmount = taxableValue * rateValue / 100;
        if (Math.abs(expectedAmount - taxAmount) > 0.02) {
          issues.push({
            code: "tax_component_calculation_mismatch",
            field: `tax_breakdown.${rowIndex}.taxes.${taxIndex}.amount`,
            message: "The extracted tax amount does not match the taxable value and rate; verify it against the invoice.",
          });
        }
      }
    });
  });
  const invoiceTaxAmount = invoice.taxAmount.value;
  if (hasCompleteTaxBreakdown && invoiceTaxAmount && /^-?\d+(\.\d{1,4})?$/.test(invoiceTaxAmount)
    && Math.abs(extractedTaxTotal - Number(invoiceTaxAmount)) > 0.02) {
    issues.push({
      code: "tax_breakdown_total_mismatch",
      field: "tax_amount",
      message: "The extracted tax components do not add up to the invoice tax total; verify the breakdown.",
    });
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

export async function extractInvoicePdf(input: InvoiceExtractionInput): Promise<InvoiceExtractionOutput> {
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
            text: invoiceExtractionInstructions,
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

export const invoiceExtractionTool: ToolDefinition<InvoiceExtractionInput, InvoiceExtractionOutput> = {
  id: "accounting.invoice.extract",
  version: invoiceExtractionPromptVersion,
  description: "Extract invoice fields, line items, and printed tax breakdowns into the accounting canonical invoice format.",
  execute: extractInvoicePdf,
};
