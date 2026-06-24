import { bigserial, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

export const rebuildSupplyGoodsRecords = pgTable(
  "rebuild_supply_goods_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    recordId: text("record_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("rebuild_supply_goods_records_record_id_unique").on(table.recordId)]
);

export type RebuildSupplyGoodsRecordRow = typeof rebuildSupplyGoodsRecords.$inferSelect;
