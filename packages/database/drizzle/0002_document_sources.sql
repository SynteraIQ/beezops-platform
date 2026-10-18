CREATE TABLE "document_source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_source_id" uuid NOT NULL,
	"external_item_id" varchar(512) NOT NULL,
	"external_version" varchar(255),
	"status" varchar(32) DEFAULT 'discovered' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"provider" varchar(80) NOT NULL,
	"external_source_id" varchar(512) NOT NULL,
	"name" varchar(500) NOT NULL,
	"path" varchar(2000) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_source_items" ADD CONSTRAINT "document_source_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_source_items" ADD CONSTRAINT "document_source_items_document_source_id_document_sources_id_fk" FOREIGN KEY ("document_source_id") REFERENCES "public"."document_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_source_items_source_external_unique" ON "document_source_items" USING btree ("document_source_id","external_item_id");--> statement-breakpoint
CREATE INDEX "document_source_items_org_source_idx" ON "document_source_items" USING btree ("organization_id","document_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sources_org_connection_external_unique" ON "document_sources" USING btree ("organization_id","provider_connection_id","external_source_id");--> statement-breakpoint
CREATE INDEX "document_sources_org_status_idx" ON "document_sources" USING btree ("organization_id","status");