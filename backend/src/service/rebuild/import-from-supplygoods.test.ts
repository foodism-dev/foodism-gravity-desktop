import { describe, expect, test } from "bun:test";

import { importFromSupplyGoods } from "./import-from-supplygoods.ts";
import { processImportFromSupplyGoodsJob } from "./import-from-supplygoods-worker.ts";
import type {
  RebuildAssetUploader,
} from "./assets.ts";
import type {
  RebuildFieldMetadata,
} from "./fields.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsCallbackRecordInput,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "./supplygoods.ts";

function createRepository(existingIds: string[]): {
  repository: SupplyGoodsRecordRepository;
  saved: SupplyGoodsRecordUpsertInput[];
  callbackRecords: SupplyGoodsCallbackRecordInput[];
} {
  const existing = new Set(existingIds);
  const saved: SupplyGoodsRecordUpsertInput[] = [];
  const callbackRecords: SupplyGoodsCallbackRecordInput[] = [];
  return {
    saved,
    callbackRecords,
    repository: {
      async findMissingSupplyGoodsIds(supplyGoodsIds: string[]): Promise<string[]> {
        return supplyGoodsIds.filter((supplyGoodsId) => !existing.has(supplyGoodsId));
      },
      async upsertRecord(input: SupplyGoodsRecordUpsertInput): Promise<void> {
        existing.add(input.supplyGoodsId);
        saved.push(input);
      },
      async createCallbackRecord(input: SupplyGoodsCallbackRecordInput): Promise<void> {
        callbackRecords.push(input);
      },
    },
  };
}

describe("从 SupplyGoods 主动导入", () => {
  test("Given Rebuild list has existing and missing ids, When importing, Then it replays callback sync only for missing ids", async () => {
    const { repository, saved, callbackRecords } = createRepository(["944-existing"]);
    const listedPages: Array<{ pageNo: number; pageSize: number }> = [];
    const syncedIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async listSupplyGoodsIds(input): Promise<string[]> {
        listedPages.push(input);
        return ["944-existing", "944-missing-a", "944-missing-b"];
      },
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        syncedIds.push(supplyGoodsId);
        return {
          SupplyGoodsId: supplyGoodsId,
          approvalState: { value: 2, text: "审核中" },
          company: {
            id: "945-company",
            entity: "SupplyCompany",
            approvalState: { value: 10, text: "通过" },
          },
          rbhost: {
            id: "946-host",
            entity: "SupplyHost",
            approvalState: { value: 2, text: "审核中" },
          },
        };
      },
    };

    const result = await importFromSupplyGoods({
      rebuildClient,
      repository,
      listFields: async (): Promise<RebuildFieldMetadata[]> => [],
      assetUploader: null as RebuildAssetUploader | null,
      pageNo: 2,
      pageSize: 50,
    });

    expect(listedPages).toEqual([{ pageNo: 2, pageSize: 50 }]);
    expect(syncedIds).toEqual(["944-missing-a", "944-missing-b"]);
    expect(result).toEqual({
      listed: 3,
      missing: 2,
      synced: 2,
      failed: 0,
      failures: [],
    });
    expect(saved.map((record) => record.supplyGoodsId)).toEqual(["944-missing-a", "944-missing-b"]);
    expect(callbackRecords.map((record) => record.rawPayload)).toEqual([{}, {}]);
    expect(callbackRecords.every((record) => record.status === "success")).toBe(true);
  });

  test("Given import job omits page size, When processing, Then it queries 200 records by default", async () => {
    const { repository } = createRepository([]);
    const listedPages: Array<{ pageNo: number; pageSize: number }> = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async listSupplyGoodsIds(input): Promise<string[]> {
        listedPages.push(input);
        return [];
      },
      async getSupplyGoods(): Promise<Record<string, unknown>> {
        throw new Error("不应该补不存在的商品");
      },
    };

    const result = await processImportFromSupplyGoodsJob({
      jobData: {},
      rebuildClient,
      repository,
      fieldMetadataRepository: null,
      assetUploader: null,
    });

    expect(listedPages).toEqual([{ pageNo: 1, pageSize: 200 }]);
    expect(result).toEqual({
      listed: 0,
      missing: 0,
      synced: 0,
      failed: 0,
      failures: [],
    });
  });
});
