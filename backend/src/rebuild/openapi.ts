import { createHash } from "node:crypto";

export interface RebuildSignedQueryInput {
  appId: string;
  appSecret: string;
  timestamp?: number;
  params: Record<string, string | number | boolean | null | undefined>;
}

export interface RebuildOpenApiResponse<T> {
  error_code: number;
  error_msg: string;
  data?: T;
  error_data?: unknown;
}

export function normalizeRebuildBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("REBUILD_BASE_URL 不能为空");
  }
  if (trimmed.endsWith("/gw/api")) {
    return `${trimmed}/`;
  }
  return `${trimmed}/gw/api/`;
}

export function readRequiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少 REBUILD OpenAPI 配置: ${name}`);
  }
  return value;
}

function stringifyParam(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function buildRebuildSignedQuery(input: RebuildSignedQueryInput): Record<string, string> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.params)) {
    const normalized = stringifyParam(value);
    if (normalized !== null) params[key] = normalized;
  }

  params.appid = input.appId;
  params.timestamp = timestamp;
  params.sign_type = "MD5";

  const signBody = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  params.sign = createHash("md5")
    .update(`${signBody}&${input.appId}.${input.appSecret}`)
    .digest("hex");

  return params;
}

export function buildRebuildOpenApiUrl(
  apiName: string,
  params: Record<string, string | number | boolean | null | undefined>,
): URL {
  const signedParams = buildRebuildSignedQuery({
    appId: readRequiredEnv("REBUILD_APP_ID"),
    appSecret: readRequiredEnv("REBUILD_APP_SECRET"),
    params,
  });

  const url = new URL(apiName, normalizeRebuildBaseUrl(readRequiredEnv("REBUILD_BASE_URL")));
  for (const [key, value] of Object.entries(signedParams).sort(([left], [right]) => left.localeCompare(right))) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function readJsonResponse<T>(response: Response): Promise<RebuildOpenApiResponse<T>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`REBUILD OpenAPI 请求失败 (${response.status}): ${text || response.statusText}`);
  }

  try {
    return JSON.parse(text) as RebuildOpenApiResponse<T>;
  } catch (error) {
    console.error("[REBUILD] 响应不是合法 JSON:", error);
    throw new Error("REBUILD OpenAPI 返回格式错误");
  }
}
