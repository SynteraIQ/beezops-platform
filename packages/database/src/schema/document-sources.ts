import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations, users } from "./tenants";
import { providerConnections } from "./connections";

export const documentSources = pgTable("document_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerConnectionId: uuid("provider_connection_id").notNull().references(() => providerConnections.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 80 }).notNull(),
  externalSourceId: varchar("external_source_id", { length: 512 }).notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  path: varchar("path", { length: 2000 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceUnique: uniqueIndex("document_sources_org_connection_external_unique").on(
    table.organizationId,
    table.providerConnectionId,
    table.externalSourceId,
  ),
  organizationStatusIndex: index("document_sources_org_status_idx").on(table.organizationId, table.status),
}));

export const documentSourceItems = pgTable("document_source_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentSourceId: uuid("document_source_id").notNull().references(() => documentSources.id, { onDelete: "cascade" }),
  externalItemId: varchar("external_item_id", { length: 512 }).notNull(),
  externalVersion: varchar("external_version", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("discovered"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  itemUnique: uniqueIndex("document_source_items_source_external_unique").on(table.documentSourceId, table.externalItemId),
  organizationSourceIndex: index("document_source_items_org_source_idx").on(table.organizationId, table.documentSourceId),
}));
