import type { RebuildAssetUploader } from "./assets.ts";
import type { RebuildFieldMetadataRepository } from "./fields.ts";
import { importFromSupplyGoods, type ImportFromSupplyGoodsResult } from "./import-from-supplygoods.ts";
import type { RebuildSupplyGoodsClient, SupplyGoodsRecordRepository } from "./supplygoods.ts";
import type { ImportFromSupplyGoodsJobData } from "../jobs/types.ts";

export interface ImportFromSupplyGoodsWorkerOptions {
  rebuildClient?: RebuildSupplyGoodsClient;
  repository?: SupplyGoodsRecordRepository | null;
  fieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
}

function readImportPages(): number {
  const value = Number.parseInt(
    Bun.env.IMPORT_FROM_SUPPLYGOODS_PAGES?.trim() ?? "",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export async function processImportFromSupplyGoodsJob(input: {
  jobData: ImportFromSupplyGoodsJobData;
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
  fieldMetadataRepository: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
}): Promise<ImportFromSupplyGoodsResult> {
  const pageNo = input.jobData.pageNo ?? 1;
  const pageSize = input.jobData.pageSize ?? 200;
  const pages = input.jobData.pages ?? readImportPages();
  const total: ImportFromSupplyGoodsResult = {
    listed: 0,
    missing: 0,
    synced: 0,
    failed: 0,
    failures: [],
  };

  for (let offset = 0; offset < pages; offset += 1) {
    const result = await importFromSupplyGoods({
      rebuildClient: input.rebuildClient,
      repository: input.repository,
      assetUploader: input.assetUploader,
      listFields: input.fieldMetadataRepository
        ? () => input.fieldMetadataRepository!.listFieldsByEntity("SupplyGoods")
        : undefined,
      pageNo: pageNo + offset,
      pageSize,
    });
    total.listed += result.listed;
    total.missing += result.missing;
    total.synced += result.synced;
    total.failed += result.failed;
    total.failures.push(...result.failures);
  }

  return total;
}
