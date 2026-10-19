import { index, jsonb, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import type { JsonObject } from "./agent-learning";
import { organizations, users } from "./tenants";

export const accountingClients = pgTable("accounting_clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalName: varchar("legal_name", { length: 300 }).notNull(),
  billingAddress: jsonb("billing_address").$type<JsonObject>().notNull().default({}),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationNameIndex: index("accounting_clients_organization_name_idx").on(table.organizationId, table.legalName),
  organizationIdUnique: unique("accounting_clients_organization_id_id_unique").on(table.organizationId, table.id),
}));
