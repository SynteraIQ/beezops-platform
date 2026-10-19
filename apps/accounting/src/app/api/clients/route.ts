import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { accountingClients, getDatabase, invoices } from "@beezops/database";
import { authOptions } from "../../../auth";
import { getWorkspaceForUser } from "../../../tenant-service";

interface CreateClientRequest {
  invoiceId?: unknown;
  legalName?: unknown;
  billingAddress?: unknown;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to view clients." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ clients: [] });

  const clients = await getDatabase()
    .select({
      id: accountingClients.id,
      legalName: accountingClients.legalName,
      billingAddress: accountingClients.billingAddress,
      status: accountingClients.status,
    })
    .from(accountingClients)
    .where(and(
      eq(accountingClients.organizationId, workspace.id),
      eq(accountingClients.status, "active"),
    ))
    .orderBy(accountingClients.legalName);

  return NextResponse.json({ clients });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in before creating a client." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before creating a client." }, { status: 409 });

  let body: CreateClientRequest;
  try {
    body = (await request.json()) as CreateClientRequest;
  } catch {
    return NextResponse.json({ error: "Provide client details from an invoice." }, { status: 400 });
  }
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const billingAddress = typeof body.billingAddress === "string" ? body.billingAddress.trim() : "";
  if (!invoiceId || legalName.length < 2 || legalName.length > 300 || billingAddress.length > 2000) {
    return NextResponse.json({ error: "Review the client name and address before saving." }, { status: 400 });
  }

  try {
    const database = getDatabase();
    const [client] = await database.transaction(async (transaction) => {
      const [invoice] = await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, workspace.id),
        ))
        .limit(1);
      if (!invoice) throw new Error("Invoice not found in this workspace.");

      const [createdClient] = await transaction
        .insert(accountingClients)
        .values({
          organizationId: workspace.id,
          legalName,
          billingAddress: billingAddress ? { formatted: billingAddress } : {},
          createdByUserId: userId,
        })
        .returning({ id: accountingClients.id, legalName: accountingClients.legalName, billingAddress: accountingClients.billingAddress });
      if (!createdClient) throw new Error("Could not save the client.");

      await transaction
        .update(invoices)
        .set({ accountingClientId: createdClient.id, updatedAt: new Date() })
        .where(and(
          eq(invoices.id, invoiceId),
          eq(invoices.organizationId, workspace.id),
        ));

      return [createdClient];
    });
    return NextResponse.json({ client, invoiceId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the client.";
    console.error("[accounting:clients] Client creation failed", { organizationId: workspace.id, invoiceId, error: message });
    return NextResponse.json({ error: message }, { status: message.startsWith("Invoice not found") ? 404 : 500 });
  }
}
