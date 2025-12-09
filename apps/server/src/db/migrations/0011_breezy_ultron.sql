-- Note: session_id has no FK constraint because sessions is a TimescaleDB hypertable
-- (hypertables don't support foreign key references to their primary key)
CREATE TABLE "termination_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"server_user_id" uuid NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"triggered_by_user_id" uuid,
	"rule_id" uuid,
	"violation_id" uuid,
	"reason" text,
	"success" boolean NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "termination_logs" ADD CONSTRAINT "termination_logs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_logs" ADD CONSTRAINT "termination_logs_server_user_id_server_users_id_fk" FOREIGN KEY ("server_user_id") REFERENCES "public"."server_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_logs" ADD CONSTRAINT "termination_logs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_logs" ADD CONSTRAINT "termination_logs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_logs" ADD CONSTRAINT "termination_logs_violation_id_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "termination_logs_session_idx" ON "termination_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "termination_logs_server_user_idx" ON "termination_logs" USING btree ("server_user_id");--> statement-breakpoint
CREATE INDEX "termination_logs_triggered_by_idx" ON "termination_logs" USING btree ("triggered_by_user_id");--> statement-breakpoint
CREATE INDEX "termination_logs_rule_idx" ON "termination_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "termination_logs_created_at_idx" ON "termination_logs" USING btree ("created_at");