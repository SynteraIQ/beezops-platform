import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import {
  GoogleDriveDiscoveryError,
  listGoogleDriveFolders,
} from "../../../../google-drive-connection";

interface FolderRequest {
  connectionId?: unknown;
  parentFolderId?: unknown;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to browse Google Drive." }, { status: 401 });
  }

  let body: FolderRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "Choose a Google Drive account and folder." }, { status: 400 });
    }
    body = parsed as FolderRequest;
  } catch {
    return NextResponse.json({ error: "Choose a Google Drive account and folder." }, { status: 400 });
  }

  if (typeof body.connectionId !== "string" || typeof body.parentFolderId !== "string") {
    return NextResponse.json({ error: "Choose a Google Drive account and folder." }, { status: 400 });
  }

  try {
    return NextResponse.json({ folders: await listGoogleDriveFolders(body.connectionId, body.parentFolderId) });
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError) {
      console.warn("[invoices:google-drive] Folder listing was rejected", {
        status: error.status,
        message: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[invoices:google-drive] Folder listing failed", error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { errorType: typeof error });
    return NextResponse.json({ error: "Could not browse Google Drive right now." }, { status: 502 });
  }
}
