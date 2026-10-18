import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../auth";
import { GoogleDriveDiscoveryError } from "../../../../google-drive-connection";
import { extractAndSaveGoogleDriveInvoice, InvoiceExtractionError } from "../../../../invoice-extraction";

interface ExtractInvoiceRequest {
  sourceId?: unknown;
  fileId?: unknown;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to extract invoices." }, { status: 401 });

  let body: ExtractInvoiceRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "Choose an invoice PDF." }, { status: 400 });
    }
    body = parsed as ExtractInvoiceRequest;
  } catch {
    return NextResponse.json({ error: "Choose an invoice PDF." }, { status: 400 });
  }

  if (typeof body.sourceId !== "string" || typeof body.fileId !== "string") {
    return NextResponse.json({ error: "Choose an invoice PDF from a synced Drive source." }, { status: 400 });
  }

  try {
    return NextResponse.json(await extractAndSaveGoogleDriveInvoice(body.sourceId, body.fileId), { status: 201 });
  } catch (error) {
    if (error instanceof GoogleDriveDiscoveryError || error instanceof InvoiceExtractionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[invoices:extract] Could not extract invoice", error instanceof Error ? { name: error.name, message: error.message } : { error: "Unknown error" });
    return NextResponse.json({ error: "Could not extract this invoice right now." }, { status: 500 });
  }
}
