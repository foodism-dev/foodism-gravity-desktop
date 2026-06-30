import { randomUUID } from "node:crypto";
import { cleanString, type JsonRecord } from "./utils.ts";

export const BASE_URL = "https://www.life-partner.cn";
const CSRF_TOKEN_PATH = "/life/partner/v1/common/csrf/token";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface OpenUrlResult {
  headers: Headers;
  body: Uint8Array;
}

export class LifePartnerSession {
  cookie: string;
  timeout: number;
  baseUrl: string;
  referer: string;
  sessionId: string;
  csrfToken = "";
  csrfSessionId = "";

  constructor(input: { cookie: string; timeout: number; baseUrl?: string; referer?: string }) {
    this.cookie = input.cookie;
    this.timeout = input.timeout;
    this.baseUrl = (input.baseUrl || BASE_URL).replace(/\/+$/, "");
    this.referer = input.referer || this.baseUrl;
    this.sessionId = randomUUID();
  }

  commonHeaders(): Record<string, string> {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Cookie: this.cookie,
      Pragma: "no-cache",
      Referer: this.referer,
      "User-Agent": USER_AGENT,
      "x-tt-ls-session-id": this.sessionId,
    };
  }

  async ensureCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const headers = {
      ...this.commonHeaders(),
      Origin: this.baseUrl,
      "x-secsdk-csrf-request": "1",
      "x-secsdk-csrf-version": "1.2.22",
    };
    const response = await this.openUrl("HEAD", this.url(CSRF_TOKEN_PATH), headers);
    const rawToken = response.headers.get("x-ware-csrf-token") || "";
    const tokenInfo = rawToken.split(",");
    if (tokenInfo.length < 2 || tokenInfo[0] !== "0" || !tokenInfo[1]) {
      throw new Error(`CSRF token 获取失败: header_parts=${JSON.stringify(tokenInfo.slice(0, 4))} status_header_present=${Boolean(rawToken)}`);
    }
    this.csrfToken = tokenInfo[1];
    if (tokenInfo.length > 4) {
      this.csrfSessionId = tokenInfo[4] ?? "";
    }
    return this.csrfToken;
  }

  async getJson(path: string, query?: Record<string, unknown>, csrf = false): Promise<unknown> {
    const headers = this.commonHeaders();
    if (csrf) {
      headers["x-secsdk-csrf-token"] = await this.ensureCsrfToken();
    }
    const response = await this.openUrl("GET", this.urlWithQuery(path, query), headers);
    return parseJsonOrText(response.body);
  }

  async postJson(path: string, payload: unknown, query?: Record<string, unknown>): Promise<unknown> {
    const token = await this.ensureCsrfToken();
    const csrfValues = this.csrfSessionId ? [token, `${token},${this.csrfSessionId}`] : [token];
    const url = this.urlWithQuery(path, query);
    let lastError: unknown = null;

    for (const csrfValue of csrfValues) {
      const headers = {
        ...this.commonHeaders(),
        "Content-Type": "application/json",
        Origin: this.baseUrl,
        "x-secsdk-csrf-token": csrfValue,
      };
      try {
        const response = await this.openUrl(
          "POST",
          url,
          headers,
          new TextEncoder().encode(JSON.stringify(payload)),
        );
        return parseJsonOrText(response.body);
      } catch (error) {
        lastError = error;
        if (!String(error).includes("HTTP 403") || csrfValue === csrfValues[csrfValues.length - 1]) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("POST failed");
  }

  async openUrl(
    method: string,
    url: string,
    headers: Record<string, string>,
    data?: Uint8Array | string | null,
  ): Promise<OpenUrlResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(this.timeout, 1) * 1000);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data || undefined,
        signal: controller.signal,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        const text = new TextDecoder().decode(body);
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      return { headers: response.headers, body };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request failed: timeout");
      }
      throw error instanceof Error ? error : new Error(`Request failed: ${String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  url(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return this.baseUrl + path;
  }

  urlWithQuery(path: string, query?: Record<string, unknown>): string {
    const url = new URL(this.url(path));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

export function cookieConfigToHeader(rawCookie: string): string {
  const text = cleanString(rawCookie);
  if (!text) return "";
  try {
    return cookieDataToHeader(JSON.parse(text) as unknown);
  } catch {
    return normalizeCookie(text);
  }
}

export function cookieDataToHeader(data: unknown, providerName = ""): string {
  if (Array.isArray(data)) {
    const pairs: Record<string, string> = {};
    for (const item of data) {
      if (isPlainCookie(item)) {
        pairs[String(item.name)] = String(item.value);
      }
    }
    return cookiePairsToHeader(pairs);
  }
  if (data && typeof data === "object") {
    const record = data as JsonRecord;
    if (providerName && record[providerName] && typeof record[providerName] === "object") {
      const entry = record[providerName] as JsonRecord;
      return cookiePairsToHeader((entry.cookies && typeof entry.cookies === "object" ? entry.cookies : entry) as Record<string, unknown>);
    }
    if (record.cookies && typeof record.cookies === "object") {
      return cookiePairsToHeader(record.cookies as Record<string, unknown>);
    }
    return cookiePairsToHeader(record);
  }
  return typeof data === "string" ? normalizeCookie(data) : "";
}

function isPlainCookie(value: unknown): value is { name: string; value: unknown } {
  return Boolean(value && typeof value === "object" && "name" in value && "value" in value);
}

export function normalizeCookie(rawCookie: string): string {
  const pairs: Record<string, string> = {};
  for (const item of rawCookie.replaceAll("\n", ";").split(";")) {
    const trimmed = item.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const [name, ...rest] = trimmed.split("=");
    const key = name?.trim();
    if (key) pairs[key] = rest.join("=").trim();
  }
  return cookiePairsToHeader(pairs);
}

export function cookiePairsToHeader(pairs: Record<string, unknown>): string {
  const normalized: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (!name || value === null || value === undefined || typeof value === "object") continue;
    const trimmedName = name.trim();
    const trimmedValue = cleanString(value);
    if (trimmedName) normalized.push(`${trimmedName}=${trimmedValue}`);
  }
  return normalized.join("; ");
}

function parseJsonOrText(body: Uint8Array): unknown {
  const text = new TextDecoder().decode(body);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
