import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;

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

export const rebuildSupplyGoods = pgTable(
  "rebuild_supply_goods",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    supplyGoodsId: text("supply_goods_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("rebuild_supply_goods_supply_goods_id_unique").on(table.supplyGoodsId)]
);

export const rebuildSupplyCompany = pgTable(
  "rebuild_supply_company",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    supplyCompanyId: text("supply_company_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("rebuild_supply_company_supply_company_id_unique").on(table.supplyCompanyId)]
);

export const rebuildSupplyGoodsCallbackRecords = pgTable(
  "rebuild_supply_goods_callback_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    supplyGoodsId: text("supply_goods_id").notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("rebuild_supply_goods_callback_records_goods_created_idx").on(table.supplyGoodsId, table.createdAt),
    index("rebuild_supply_goods_callback_records_status_idx").on(table.status),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    supplyGoodsId: text("supply_goods_id")
      .notNull()
      .references(() => rebuildSupplyGoods.supplyGoodsId, { onDelete: "cascade", onUpdate: "cascade" }),
    status: text("status").notNull().default("todo"),
    businessStatus: text("business_status").notNull().default("access_review_pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("tickets_supply_goods_id_unique").on(table.supplyGoodsId)]
);

export const ticketActionRecords = pgTable(
  "ticket_action_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: bigint("ticket_id", { mode: "number" })
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade", onUpdate: "cascade" }),
    action: text("action").notNull(),
    origin: jsonb("origin").$type<Record<string, unknown>>().notNull(),
    current: jsonb("current").$type<Record<string, unknown>>().notNull(),
    operator: jsonb("operator").$type<Record<string, unknown>>().notNull().default({}),
    remark: text("remark"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ticket_action_records_ticket_created_idx").on(table.ticketId, table.createdAt),
  ]
);

export const rebuildFields = pgTable(
  "rebuild_fields",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityName: text("entity_name").notNull(),
    fieldName: text("field_name").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("rebuild_fields_entity_field_unique").on(table.entityName, table.fieldName)]
);

export const rebuildFieldOptions = pgTable(
  "rebuild_field_options",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityName: text("entity_name").notNull(),
    fieldName: text("field_name").notNull(),
    optionValue: text("option_value").notNull(),
    optionLabel: text("option_label").notNull(),
    sortOrder: integer("sort_order"),
    isDefault: boolean("is_default").default(false).notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("rebuild_field_options_entity_field_value_unique").on(
      table.entityName,
      table.fieldName,
      table.optionValue,
    ),
  ]
);

export const linKeAccountConfigs = pgTable(
  "lin_ke_account_configs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    bdCityTexts: jsonb("bd_city_texts").$type<string[]>().notNull(),
    cookie: text("cookie").notNull(),
    groupId: text("group_id").default("").notNull(),
    rootLifeAccountId: text("root_life_account_id").default("").notNull(),
    accountId: text("account_id").default("").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export type RebuildSupplyGoodsRow = typeof rebuildSupplyGoods.$inferSelect;
export type RebuildSupplyCompanyRow = typeof rebuildSupplyCompany.$inferSelect;
export type RebuildSupplyGoodsCallbackRecordRow = typeof rebuildSupplyGoodsCallbackRecords.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type TicketActionRecordRow = typeof ticketActionRecords.$inferSelect;
export type RebuildFieldRow = typeof rebuildFields.$inferSelect;
export type RebuildFieldOptionRow = typeof rebuildFieldOptions.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type SkillTagRow = typeof skillTags.$inferSelect;
export type LinKeAccountConfigRow = typeof linKeAccountConfigs.$inferSelect;
