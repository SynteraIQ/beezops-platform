import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import { getWorkspaceForUser } from "../../../../tenant-service";
import { listDriveInvoiceFolder } from "../../../../google-drive-invoice-files";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to browse Google Drive." }, { status: 401 });

  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before importing invoices." }, { status: 409 });

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
  const folderId = request.nextUrl.searchParams.get("folderId")?.trim() || "root";
  if (!connectionId) return NextResponse.json({ error: "Choose a Google Drive connection." }, { status: 400 });
  try {
    const contents = await listDriveInvoiceFolder(workspace.id, connectionId, folderId);
    console.info("[accounting:invoice-intake] Drive folder contents loaded", {
      organizationId: workspace.id,
      connectionId,
      folderId,
      fileCount: contents.files.length,
      folderCount: contents.folders.length,
    });
    return NextResponse.json(contents);
  } catch (error) {
    console.error("[accounting:invoice-intake] Drive PDF discovery failed", {
      organizationId: workspace.id,
      connectionId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not browse Google Drive." },
      { status: 502 },
    );
  }
}
