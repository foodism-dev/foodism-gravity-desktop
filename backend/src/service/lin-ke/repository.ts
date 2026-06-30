import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../../db/client.ts";
import { linKeAccountConfigs, rebuildFieldOptions, rebuildSupplyGoods, tickets } from "../../db/schema.ts";
import { cleanString, parseIntValue, type JsonRecord } from "./utils.ts";

export interface LinKeAccountConfig {
  id: number;
  name: string;
  bdCityTexts: string[];
  cookieFilePath: string;
  groupId: string;
  rootLifeAccountId: string;
  accountId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinKeAccountConfigInput {
  name: string;
  bdCityTexts: string[];
  cookieFilePath: string;
  groupId?: string;
  rootLifeAccountId?: string;
  accountId?: string;
  active?: boolean;
}

export interface LinKeAccountConfigPatch {
  name?: string;
  bdCityTexts?: string[];
  cookieFilePath?: string;
  groupId?: string;
  rootLifeAccountId?: string;
  accountId?: string;
  active?: boolean;
}

export interface LinKeRepository {
  fetchSupplyGoodsPayloads: (supplyGoodsIds: string[]) => Promise<Map<string, JsonRecord>>;
  fetchRebuildFieldOptionLabels: (entityName: string, fieldValues: Record<string, string>) => Promise<Record<string, string>>;
  listAccountConfigs: () => Promise<LinKeAccountConfig[]>;
  getAccountConfig: (configId: number) => Promise<LinKeAccountConfig | null>;
  findAccountConfigByCity: (bdCityText: string) => Promise<LinKeAccountConfig | null>;
  createAccountConfig: (input: LinKeAccountConfigInput) => Promise<LinKeAccountConfig>;
  updateAccountConfig: (configId: number, input: LinKeAccountConfigPatch) => Promise<LinKeAccountConfig | null>;
  deleteAccountConfig: (configId: number) => Promise<boolean>;
  updateSupplyGoodsLinKeMapping: (supplyGoodsId: string, mapping: JsonRecord) => Promise<boolean>;
}

function mapAccountConfig(row: typeof linKeAccountConfigs.$inferSelect): LinKeAccountConfig {
  return {
    id: row.id,
    name: row.name,
    bdCityTexts: row.bdCityTexts,
    cookieFilePath: row.cookieFilePath,
    groupId: row.groupId,
    rootLifeAccountId: row.rootLifeAccountId,
    accountId: row.accountId,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeAccountConfig(row: LinKeAccountConfig): JsonRecord {
  return {
    id: row.id,
    name: row.name,
    bdCityTexts: row.bdCityTexts,
    cookieFilePath: row.cookieFilePath,
    groupId: row.groupId,
    rootLifeAccountId: row.rootLifeAccountId,
    accountId: row.accountId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDrizzleLinKeRepository(db: ServerDatabase): LinKeRepository {
  return {
    async fetchSupplyGoodsPayloads(supplyGoodsIds: string[]): Promise<Map<string, JsonRecord>> {
      if (supplyGoodsIds.length === 0) return new Map();
      const rows = await db
        .select({
          supplyGoodsId: tickets.supplyGoodsId,
          payload: tickets.payload,
        })
        .from(tickets)
        .where(inArray(tickets.supplyGoodsId, supplyGoodsIds));
      return new Map(rows.map((row) => [row.supplyGoodsId, row.payload]));
    },

    async fetchRebuildFieldOptionLabels(entityName: string, fieldValues: Record<string, string>): Promise<Record<string, string>> {
      const values = Object.fromEntries(
        Object.entries(fieldValues)
          .map(([field, value]) => [field, cleanString(value)] as const)
          .filter(([, value]) => Boolean(value)),
      );
      const fieldNames = Object.keys(values);
      const optionValues = Object.values(values);
      if (fieldNames.length === 0 || optionValues.length === 0) return {};

      const rows = await db
        .select({
          fieldName: rebuildFieldOptions.fieldName,
          optionValue: rebuildFieldOptions.optionValue,
          optionLabel: rebuildFieldOptions.optionLabel,
        })
        .from(rebuildFieldOptions)
        .where(and(
          eq(rebuildFieldOptions.entityName, entityName),
          inArray(rebuildFieldOptions.fieldName, fieldNames),
          inArray(rebuildFieldOptions.optionValue, optionValues),
        ));

      return Object.fromEntries(
        rows
          .filter((row) => values[row.fieldName] === row.optionValue)
          .map((row) => [row.fieldName, row.optionLabel]),
      );
    },

    async listAccountConfigs(): Promise<LinKeAccountConfig[]> {
      const rows = await db
        .select()
        .from(linKeAccountConfigs)
        .orderBy(asc(linKeAccountConfigs.name), asc(linKeAccountConfigs.id));
      return rows.map(mapAccountConfig);
    },

    async getAccountConfig(configId: number): Promise<LinKeAccountConfig | null> {
      const rows = await db
        .select()
        .from(linKeAccountConfigs)
        .where(eq(linKeAccountConfigs.id, configId))
        .limit(1);
      return rows[0] ? mapAccountConfig(rows[0]) : null;
    },

    async findAccountConfigByCity(bdCityText: string): Promise<LinKeAccountConfig | null> {
      const rows = await db
        .select()
        .from(linKeAccountConfigs)
        .where(sql`${linKeAccountConfigs.bdCityTexts} @> ${JSON.stringify([bdCityText])}::jsonb AND ${linKeAccountConfigs.active} = true`)
        .orderBy(asc(linKeAccountConfigs.id))
        .limit(1);
      return rows[0] ? mapAccountConfig(rows[0]) : null;
    },

    async createAccountConfig(input: LinKeAccountConfigInput): Promise<LinKeAccountConfig> {
      const [row] = await db
        .insert(linKeAccountConfigs)
        .values({
          name: input.name,
          bdCityTexts: input.bdCityTexts,
          cookieFilePath: input.cookieFilePath,
          groupId: input.groupId ?? "",
          rootLifeAccountId: input.rootLifeAccountId ?? "",
          accountId: input.accountId ?? "",
          active: input.active ?? true,
        })
        .returning();
      if (!row) throw new Error("创建林客账号配置失败");
      return mapAccountConfig(row);
    },

    async updateAccountConfig(configId: number, input: LinKeAccountConfigPatch): Promise<LinKeAccountConfig | null> {
      const updates: Partial<typeof linKeAccountConfigs.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.bdCityTexts !== undefined) updates.bdCityTexts = input.bdCityTexts;
      if (input.cookieFilePath !== undefined) updates.cookieFilePath = input.cookieFilePath;
      if (input.groupId !== undefined) updates.groupId = input.groupId;
      if (input.rootLifeAccountId !== undefined) updates.rootLifeAccountId = input.rootLifeAccountId;
      if (input.accountId !== undefined) updates.accountId = input.accountId;
      if (input.active !== undefined) updates.active = input.active;
      if (Object.keys(updates).length === 0) return this.getAccountConfig(configId);

      const [row] = await db
        .update(linKeAccountConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(linKeAccountConfigs.id, configId))
        .returning();
      return row ? mapAccountConfig(row) : null;
    },

    async deleteAccountConfig(configId: number): Promise<boolean> {
      const rows = await db
        .delete(linKeAccountConfigs)
        .where(eq(linKeAccountConfigs.id, configId))
        .returning({ id: linKeAccountConfigs.id });
      return rows.length > 0;
    },

    async updateSupplyGoodsLinKeMapping(supplyGoodsId: string, mapping: JsonRecord): Promise<boolean> {
      if (!supplyGoodsId) return false;
      const [currentRow] = await db
        .select({ payload: rebuildSupplyGoods.payload })
        .from(rebuildSupplyGoods)
        .where(eq(rebuildSupplyGoods.supplyGoodsId, supplyGoodsId))
        .limit(1);
      if (!currentRow) return false;

      const nextPayload = {
        ...currentRow.payload,
        linKeMapping: {
          productType: parseIntValue(mapping.productType),
          categoryId: cleanString(mapping.categoryId),
          thirdCategoryId: cleanString(mapping.thirdCategoryId),
          categoryName: cleanString(mapping.categoryName),
          categoryPath: cleanString(mapping.categoryPath),
        },
      };
      const rows = await db
        .update(rebuildSupplyGoods)
        .set({
          payload: nextPayload,
          updatedAt: new Date(),
        })
        .where(eq(rebuildSupplyGoods.supplyGoodsId, supplyGoodsId))
        .returning({ supplyGoodsId: rebuildSupplyGoods.supplyGoodsId });
      return rows.length > 0;
    },
  };
}

let defaultRepository: LinKeRepository | null | undefined;

export function getDefaultLinKeRepository(): LinKeRepository | null {
  if (defaultRepository !== undefined) return defaultRepository;
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，Lin-Ke 接口不可用");
    defaultRepository = null;
    return defaultRepository;
  }
  defaultRepository = createDrizzleLinKeRepository(createDatabase(databaseUrl));
  return defaultRepository;
}
