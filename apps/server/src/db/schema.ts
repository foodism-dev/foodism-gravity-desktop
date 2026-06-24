import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary"),
    description: text("description"),
    icon: text("icon"),
    status: text("status").notNull().default("published"),
    packageUrl: text("package_url").notNull(),
    packageSha256: text("package_sha256").notNull(),
    packageSizeBytes: bigint("package_size_bytes", { mode: "number" }).notNull(),
    unpackedSizeBytes: bigint("unpacked_size_bytes", { mode: "number" }),
    fileCount: integer("file_count"),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull().default({}),
    downloadCount: integer("download_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("skills_list_idx").on(table.status, table.updatedAt),
    index("skills_download_idx").on(table.status, table.downloadCount),
  ],
);

export const skillTags = pgTable("skill_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const skillTagLinks = pgTable(
  "skill_tag_links",
  {
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => skillTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.tagId] }),
    index("skill_tag_links_tag_idx").on(table.tagId, table.skillId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type SkillTagRow = typeof skillTags.$inferSelect;
