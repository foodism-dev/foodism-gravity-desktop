CREATE TABLE "lin_ke_account_configs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bd_city_texts" jsonb NOT NULL,
	"cookie_file_path" text NOT NULL,
	"group_id" text DEFAULT '' NOT NULL,
	"root_life_account_id" text DEFAULT '' NOT NULL,
	"account_id" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD COLUMN "lin_ke_product_type" integer;--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD COLUMN "lin_ke_category_id" text;--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD COLUMN "lin_ke_third_category_id" text;--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD COLUMN "lin_ke_category_name" text;--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD COLUMN "lin_ke_category_path" text;