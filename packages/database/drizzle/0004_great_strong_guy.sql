CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"source_file_name" varchar(500) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"imported_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_imports_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_statement_imports_organization_client_content_hash_unique" UNIQUE("organization_id","client_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"statement_import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"direction" varchar(16) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"counterparty" varchar(300),
	"reference" varchar(500),
	"memo" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_statement_row_unique" UNIQUE("organization_id","statement_import_id","row_number"),
	CONSTRAINT "bank_transactions_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_transactions_amount_positive_check" CHECK ("bank_transactions"."amount" > 0),
	CONSTRAINT "bank_transactions_direction_check" CHECK (direction in ('debit', 'credit'))
);
--> statement-breakpoint
CREATE TABLE "client_gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(240) NOT NULL,
	"account_type" varchar(80),
	"description" varchar(1000),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_gl_accounts_organization_client_code_unique" UNIQUE("organization_id","client_id","code"),
	CONSTRAINT "client_gl_accounts_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_coding_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) DEFAULT 'accounting' NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"line_index" integer NOT NULL,
	"recommended_gl_account_id" uuid,
	"approved_gl_account_id" uuid,
	"rationale" varchar(2000) NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"model_key" varchar(160),
	"prompt_version" varchar(120) NOT NULL,
	"status" varchar(32) DEFAULT 'suggested' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_line_coding_suggestions_line_index_check" CHECK ("invoice_line_coding_suggestions"."line_index" >= 0),
	CONSTRAINT "invoice_line_coding_suggestions_confidence_check" CHECK ("invoice_line_coding_suggestions"."confidence" is null or ("invoice_line_coding_suggestions"."confidence" >= 0 and "invoice_line_coding_suggestions"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "invoice_payment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) DEFAULT 'accounting' NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_source_version" varchar(255) NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"matched_amount" numeric(20, 4) NOT NULL,
	"status" varchar(32) DEFAULT 'suggested' NOT NULL,
	"rationale" varchar(2000) NOT NULL,
	"confidence" numeric(4, 3),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payment_matches_amount_positive_check" CHECK ("invoice_payment_matches"."matched_amount" > 0),
	CONSTRAINT "invoice_payment_matches_status_check" CHECK (status in ('suggested', 'confirmed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_client_same_organization_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_same_organization_fk" FOREIGN KEY ("organization_id","statement_import_id") REFERENCES "public"."bank_statement_imports"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_client_same_organization_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_gl_accounts" ADD CONSTRAINT "client_gl_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_gl_accounts" ADD CONSTRAINT "client_gl_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_gl_accounts" ADD CONSTRAINT "client_gl_accounts_client_same_organization_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_invoice_same_organization_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_run_same_scope_fk" FOREIGN KEY ("organization_id","product_key","agent_run_id") REFERENCES "public"."agent_runs"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_client_same_organization_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_recommended_account_same_organi" FOREIGN KEY ("organization_id","recommended_gl_account_id") REFERENCES "public"."client_gl_accounts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_approved_account_same_organizat" FOREIGN KEY ("organization_id","approved_gl_account_id") REFERENCES "public"."client_gl_accounts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_matches" ADD CONSTRAINT "invoice_payment_matches_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_matches" ADD CONSTRAINT "invoice_payment_matches_invoice_same_organization_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_matches" ADD CONSTRAINT "invoice_payment_matches_run_same_scope_fk" FOREIGN KEY ("organization_id","product_key","agent_run_id") REFERENCES "public"."agent_runs"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_matches" ADD CONSTRAINT "invoice_payment_matches_client_same_organization_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."accounting_clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_matches" ADD CONSTRAINT "invoice_payment_matches_transaction_same_organization_fk" FOREIGN KEY ("organization_id","bank_transaction_id") REFERENCES "public"."bank_transactions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_imports_client_created_idx" ON "bank_statement_imports" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_transactions_client_date_idx" ON "bank_transactions" USING btree ("client_id","transaction_date");--> statement-breakpoint
CREATE INDEX "client_gl_accounts_client_status_idx" ON "client_gl_accounts" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "invoice_line_coding_suggestions_invoice_idx" ON "invoice_line_coding_suggestions" USING btree ("invoice_id","line_index","created_at");--> statement-breakpoint
CREATE INDEX "invoice_payment_matches_invoice_idx" ON "invoice_payment_matches" USING btree ("invoice_id","status");--> statement-breakpoint
CREATE INDEX "invoice_payment_matches_transaction_idx" ON "invoice_payment_matches" USING btree ("bank_transaction_id","status");
