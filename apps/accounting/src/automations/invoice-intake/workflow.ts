import { and, desc, eq, or } from "drizzle-orm";
import { getDatabase, invoiceExtractionAttempts, invoices } from "@beezops/database";
import {
  invoiceExtractionPromptVersion,
  invoiceExtractionTool,
  invoiceExtractionSchemaVersion,
  toJsonObject,
  validationIssuesToJson,
} from "@beezops/domain-accounting/tools/invoice-extraction";
import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { DriveApiError, downloadDriveInvoicePdf } from "../../google-drive-invoice-files";
import type { InvoiceIntakeTriggerSource } from "./definition";

export interface InvoiceIntakeWorkflowInput {
  organizationId: string;
  userId: string;
  providerConnectionId: string;
  externalConnectionId: string;
  invoiceId: string;
  attemptId: string;
  fileId: string;
  fileName: string;
  sourceVersion: string;
}

export interface InvoiceIntakeWorkflowResult {
  invoiceId: string;
  attemptId: string;
  status: "ready_for_matching" | "needs_review";
  issueCount: number;
}

async function extractValidateAndPersist(
  input: InvoiceIntakeWorkflowInput,
  triggerSource: InvoiceIntakeTriggerSource,
): Promise<InvoiceIntakeWorkflowResult> {
  "use step";

  const database = getDatabase();
  const [attempt] = await database
    .select({
      id: invoiceExtractionAttempts.id,
      status: invoiceExtractionAttempts.status,
      extractedData: invoiceExtractionAttempts.extractedData,
      validationIssues: invoiceExtractionAttempts.validationIssues,
      sourceVersion: invoiceExtractionAttempts.sourceVersion,
    })
    .from(invoiceExtractionAttempts)
    .innerJoin(invoices, eq(invoiceExtractionAttempts.invoiceId, invoices.id))
    .where(and(
      eq(invoiceExtractionAttempts.id, input.attemptId),
      eq(invoiceExtractionAttempts.organizationId, input.organizationId),
      eq(invoices.organizationId, input.organizationId),
      eq(invoices.providerConnectionId, input.providerConnectionId),
      eq(invoices.sourceFileId, input.fileId),
    ))
    .limit(1);
  if (!attempt) throw new FatalError("The invoice extraction request is no longer available.");
  if ((attempt.status === "ready_for_matching" || attempt.status === "needs_review") && attempt.extractedData) {
    return {
      invoiceId: input.invoiceId,
      attemptId: input.attemptId,
      status: attempt.status,
      issueCount: attempt.validationIssues.length,
    };
  }
  if (attempt.status === "failed") {
    throw new FatalError("This extraction attempt has been replaced or has already failed.");
  }
  if (attempt.sourceVersion !== input.sourceVersion) {
    throw new FatalError("The extraction attempt does not match the selected Drive file version.");
  }

  const now = new Date();
  const [runningAttempt] = await database
    .update(invoiceExtractionAttempts)
    .set({ status: "processing", startedAt: now, errorSummary: null })
    .where(and(
      eq(invoiceExtractionAttempts.id, input.attemptId),
      eq(invoiceExtractionAttempts.organizationId, input.organizationId),
      or(
        eq(invoiceExtractionAttempts.status, "queued"),
        eq(invoiceExtractionAttempts.status, "processing"),
      ),
    ))
    .returning({ id: invoiceExtractionAttempts.id });
  if (!runningAttempt) throw new FatalError("This extraction attempt has been replaced before it started.");
  await database
    .update(invoices)
    .set({ status: "processing", updatedAt: now })
    .where(and(
      eq(invoices.id, input.invoiceId),
      eq(invoices.organizationId, input.organizationId),
      eq(invoices.sourceVersion, input.sourceVersion),
    ));

  try {
    const { base64, file } = await downloadDriveInvoicePdf(
      input.organizationId,
      input.externalConnectionId,
      input.fileId,
      input.sourceVersion,
    );
    const extraction = await invoiceExtractionTool.execute({ base64 });
    const status = extraction.issues.length > 0 ? "needs_review" : "ready_for_matching";
    const validationIssues = validationIssuesToJson(extraction.issues);
    const extractedData = toJsonObject(extraction.invoice);
    const completedAt = new Date();

    const persisted = await database.transaction(async (transaction) => {
      const [updatedAttempt] = await transaction
        .update(invoiceExtractionAttempts)
        .set({
          status,
          modelKey: extraction.modelKey,
          promptVersion: invoiceExtractionPromptVersion,
          schemaVersion: invoiceExtractionSchemaVersion,
          extractedData,
          validationIssues,
          completedAt,
          errorSummary: null,
        })
        .where(and(
          eq(invoiceExtractionAttempts.id, input.attemptId),
          eq(invoiceExtractionAttempts.organizationId, input.organizationId),
          eq(invoiceExtractionAttempts.status, "processing"),
        ))
        .returning({ id: invoiceExtractionAttempts.id });
      if (!updatedAttempt) return false;
      await transaction
        .update(invoices)
        .set({
          status,
          sourceFileName: file.name,
          sourceMimeType: file.mimeType,
          extractedData,
          validationIssues,
          updatedAt: completedAt,
        })
        .where(and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.organizationId, input.organizationId),
          eq(invoices.sourceVersion, input.sourceVersion),
        ));
      return true;
    });
    if (!persisted) throw new FatalError("This extraction attempt was replaced before its result could be saved.");

    console.info("[accounting:invoice-intake] Extraction step completed", {
      attemptId: input.attemptId,
      triggerSource,
      status,
      issueCount: extraction.issues.length,
      workflowAttempt: getStepMetadata().attempt,
    });
    return { invoiceId: input.invoiceId, attemptId: input.attemptId, status, issueCount: extraction.issues.length };
  } catch (error) {
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    if (error instanceof DriveApiError) {
      if (error.status === 401 || error.status === 403 || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
        throw new FatalError(error.message);
      }
      const waitMs = Math.min(1000 * (2 ** (getStepMetadata().attempt - 1)), 30_000);
      throw new RetryableError(error.message, { retryAfter: waitMs });
    }
    if (error instanceof Error && (
      error.message.includes("changed after it was selected")
      || error.message.includes("supports PDF")
      || error.message.includes("too large")
      || error.message.includes("not configured")
      || error.message.includes("did not match the canonical invoice schema")
      || error instanceof SyntaxError
    )) {
      throw new FatalError(error.message);
    }
    if (error instanceof Error && error.name === "ExtractionProviderError") {
      const status = "status" in error && typeof error.status === "number" ? error.status : 500;
      if (status === 401 || status === 403 || (status >= 400 && status < 500 && status !== 429)) {
        throw new FatalError(error.message);
      }
      const waitMs = Math.min(1000 * (2 ** (getStepMetadata().attempt - 1)), 30_000);
      throw new RetryableError(error.message, { retryAfter: waitMs });
    }
    throw error;
  }
}

