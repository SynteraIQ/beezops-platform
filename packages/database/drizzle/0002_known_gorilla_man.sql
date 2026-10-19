CREATE TABLE "invoice_extraction_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"trigger_source" varchar(32) NOT NULL,
	"source_version" varchar(255) NOT NULL,
	"status" varchar(40) DEFAULT 'queued' NOT NULL,
	"workflow_run_id" varchar(255),
	"model_key" varchar(160),
	"prompt_version" varchar(120) NOT NULL,
	"schema_version" varchar(120) NOT NULL,
	"extracted_data" jsonb,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_summary" varchar(1000),
	"triggered_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_extraction_attempts_status_check" CHECK (status in ('queued', 'processing', 'ready_for_matching', 'needs_review', 'failed')),
	CONSTRAINT "invoice_extraction_attempts_trigger_source_check" CHECK (trigger_source in ('manual', 'drive_discovery'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"source_provider" varchar(80) DEFAULT 'google-drive' NOT NULL,
	"source_file_id" varchar(255) NOT NULL,
	"source_file_name" varchar(500) NOT NULL,
	"source_mime_type" varchar(160) NOT NULL,
	"source_version" varchar(255) NOT NULL,
	"source_modified_at" timestamp with time zone,
	"status" varchar(40) DEFAULT 'queued' NOT NULL,
	"extracted_data" jsonb,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_workflow_run_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_status_check" CHECK (status in ('queued', 'processing', 'ready_for_matching', 'needs_review', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "invoice_extraction_attempts" ADD CONSTRAINT "invoice_extraction_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_extraction_attempts" ADD CONSTRAINT "invoice_extraction_attempts_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_extraction_attempts" ADD CONSTRAINT "invoice_extraction_attempts_invoice_same_organization_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_extraction_attempts_idempotency_unique" ON "invoice_extraction_attempts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_extraction_attempts_invoice_created_idx" ON "invoice_extraction_attempts" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_extraction_attempts_organization_status_idx" ON "invoice_extraction_attempts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_source_file_unique" ON "invoices" USING btree ("organization_id","provider_connection_id","source_file_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_status_idx" ON "invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invoices_organization_created_idx" ON "invoices" USING btree ("organization_id","created_at");