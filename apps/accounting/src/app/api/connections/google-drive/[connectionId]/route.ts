import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../auth";
import { disconnectGoogleDriveConnection } from "../../../../../google-drive-connection";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to disconnect Google Drive." }, { status: 401 });
  }

  try {
    const { connectionId } = await context.params;
    await disconnectGoogleDriveConnection(connectionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[connections:google-drive] Disconnect request failed", error);
    const message = error instanceof Error ? error.message : "Could not disconnect Google Drive.";
    const status = message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
