import { describe, expect, test } from "bun:test";

import { backfillSupplyGoodsAssets, type SupplyGoodsAssetBackfillRepository } from "./assets-backfill.ts";
import type { RebuildAssetUploader } from "./assets.ts";
import type { RebuildFieldMetadata } from "./fields.ts";

const mediaFields: RebuildFieldMetadata[] = [
  {
    entityName: "SupplyGoods",
    fieldName: "mainPic",
    label: "商品主图",
    fieldType: "IMAGE",
    raw: { name: "mainPic", displayType: "IMAGE" },
  },
];

describe("SupplyGoods 资产补偿处理", () => {
  test("Given records without assets, When backfilling, Then it mirrors media assets and updates only assets field", async () => {
    const updates: Array<{ supplyGoodsId: string; assets: Record<string, Array<{ source: string; url: string }>> }> = [];
    const repository: SupplyGoodsAssetBackfillRepository = {
      async listRecordsForBackfill(input) {
        expect(input).toEqual({ limit: 20, force: false, supplyGoodsIds: [] });
        return [
          {
            supplyGoodsId: "944-backfill",
            payload: {
              SupplyGoodsId: "944-backfill",
              goodsName: "历史商品",
              mainPic: ["rb/20260624/main.jpg"],
            },
            assets: {},
          },
        ];
      },

      async updateAssets(supplyGoodsId, assets) {
        updates.push({ supplyGoodsId, assets });
      },
    };
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.supplyGoodsId}/${input.fieldName}/main.jpg`,
        };
      },
    };

    const result = await backfillSupplyGoodsAssets({
      repository,
      uploader,
      fields: mediaFields,
      limit: 20,
    });

    expect(result).toEqual({
      scanned: 1,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(updates).toEqual([
      {
        supplyGoodsId: "944-backfill",
        assets: {
          mainPic: [
            {
              source: "rb/20260624/main.jpg",
              url: "https://cdn.example.com/944-backfill/mainPic/main.jpg",
            },
          ],
        },
      },
    ]);
  });

  test("Given force enabled, When backfilling, Then repository can refresh records that already have assets", async () => {
    const requests: Array<{ limit: number; force: boolean; supplyGoodsIds: string[] }> = [];
    const repository: SupplyGoodsAssetBackfillRepository = {
      async listRecordsForBackfill(input) {
        requests.push(input);
        return [
          {
            supplyGoodsId: "944-force",
            payload: {
              SupplyGoodsId: "944-force",
              mainPic: ["rb/20260624/main.jpg"],
            },
            assets: {
              mainPic: [
                {
                  source: "rb/20260624/main.jpg",
                  url: "https://old.example.com/upload_file/rebuild/main.jpg",
                },
              ],
            },
          },
        ];
      },

      async updateAssets() {},
    };
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.supplyGoodsId}/${input.fieldName}/main.jpg`,
        };
      },
    };

    const result = await backfillSupplyGoodsAssets({
      repository,
      uploader,
      fields: mediaFields,
      limit: 2,
      force: true,
    });

    expect(requests).toEqual([{ limit: 2, force: true, supplyGoodsIds: [] }]);
    expect(result).toEqual({
      scanned: 1,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
  });

  test("Given supply goods ids are provided, When backfilling, Then repository receives targeted ids", async () => {
    const requests: Array<{ limit: number; force: boolean; supplyGoodsIds: string[] }> = [];
    const repository: SupplyGoodsAssetBackfillRepository = {
      async listRecordsForBackfill(input) {
        requests.push(input);
        return [];
      },

      async updateAssets() {},
    };
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return { source: input.sourcePath, url: "https://cdn.example.com/unused" };
      },
    };

    const result = await backfillSupplyGoodsAssets({
      repository,
      uploader,
      fields: mediaFields,
      limit: 50,
      supplyGoodsIds: ["944-a", "944-b"],
    });

    expect(requests).toEqual([{ limit: 50, force: false, supplyGoodsIds: ["944-a", "944-b"] }]);
    expect(result).toEqual({
      scanned: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
