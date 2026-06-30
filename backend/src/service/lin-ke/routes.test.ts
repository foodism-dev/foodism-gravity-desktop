import { describe, expect, test } from "bun:test";

import { createServerApp } from "../../app.ts";
import type { LinKeSettings } from "./config.ts";
import type {
  LinKeAccountConfig,
  LinKeAccountConfigInput,
  LinKeAccountConfigPatch,
  LinKeRepository,
} from "./repository.ts";
import type { JsonRecord } from "./utils.ts";

process.env.DATABASE_URL = "";
process.env.PROMA_SERVER_JWT_SECRET = "";

function settings(): LinKeSettings {
  return {
    databaseUrl: null,
    openaiApiKey: "",
    openaiBaseUrl: "",
    optimizeModel: "gpt-4o-mini",
    optimizeConcurrency: 2,
    optimizeMaxBatchSize: 20,
    optimizeRetries: 3,
    lifePartnerBaseUrl: "https://www.life-partner.cn",
    lifePartnerTimeout: 60,
    rbImageBaseUrl: "",
  };
}

function accountConfig(input: Partial<LinKeAccountConfig> = {}): LinKeAccountConfig {
  return {
    id: input.id ?? 1,
    name: input.name ?? "合肥",
    bdCityTexts: input.bdCityTexts ?? ["合肥市"],
    cookie: input.cookie ?? "sessionid=test",
    groupId: input.groupId ?? "",
    rootLifeAccountId: input.rootLifeAccountId ?? "",
    accountId: input.accountId ?? "",
    active: input.active ?? true,
    createdAt: input.createdAt ?? new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: input.updatedAt ?? new Date("2026-06-25T00:00:00.000Z"),
  };
}

function createMemoryLinKeRepository(input: {
  payloads?: Record<string, JsonRecord>;
  accountConfigs?: LinKeAccountConfig[];
} = {}): LinKeRepository & { updatedMappings: Array<{ supplyGoodsId: string; mapping: JsonRecord }> } {
  const payloads = new Map(Object.entries(input.payloads ?? {}));
  const accountConfigs = [...(input.accountConfigs ?? [])];
  const updatedMappings: Array<{ supplyGoodsId: string; mapping: JsonRecord }> = [];
  return {
    updatedMappings,
    async fetchSupplyGoodsPayloads(supplyGoodsIds: string[]) {
      return new Map(supplyGoodsIds.flatMap((id) => {
        const payload = payloads.get(id);
        return payload ? [[id, payload] as const] : [];
      }));
    },
    async fetchRebuildFieldOptionLabels() {
      return {};
    },
    async listAccountConfigs() {
      return [...accountConfigs].sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
    },
    async getAccountConfig(configId: number) {
      return accountConfigs.find((config) => config.id === configId) ?? null;
    },
    async findAccountConfigByCity(cityText: string) {
      return accountConfigs.find((config) => config.active && config.bdCityTexts.includes(cityText)) ?? null;
    },
    async createAccountConfig(configInput: LinKeAccountConfigInput) {
      const created = accountConfig({
        id: accountConfigs.length + 1,
        name: configInput.name,
        bdCityTexts: configInput.bdCityTexts,
        cookie: configInput.cookie,
        groupId: configInput.groupId ?? "",
        rootLifeAccountId: configInput.rootLifeAccountId ?? "",
        accountId: configInput.accountId ?? "",
        active: configInput.active ?? true,
      });
      accountConfigs.push(created);
      return created;
    },
    async updateAccountConfig(configId: number, patch: LinKeAccountConfigPatch) {
      const current = accountConfigs.find((config) => config.id === configId);
      if (!current) return null;
      Object.assign(current, patch, { updatedAt: new Date("2026-06-25T01:00:00.000Z") });
      return current;
    },
    async deleteAccountConfig(configId: number) {
      const index = accountConfigs.findIndex((config) => config.id === configId);
      if (index < 0) return false;
      accountConfigs.splice(index, 1);
      return true;
    },
    async updateSupplyGoodsLinKeMapping(supplyGoodsId: string, mapping: JsonRecord) {
      updatedMappings.push({ supplyGoodsId, mapping });
      return true;
    },
  };
}

