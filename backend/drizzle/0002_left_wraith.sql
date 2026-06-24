CREATE TABLE "skill_tag_links" (
	"skill_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "skill_tag_links_skill_id_tag_id_pk" PRIMARY KEY("skill_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "skill_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "skill_tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"description" text,
	"icon" text,
	"status" text DEFAULT 'published' NOT NULL,
	"package_url" text NOT NULL,
	"package_sha256" text NOT NULL,
	"package_size_bytes" bigint NOT NULL,
	"unpacked_size_bytes" bigint,
	"file_count" integer,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "skill_tag_links" ADD CONSTRAINT "skill_tag_links_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_tag_links" ADD CONSTRAINT "skill_tag_links_tag_id_skill_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."skill_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_tag_links_tag_idx" ON "skill_tag_links" USING btree ("tag_id","skill_id");--> statement-breakpoint
CREATE INDEX "skills_list_idx" ON "skills" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "skills_download_idx" ON "skills" USING btree ("status","download_count");