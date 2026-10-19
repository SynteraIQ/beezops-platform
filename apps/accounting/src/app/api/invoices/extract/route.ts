import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, invoiceExtractionAttempts, invoices, providerConnections } from "@beezops/database";
import {
  invoiceExtractionPromptVersion,
  invoiceExtractionSchemaVersion,
} from "@beezops/domain-accounting/tools/invoice-extraction";
import { start } from "workflow/api";
import { authOptions } from "../../../../auth";
import { getDriveInvoiceFile } from "../../../../google-drive-invoice-files";
import { runInvoiceIntakeExtraction } from "../../../../automations/invoice-intake/workflow";
import { getWorkspaceForUser } from "../../../../tenant-service";
import { isInvoiceExtractionStuck } from "../../../../invoice-extraction-status";

interface ExtractRequest {
  connectionId?: unknown;
  fileId?: unknown;
  requestId?: unknown;
  retryStuck?: unknown;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in before extracting an invoice." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before importing invoices." }, { status: 409 });

  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "Provide an invoice file to extract." }, { status: 400 });
  }
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId)
    ? body.requestId.toLowerCase()
    : "";
  const retryStuck = body.retryStuck === true;
  if (!connectionId || !fileId || !requestId) {
    return NextResponse.json({ error: "Choose a Drive file and start a new extraction request." }, { status: 400 });
  }

  try {
    const file = await getDriveInvoiceFile(workspace.id, connectionId, fileId);
    if (!file.version) {
      return NextResponse.json({ error: "This Drive file does not expose a stable version. Refresh and try again." }, { status: 409 });
    }
    const database = getDatabase();
    const now = new Date();
    const [connection] = await database
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(and(
        eq(providerConnections.organizationId, workspace.id),
        eq(providerConnections.externalConnectionId, connectionId),
        eq(providerConnections.provider, "google-drive"),
        eq(providerConnections.status, "active"),
      ))
      .limit(1);
    if (!connection) return NextResponse.json({ error: "Choose an active Google Drive connection." }, { status: 409 });
    const idempotencyKey = requestId + ":" + connectionId + ":" + file.id + ":" + file.version;
    const [idempotentAttempt] = await database
      .select({
        id: invoiceExtractionAttempts.id,
        invoiceId: invoiceExtractionAttempts.invoiceId,
        workflowRunId: invoiceExtractionAttempts.workflowRunId,
        status: invoiceExtractionAttempts.status,
      })
      .from(invoiceExtractionAttempts)
      .where(and(
        eq(invoiceExtractionAttempts.organizationId, workspace.id),
        eq(invoiceExtractionAttempts.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    if (idempotentAttempt) {
      return NextResponse.json({
        invoiceId: idempotentAttempt.invoiceId,
        attemptId: idempotentAttempt.id,
        runId: idempotentAttempt.workflowRunId,
        status: idempotentAttempt.status,
      }, { status: 202 });
    }

    const [existingInvoice] = await database
      .select({ id: invoices.id, sourceVersion: invoices.sourceVersion })
      .from(invoices)
      .where(and(
        eq(invoices.organizationId, workspace.id),
        eq(invoices.providerConnectionId, connection.id),
        eq(invoices.sourceFileId, file.id),
      ))
      .limit(1);
    if (existingInvoice) {
      const [activeAttempt] = await database
        .select({
          id: invoiceExtractionAttempts.id,
          workflowRunId: invoiceExtractionAttempts.workflowRunId,
          status: invoiceExtractionAttempts.status,
          createdAt: invoiceExtractionAttempts.createdAt,
          startedAt: invoiceExtractionAttempts.startedAt,
        })
        .from(invoiceExtractionAttempts)
        .where(and(
          eq(invoiceExtractionAttempts.organizationId, workspace.id),
          eq(invoiceExtractionAttempts.invoiceId, existingInvoice.id),
          eq(invoiceExtractionAttempts.sourceVersion, file.version),
          or(
            eq(invoiceExtractionAttempts.status, "queued"),
            eq(invoiceExtractionAttempts.status, "processing"),
          ),
        ))
        .limit(1);
      if (activeAttempt) {
        const stuck = isInvoiceExtractionStuck(
          activeAttempt.status,
          activeAttempt.startedAt ?? activeAttempt.createdAt,
        );
        if (!retryStuck || !stuck) {
          return NextResponse.json({
            invoiceId: existingInvoice.id,
            attemptId: activeAttempt.id,
            runId: activeAttempt.workflowRunId,
            status: activeAttempt.status,
          }, { status: 202 });
        }
        await database
          .update(invoiceExtractionAttempts)
          .set({
            status: "failed",
            errorSummary: "Replaced by a new extraction request after becoming unresponsive.",
            completedAt: now,
          })
          .where(and(
            eq(invoiceExtractionAttempts.id, activeAttempt.id),
            eq(invoiceExtractionAttempts.organizationId, workspace.id),
            or(
              eq(invoiceExtractionAttempts.status, "queued"),
              eq(invoiceExtractionAttempts.status, "processing"),
            ),
          ));
      }
    }
    const invoiceUpdate = {
      sourceFileName: file.name,
      sourceMimeType: file.mimeType,
      sourceVersion: file.version,
      sourceModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
      status: "queued" as const,
      extractedData: null,
      validationIssues: [],
      updatedAt: now,
      ...(existingInvoice && existingInvoice.sourceVersion !== file.version ? { accountingClientId: null } : {}),
    };
    const [invoice] = await database
      .insert(invoices)
      .values({
        organizationId: workspace.id,
        providerConnectionId: connection.id,
        sourceFileId: file.id,
        sourceFileName: file.name,
        sourceMimeType: file.mimeType,
        sourceVersion: file.version,
        sourceModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
        status: "queued",
        validationIssues: [],
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [invoices.organizationId, invoices.providerConnectionId, invoices.sourceFileId],
        set: invoiceUpdate,
      })
      .returning({ id: invoices.id });
    if (!invoice) throw new Error("Could not create the invoice record.");

    const [createdAttempt] = await database
      .insert(invoiceExtractionAttempts)
      .values({
        organizationId: workspace.id,
        invoiceId: invoice.id,
        idempotencyKey,
        triggerSource: "manual",
        sourceVersion: file.version,
        status: "queued",
        promptVersion: invoiceExtractionPromptVersion,
        schemaVersion: invoiceExtractionSchemaVersion,
        triggeredByUserId: userId,
      })
      .onConflictDoNothing()
      .returning({ id: invoiceExtractionAttempts.id });
    if (!createdAttempt) {
      const [existing] = await database
        .select({
          id: invoiceExtractionAttempts.id,
          workflowRunId: invoiceExtractionAttempts.workflowRunId,
          status: invoiceExtractionAttempts.status,
        })
        .from(invoiceExtractionAttempts)
        .where(and(
          eq(invoiceExtractionAttempts.organizationId, workspace.id),
          eq(invoiceExtractionAttempts.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      return NextResponse.json({ invoiceId: invoice.id, attemptId: existing?.id, runId: existing?.workflowRunId, status: existing?.status ?? "queued" }, { status: 202 });
    }

    const input = {
      organizationId: workspace.id,
      userId,
      providerConnectionId: connection.id,
      externalConnectionId: connectionId,
      invoiceId: invoice.id,
      attemptId: createdAttempt.id,
      fileId: file.id,
      fileName: file.name,
      sourceVersion: file.version,
      triggerSource: "manual" as const,
    };
    const run = await start(runInvoiceIntakeExtraction, [input], {
      attributes: {
        automation: "invoice-intake-extraction",
        workflowVersion: "1",
        organizationId: workspace.id,
        invoiceId: invoice.id,
        attemptId: createdAttempt.id,
        triggerSource: "manual",
      },
    });
    await database.transaction(async (transaction) => {
      await transaction
        .update(invoiceExtractionAttempts)
        .set({ workflowRunId: run.runId })
        .where(and(
          eq(invoiceExtractionAttempts.id, createdAttempt.id),
          eq(invoiceExtractionAttempts.organizationId, workspace.id),
        ));
      await transaction
        .update(invoices)
        .set({ latestWorkflowRunId: run.runId, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, workspace.id)));
    });
    return NextResponse.json({
      invoiceId: invoice.id,
      attemptId: createdAttempt.id,
      runId: run.runId,
      status: "queued",
    }, { status: 202 });
  } catch (error) {
    console.error("[accounting:invoice-intake] Could not start manual extraction", {
      organizationId: workspace.id,
      connectionId,
      fileId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start invoice extraction." },
      { status: 502 },
    );
  }
}
