import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations, users } from "./tenants";

export type ProviderAccountMetadata = Record<string, string | number | boolean | null>;

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 80 }).notNull(),
  integrationKey: varchar("integration_key", { length: 160 }).notNull(),
  externalConnectionId: varchar("external_connection_id", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 200 }),
  accountMetadata: jsonb("account_metadata").$type<ProviderAccountMetadata>().notNull().default({}),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
}, (table) => ({
  externalConnectionUnique: uniqueIndex("provider_connections_external_unique").on(
    table.organizationId,
    table.provider,
    table.integrationKey,
    table.externalConnectionId,
  ),
  organizationStatusIndex: index("provider_connections_organization_status_idx").on(
    table.organizationId,
    table.status,
  ),
}));
