export interface ParsedBankTransaction {
  rowNumber: number;
  transactionDate: Date;
  direction: "debit" | "credit";
  amount: string;
  currency: string;
  counterparty: string | null;
  reference: string | null;
  memo: string | null;
}

export function parseBankStatementCsv(input: string): ParsedBankTransaction[] {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new Error("The CSV must include a header and at least one transaction.");
  const headers = rows[0].map(normalizeHeader);
  const columns = {
    date: headers.indexOf("date"),
    direction: headers.indexOf("direction"),
    amount: headers.indexOf("amount"),
    currency: headers.indexOf("currency"),
    counterparty: headers.indexOf("counterparty"),
    reference: headers.indexOf("reference"),
    memo: headers.indexOf("memo"),
  };
  const required = [columns.date, columns.direction, columns.amount, columns.currency];
  if (required.some((index) => index < 0)) {
    throw new Error("Required CSV columns are date, direction, amount, and currency. Counterparty, reference, and memo are optional.");
  }

  return rows.slice(1).flatMap((row, index) => {
    if (row.every((value) => !value.trim())) return [];
    const dateText = cell(row, columns.date);
    const transactionDate = parseDate(dateText);
    const directionText = cell(row, columns.direction).toLowerCase();
    const direction = directionText === "debit" || directionText === "credit" ? directionText : null;
    const amountText = cell(row, columns.amount).replaceAll(",", "").trim();
    const amountValue = Number(amountText);
    const currency = cell(row, columns.currency).trim().toUpperCase();
    if (!transactionDate || !direction || !Number.isFinite(amountValue) || amountValue <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Transaction row ${index + 2} has an invalid date, direction, amount, or currency.`);
    }
    return [{
      rowNumber: index + 2,
      transactionDate,
      direction,
      amount: amountValue.toFixed(4),
      currency,
      counterparty: optionalCell(row, columns.counterparty),
      reference: optionalCell(row, columns.reference),
      memo: optionalCell(row, columns.memo),
    }];
  });
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cell(row: string[], index: number): string {
  return index < 0 ? "" : (row[index] ?? "").trim();
}

function optionalCell(row: string[], index: number): string | null {
  const value = cell(row, index);
  return value ? value.slice(0, 2000) : null;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T00:00:00.000Z" : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
