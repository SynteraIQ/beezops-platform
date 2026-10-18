import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../auth";
import { syncGoogleDriveConnections } from "../../../../../google-drive-connection";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to sync Google Drive connections." }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncGoogleDriveConnections());
  } catch (error) {
    console.error("[connections:google-drive] Connection sync failed", error);
    return NextResponse.json({ error: "Could not sync Google Drive connections." }, { status: 502 });
  }
}
