import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../auth";
import { createGoogleDriveConnectSession } from "../../../../../google-drive-connection";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Sign in before connecting Google Drive." }, { status: 401 });
    }

    const token = await createGoogleDriveConnectSession();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive connection is not configured." },
        { status: 503 },
      );
    }
    return NextResponse.json({ token });
  } catch (error) {
    console.error("[connections:google-drive] Session request failed", error);
    return NextResponse.json(
      { error: "Could not start Google Drive authorization." },
      { status: 502 },
    );
  }
}
