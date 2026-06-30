import { Hono } from "hono";
import type { Context } from "hono";
import { getLinKeSettings, type LinKeSettings } from "./config.ts";
import { optimizePayloadWithRetries, type OptimizePayloadResult } from "./optimizer.ts";
import {
  getDefaultLinKeRepository,
  serializeAccountConfig,
  type LinKeAccountConfigInput,
  type LinKeAccountConfigPatch,
  type LinKeRepository,
} from "./repository.ts";
import { checkCookie, LinKeServiceError, saveSupplyGoodsDraft } from "./service.ts";
import { bdCityText } from "./supply-goods.ts";
import { cleanString, conciseError, isRecord, type JsonRecord } from "./utils.ts";

export interface LinKeRoutesOptions {
  settings?: LinKeSettings;
  repository?: LinKeRepository | null;
  optimizePayload?: (settings: LinKeSettings, payload: JsonRecord) => Promise<OptimizePayloadResult>;
  checkCookie?: typeof checkCookie;
  saveSupplyGoodsDraft?: typeof saveSupplyGoodsDraft;
}

function errorBody(error: string, message: string, details?: JsonRecord) {
  return details ? { error, message, details } : { error, message };
}

function errorName(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 404) return "Not Found";
  if (status === 502) return "Bad Gateway";
  if (status === 503) return "Service Unavailable";
  return "Internal Server Error";
}

async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new Error("请求体必须是 JSON");
  }
}

function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
}

function parseAccountConfigInput(body: unknown, patch = false): LinKeAccountConfigInput | LinKeAccountConfigPatch {
  if (!isRecord(body)) throw new Error("请求体必须是 JSON 对象");
  const input: LinKeAccountConfigPatch = {};
  if (body.name !== undefined) input.name = cleanString(body.name);
  if (body.bdCityTexts !== undefined) {
    if (!Array.isArray(body.bdCityTexts)) throw new Error("bdCityTexts 必须是数组");
    input.bdCityTexts = body.bdCityTexts.map(cleanString).filter(Boolean);
  }
  if (body.cookie !== undefined) input.cookie = cleanString(body.cookie);
  if (body.groupId !== undefined) input.groupId = cleanString(body.groupId);
  if (body.rootLifeAccountId !== undefined) input.rootLifeAccountId = cleanString(body.rootLifeAccountId);
  if (body.accountId !== undefined) input.accountId = cleanString(body.accountId);
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new Error("active 必须是布尔值");
    input.active = body.active;
  }
  if (!patch) {
    if (!input.name) throw new Error("name 不能为空");
    if (!input.bdCityTexts) throw new Error("bdCityTexts 不能为空");
    if (!input.cookie) throw new Error("cookie 不能为空");
  }
  return input;
}

function getRepository(repository: LinKeRepository | null) {
  if (!repository) {
    return null;
  }
  return repository;
}

