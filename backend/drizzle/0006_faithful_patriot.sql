CREATE TABLE "rebuild_supply_company" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_company_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuild_supply_company_supply_company_id_unique" UNIQUE("supply_company_id")
);
--> statement-breakpoint
CREATE TABLE "rebuild_supply_goods_callback_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_goods_id" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_action_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"action" text NOT NULL,
	"origin" jsonb NOT NULL,
	"current" jsonb NOT NULL,
	"operator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "status" text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "business_status" text DEFAULT 'access_review_pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "tickets" AS "t"
SET "payload" = COALESCE("r"."payload", '{}'::jsonb)
FROM "rebuild_supply_goods" AS "r"
WHERE "r"."supply_goods_id" = "t"."supply_goods_id"
	AND "t"."payload" = '{}'::jsonb;--> statement-breakpoint
UPDATE "tickets"
SET "business_status" = CASE
	WHEN "approval_state" NOT IN ('10', '通过', '审核通过') THEN 'access_review_pending'
	ELSE 'info_optimization_pending'
END;--> statement-breakpoint
UPDATE "tickets"
SET "status" = CASE
	WHEN "business_status" = 'access_review_pending' THEN 'todo'
	WHEN "business_status" = 'online' THEN 'done'
	ELSE 'processing'
END;--> statement-breakpoint
ALTER TABLE "ticket_action_records" ADD CONSTRAINT "ticket_action_records_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "rebuild_supply_goods_callback_records_goods_created_idx" ON "rebuild_supply_goods_callback_records" USING btree ("supply_goods_id","created_at");--> statement-breakpoint
CREATE INDEX "rebuild_supply_goods_callback_records_status_idx" ON "rebuild_supply_goods_callback_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ticket_action_records_ticket_created_idx" ON "ticket_action_records" USING btree ("ticket_id","created_at");--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "assets";--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN "approval_state";
