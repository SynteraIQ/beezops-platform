CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) NOT NULL,
	"agent_key" varchar(160) NOT NULL,
	"status" varchar(32) NOT NULL,
	"model_key" varchar(160),
	"prompt_version" varchar(120),
	"agent_version" varchar(120),
	"source_type" varchar(120),
	"source_id" varchar(255),
	"result" jsonb,
	"error_code" varchar(120),
	"error_summary" varchar(1000),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_organization_product_id_unique" UNIQUE("organization_id","product_key","id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_evidence" (
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"learning_event_id" uuid NOT NULL,
	"relation" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_evidence_pk" PRIMARY KEY("organization_id","knowledge_item_id","learning_event_id","relation")
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) NOT NULL,
	"knowledge_type" varchar(120) NOT NULL,
	"scope_type" varchar(120) NOT NULL,
	"scope_id" varchar(255),
	"title" varchar(240) NOT NULL,
	"summary" varchar(2000),
	"content" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_until" timestamp with time zone,
	"last_evidence_at" timestamp with time zone,
	"version" integer NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_items_organization_product_id_unique" UNIQUE("organization_id","product_key","id"),
	CONSTRAINT "knowledge_items_confidence_range_check" CHECK ("knowledge_items"."confidence" >= 0 and "knowledge_items"."confidence" <= 1),
	CONSTRAINT "knowledge_items_version_positive_check" CHECK ("knowledge_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) NOT NULL,
	"agent_run_id" uuid,
	"event_type" varchar(120) NOT NULL,
	"source_type" varchar(120),
	"source_id" varchar(255),
	"idempotency_key" varchar(255),
	"subject_type" varchar(120),
	"subject_id" varchar(255),
	"actor_user_id" uuid,
	"proposed_value" jsonb,
	"final_value" jsonb,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_events_organization_product_id_unique" UNIQUE("organization_id","product_key","id")
);
--> statement-breakpoint
CREATE TABLE "run_knowledge_items" (
	"organization_id" uuid NOT NULL,
	"product_key" varchar(120) NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"retrieval_reason" varchar(1000) NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_knowledge_items_pk" PRIMARY KEY("organization_id","agent_run_id","knowledge_item_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_evidence" ADD CONSTRAINT "knowledge_evidence_item_same_scope_fk" FOREIGN KEY ("organization_id","product_key","knowledge_item_id") REFERENCES "public"."knowledge_items"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_evidence" ADD CONSTRAINT "knowledge_evidence_event_same_scope_fk" FOREIGN KEY ("organization_id","product_key","learning_event_id") REFERENCES "public"."learning_events"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_supersedes_same_scope_fk" FOREIGN KEY ("organization_id","product_key","supersedes_id") REFERENCES "public"."knowledge_items"("organization_id","product_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_agent_run_same_scope_fk" FOREIGN KEY ("organization_id","product_key","agent_run_id") REFERENCES "public"."agent_runs"("organization_id","product_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_knowledge_items" ADD CONSTRAINT "run_knowledge_items_run_same_scope_fk" FOREIGN KEY ("organization_id","product_key","agent_run_id") REFERENCES "public"."agent_runs"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_knowledge_items" ADD CONSTRAINT "run_knowledge_items_item_same_scope_fk" FOREIGN KEY ("organization_id","product_key","knowledge_item_id") REFERENCES "public"."knowledge_items"("organization_id","product_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_organization_product_created_idx" ON "agent_runs" USING btree ("organization_id","product_key","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_organization_status_idx" ON "agent_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_organization_product_status_idx" ON "knowledge_items" USING btree ("organization_id","product_key","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_organization_product_scope_idx" ON "knowledge_items" USING btree ("organization_id","product_key","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "learning_events_organization_product_recorded_idx" ON "learning_events" USING btree ("organization_id","product_key","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_events_organization_idempotency_unique" ON "learning_events" USING btree ("organization_id","product_key","idempotency_key");