export function createLinKeRoutes(options: LinKeRoutesOptions = {}) {
  const app = new Hono();
  const settings = options.settings ?? getLinKeSettings();
  const repository = options.repository !== undefined ? options.repository : getDefaultLinKeRepository();
  const optimize = options.optimizePayload ?? optimizePayloadWithRetries;
  const checkCookieFn = options.checkCookie ?? checkCookie;
  const saveDraftFn = options.saveSupplyGoodsDraft ?? saveSupplyGoodsDraft;

  app.post("/api/supply-goods/optimize-stream", async (context) => {
    const repo = getRepository(repository);
    if (!repo) {
      return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    }

    let body: unknown;
    try {
      body = await readJson(context);
    } catch (error) {
      return context.json(errorBody("Bad Request", conciseError(error)), 400);
    }
    if (!isRecord(body) || !Array.isArray(body.supplyGoodsIds)) {
      return context.json(errorBody("Bad Request", "supplyGoodsIds 不能为空"), 400);
    }
    const supplyGoodsIds = body.supplyGoodsIds.map(cleanString).filter(Boolean);
    if (supplyGoodsIds.length > settings.optimizeMaxBatchSize) {
      return context.json(
        errorBody("Bad Request", `supplyGoodsIds must contain at most ${settings.optimizeMaxBatchSize} items`),
        400,
      );
    }

    const payloads = await repo.fetchSupplyGoodsPayloads(supplyGoodsIds);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const concurrency = Math.max(settings.optimizeConcurrency, 1);
        let nextIndex = 0;
        let active = 0;
        let closed = false;

        const writeItem = (item: JsonRecord) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
        };

        const launch = () => {
          if (closed) return;
          while (active < concurrency && nextIndex < supplyGoodsIds.length) {
            const index = nextIndex;
            const supplyGoodsId = supplyGoodsIds[index]!;
            nextIndex += 1;
            active += 1;
            void (async () => {
              const payload = payloads.get(supplyGoodsId);
              if (!payload) {
                writeItem({
                  index,
                  supplyGoodsId,
                  ok: false,
                  fallback: true,
                  payload: null,
                  error: "supply_goods_not_found",
                  changes: [],
                });
                return;
              }
              const result = await optimize(settings, payload);
              writeItem({
                index,
                supplyGoodsId,
                ok: true,
                fallback: result.fallback,
                payload: result.payload,
                error: result.error || null,
                changes: result.changes,
              });
            })()
              .catch((error) => {
                writeItem({
                  index,
                  supplyGoodsId,
                  ok: true,
                  fallback: true,
                  payload: payloads.get(supplyGoodsId) ?? null,
                  error: conciseError(error),
                  changes: [],
                });
              })
              .finally(() => {
                active -= 1;
                if (nextIndex >= supplyGoodsIds.length && active === 0) {
                  closed = true;
                  controller.close();
                } else {
                  launch();
                }
              });
          }
          if (supplyGoodsIds.length === 0 && !closed) {
            closed = true;
            controller.close();
          }
        };

        launch();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  });

  app.get("/api/lin-ke/account-configs", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    return context.json((await repo.listAccountConfigs()).map(serializeAccountConfig));
  });

  app.post("/api/lin-ke/account-configs", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    try {
      const input = parseAccountConfigInput(await readJson(context), false) as LinKeAccountConfigInput;
      return context.json(serializeAccountConfig(await repo.createAccountConfig(input)), 201);
    } catch (error) {
      return context.json(errorBody("Bad Request", conciseError(error)), 400);
    }
  });

  app.patch("/api/lin-ke/account-configs/:configId", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    const configId = parseId(context.req.param("configId"));
    if (configId === null) return context.json(errorBody("Bad Request", "config_id 无效"), 400);
    try {
      const input = parseAccountConfigInput(await readJson(context), true) as LinKeAccountConfigPatch;
      const row = await repo.updateAccountConfig(configId, input);
      if (!row) return context.json(errorBody("Not Found", "account_config_not_found"), 404);
      return context.json(serializeAccountConfig(row));
    } catch (error) {
      return context.json(errorBody("Bad Request", conciseError(error)), 400);
    }
  });

  app.delete("/api/lin-ke/account-configs/:configId", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    const configId = parseId(context.req.param("configId"));
    if (configId === null) return context.json(errorBody("Bad Request", "config_id 无效"), 400);
    if (!(await repo.deleteAccountConfig(configId))) {
      return context.json(errorBody("Not Found", "account_config_not_found"), 404);
    }
    return context.json({ ok: true });
  });

  app.post("/api/lin-ke/account-configs/:configId/check-cookie", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    const configId = parseId(context.req.param("configId"));
    if (configId === null) return context.json(errorBody("Bad Request", "config_id 无效"), 400);
    const accountConfig = await repo.getAccountConfig(configId);
    if (!accountConfig) return context.json(errorBody("Not Found", "account_config_not_found"), 404);
    try {
      return context.json(await checkCookieFn(settings, accountConfig));
    } catch (error) {
      if (error instanceof LinKeServiceError) {
        return context.json(errorBody(errorName(error.statusCode), error.message, error.payload), error.statusCode as 400);
      }
      return context.json(errorBody("Bad Gateway", conciseError(error)), 502);
    }
  });

  app.post("/api/lin-ke/drafts", async (context) => {
    const repo = getRepository(repository);
    if (!repo) return context.json(errorBody("Service Unavailable", "DATABASE_URL 未配置"), 503);
    let body: unknown;
    try {
      body = await readJson(context);
    } catch (error) {
      return context.json(errorBody("Bad Request", conciseError(error)), 400);
    }
    if (!isRecord(body) || !isRecord(body.payload)) {
      return context.json(errorBody("Bad Request", "payload 不能为空"), 400);
    }
    const supplyGoodsId = cleanString(body.supplyGoodsId);
    if (!supplyGoodsId) {
      return context.json(errorBody("Bad Request", "supplyGoodsId 不能为空"), 400);
    }
    const cityText = bdCityText(body.payload);
    if (!cityText) {
      return context.json(errorBody("Bad Request", "payload.bdCity.text is required"), 400);
    }
    const accountConfig = await repo.findAccountConfigByCity(cityText);
    if (!accountConfig) {
      return context.json(errorBody("Bad Request", `lin_ke_account_config_not_found_for_city:${cityText}`), 400);
    }
    try {
      return context.json(await saveDraftFn({
        settings,
        repository: repo,
        payload: body.payload,
        accountConfig,
        supplyGoodsId,
        poiId: cleanString(body.poiId) || null,
      }));
    } catch (error) {
      if (error instanceof LinKeServiceError) {
        return context.json(
          errorBody(errorName(error.statusCode), error.message, error.payload),
          error.statusCode as 400,
        );
      }
      return context.json(errorBody("Bad Gateway", conciseError(error)), 502);
    }
  });

  return app;
}
