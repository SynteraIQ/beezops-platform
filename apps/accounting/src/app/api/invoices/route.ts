import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getDatabase, invoices, providerConnections } from "@beezops/database";
import { authOptions } from "../../../auth";
import { getWorkspaceForUser } from "../../../tenant-service";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view invoices." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ invoices: [] });

  const rows = await getDatabase()
    .select({
      id: invoices.id,
      accountingClientId: invoices.accountingClientId,
      connectionId: providerConnections.externalConnectionId,
      sourceFileId: invoices.sourceFileId,
      sourceFileName: invoices.sourceFileName,
      sourceMimeType: invoices.sourceMimeType,
      sourceVersion: invoices.sourceVersion,
      sourceModifiedAt: invoices.sourceModifiedAt,
      status: invoices.status,
      extractedData: invoices.extractedData,
      validationIssues: invoices.validationIssues,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .innerJoin(providerConnections, eq(invoices.providerConnectionId, providerConnections.id))
    .where(eq(invoices.organizationId, workspace.id))
    .orderBy(desc(invoices.updatedAt))
    .limit(100);
  console.info("[accounting:invoice-intake] Invoice list loaded", {
    organizationId: workspace.id,
    count: rows.length,
  });
  return NextResponse.json({ invoices: rows });
}
