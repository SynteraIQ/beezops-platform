import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../auth";
import { createWorkspaceForUser, getWorkspaceForUser } from "../../../tenant-service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to view your workspace." }, { status: 401 });
  }

  try {
    return NextResponse.json({ workspace: await getWorkspaceForUser(session.user.id) });
  } catch (error) {
    console.error("[workspace] Could not load workspace", error);
    return NextResponse.json({ error: "Could not load your workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to create a workspace." }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string") {
      return NextResponse.json({ error: "Enter a workspace name." }, { status: 400 });
    }

    const workspace = await createWorkspaceForUser(session.user.id, body.name);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Workspace name must be between 2 and 200 characters.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[workspace] Could not create workspace", error);
    return NextResponse.json({ error: "Could not create your workspace." }, { status: 500 });
  }
}
