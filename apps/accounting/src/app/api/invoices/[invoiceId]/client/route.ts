import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { accountingClients, getDatabase, invoices } from "@beezops/database";
import { authOptions } from "../../../../../auth";
import { getWorkspaceForUser } from "../../../../../tenant-service";

type InvoiceClientRouteContext = {
  params: Promise<{ invoiceId: string }>;
};

interface SetInvoiceClientRequest {
  clientId?: unknown;
}

export async function PATCH(request: NextRequest, context: InvoiceClientRouteContext) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to assign an invoice to a client." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace first." }, { status: 409 });

  const { invoiceId } = await context.params;
  let body: SetInvoiceClientRequest;
  try {
    body = (await request.json()) as SetInvoiceClientRequest;
  } catch {
    return NextResponse.json({ error: "Choose a client for this invoice." }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return NextResponse.json({ error: "Choose a client for this invoice." }, { status: 400 });

  try {
    const database = getDatabase();
    const [client] = await database
      .select({ id: accountingClients.id, legalName: accountingClients.legalName })
      .from(accountingClients)
      .where(and(
        eq(accountingClients.id, clientId),
        eq(accountingClients.organizationId, workspace.id),
        eq(accountingClients.status, "active"),
      ))
      .limit(1);
    if (!client) return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });

    const [invoice] = await database
      .update(invoices)
      .set({ accountingClientId: client.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, workspace.id)))
      .returning({ id: invoices.id });
    if (!invoice) return NextResponse.json({ error: "Invoice not found in this workspace." }, { status: 404 });

    return NextResponse.json({ invoiceId: invoice.id, client });
  } catch (error) {
    console.error("[accounting:clients] Invoice client assignment failed", {
      organizationId: workspace.id,
      invoiceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Could not assign this invoice to the client." }, { status: 500 });
  }
}
