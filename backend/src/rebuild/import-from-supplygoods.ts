import type { RebuildAssetUploader } from "./assets.ts";
import type { RebuildFieldMetadata } from "./fields.ts";
import {
  syncSupplyGoodsFromCallback,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "./supplygoods.ts";

export interface ImportFromSupplyGoodsResult {
  listed: number;
  missing: number;
  synced: number;
  failed: number;
  failures: Array<{
    supplyGoodsId: string;
    message: string;
  }>;
}

export interface ImportFromSupplyGoodsInput {
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
  assetUploader?: RebuildAssetUploader | null;
  listFields?: () => Promise<RebuildFieldMetadata[]>;
  pageNo?: number;
  pageSize?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importFromSupplyGoods(input: ImportFromSupplyGoodsInput): Promise<ImportFromSupplyGoodsResult> {
  if (!input.rebuildClient.listSupplyGoodsIds) {
    throw new Error("RebuildSupplyGoodsClient 缺少 listSupplyGoodsIds，无法从 SupplyGoods 导入");
  }
  if (!input.repository.findMissingSupplyGoodsIds) {
    throw new Error("SupplyGoodsRecordRepository 缺少 findMissingSupplyGoodsIds，无法从 SupplyGoods 导入");
  }
  const pageNo = input.pageNo ?? 1;
  const pageSize = input.pageSize ?? 200;
  const listedIds = await input.rebuildClient.listSupplyGoodsIds({ pageNo, pageSize });
  const missingIds = await input.repository.findMissingSupplyGoodsIds(listedIds);
  const failures: ImportFromSupplyGoodsResult["failures"] = [];
  let synced = 0;

  for (const supplyGoodsId of missingIds) {
    try {
      await syncSupplyGoodsFromCallback({
        supplyGoodsId,
        rawPayload: {},
        rebuildClient: input.rebuildClient,
        repository: input.repository,
        assetUploader: input.assetUploader,
        listFields: input.listFields,
      });
      synced += 1;
    } catch (error) {
      failures.push({
        supplyGoodsId,
        message: errorMessage(error),
      });
      console.warn(`[REBUILD] 从 SupplyGoods 导入失败: ${supplyGoodsId} ${errorMessage(error)}`);
    }
  }

  return {
    listed: listedIds.length,
    missing: missingIds.length,
    synced,
    failed: failures.length,
    failures,
  };
}
