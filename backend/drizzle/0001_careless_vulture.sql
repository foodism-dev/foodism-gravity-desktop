CREATE TABLE "rebuild_supply_goods_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuild_supply_goods_records_record_id_unique" UNIQUE("record_id")
);
