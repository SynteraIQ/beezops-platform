export const invoiceIntakeExtractionWorkflow = {
  id: "invoice-intake-extraction",
  version: "1",
  name: "Invoice Intake & Extraction",
  purpose: "Extract a reviewable canonical invoice candidate from a connected source file.",
  triggers: ["manual", "drive_discovery"] as const,
  steps: [
    { id: "deduplicate", label: "Check source file version" },
    { id: "extract-and-validate", label: "Extract fields and validate structure" },
    { id: "save-result", label: "Save candidate or route to review" },
  ],
} as const;

export type InvoiceIntakeTriggerSource = (typeof invoiceIntakeExtractionWorkflow.triggers)[number];
