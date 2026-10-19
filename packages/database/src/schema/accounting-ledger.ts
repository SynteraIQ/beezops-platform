import { sql } from "drizzle-orm";
import {
  check,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { JsonObject } from "./agent-learning";
import { agentRuns } from "./agent-learning";
import { accountingClients } from "./clients";
import { invoices } from "./invoices";
import { organizations, users } from "./tenants";

export const clientGlAccounts = pgTable("client_gl_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  accountType: varchar("account_type", { length: 80 }),
  description: varchar("description", { length: 1000 }),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientCodeUnique: unique("client_gl_accounts_organization_client_code_unique").on(
    table.organizationId,
    table.clientId,
    table.code,
  ),
  clientScopeUnique: unique("client_gl_accounts_organization_id_id_unique").on(table.organizationId, table.id),
  clientAccountScopeUnique: unique("client_gl_accounts_organization_client_id_unique").on(
    table.organizationId,
    table.clientId,
    table.id,
  ),
  clientIndex: index("client_gl_accounts_client_status_idx").on(table.clientId, table.status),
  clientSameOrganizationForeignKey: foreignKey({
    name: "client_gl_accounts_client_same_organization_fk",
    columns: [table.organizationId, table.clientId],
    foreignColumns: [accountingClients.organizationId, accountingClients.id],
  }).onDelete("cascade"),
}));

