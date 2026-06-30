import { describe, expect, test } from "bun:test";

import type { LinKeSettings } from "./config.ts";
import { cookieConfigToHeader } from "./auth.ts";
import type { LinKeAccountConfig, LinKeRepository } from "./repository.ts";
import {
  LinKeServiceError,
  buildWorkbenchDraftUrl,
  saveSupplyGoodsDraft,
} from "./service.ts";
import type { JsonRecord } from "./utils.ts";

function settings(): LinKeSettings {
  return {
    databaseUrl: null,
    openaiApiKey: "",
    openaiBaseUrl: "",
    optimizeModel: "gpt-4o-mini",
    optimizeConcurrency: 5,
    optimizeMaxBatchSize: 20,
    optimizeRetries: 3,
    lifePartnerBaseUrl: "https://www.life-partner.cn",
    lifePartnerTimeout: 1,
    rbImageBaseUrl: "",
  };
}

function payload(): JsonRecord {
  return {
    SupplyGoodsId: "944-test",
    bdCity: { text: "合肥市" },
    mealType: { text: "普通E" },
    classification: { text: "同城优享.烧烤.中式烧烤" },
    goodsName: "测试商品",
    price: "1.00",
    originPrice: "2.00",
    mainPic: ["https://example.com/a.jpg"],
    packages: { viewList: [] },
  };
}

function accountConfig(): LinKeAccountConfig {
  return {
    id: 1,
    name: "合肥",
    bdCityTexts: ["合肥市"],
    cookie: "/tmp/missing-life-partner.cookie.json",
    groupId: "",
    rootLifeAccountId: "",
    accountId: "",
    active: true,
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
  };
}

function repository(labels: Record<string, string> = {}): LinKeRepository & { updatedMappings: JsonRecord[] } {
  const updatedMappings: JsonRecord[] = [];
  return {
    updatedMappings,
    async fetchSupplyGoodsPayloads() {
      return new Map();
    },
    async fetchRebuildFieldOptionLabels() {
      return labels;
    },
    async listAccountConfigs() {
      return [];
    },
    async getAccountConfig() {
      return null;
    },
    async findAccountConfigByCity() {
      return null;
    },
    async createAccountConfig() {
      throw new Error("not used");
    },
    async updateAccountConfig() {
      return null;
    },
    async deleteAccountConfig() {
      return false;
    },
    async updateSupplyGoodsLinKeMapping(supplyGoodsId: string, mapping: JsonRecord) {
      updatedMappings.push({ supplyGoodsId, mapping });
      return true;
    },
  };
}

describe("Lin-Ke service", () => {
  test("Given raw cookie content, When normalizing, Then cookie header is returned", () => {
    expect(cookieConfigToHeader("sessionid=test; uid=1")).toBe("sessionid=test; uid=1");
  });

  test("Given JSON cookie content, When normalizing, Then cookie header is returned", () => {
    expect(cookieConfigToHeader(JSON.stringify([{ name: "sessionid", value: "test" }]))).toBe("sessionid=test");
  });

  test("Given option ids, When saving draft, Then labels are mapped before Lin-Ke mapping and record mapping is updated", async () => {
    const testPayload = payload();
    testPayload.mealType = { text: "012-0184a87067a64664", value: "012-0184a87067a64664" };
    testPayload.classification = { text: "019-017d6b4bb3cd5e39", value: "019-017d6b4bb3cd5e39" };
    const repo = repository({
      mealType: "主套餐A",
      classification: "同城优享 / 中式餐饮",
    });

    try {
      await saveSupplyGoodsDraft({
        settings: settings(),
        repository: repo,
        payload: testPayload,
        accountConfig: accountConfig(),
        supplyGoodsId: "944-test",
      });
      throw new Error("expected cookie error");
    } catch (error) {
      expect(error).toBeInstanceOf(LinKeServiceError);
      expect((error as LinKeServiceError).payload.reason).toBe("empty_cookie");
    }

    expect(repo.updatedMappings).toHaveLength(1);
    const updatedMapping = repo.updatedMappings[0]!;
    expect(updatedMapping.supplyGoodsId).toBe("944-test");
    expect((updatedMapping.mapping as JsonRecord).productType).toBe(1);
    expect((updatedMapping.mapping as JsonRecord).categoryId).toBe("1001015");
    expect((updatedMapping.mapping as JsonRecord).categoryPath).toBe("美食 > 地方菜 > 其他地方菜");
    expect((testPayload.mealType as JsonRecord).text).toBe("012-0184a87067a64664");
    expect((testPayload.classification as JsonRecord).text).toBe("019-017d6b4bb3cd5e39");
  });

  test("Given draft metadata, When building workbench URL, Then expected query fields are included", () => {
    const url = buildWorkbenchDraftUrl(
      { group_id: "1868051999515656" },
      {
        productType: 11,
        thirdCategoryId: "1003002",
        merchant: { merchantId: "7651539009109526564", skuOrderId: "7654505757261776948" },
      },
      "1868864068281379",
    );
    expect(url).toContain("product_draft_cache_id=1868864068281379");
    expect(url).toContain("merchantId=7651539009109526564");
    expect(url).toContain("sku_order_id=7654505757261776948");
    expect(url).toContain("product_type=11");
    expect(url).toContain("third_category_id=1003002");
  });
});
