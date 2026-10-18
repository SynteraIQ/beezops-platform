import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import {
  GoogleDriveDiscoveryError,
  listGoogleDriveDocumentSources,
  saveGoogleDriveDocumentSource,
} from "../../../../google-drive-connection";

interface SaveSourceRequest {
  connectionId?: unknown;
  folderId?: unknown;
  name?: unknown;
  path?: unknown;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view document sources." }, { status: 401 });
  try {
    return NextResponse.json({ sources: await listGoogleDriveDocumentSources() });
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[invoices:sources] Could not load document sources", error);
    return NextResponse.json({ error: "Could not load document sources right now." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to save a document source." }, { status: 401 });

  let body: SaveSourceRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") return NextResponse.json({ error: "Choose a Google Drive folder." }, { status: 400 });
    body = parsed as SaveSourceRequest;
  } catch {
    return NextResponse.json({ error: "Choose a Google Drive folder." }, { status: 400 });
  }
  if (typeof body.connectionId !== "string" || typeof body.folderId !== "string" || typeof body.name !== "string" || typeof body.path !== "string") {
    return NextResponse.json({ error: "Choose a Google Drive account and folder." }, { status: 400 });
  }

  try {
    const source = await saveGoogleDriveDocumentSource({
      connectionId: body.connectionId,
      folderId: body.folderId,
      name: body.name,
      path: body.path,
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[invoices:sources] Could not save document source", error);
    return NextResponse.json({ error: "Could not save this document source right now." }, { status: 500 });
  }
}
