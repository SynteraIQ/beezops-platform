import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, providerConnections } from "@beezops/database";
import { authOptions } from "../../../../auth";
import { getDriveInvoiceFolder } from "../../../../google-drive-invoice-files";
import { getWorkspaceForUser } from "../../../../tenant-service";

interface SourceFolderRequest {
  connectionId?: unknown;
  folderId?: unknown;
  folderPath?: unknown;
}

async function getScopedConnection(organizationId: string, connectionId: string) {
  const integrationKey = process.env.NANGO_GOOGLE_DRIVE_INTEGRATION_KEY?.trim();
  if (!integrationKey) return null;
  const [connection] = await getDatabase()
    .select({ id: providerConnections.id, accountMetadata: providerConnections.accountMetadata })
    .from(providerConnections)
    .where(and(
      eq(providerConnections.organizationId, organizationId),
      eq(providerConnections.provider, "google-drive"),
      eq(providerConnections.integrationKey, integrationKey),
      eq(providerConnections.externalConnectionId, connectionId),
      eq(providerConnections.status, "active"),
    ))
    .limit(1);
  return connection ?? null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view the invoice folder." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before importing invoices." }, { status: 409 });

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
  if (!connectionId) return NextResponse.json({ error: "Choose a Google Drive connection." }, { status: 400 });
  const connection = await getScopedConnection(workspace.id, connectionId);
  if (!connection) return NextResponse.json({ error: "Choose an active Google Drive connection." }, { status: 409 });

  const folderId = connection.accountMetadata.invoiceSourceFolderId;
  const folderPath = connection.accountMetadata.invoiceSourceFolderPath;
  return NextResponse.json({
    folder: typeof folderId === "string" && typeof folderPath === "string"
      ? { id: folderId, path: folderPath }
      : null,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to save the invoice folder." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before importing invoices." }, { status: 409 });

  let body: SourceFolderRequest;
  try {
    body = (await request.json()) as SourceFolderRequest;
  } catch {
    return NextResponse.json({ error: "Choose a Google Drive folder." }, { status: 400 });
  }
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
  const folderPath = typeof body.folderPath === "string" ? body.folderPath.trim().slice(0, 500) : "";
  if (!connectionId || !folderId || !folderPath) {
    return NextResponse.json({ error: "Choose a Google Drive folder for invoice intake." }, { status: 400 });
  }

  try {
    const connection = await getScopedConnection(workspace.id, connectionId);
    if (!connection) return NextResponse.json({ error: "Choose an active Google Drive connection." }, { status: 409 });
    const folder = await getDriveInvoiceFolder(workspace.id, connectionId, folderId);
    const database = getDatabase();
    await database
      .update(providerConnections)
      .set({
        accountMetadata: {
          ...connection.accountMetadata,
          invoiceSourceFolderId: folder.id,
          invoiceSourceFolderPath: folderPath,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(providerConnections.id, connection.id),
        eq(providerConnections.organizationId, workspace.id),
      ));
    return NextResponse.json({ folder: { id: folder.id, path: folderPath } });
  } catch (error) {
    console.error("[accounting:invoice-intake] Could not save selected Drive folder", {
      organizationId: workspace.id,
      connectionId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the invoice folder." },
      { status: 502 },
    );
  }
}
