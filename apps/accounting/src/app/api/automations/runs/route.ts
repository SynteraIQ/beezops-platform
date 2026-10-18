import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getDatabase, invoiceExtractionAttempts, invoices } from "@beezops/database";
import { authOptions } from "../../../../auth";
import { getWorkspaceForUser } from "../../../../tenant-service";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view agent runs." }, { status: 401 });

  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ runs: [] });

  const rows = await getDatabase()
    .select({
      id: invoiceExtractionAttempts.id,
      invoiceId: invoiceExtractionAttempts.invoiceId,
      workflowRunId: invoiceExtractionAttempts.workflowRunId,
      sourceFileName: invoices.sourceFileName,
      triggerSource: invoiceExtractionAttempts.triggerSource,
      status: invoiceExtractionAttempts.status,
      modelKey: invoiceExtractionAttempts.modelKey,
      promptVersion: invoiceExtractionAttempts.promptVersion,
      schemaVersion: invoiceExtractionAttempts.schemaVersion,
      errorSummary: invoiceExtractionAttempts.errorSummary,
      startedAt: invoiceExtractionAttempts.startedAt,
      completedAt: invoiceExtractionAttempts.completedAt,
      createdAt: invoiceExtractionAttempts.createdAt,
    })
    .from(invoiceExtractionAttempts)
    .innerJoin(invoices, and(
      eq(invoiceExtractionAttempts.invoiceId, invoices.id),
      eq(invoiceExtractionAttempts.organizationId, invoices.organizationId),
    ))
    .where(eq(invoiceExtractionAttempts.organizationId, workspace.id))
    .orderBy(desc(invoiceExtractionAttempts.createdAt))
    .limit(100);

  return NextResponse.json({ runs: rows });
}