describe("Lin-Ke Hono routes", () => {
  test("Given account config input, When creating config, Then cookie content is stored and returned", async () => {
    const repository = createMemoryLinKeRepository();
    const app = createServerApp({ linKeRoutesOptions: { settings: settings(), repository } });

    const response = await app.request("/api/lin-ke/account-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "上海账号",
        bdCityTexts: ["上海"],
        cookie: "sessionid=test",
      }),
    });
    const body = await response.json() as { cookie: string; cookieFilePath?: string };

    expect(response.status).toBe(201);
    expect(body.cookie).toBe("sessionid=test");
    expect(body.cookieFilePath).toBeUndefined();
  });

  test("Given payload exists, When optimize stream is requested, Then NDJSON item is returned", async () => {
    const repository = createMemoryLinKeRepository({
      payloads: { "goods-a": { packages: "{\"viewList\":[]}" } },
    });
    const app = createServerApp({
      linKeRoutesOptions: {
        settings: settings(),
        repository,
        async optimizePayload(_settings, payload) {
          return {
            payload: { ...payload, optimized: true },
            changes: [{ path: "packages.viewList[0].groupName" }],
            fallback: false,
            error: "",
          };
        },
      },
    });

    const response = await app.request("/api/supply-goods/optimize-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplyGoodsIds: ["goods-a"] }),
    });

    expect(response.status).toBe(200);
    const lines = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0].supplyGoodsId).toBe("goods-a");
    expect(lines[0].payload.optimized).toBe(true);
    expect(lines[0].fallback).toBe(false);
    expect(lines[0].recordId).toBeUndefined();
  });

  test("Given legacy recordIds, When optimize stream is requested, Then Hono bad request is returned", async () => {
    const app = createServerApp({ linKeRoutesOptions: { settings: settings(), repository: createMemoryLinKeRepository() } });
    const response = await app.request("/api/supply-goods/optimize-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordIds: ["record-a"] }),
    });
    const body = await response.json() as { error: string; message: string };
    expect(response.status).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(body.message).toContain("supplyGoodsIds");
  });

  test("Given payload missing, When optimize stream is requested, Then not found item is streamed", async () => {
    const app = createServerApp({ linKeRoutesOptions: { settings: settings(), repository: createMemoryLinKeRepository() } });
    const response = await app.request("/api/supply-goods/optimize-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplyGoodsIds: ["missing"] }),
    });
    const [item] = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect(item.supplyGoodsId).toBe("missing");
    expect(item.ok).toBe(false);
    expect(item.fallback).toBe(true);
    expect(item.error).toBe("supply_goods_not_found");
  });

  test("Given city account config, When creating draft, Then supplyGoodsId is passed to service", async () => {
    const repository = createMemoryLinKeRepository({
      accountConfigs: [accountConfig({ name: "深圳食义", bdCityTexts: ["深圳一区", "深圳二区"] })],
    });
    let receivedSupplyGoodsId = "";
    let receivedAccountName = "";
    const app = createServerApp({
      linKeRoutesOptions: {
        settings: settings(),
        repository,
        async saveSupplyGoodsDraft(input) {
          receivedSupplyGoodsId = input.supplyGoodsId;
          receivedAccountName = input.accountConfig.name;
          return { ok: true, cacheId: "cache-shenzhen" };
        },
      },
    });

    const response = await app.request("/api/lin-ke/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplyGoodsId: "goods-shenzhen",
        payload: { bdCity: { text: "深圳一区" }, packages: { viewList: [] } },
      }),
    });
    const body = await response.json() as { cacheId: string };
    expect(response.status).toBe(200);
    expect(body.cacheId).toBe("cache-shenzhen");
    expect(receivedSupplyGoodsId).toBe("goods-shenzhen");
    expect(receivedAccountName).toBe("深圳食义");
  });

  test("Given missing city or config, When creating draft, Then Hono bad request is returned", async () => {
    const app = createServerApp({ linKeRoutesOptions: { settings: settings(), repository: createMemoryLinKeRepository() } });
    const missingCity = await app.request("/api/lin-ke/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplyGoodsId: "goods-a", payload: { packages: { viewList: [] } } }),
    });
    expect(missingCity.status).toBe(400);
    expect(((await missingCity.json()) as { message: string }).message).toBe("payload.bdCity.text is required");

    const missingConfig = await app.request("/api/lin-ke/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplyGoodsId: "goods-a", payload: { bdCity: { text: "北京二区" } } }),
    });
    expect(missingConfig.status).toBe(400);
    expect(((await missingConfig.json()) as { message: string }).message).toBe("lin_ke_account_config_not_found_for_city:北京二区");
  });
});
