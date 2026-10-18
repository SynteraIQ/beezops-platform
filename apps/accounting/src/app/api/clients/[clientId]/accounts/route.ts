import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { accountingClients, clientGlAccounts, getDatabase } from "@beezops/database";
import { authOptions } from "../../../../../auth";
import { getWorkspaceForUser } from "../../../../../tenant-service";

type ClientAccountsRouteContext = {
  params: Promise<{ clientId: string }>;
};

interface CreateAccountRequest {
  code?: unknown;
  name?: unknown;
  accountType?: unknown;
  description?: unknown;
}

async function getScopedClient(clientId: string, organizationId: string) {
  const [client] = await getDatabase()
    .select({ id: accountingClients.id })
    .from(accountingClients)
    .where(and(
      eq(accountingClients.id, clientId),
      eq(accountingClients.organizationId, organizationId),
      eq(accountingClients.status, "active"),
    ))
    .limit(1);
  return client ?? null;
}

export async function GET(_request: NextRequest, context: ClientAccountsRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view the chart of accounts." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ accounts: [] });
  const { clientId } = await context.params;
  if (!await getScopedClient(clientId, workspace.id)) {
    return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });
  }

  const accounts = await getDatabase()
    .select({
      id: clientGlAccounts.id,
      code: clientGlAccounts.code,
      name: clientGlAccounts.name,
      accountType: clientGlAccounts.accountType,
      description: clientGlAccounts.description,
    })
    .from(clientGlAccounts)
    .where(and(
      eq(clientGlAccounts.organizationId, workspace.id),
      eq(clientGlAccounts.clientId, clientId),
      eq(clientGlAccounts.status, "active"),
    ))
    .orderBy(clientGlAccounts.code);
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest, context: ClientAccountsRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to update the chart of accounts." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });
  const { clientId } = await context.params;
  if (!await getScopedClient(clientId, workspace.id)) {
    return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });
  }

  let body: CreateAccountRequest;
  try {
    body = (await request.json()) as CreateAccountRequest;
  } catch {
    return NextResponse.json({ error: "Provide a GL code and account name." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const accountType = typeof body.accountType === "string" ? body.accountType.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!code || code.length > 80 || name.length < 2 || name.length > 240 || accountType.length > 80 || description.length > 1000) {
    return NextResponse.json({ error: "Review the account code, name, type, and description." }, { status: 400 });
  }

  const database = getDatabase();
  const [existing] = await database
    .select({ id: clientGlAccounts.id })
    .from(clientGlAccounts)
    .where(and(
      eq(clientGlAccounts.organizationId, workspace.id),
      eq(clientGlAccounts.clientId, clientId),
      eq(clientGlAccounts.code, code),
    ))
    .limit(1);
  if (existing) return NextResponse.json({ error: "That GL code already exists for this client." }, { status: 409 });

  try {
    const [account] = await database
      .insert(clientGlAccounts)
      .values({
        organizationId: workspace.id,
        clientId,
        code,
        name,
        accountType: accountType || null,
        description: description || null,
        createdByUserId: userId,
      })
      .returning({
        id: clientGlAccounts.id,
        code: clientGlAccounts.code,
        name: clientGlAccounts.name,
        accountType: clientGlAccounts.accountType,
        description: clientGlAccounts.description,
      });
    if (!account) throw new Error("The account was not returned after saving.");
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    console.error("[accounting:chart-of-accounts] Could not create account", {
      organizationId: workspace.id,
      clientId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Could not add the GL account." }, { status: 500 });
  }
}
