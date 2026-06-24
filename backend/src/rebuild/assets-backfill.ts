import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { createDatabaseClient, getDatabaseUrl, type ServerDatabase } from "../db/client.ts";
import { rebuildSupplyGoods } from "../db/schema.ts";
import {
  getDefaultRebuildAssetUploader,
  mirrorSupplyGoodsAssets,
  type RebuildAssetMap,
  type RebuildAssetUploader,
} from "./assets.ts";
import { createDrizzleRebuildFieldMetadataRepository, type RebuildFieldMetadata } from "./fields.ts";

export interface SupplyGoodsAssetBackfillRecord {
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  assets: RebuildAssetMap;
}

export interface SupplyGoodsAssetBackfillRepository {
  listRecordsForBackfill: (input: {
    limit: number;
    force: boolean;
    supplyGoodsIds: string[];
  }) => Promise<SupplyGoodsAssetBackfillRecord[]>;
  updateAssets: (supplyGoodsId: string, assets: RebuildAssetMap) => Promise<void>;
}

export interface SupplyGoodsAssetBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface SupplyGoodsAssetBackfillInput {
  repository: SupplyGoodsAssetBackfillRepository;
  uploader: RebuildAssetUploader;
  fields: RebuildFieldMetadata[];
  limit: number;
  force?: boolean;
  supplyGoodsIds?: string[];
}

function hasAssets(assets: RebuildAssetMap): boolean {
  return Object.values(assets).some((items) => items.length > 0);
}

export async function backfillSupplyGoodsAssets(
  input: SupplyGoodsAssetBackfillInput,
): Promise<SupplyGoodsAssetBackfillResult> {
  const records = await input.repository.listRecordsForBackfill({
    limit: input.limit,
    force: input.force ?? false,
    supplyGoodsIds: input.supplyGoodsIds ?? [],
  });
  const result: SupplyGoodsAssetBackfillResult = {
    scanned: records.length,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const record of records) {
    try {
      const assets = await mirrorSupplyGoodsAssets({
        supplyGoodsId: record.supplyGoodsId,
        payload: record.payload,
        fields: input.fields,
        uploader: input.uploader,
      });
      if (!hasAssets(assets)) {
        result.skipped += 1;
        continue;
      }
      await input.repository.updateAssets(record.supplyGoodsId, assets);
      result.updated += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[REBUILD] SupplyGoods 资产补偿失败: ${record.supplyGoodsId} ${message}`);
    }
  }

  return result;
}

export function createDrizzleSupplyGoodsAssetBackfillRepository(
  db: ServerDatabase,
): SupplyGoodsAssetBackfillRepository {
  return {
    async listRecordsForBackfill(input): Promise<SupplyGoodsAssetBackfillRecord[]> {
      const selection = {
        supplyGoodsId: rebuildSupplyGoods.supplyGoodsId,
        payload: rebuildSupplyGoods.payload,
        assets: rebuildSupplyGoods.assets,
      };

      const rows = input.supplyGoodsIds.length > 0
        ? await db
            .select(selection)
            .from(rebuildSupplyGoods)
            .where(inArray(rebuildSupplyGoods.supplyGoodsId, input.supplyGoodsIds))
            .orderBy(asc(rebuildSupplyGoods.updatedAt))
            .limit(input.limit)
        : input.force
          ? await db
              .select(selection)
              .from(rebuildSupplyGoods)
              .orderBy(asc(rebuildSupplyGoods.updatedAt))
              .limit(input.limit)
          : await db
            .select(selection)
            .from(rebuildSupplyGoods)
            .where(or(
              sql`${rebuildSupplyGoods.assets} = '{}'::jsonb`,
              sql`${rebuildSupplyGoods.assets} IS NULL`,
            ))
            .orderBy(asc(rebuildSupplyGoods.updatedAt))
            .limit(input.limit);

      return rows.map((row) => ({
        supplyGoodsId: row.supplyGoodsId,
        payload: row.payload,
        assets: row.assets,
      }));
    },

    async updateAssets(supplyGoodsId: string, assets: RebuildAssetMap): Promise<void> {
      await db
        .update(rebuildSupplyGoods)
        .set({
          assets,
          updatedAt: new Date(),
        })
        .where(eq(rebuildSupplyGoods.supplyGoodsId, supplyGoodsId));
    },
  };
}

export async function runDefaultSupplyGoodsAssetsBackfill(input: {
  limit: number;
  force?: boolean;
  supplyGoodsIds?: string[];
}): Promise<SupplyGoodsAssetBackfillResult> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL，无法执行 SupplyGoods 资产补偿");
  }

  const uploader = getDefaultRebuildAssetUploader();
  if (!uploader) {
    throw new Error("资产镜像配置不完整，无法执行 SupplyGoods 资产补偿");
  }

  const database = createDatabaseClient(databaseUrl);
  try {
    const fieldRepository = createDrizzleRebuildFieldMetadataRepository(database.db);
    const fields = await fieldRepository.listFieldsByEntity("SupplyGoods");
    return await backfillSupplyGoodsAssets({
      repository: createDrizzleSupplyGoodsAssetBackfillRepository(database.db),
      uploader,
      fields,
      limit: input.limit,
      force: input.force ?? false,
      supplyGoodsIds: input.supplyGoodsIds ?? [],
    });
  } finally {
    await database.close();
  }
}
