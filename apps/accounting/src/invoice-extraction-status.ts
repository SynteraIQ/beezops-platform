export const invoiceExtractionStaleAfterMs = 5 * 60 * 1000;

export function isInvoiceExtractionStuck(
  status: string,
  updatedAt: string | Date,
  now = Date.now(),
): boolean {
  if (status !== "queued" && status !== "processing") return false;
  const lastUpdatedAt = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  return Number.isFinite(lastUpdatedAt) && now - lastUpdatedAt >= invoiceExtractionStaleAfterMs;
}
