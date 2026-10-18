ALTER TABLE "invoice_line_coding_suggestions" DROP CONSTRAINT "invoice_line_coding_suggestions_recommended_account_same_organi";
--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" DROP CONSTRAINT "invoice_line_coding_suggestions_approved_account_same_organizat";
--> statement-breakpoint
ALTER TABLE "client_gl_accounts" ADD CONSTRAINT "client_gl_accounts_organization_client_id_unique" UNIQUE("organization_id","client_id","id");--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_recommended_account_same_client_fk" FOREIGN KEY ("organization_id","client_id","recommended_gl_account_id") REFERENCES "public"."client_gl_accounts"("organization_id","client_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_coding_suggestions" ADD CONSTRAINT "invoice_line_coding_suggestions_approved_account_same_client_fk" FOREIGN KEY ("organization_id","client_id","approved_gl_account_id") REFERENCES "public"."client_gl_accounts"("organization_id","client_id","id") ON DELETE restrict ON UPDATE no action;
