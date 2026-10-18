import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { JsonObject, JsonValue } from "./agent-learning";
import { organizations, users } from "./tenants";
import { providerConnections } from "./connections";

export type InvoiceTriggerSource = "manual" | "drive_discovery";
export type InvoiceProcessingStatus =
  | "queued"
  | "processing"
  | "ready_for_matching"
  | "needs_review"
  | "failed";

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerConnectionId: uuid("provider_connection_id").notNull().references(() => providerConnections.id, { onDelete: "restrict" }),
  sourceProvider: varchar("source_provider", { length: 80 }).notNull().default("google-drive"),
  sourceFileId: varchar("source_file_id", { length: 255 }).notNull(),
  sourceFileName: varchar("source_file_name", { length: 500 }).notNull(),
  sourceMimeType: varchar("source_mime_type", { length: 160 }).notNull(),
  sourceVersion: varchar("source_version", { length: 255 }).notNull(),
  sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
  status: varchar("status", { length: 40 }).$type<InvoiceProcessingStatus>().notNull().default("queued"),
  extractedData: jsonb("extracted_data").$type<JsonObject>(),
  validationIssues: jsonb("validation_issues").$type<JsonValue[]>().notNull().default([]),
  latestWorkflowRunId: varchar("latest_workflow_run_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceFileUnique: uniqueIndex("invoices_source_file_unique").on(
    table.organizationId,
    table.providerConnectionId,
    table.sourceFileId,
  ),
  organizationStatusIndex: index("invoices_organization_status_idx").on(table.organizationId, table.status),
  organizationCreatedIndex: index("invoices_organization_created_idx").on(table.organizationId, table.createdAt),
  organizationIdUnique: unique("invoices_organization_id_id_unique").on(table.organizationId, table.id),
  validStatusCheck: check(
    "invoices_status_check",
    sql.raw("status in ('queued', 'processing', 'ready_for_matching', 'needs_review', 'failed')"),
  ),
}));

export const invoiceExtractionAttempts = pgTable("invoice_extraction_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  triggerSource: varchar("trigger_source", { length: 32 }).$type<InvoiceTriggerSource>().notNull(),
  sourceVersion: varchar("source_version", { length: 255 }).notNull(),
  status: varchar("status", { length: 40 }).$type<InvoiceProcessingStatus>().notNull().default("queued"),
  workflowRunId: varchar("workflow_run_id", { length: 255 }),
  modelKey: varchar("model_key", { length: 160 }),
  promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
  schemaVersion: varchar("schema_version", { length: 120 }).notNull(),
  extractedData: jsonb("extracted_data").$type<JsonObject>(),
  validationIssues: jsonb("validation_issues").$type<JsonValue[]>().notNull().default([]),
  errorSummary: varchar("error_summary", { length: 1000 }),
  triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex("invoice_extraction_attempts_idempotency_unique").on(
    table.organizationId,
    table.idempotencyKey,
  ),
  invoiceCreatedIndex: index("invoice_extraction_attempts_invoice_created_idx").on(table.invoiceId, table.createdAt),
  organizationStatusIndex: index("invoice_extraction_attempts_organization_status_idx").on(
    table.organizationId,
    table.status,
  ),
  invoiceSameOrganizationForeignKey: foreignKey({
    name: "invoice_extraction_attempts_invoice_same_organization_fk",
    columns: [table.organizationId, table.invoiceId],
    foreignColumns: [invoices.organizationId, invoices.id],
  }).onDelete("cascade"),
  validStatusCheck: check(
    "invoice_extraction_attempts_status_check",
    sql.raw("status in ('queued', 'processing', 'ready_for_matching', 'needs_review', 'failed')"),
  ),
  validTriggerCheck: check(
    "invoice_extraction_attempts_trigger_source_check",
    sql.raw("trigger_source in ('manual', 'drive_discovery')"),
  ),
}));
