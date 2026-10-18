import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../auth";
import { getGoogleDriveConnectionStatus } from "../../../../../google-drive-connection";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Sign in to view connection status." }, { status: 401 });
    }

    const status = await getGoogleDriveConnectionStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[connections:google-drive] Status request failed", error);
    return NextResponse.json(
      { error: "Could not load Google Drive connection status." },
      { status: 502 },
    );
  }
}
