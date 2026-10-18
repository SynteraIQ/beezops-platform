import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../../auth";
import {
  GoogleDriveDiscoveryError,
  syncGoogleDriveDocumentSource,
} from "../../../../../../google-drive-connection";

interface RouteContext {
  params: Promise<{ sourceId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to sync this document source." }, { status: 401 });
  const { sourceId } = await context.params;
  try {
    return NextResponse.json(await syncGoogleDriveDocumentSource(sourceId));
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[invoices:sources] Could not sync document source", error);
    return NextResponse.json({ error: "Could not sync this document source right now." }, { status: 500 });
  }
}
