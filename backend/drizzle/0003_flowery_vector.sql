CREATE TABLE "rebuild_field_options" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_name" text NOT NULL,
	"field_name" text NOT NULL,
	"option_value" text NOT NULL,
	"option_label" text NOT NULL,
	"sort_order" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuild_field_options_entity_field_value_unique" UNIQUE("entity_name","field_name","option_value")
);
--> statement-breakpoint
CREATE TABLE "rebuild_fields" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_name" text NOT NULL,
	"field_name" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuild_fields_entity_field_unique" UNIQUE("entity_name","field_name")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supply_goods_id" text NOT NULL,
	"approval_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_supply_goods_id_unique" UNIQUE("supply_goods_id")
);
--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods_records" RENAME TO "rebuild_supply_goods";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" RENAME COLUMN "record_id" TO "supply_goods_id";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP CONSTRAINT "rebuild_supply_goods_records_record_id_unique";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" DROP COLUMN "synced_at";--> statement-breakpoint
ALTER TABLE "rebuild_supply_goods" ADD CONSTRAINT "rebuild_supply_goods_supply_goods_id_unique" UNIQUE("supply_goods_id");--> statement-breakpoint
INSERT INTO "tickets" ("supply_goods_id", "approval_state", "created_at", "updated_at")
SELECT
	"supply_goods_id",
	COALESCE(
		NULLIF("payload" #>> '{approvalState,text}', ''),
		NULLIF("payload" #>> '{approvalState,value}', ''),
		NULLIF("payload" ->> 'approvalState', ''),
		'unknown'
	),
	"created_at",
	"updated_at"
FROM "rebuild_supply_goods"
ON CONFLICT ("supply_goods_id") DO UPDATE SET
	"approval_state" = EXCLUDED."approval_state",
	"updated_at" = EXCLUDED."updated_at";--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_supply_goods_id_rebuild_supply_goods_supply_goods_id_fk" FOREIGN KEY ("supply_goods_id") REFERENCES "public"."rebuild_supply_goods"("supply_goods_id") ON DELETE cascade ON UPDATE cascade;
