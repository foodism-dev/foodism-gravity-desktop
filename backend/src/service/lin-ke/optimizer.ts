import type { LinKeSettings } from "./config.ts";
import { applyMenuOptimization, extractMenuForOptimization } from "./supply-goods.ts";
import { cleanString, conciseError, entityText, isRecord, type JsonRecord } from "./utils.ts";

export const SYSTEM_PROMPT = `你是餐饮团购套餐的平台招商命名与营销文案助手。你的任务不是简单纠错，而是把套餐组名和菜品名称优化成更适合抖音生活服务上品展示的销售型名称。

只允许优化：
- packages.viewList[].groupName
- packages.viewList[].list[].title

不得修改价格、数量、ID、套餐结构、选择规则、菜品数量，不得新增或删除菜品。

整体命名目标：
1. 名称要有宣传效果，读起来更有食欲、更有品质感、更适合团购套餐售卖。
2. 同一套餐内的组名要风格统一、结构对称、层次清楚，例如“招牌主菜 / 人气荤菜 / 爽口素菜 / 主食饮品 / 甜品小吃”。
3. 菜品名要比原名更完整、更顺口、更有画面感，但不能变成虚假宣传。
4. 优先使用平台常见的销售型表达：招牌、人气、经典、精选、特色、风味、鲜香、浓香、爽口、现拌、热卤、炙烤、秘制、手作等；只有原始信息能支持时才使用强事实词。
5. 组名负责“套餐结构和价值感”，菜品名负责“具体菜品和食欲感”。不要把组名写成单个菜名，也不要把菜品名写成大段广告语。
6. 默认应进行优化。只有原名已经具备清晰、对称、有销售感、无提升空间时，才保留原名。

优化风格：
- 组名建议 4-8 个中文字符，尽量对称、有栏目感。
- 菜品名建议 4-14 个中文字符，简洁但有食欲。
- 可以把“主菜”优化为“招牌主菜”“人气主菜”“风味主菜”。
- 可以把“素菜”优化为“爽口素菜”“清爽时蔬”“经典素菜”。
- 可以把“饮品”优化为“畅饮饮品”“佐餐饮品”。
- 可以把过短菜名补足为更适合展示的名称，例如在不改变事实的前提下补充品类、做法、口味或常见搭配语感。
- 同一组内菜品命名应保持句式协调，避免一个很华丽、一个很朴素。

严格禁止：
1. 禁止虚构食材、产地、规格、权益、口味、城市特色、门店信息。
2. 禁止无依据使用“现切、鲜活、手工、自制、进口、主厨、必点、销冠、全网第一”等强事实或强背书词。
3. 禁止加入折扣、满减、限时、买赠、低价、爆款第一、闭眼冲、错过血亏等促销或夸张词。
4. 禁止 emoji、特殊符号、过多括号、平台外引流信息。
5. 禁止把普通菜品强行写得不符合餐厅品类或价格带。

输出要求：
- 必须返回所有输入的 group index 和 item index。
- 无需优化的项目也返回原名。
- 严格输出 JSON，不要解释，不要 Markdown。
- JSON 格式：{"groups":[{"index":0,"groupName":"...","items":[{"index":0,"title":"..."}]}]}。`;

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
  throw new Error(lastError || "信息优化失败");
}
