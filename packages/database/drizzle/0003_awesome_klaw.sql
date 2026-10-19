CREATE TABLE "accounting_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" varchar(300) NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_clients_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "accounting_client_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_clients" ADD CONSTRAINT "accounting_clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_clients" ADD CONSTRAINT "accounting_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_clients_organization_name_idx" ON "accounting_clients" USING btree ("organization_id","legal_name");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accounting_client_same_organization_fk" FOREIGN KEY ("organization_id","accounting_client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE restrict ON UPDATE no action;