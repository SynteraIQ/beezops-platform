export interface CanonicalInvoiceTaxIdentifier {
  scheme: string | null;
  value: string | null;
  countryCode: string | null;
}

export interface CanonicalInvoiceTaxComponent {
  label: string | null;
  rate: string | null;
  amount: string | null;
  jurisdiction: string | null;
}

export interface CanonicalInvoiceLineItem {
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  code: string | null;
  codeSystem: string | null;
}

export interface CanonicalInvoiceEvidence {
  field: string;
  quote: string;
  page: number | null;
}

export interface CanonicalInvoice {
  schemaVersion: "2";
  jurisdictionCountryCode: string | null;
  supplierName: string | null;
  supplierTaxIdentifiers: CanonicalInvoiceTaxIdentifier[];
  buyerName: string | null;
  buyerTaxIdentifiers: CanonicalInvoiceTaxIdentifier[];
  shipToName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: string | null;
  discountTotal: string | null;
  taxTotal: string | null;
  taxComponents: CanonicalInvoiceTaxComponent[];
  total: string | null;
  lineItems: CanonicalInvoiceLineItem[];
  evidence: CanonicalInvoiceEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function readNullableString(record: Record<string, unknown>, key: string, fallback: string | null = null) {
  const value = record[key];
  if (value === undefined) return fallback;
  if (!isNullableString(value)) throw new Error("The stored invoice record is invalid.");
  return value;
}

function readTaxIdentifiers(value: unknown): CanonicalInvoiceTaxIdentifier[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The stored invoice tax identifiers are invalid.");
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("The stored invoice tax identifier is invalid.");
    return {
      scheme: readNullableString(item, "scheme"),
      value: readNullableString(item, "value"),
      countryCode: readNullableString(item, "countryCode"),
    };
  });
}

function readTaxComponents(value: unknown): CanonicalInvoiceTaxComponent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The stored invoice tax breakdown is invalid.");
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("The stored invoice tax component is invalid.");
    return {
      label: readNullableString(item, "label"),
      rate: readNullableString(item, "rate"),
      amount: readNullableString(item, "amount"),
      jurisdiction: readNullableString(item, "jurisdiction"),
    };
  });
}

function readLineItems(value: unknown): CanonicalInvoiceLineItem[] {
  if (!Array.isArray(value)) throw new Error("The stored invoice record is invalid.");
  return value.map((item): CanonicalInvoiceLineItem => {
    if (!isRecord(item)) throw new Error("The stored invoice line item is invalid.");
    return {
      description: readNullableString(item, "description"),
      quantity: readNullableString(item, "quantity"),
      unitPrice: readNullableString(item, "unitPrice"),
      amount: readNullableString(item, "amount"),
      code: readNullableString(item, "code"),
      codeSystem: readNullableString(item, "codeSystem"),
    };
  });
}

function readEvidence(value: unknown): CanonicalInvoiceEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The stored invoice evidence is invalid.");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.field !== "string" || typeof item.quote !== "string") {
      throw new Error("The stored invoice evidence item is invalid.");
    }
    if (item.page !== null && item.page !== undefined && (typeof item.page !== "number" || !Number.isInteger(item.page) || item.page < 1)) {
      throw new Error("The stored invoice evidence page is invalid.");
    }
    return { field: item.field, quote: item.quote, page: typeof item.page === "number" ? item.page : null };
  });
}

export function parseCanonicalInvoice(value: unknown): CanonicalInvoice {
  if (!isRecord(value)) throw new Error("The stored invoice record is invalid.");
  const scalarFields = ["supplierName", "invoiceNumber", "invoiceDate", "dueDate", "currency", "subtotal", "taxTotal", "total"];
  if (scalarFields.some((field) => !isNullableString(value[field]))) {
    throw new Error("The stored invoice record is invalid.");
  }

  return {
    schemaVersion: "2",
    jurisdictionCountryCode: readNullableString(value, "jurisdictionCountryCode"),
    supplierName: readNullableString(value, "supplierName"),
    supplierTaxIdentifiers: readTaxIdentifiers(value.supplierTaxIdentifiers),
    buyerName: readNullableString(value, "buyerName"),
    buyerTaxIdentifiers: readTaxIdentifiers(value.buyerTaxIdentifiers),
    shipToName: readNullableString(value, "shipToName"),
    invoiceNumber: readNullableString(value, "invoiceNumber"),
    invoiceDate: readNullableString(value, "invoiceDate"),
    dueDate: readNullableString(value, "dueDate"),
    currency: readNullableString(value, "currency"),
    subtotal: readNullableString(value, "subtotal"),
    discountTotal: readNullableString(value, "discountTotal"),
    taxTotal: readNullableString(value, "taxTotal"),
    taxComponents: readTaxComponents(value.taxComponents),
    total: readNullableString(value, "total"),
    lineItems: readLineItems(value.lineItems),
    evidence: readEvidence(value.evidence),
  };
}
