import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { accountingClients, agentRuns, bankStatementImports, bankTransactions, getDatabase } from "@beezops/database";
import {
  bankStatementExtractionPromptVersion,
  bankStatementExtractionTool,
} from "@beezops/domain-accounting/tools/bank-statement-extraction";
import { authOptions } from "../../../../auth";
import { getWorkspaceForUser } from "../../../../tenant-service";
import { parseBankStatementCsv } from "../../../../bank-statement-csv";

interface ImportStatementRequest {
  clientId?: unknown;
  fileName?: unknown;
  csvText?: unknown;
  pdfBase64?: unknown;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in before importing a bank statement." }, { status: 401 });
  const workspace = await getWorkspaceForUser(userId);
  if (!workspace) return NextResponse.json({ error: "Set up a workspace before importing a statement." }, { status: 409 });

  let body: ImportStatementRequest;
  try {
    body = (await request.json()) as ImportStatementRequest;
  } catch {
    return NextResponse.json({ error: "Choose a CSV or PDF bank statement to import." }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 500) : "";
  const csvText = typeof body.csvText === "string" ? body.csvText : "";
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  if (!clientId || (!isCsv && !isPdf)
    || (isCsv && (!csvText || csvText.length > 2_000_000))
    || (isPdf && (!pdfBase64 || pdfBase64.length > 3_500_000))) {
    return NextResponse.json({ error: "Choose a CSV under 2 MB or a PDF under 2.5 MB and a client before importing." }, { status: 400 });
  }

  let agentRunId: string | null = null;
  let stage = "validate-client";
  try {
    const database = getDatabase();
    const [client] = await database
      .select({ id: accountingClients.id })
      .from(accountingClients)
      .where(and(
        eq(accountingClients.id, clientId),
        eq(accountingClients.organizationId, workspace.id),
        eq(accountingClients.status, "active"),
      ))
      .limit(1);
    if (!client) return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });

    const startedAt = new Date();
    const promptVersion = isPdf ? bankStatementExtractionPromptVersion : "bank-statement-csv-normalization.v1";
    const [run] = await database.insert(agentRuns).values({
      organizationId: workspace.id,
      productKey: "accounting",
      agentKey: isPdf ? "bank-statement-extraction" : "bank-statement-import",
      status: "running",
      promptVersion,
      agentVersion: "1",
      sourceType: "bank_statement",
      result: { sourceFileName: fileName, fileType: isPdf ? "pdf" : "csv" },
      startedAt,
    }).returning({ id: agentRuns.id });
    if (!run) throw new Error("Could not start the statement import run.");
    agentRunId = run.id;
    console.info("[accounting:reconciliation] Bank statement import started", {
      organizationId: workspace.id,
      clientId: client.id,
      agentRunId: run.id,
      fileType: isPdf ? "pdf" : "csv",
    });

    let sourceBytes: Buffer;
    let transactions: ReturnType<typeof parseBankStatementCsv>;
    let modelKey: string | null = null;
    if (isPdf) {
      stage = "extract-pdf";
      sourceBytes = Buffer.from(pdfBase64, "base64");
      if (sourceBytes.length === 0 || sourceBytes.length > 2_500_000 || sourceBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("The selected PDF is invalid or exceeds the 2.5 MB limit.");
      }
      const extracted = await bankStatementExtractionTool.execute({ base64: pdfBase64, fileName });
      modelKey = extracted.modelKey;
      transactions = extracted.transactions.map((item, index) => ({
        rowNumber: index + 1,
        transactionDate: new Date(item.transactionDate + "T00:00:00.000Z"),
        direction: item.direction,
        amount: item.amount,
        currency: item.currency,
        counterparty: item.counterparty,
        reference: item.reference,
        memo: item.memo,
      }));
    } else {
      stage = "parse-csv";
      sourceBytes = Buffer.from(csvText, "utf8");
      transactions = parseBankStatementCsv(csvText);
    }
    console.info("[accounting:reconciliation] Bank statement rows prepared", {
      organizationId: workspace.id,
      clientId: client.id,
      agentRunId: run.id,
      transactionCount: transactions.length,
      stage,
    });
    if (transactions.length === 0) throw new Error("The statement has no transaction rows.");
    if (transactions.length > 5000) throw new Error("A statement can contain up to 5,000 transactions per import.");
    const contentHash = createHash("sha256").update(sourceBytes).digest("hex");
    const [existingImport] = await database
      .select({ id: bankStatementImports.id })
      .from(bankStatementImports)
      .where(and(
        eq(bankStatementImports.organizationId, workspace.id),
        eq(bankStatementImports.clientId, client.id),
        eq(bankStatementImports.contentHash, contentHash),
      ))
      .limit(1);
    if (existingImport) {
      await database.update(agentRuns).set({ status: "failed", errorCode: "DUPLICATE_STATEMENT", errorSummary: "This statement has already been imported for the selected client.", completedAt: new Date() }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
      return NextResponse.json({ error: "This statement has already been imported for the selected client." }, { status: 409 });
    }

    stage = "persist-transactions";
    const statement = await database.transaction(async (transaction) => {
      const [createdImport] = await transaction
        .insert(bankStatementImports)
        .values({
          organizationId: workspace.id,
          clientId: client.id,
          sourceFileName: fileName,
          contentHash,
          transactionCount: transactions.length,
          importedByUserId: userId,
        })
        .returning({ id: bankStatementImports.id });
      if (!createdImport) throw new Error("Could not create the statement import record.");
      await transaction.insert(bankTransactions).values(transactions.map((item) => ({
        organizationId: workspace.id,
        clientId: client.id,
        statementImportId: createdImport.id,
        rowNumber: item.rowNumber,
        transactionDate: item.transactionDate,
        direction: item.direction,
        amount: item.amount,
        currency: item.currency,
        counterparty: item.counterparty,
        reference: item.reference,
        memo: item.memo,
      })));
      await transaction.update(agentRuns).set({
        sourceId: createdImport.id,
        modelKey,
        status: "completed",
        result: { sourceFileName: fileName, transactionCount: transactions.length, fileType: isPdf ? "pdf" : "csv" },
        completedAt: new Date(),
      }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.organizationId, workspace.id)));
      return createdImport;
    });
    console.info("[accounting:reconciliation] Bank statement imported", {
      organizationId: workspace.id,
      clientId: client.id,
      statementImportId: statement.id,
      agentRunId: run.id,
      transactionCount: transactions.length,
    });
    return NextResponse.json({ statementImportId: statement.id, transactionCount: transactions.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import the statement.";
    if (agentRunId) {
      try {
        await getDatabase().update(agentRuns).set({
          status: "failed",
          errorCode: "BANK_STATEMENT_IMPORT_FAILED",
          errorSummary: message.slice(0, 1000),
          completedAt: new Date(),
        }).where(and(eq(agentRuns.id, agentRunId), eq(agentRuns.organizationId, workspace.id)));
      } catch (runUpdateError) {
        console.error("[accounting:reconciliation] Could not mark failed bank statement run", {
          organizationId: workspace.id,
          clientId,
          agentRunId,
          error: runUpdateError instanceof Error ? runUpdateError.message : "Unknown database error",
        });
      }
    }
    console.error("[accounting:reconciliation] Bank statement import failed", {
      organizationId: workspace.id,
      clientId,
      agentRunId,
      stage,
      error: message,
    });
    const status = message.includes("provider") || message.includes("OPENAI")
      ? 502
      : error instanceof Error && "status" in error && typeof error.status === "number" ? error.status
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