async function markExtractionFailed(input: InvoiceIntakeWorkflowInput, message: string): Promise<void> {
  "use step";

  const database = getDatabase();
  const completedAt = new Date();
  const safeMessage = message.slice(0, 1000);
  const markedFailed = await database.transaction(async (transaction) => {
    const [updatedAttempt] = await transaction
      .update(invoiceExtractionAttempts)
      .set({ status: "failed", errorSummary: safeMessage, completedAt })
      .where(and(
        eq(invoiceExtractionAttempts.id, input.attemptId),
        eq(invoiceExtractionAttempts.organizationId, input.organizationId),
        or(
          eq(invoiceExtractionAttempts.status, "queued"),
          eq(invoiceExtractionAttempts.status, "processing"),
        ),
      ))
      .returning({ id: invoiceExtractionAttempts.id });
    if (!updatedAttempt) return false;
    const [latestAttempt] = await transaction
      .select({ id: invoiceExtractionAttempts.id })
      .from(invoiceExtractionAttempts)
      .where(and(
        eq(invoiceExtractionAttempts.organizationId, input.organizationId),
        eq(invoiceExtractionAttempts.invoiceId, input.invoiceId),
      ))
      .orderBy(desc(invoiceExtractionAttempts.createdAt))
      .limit(1);
    if (latestAttempt?.id !== input.attemptId) return true;
    await transaction
      .update(invoices)
      .set({
        status: "failed",
        validationIssues: [{ code: "extraction_failed", field: "document", message: "Extraction did not complete. See run details." }],
        updatedAt: completedAt,
      })
      .where(and(
        eq(invoices.id, input.invoiceId),
        eq(invoices.organizationId, input.organizationId),
        eq(invoices.sourceVersion, input.sourceVersion),
      ));
    return true;
  });
  if (!markedFailed) {
    console.info("[accounting:invoice-intake] Skipped failure update for a replaced extraction attempt", {
      attemptId: input.attemptId,
    });
    return;
  }
  console.error("[accounting:invoice-intake] Extraction workflow failed", {
    attemptId: input.attemptId,
    error: safeMessage,
  });
}

export async function runInvoiceIntakeExtraction(
  input: InvoiceIntakeWorkflowInput & { triggerSource: InvoiceIntakeTriggerSource },
): Promise<InvoiceIntakeWorkflowResult> {
  "use workflow";

  try {
    return await extractValidateAndPersist(input, input.triggerSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice extraction failed.";
    await markExtractionFailed(input, message);
    throw error;
  }
}