export const invoiceLineCodingSuggestions = pgTable("invoice_line_coding_suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  productKey: varchar("product_key", { length: 120 }).notNull().default("accounting"),
  agentRunId: uuid("agent_run_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  invoiceSourceVersion: varchar("invoice_source_version", { length: 255 }).notNull(),
  clientId: uuid("client_id").notNull(),
  lineIndex: integer("line_index").notNull(),
  recommendedGlAccountId: uuid("recommended_gl_account_id"),
  approvedGlAccountId: uuid("approved_gl_account_id"),
  rationale: varchar("rationale", { length: 2000 }).notNull(),
  evidence: jsonb("evidence").$type<JsonObject>().notNull().default({}),
  confidence: decimal("confidence", { precision: 4, scale: 3 }),
  modelKey: varchar("model_key", { length: 160 }),
  promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("suggested"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  invoiceIndex: index("invoice_line_coding_suggestions_invoice_idx").on(table.invoiceId, table.lineIndex, table.createdAt),
  invoiceSameOrganizationForeignKey: foreignKey({
    name: "invoice_line_coding_suggestions_invoice_same_organization_fk",
    columns: [table.organizationId, table.invoiceId],
    foreignColumns: [invoices.organizationId, invoices.id],
  }).onDelete("cascade"),
  agentRunSameScopeForeignKey: foreignKey({
    name: "invoice_line_coding_suggestions_run_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.agentRunId],
    foreignColumns: [agentRuns.organizationId, agentRuns.productKey, agentRuns.id],
  }).onDelete("cascade"),
  clientSameOrganizationForeignKey: foreignKey({
    name: "invoice_line_coding_suggestions_client_same_organization_fk",
    columns: [table.organizationId, table.clientId],
    foreignColumns: [accountingClients.organizationId, accountingClients.id],
  }).onDelete("cascade"),
  recommendedAccountSameOrganizationForeignKey: foreignKey({
    name: "invoice_line_coding_suggestions_recommended_account_same_client_fk",
    columns: [table.organizationId, table.clientId, table.recommendedGlAccountId],
    foreignColumns: [clientGlAccounts.organizationId, clientGlAccounts.clientId, clientGlAccounts.id],
  }).onDelete("restrict"),
  approvedAccountSameOrganizationForeignKey: foreignKey({
    name: "invoice_line_coding_suggestions_approved_account_same_client_fk",
    columns: [table.organizationId, table.clientId, table.approvedGlAccountId],
    foreignColumns: [clientGlAccounts.organizationId, clientGlAccounts.clientId, clientGlAccounts.id],
  }).onDelete("restrict"),
  validLineIndexCheck: check("invoice_line_coding_suggestions_line_index_check", sql`${table.lineIndex} >= 0`),
  confidenceRangeCheck: check("invoice_line_coding_suggestions_confidence_check", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`),
}));

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(),
  sourceFileName: varchar("source_file_name", { length: 500 }).notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  transactionCount: integer("transaction_count").notNull().default(0),
  importedByUserId: uuid("imported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientScopeUnique: unique("bank_statement_imports_organization_id_id_unique").on(table.organizationId, table.id),
  contentHashUnique: unique("bank_statement_imports_organization_client_content_hash_unique").on(table.organizationId, table.clientId, table.contentHash),
  clientIndex: index("bank_statement_imports_client_created_idx").on(table.clientId, table.createdAt),
  clientSameOrganizationForeignKey: foreignKey({
    name: "bank_statement_imports_client_same_organization_fk",
    columns: [table.organizationId, table.clientId],
    foreignColumns: [accountingClients.organizationId, accountingClients.id],
  }).onDelete("cascade"),
}));

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  clientId: uuid("client_id").notNull(),
  statementImportId: uuid("statement_import_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  counterparty: varchar("counterparty", { length: 300 }),
  reference: varchar("reference", { length: 500 }),
  memo: varchar("memo", { length: 2000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statementRowUnique: unique("bank_transactions_statement_row_unique").on(table.organizationId, table.statementImportId, table.rowNumber),
  transactionScopeUnique: unique("bank_transactions_organization_id_id_unique").on(table.organizationId, table.id),
  clientDateIndex: index("bank_transactions_client_date_idx").on(table.clientId, table.transactionDate),
  statementSameOrganizationForeignKey: foreignKey({
    name: "bank_transactions_statement_same_organization_fk",
    columns: [table.organizationId, table.statementImportId],
    foreignColumns: [bankStatementImports.organizationId, bankStatementImports.id],
  }).onDelete("cascade"),
  clientSameOrganizationForeignKey: foreignKey({
    name: "bank_transactions_client_same_organization_fk",
    columns: [table.organizationId, table.clientId],
    foreignColumns: [accountingClients.organizationId, accountingClients.id],
  }).onDelete("cascade"),
  positiveAmountCheck: check("bank_transactions_amount_positive_check", sql`${table.amount} > 0`),
  validDirectionCheck: check("bank_transactions_direction_check", sql.raw("direction in ('debit', 'credit')")),
}));

export const invoicePaymentMatches = pgTable("invoice_payment_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  productKey: varchar("product_key", { length: 120 }).notNull().default("accounting"),
  agentRunId: uuid("agent_run_id").notNull(),
  clientId: uuid("client_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  invoiceSourceVersion: varchar("invoice_source_version", { length: 255 }).notNull(),
  bankTransactionId: uuid("bank_transaction_id").notNull(),
  matchedAmount: decimal("matched_amount", { precision: 20, scale: 4 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("suggested"),
  rationale: varchar("rationale", { length: 2000 }).notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }),
  evidence: jsonb("evidence").$type<JsonObject>().notNull().default({}),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  invoiceIndex: index("invoice_payment_matches_invoice_idx").on(table.invoiceId, table.status),
  transactionIndex: index("invoice_payment_matches_transaction_idx").on(table.bankTransactionId, table.status),
  invoiceSameOrganizationForeignKey: foreignKey({
    name: "invoice_payment_matches_invoice_same_organization_fk",
    columns: [table.organizationId, table.invoiceId],
    foreignColumns: [invoices.organizationId, invoices.id],
  }).onDelete("cascade"),
  agentRunSameScopeForeignKey: foreignKey({
    name: "invoice_payment_matches_run_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.agentRunId],
    foreignColumns: [agentRuns.organizationId, agentRuns.productKey, agentRuns.id],
  }).onDelete("cascade"),
  clientSameOrganizationForeignKey: foreignKey({
    name: "invoice_payment_matches_client_same_organization_fk",
    columns: [table.organizationId, table.clientId],
    foreignColumns: [accountingClients.organizationId, accountingClients.id],
  }).onDelete("cascade"),
  transactionSameOrganizationForeignKey: foreignKey({
    name: "invoice_payment_matches_transaction_same_organization_fk",
    columns: [table.organizationId, table.bankTransactionId],
    foreignColumns: [bankTransactions.organizationId, bankTransactions.id],
  }).onDelete("cascade"),
  positiveMatchedAmountCheck: check("invoice_payment_matches_amount_positive_check", sql`${table.matchedAmount} > 0`),
  validStatusCheck: check("invoice_payment_matches_status_check", sql.raw("status in ('suggested', 'confirmed', 'rejected')")),
}));
