CREATE TABLE "rebuild_supply_company_callback_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_company_id" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rebuild_supply_host" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_host_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuild_supply_host_supply_host_id_unique" UNIQUE("supply_host_id")
);
--> statement-breakpoint
CREATE TABLE "rebuild_supply_host_callback_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_host_id" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rebuild_supply_company_callback_records_company_created_idx" ON "rebuild_supply_company_callback_records" USING btree ("supply_company_id","created_at");--> statement-breakpoint
CREATE INDEX "rebuild_supply_company_callback_records_status_idx" ON "rebuild_supply_company_callback_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rebuild_supply_host_callback_records_host_created_idx" ON "rebuild_supply_host_callback_records" USING btree ("supply_host_id","created_at");--> statement-breakpoint
CREATE INDEX "rebuild_supply_host_callback_records_status_idx" ON "rebuild_supply_host_callback_records" USING btree ("status");--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "lin_ke_product_type";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "lin_ke_category_id";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "lin_ke_third_category_id";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "lin_ke_category_name";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "lin_ke_category_path";