import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./tenants";

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productKey: varchar("product_key", { length: 120 }).notNull(),
  agentKey: varchar("agent_key", { length: 160 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  modelKey: varchar("model_key", { length: 160 }),
  promptVersion: varchar("prompt_version", { length: 120 }),
  agentVersion: varchar("agent_version", { length: 120 }),
  sourceType: varchar("source_type", { length: 120 }),
  sourceId: varchar("source_id", { length: 255 }),
  result: jsonb("result").$type<JsonObject>(),
  errorCode: varchar("error_code", { length: 120 }),
  errorSummary: varchar("error_summary", { length: 1000 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationProductCreatedIndex: index("agent_runs_organization_product_created_idx").on(
    table.organizationId,
    table.productKey,
    table.createdAt,
  ),
  organizationStatusIndex: index("agent_runs_organization_status_idx").on(table.organizationId, table.status),
  organizationProductIdUnique: uniqueIndex("agent_runs_organization_product_id_unique").on(
    table.organizationId,
    table.productKey,
    table.id,
  ),
}));

export const learningEvents = pgTable("learning_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productKey: varchar("product_key", { length: 120 }).notNull(),
  agentRunId: uuid("agent_run_id"),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  sourceType: varchar("source_type", { length: 120 }),
  sourceId: varchar("source_id", { length: 255 }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  subjectType: varchar("subject_type", { length: 120 }),
  subjectId: varchar("subject_id", { length: 255 }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  proposedValue: jsonb("proposed_value").$type<JsonValue>(),
  finalValue: jsonb("final_value").$type<JsonValue>(),
  details: jsonb("details").$type<JsonObject>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationProductRecordedIndex: index("learning_events_organization_product_recorded_idx").on(
    table.organizationId,
    table.productKey,
    table.recordedAt,
  ),
  organizationIdempotencyUnique: uniqueIndex("learning_events_organization_idempotency_unique").on(
    table.organizationId,
    table.productKey,
    table.idempotencyKey,
  ),
  organizationProductIdUnique: uniqueIndex("learning_events_organization_product_id_unique").on(
    table.organizationId,
    table.productKey,
    table.id,
  ),
  agentRunSameScopeForeignKey: foreignKey({
    name: "learning_events_agent_run_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.agentRunId],
    foreignColumns: [agentRuns.organizationId, agentRuns.productKey, agentRuns.id],
  }),
}));

export const knowledgeItems = pgTable("knowledge_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productKey: varchar("product_key", { length: 120 }).notNull(),
  knowledgeType: varchar("knowledge_type", { length: 120 }).notNull(),
  scopeType: varchar("scope_type", { length: 120 }).notNull(),
  scopeId: varchar("scope_id", { length: 255 }),
  title: varchar("title", { length: 240 }).notNull(),
  summary: varchar("summary", { length: 2000 }),
  content: jsonb("content").$type<JsonObject>().notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }),
  version: integer("version").notNull(),
  supersedesId: uuid("supersedes_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationProductStatusIndex: index("knowledge_items_organization_product_status_idx").on(
    table.organizationId,
    table.productKey,
    table.status,
  ),
  organizationProductScopeIndex: index("knowledge_items_organization_product_scope_idx").on(
    table.organizationId,
    table.productKey,
    table.scopeType,
    table.scopeId,
  ),
  organizationProductIdUnique: uniqueIndex("knowledge_items_organization_product_id_unique").on(
    table.organizationId,
    table.productKey,
    table.id,
  ),
  confidenceRangeCheck: check(
    "knowledge_items_confidence_range_check",
    sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
  ),
  versionPositiveCheck: check("knowledge_items_version_positive_check", sql`${table.version} > 0`),
  supersedesSameScopeForeignKey: foreignKey({
    name: "knowledge_items_supersedes_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.supersedesId],
    foreignColumns: [table.organizationId, table.productKey, table.id],
  }),
}));

export const knowledgeEvidence = pgTable("knowledge_evidence", {
  organizationId: uuid("organization_id").notNull(),
  productKey: varchar("product_key", { length: 120 }).notNull(),
  knowledgeItemId: uuid("knowledge_item_id").notNull(),
  learningEventId: uuid("learning_event_id").notNull(),
  relation: varchar("relation", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  evidencePrimaryKey: primaryKey({ columns: [table.organizationId, table.knowledgeItemId, table.learningEventId, table.relation] }),
  knowledgeItemSameScopeForeignKey: foreignKey({
    name: "knowledge_evidence_item_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.knowledgeItemId],
    foreignColumns: [knowledgeItems.organizationId, knowledgeItems.productKey, knowledgeItems.id],
  }).onDelete("cascade"),
  learningEventSameScopeForeignKey: foreignKey({
    name: "knowledge_evidence_event_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.learningEventId],
    foreignColumns: [learningEvents.organizationId, learningEvents.productKey, learningEvents.id],
  }).onDelete("cascade"),
}));

export const runKnowledgeItems = pgTable("run_knowledge_items", {
  organizationId: uuid("organization_id").notNull(),
  productKey: varchar("product_key", { length: 120 }).notNull(),
  agentRunId: uuid("agent_run_id").notNull(),
  knowledgeItemId: uuid("knowledge_item_id").notNull(),
  retrievalReason: varchar("retrieval_reason", { length: 1000 }).notNull(),
  rank: integer("rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runKnowledgePrimaryKey: primaryKey({ columns: [table.organizationId, table.agentRunId, table.knowledgeItemId] }),
  agentRunSameScopeForeignKey: foreignKey({
    name: "run_knowledge_items_run_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.agentRunId],
    foreignColumns: [agentRuns.organizationId, agentRuns.productKey, agentRuns.id],
  }).onDelete("cascade"),
  knowledgeItemSameScopeForeignKey: foreignKey({
    name: "run_knowledge_items_item_same_scope_fk",
    columns: [table.organizationId, table.productKey, table.knowledgeItemId],
    foreignColumns: [knowledgeItems.organizationId, knowledgeItems.productKey, knowledgeItems.id],
  }).onDelete("cascade"),
}));
