CREATE INDEX "skill_tag_links_tag_idx" ON "skill_tag_links" USING btree ("tag_id","skill_id");--> statement-breakpoint
CREATE INDEX "skills_list_idx" ON "skills" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "skills_download_idx" ON "skills" USING btree ("status","download_count");