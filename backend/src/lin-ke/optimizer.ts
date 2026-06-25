import type { LinKeSettings } from "./config.ts";
import { applyMenuOptimization, extractMenuForOptimization } from "./supply-goods.ts";
import { cleanString, conciseError, entityText, isRecord, type JsonRecord } from "./utils.ts";

export const SYSTEM_PROMPT = `你是餐饮团购套餐命名审核与优化助手。你的任务是判断套餐组名和菜品名称/条目描述是否需要优化，而不是强制改写。
只允许优化 packages.viewList[].groupName 和 packages.viewList[].list[].title，让名称更清晰、自然、贴合餐厅风格、商品主题、品类和原始套餐语境，适合上品展示。
原文已经清晰、自然、符合门店调性时必须保持原文，不要为了显得更高级或更营销而机械改写。
可以优化表达不清、过长、口语过重、符号噪音、语病、歧义、堆砌营销或不适合商品展示的名称。
禁止虚构食材、规格、权益、口味、城市特色、门店信息；禁止使用与门店无关的空泛广告词替换。
禁止改价格、数量、ID、套餐结构、选择规则。禁止新增或删除菜品。
输出严格 JSON：{"groups":[{"index":0,"groupName":"...","items":[{"index":0,"title":"..."}]}]}。`;

export interface OptimizePayloadResult {
  payload: JsonRecord;
  changes: JsonRecord[];
  fallback: boolean;
  error: string;
}

export function buildUserPrompt(payload: JsonRecord, menu: JsonRecord[]): string {
  return JSON.stringify({
    goodsName: payload.goodsName,
    hostName: payload.hostName || payload.hostNameInput,
    classification: entityText(payload.classification || payload["classification.text"]),
    mealType: entityText(payload.mealType || payload["mealType.text"]),
    bdCity: entityText(payload.bdCity || payload["bdCity.text"]),
    groups: menu,
  });
}

async function callModel(settings: LinKeSettings, payload: JsonRecord, menu: JsonRecord[]): Promise<JsonRecord> {
  if (!settings.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const baseUrl = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.optimizeModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(payload, menu) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败 (${response.status}): ${text || response.statusText}`);
  }
  const data = JSON.parse(text) as unknown;
  if (!isRecord(data) || !Array.isArray(data.choices) || !isRecord(data.choices[0])) {
    throw new Error("model returned invalid response");
  }
  const message = data.choices[0].message;
  const content = isRecord(message) ? cleanString(message.content) : "";
  const parsed = JSON.parse(content || "{}") as unknown;
  if (!isRecord(parsed)) throw new Error("model returned non-object JSON");
  return parsed;
}

async function optimizePayload(settings: LinKeSettings, payload: JsonRecord): Promise<{ payload: JsonRecord; changes: JsonRecord[] }> {
  const menu = extractMenuForOptimization(payload);
  if (menu.length === 0) {
    return { payload, changes: [] };
  }
  const optimized = await callModel(settings, payload, menu);
  return applyMenuOptimization(payload, optimized);
}

export async function optimizePayloadWithRetries(settings: LinKeSettings, payload: JsonRecord): Promise<OptimizePayloadResult> {
  let lastError = "";
  for (let attempt = 0; attempt < Math.max(settings.optimizeRetries, 1); attempt += 1) {
    try {
      const result = await optimizePayload(settings, payload);
      return { payload: result.payload, changes: result.changes, fallback: false, error: "" };
    } catch (error) {
      lastError = conciseError(error);
    }
  }
  return { payload, changes: [], fallback: true, error: lastError };
}
