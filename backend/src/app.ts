import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
import type { Context } from "hono";
import {
  authenticateLogin,
  createLoginResponse,
  extractSsoUser,
  getJwtSecret,
  isLoginRequest,
  type LoginResponse,
  resolveUserFromTokenPayload,
  type ApiUser,
  type AuthTokenPayload,
} from "./auth.ts";
import {
  createRebuildSupplyGoodsClient,
  extractSupplyCompanyId,
  extractSupplyGoodsId,
  extractSupplyHostId,
  getDefaultSupplyGoodsRecordRepository,
  syncSupplyGoodsFromCallback,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "./service/rebuild/supplygoods.ts";
import { getDefaultRebuildAssetUploader, type RebuildAssetUploader } from "./service/rebuild/assets.ts";
import {
  extractSupplyCompanyIdFromCallback,
  extractSupplyHostIdFromCallback,
  getDefaultRebuildSupplierRecordRepository,
  syncSupplyCompanyFromCallback,
  syncSupplyHostFromCallback,
  type RebuildSupplierRecordRepository,
} from "./service/rebuild/suppliers.ts";
import {
  createRebuildMetadataClient,
  getDefaultRebuildFieldMetadataRepository,
  getSupplyGoodsOptionFieldNames,
  syncSupplyCompanyFieldMetadata,
  syncSupplyGoodsFieldMetadata,
  type RebuildFieldMetadata,
  type RebuildFieldMetadataRepository,
  type RebuildMetadataSyncResult,
  type RebuildMetadataClient,
} from "./service/rebuild/fields.ts";
import {
  getDefaultTicketRepository,
  parseTicketQuery,
  serializeFieldOption,
  serializeFieldMetadata,
  serializeTicket,
  serializeTicketActionRecord,
  serializeTicketList,
  type CreateTicketActionRecordResult,
  type TicketFieldMetadataApiMap,
  type TicketFieldOptionsApiMap,
  type TicketRepository,
} from "./tickets.ts";
import { getDefaultSkillPublisher, sha256Bytes, type SkillPublisher } from "./skill-publisher.ts";
import { getDefaultSkillRepository, type MarketSkill, type SkillRepository } from "./skills.ts";
import { getDefaultUserRepository, type UserRepository } from "./users.ts";
import { createLinKeRoutes, type LinKeRoutesOptions } from "./service/lin-ke/routes.ts";
import { getLinKeSettings, type LinKeSettings } from "./service/lin-ke/config.ts";
import { optimizePayloadWithRetries } from "./service/lin-ke/optimizer.ts";
import {
  applyEditablePackages,
  bdCityText,
  displaySupplyGoodsPackages,
} from "./service/lin-ke/supply-goods.ts";
import {
  getDefaultLinKeRepository,
  type LinKeRepository,
} from "./service/lin-ke/repository.ts";
import { checkCookie } from "./service/lin-ke/service.ts";
import {
  getDefaultGravityJobsQueue,
  REBUILD_SUPPLIER_SYNC_JOB_NAME,
  type GravityJobsQueueClient,
} from "./jobs/queue.ts";
import type { RebuildSupplierSyncJobData } from "./jobs/types.ts";
import {
  getDefaultLinKeDraftQueue,
  type LinKeDraftQueueClient,
} from "./service/lin-ke/draft-queue.ts";
import {
  getDefaultLinKeFeeSetupQueue,
  LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS,
  type LinKeFeeSetupQueueClient,
} from "./service/lin-ke/fee-setup-queue.ts";
import {
  LIN_KE_FEE_SETUP_SAVE_VERSION,
  type LinKeFeeRates,
  normalizeLinKeFeeRates,
  resolveLinKeMerchantId,
  validateLinKeFeeRates,
} from "./service/lin-ke/fee-setup.ts";

interface ServerStatus {
  name: string;
  status: "ok";
  uptime: number;
  timestamp: string;
}

interface ServerVariables {
  jwtPayload: AuthTokenPayload;
  apiUser: ApiUser;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ServerAppOptions {
  userRepository?: UserRepository | null;
  skillRepository?: SkillRepository | null;
  skillPublisher?: SkillPublisher | null;
  internalApiToken?: string | null;
  rebuildSupplyGoodsClient?: RebuildSupplyGoodsClient;
  rebuildMetadataClient?: RebuildMetadataClient;
  rebuildAssetUploader?: RebuildAssetUploader | null;
  rebuildSupplierRepository?: RebuildSupplierRecordRepository | null;
  supplyGoodsRecordRepository?: SupplyGoodsRecordRepository | null;
  rebuildFieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  ticketRepository?: TicketRepository | null;
  gravityJobsQueue?: GravityJobsQueueClient | null;
  fetchImpl?: FetchLike;
  linKeRoutesOptions?: LinKeRoutesOptions;
  linKeDraftQueue?: LinKeDraftQueueClient | null;
  linKeFeeSetupQueue?: LinKeFeeSetupQueueClient | null;
}

const DEFAULT_GRAVITY_SSO_ISSUER = "https://fawos.online";
const DEFAULT_WEB_SSO_CLIENT_ID = "gravity-pc";
export const DEFAULT_WEB_SSO_REDIRECT_URI = "http://127.0.0.1:8787/sso/callback";
const DEFAULT_WEB_SSO_SCOPE = "openid profile email offline_access";
const WEB_SSO_STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000;

const SENSITIVE_LOG_KEYS = new Set([
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "token",
  "jwt",
  "apiToken",
  "api_token",
  "authorization",
  "Authorization",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_LOG_KEYS.has(key) ? "<redacted>" : sanitizeForLog(item);
  }
  return sanitized;
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorCause(error: unknown): unknown {
  if (error instanceof Error && "cause" in error) {
    return error.cause;
  }
  if (isRecord(error) && "cause" in error) {
    return error.cause;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  const cause = getErrorCause(error);
  if (cause === undefined) {
    return message;
  }
  return `${message}\nCause: ${getErrorMessage(cause)}`;
}

function getBriefErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = getErrorCause(error);
  if (cause === undefined) return message;
  return `${message}; Cause: ${getBriefErrorMessage(cause)}`;
}

function getRecordKeys(value: unknown): string {
  return isRecord(value) ? Object.keys(value).join(", ") || "<empty>" : "<非对象>";
}

function getNestedRecord(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function readRecordValue(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : null;
}

function buildInitialProductTrackingPayload(startedAt: string): Record<string, unknown> {
  const startedAtMs = new Date(startedAt).getTime();
  const safeStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : Date.now();
  return {
    linkeProductTrackingStartedAt: new Date(safeStartedAtMs).toISOString(),
    linkeProductTrackingTimeoutAt: new Date(safeStartedAtMs + LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS).toISOString(),
    linkeProductTrackingNextCheckAt: new Date(safeStartedAtMs).toISOString(),
    linkeProductTrackingLastCheckedAt: "",
    linkeProductTrackingLastCheckCount: 0,
    linkeProductTrackingNextCheckCount: 1,
    linkeFeeStatus: "",
    linkeProductStatus: "",
  };
}

function logSsoPayload(body: unknown, authAction: "create_user" | "sso_login"): void {
  const sanitized = sanitizeForLog(body);
  console.log(`[认证] SSO ${authAction} 请求 payload（已脱敏）: ${stringifyForLog(sanitized)}`);
  console.log(`[认证] SSO ${authAction} 顶层字段: ${getRecordKeys(body)}`);
  console.log(`[认证] SSO ${authAction} user 字段: ${getRecordKeys(getNestedRecord(body, ["user"]))}`);
  console.log(`[认证] SSO ${authAction} account 字段: ${getRecordKeys(getNestedRecord(body, ["account"]))}`);
  console.log(`[认证] SSO ${authAction} account.account 字段: ${getRecordKeys(getNestedRecord(body, ["account", "account"]))}`);
}

async function enqueueLinkedSupplierSyncJobs(input: {
  queue: GravityJobsQueueClient | null;
  supplyGoodsId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!input.queue) return;

  const jobs: RebuildSupplierSyncJobData[] = [];
  const supplyCompanyId = extractSupplyCompanyId(input.payload);
  if (supplyCompanyId) {
    jobs.push({
      entityName: "SupplyCompany",
      recordId: supplyCompanyId,
      source: "supply_goods_callback",
      supplyGoodsId: input.supplyGoodsId,
    });
  }

  const supplyHostId = extractSupplyHostId(input.payload);
  if (supplyHostId) {
    jobs.push({
      entityName: "SupplyHost",
      recordId: supplyHostId,
      source: "supply_goods_callback",
      supplyGoodsId: input.supplyGoodsId,
    });
  }

  for (const job of jobs) {
    try {
      await input.queue.addJob(REBUILD_SUPPLIER_SYNC_JOB_NAME, job);
    } catch (error) {
      console.warn(`[REBUILD] 投递 ${job.entityName} 异步同步任务失败: ${job.recordId} ${getBriefErrorMessage(error)}`);
    }
  }
}

function toSkillListItem(skill: MarketSkill) {
  return {
    slug: skill.slug,
    name: skill.name,
    summary: skill.summary,
    icon: skill.icon,
    tags: skill.tags,
    packageSha256: skill.packageSha256,
    packageSizeBytes: skill.packageSizeBytes,
    downloadCount: skill.downloadCount,
    updatedAt: skill.updatedAt,
  };
}

function toSkillDetail(skill: MarketSkill) {
  return {
    ...toSkillListItem(skill),
    description: skill.description,
    unpackedSizeBytes: skill.unpackedSizeBytes,
    fileCount: skill.fileCount,
    manifest: skill.manifest,
  };
}

function resolveInternalApiToken(input: string | null | undefined): string | null {
  if (input !== undefined) {
    return input?.trim() || null;
  }
  return Bun.env.PROMA_INTERNAL_API_TOKEN?.trim() || null;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

interface WebSsoState {
  verifier: string;
  returnTo: string;
  redirectUri: string;
  expiresAt: number;
}

interface HandoffSession {
  session: LoginResponse;
  expiresAt: number;
}

interface WebSsoConfig {
  issuer: string;
  clientId: string;
  scope: string;
}

interface WebSsoPkce {
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
}

interface SsoTokenSet {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
}

function createWebSsoPkce(): WebSsoPkce {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(24)),
    nonce: base64url(randomBytes(24)),
  };
}

function resolveConfiguredWebSsoLoginUrl(): string | null {
  const configuredUrl = Bun.env.GRAVITY_WEB_SSO_LOGIN_URL?.trim() || Bun.env.VITE_SSO_LOGIN_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }
  return null;
}

function resolveWebSsoConfig(): WebSsoConfig {
  const issuer = Bun.env.GRAVITY_SSO_ISSUER?.trim() || DEFAULT_GRAVITY_SSO_ISSUER;
  return {
    issuer,
    clientId: Bun.env.GRAVITY_WEB_CLIENT_ID?.trim() || Bun.env.GRAVITY_PC_CLIENT_ID?.trim() || DEFAULT_WEB_SSO_CLIENT_ID,
    scope: Bun.env.GRAVITY_WEB_SCOPE?.trim() || Bun.env.GRAVITY_PC_SCOPE?.trim() || DEFAULT_WEB_SSO_SCOPE,
  };
}

function buildConfiguredWebSsoRedirectUrl(context: Context, loginUrl: string): string {
  const redirectUrl = new URL(loginUrl);
  const returnTo = context.req.query("returnTo")?.trim();
  if (returnTo) {
    redirectUrl.searchParams.set("returnTo", returnTo);
  }
  return redirectUrl.toString();
}

function getRequestOrigin(context: Context): string {
  return new URL(context.req.url).origin;
}

function resolveWebSsoRedirectUri(context: Context): string {
  return Bun.env.GRAVITY_WEB_REDIRECT_URI?.trim()
    || Bun.env.GRAVITY_PC_REDIRECT_URI?.trim()
    || DEFAULT_WEB_SSO_REDIRECT_URI;
}

function resolveWebSsoReturnTo(context: Context): string {
  return context.req.query("returnTo")?.trim()
    || Bun.env.GRAVITY_WEB_DEFAULT_RETURN_TO?.trim()
    || new URL("/", getRequestOrigin(context)).toString();
}

function buildOidcAuthorizeUrl(config: WebSsoConfig, pkce: WebSsoPkce, redirectUri: string): string {
  const authorizeUrl = new URL("/oauth2/authorize", normalizeBaseUrl(config.issuer));
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    login_hint: "dingtalk",
  }).toString();
  return authorizeUrl.toString();
}

function toSsoTokenSet(payload: unknown): SsoTokenSet {
  if (!isRecord(payload)) return {};
  return {
    access_token: typeof payload.access_token === "string" ? payload.access_token : undefined,
    token_type: typeof payload.token_type === "string" ? payload.token_type : undefined,
    expires_in: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    id_token: typeof payload.id_token === "string" ? payload.id_token : undefined,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getAuthResponseError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.message === "string" && payload.message) return payload.message;
  if (typeof payload.error === "string" && payload.error) return payload.error;
  return fallback;
}

async function exchangeWebSsoCode(
  fetchImpl: FetchLike,
  config: WebSsoConfig,
  code: string,
  state: WebSsoState,
): Promise<SsoTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: state.redirectUri,
    code_verifier: state.verifier,
  });
  const response = await fetchImpl(new URL("/oauth2/token", normalizeBaseUrl(config.issuer)), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(getAuthResponseError(payload, `SSO token 请求失败: ${response.status}`));
  }
  return toSsoTokenSet(payload);
}

async function fetchWebSsoAccount(fetchImpl: FetchLike, issuer: string, accessToken: string): Promise<unknown> {
  const response = await fetchImpl(new URL("/oauth2/account", normalizeBaseUrl(issuer)), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(getAuthResponseError(payload, `SSO account 请求失败: ${response.status}`));
  }
  return payload;
}

function isAuthorizedInternalRequest(context: Context, expectedToken: string): boolean {
  const token = context.req.header("Authorization")?.trim();
  return Boolean(token && token === `Bearer ${expectedToken}`);
}

function createTicketOperatorSnapshot(user: ApiUser): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    source: "jwt",
  };
}

function isLinKeTestSkipEnabled(): boolean {
  return Bun.env.LIN_KE_TEST_SKIP_ENABLED?.trim() === "true";
}

function shouldSkipLinKeExternal(body: unknown): boolean {
  return isRecord(body) && body.skipLinKeExternal === true;
}

function buildMockLinKeUrl(kind: "draft" | "fee-setting", supplyGoodsId: string): string {
  return `https://www.life-partner.cn/test/mock-${kind}/${encodeURIComponent(supplyGoodsId)}`;
}

function readLinKeCookieCheckMessage(result: Record<string, unknown>): string {
  return String(result.error ?? result.reason ?? result.message ?? "").trim();
}

async function validateLinKeDraftCookie(input: {
  linKeRepository: LinKeRepository | null;
  settings: LinKeSettings;
  payload: Record<string, unknown>;
  checkCookieFn: typeof checkCookie;
}): Promise<{ ok: true } | { ok: false; status: 400 | 503; message: string }> {
  if (!input.linKeRepository) {
    return { ok: false, status: 503, message: "DATABASE_URL 未配置，Lin-Ke repository 不可用" };
  }
  const cityText = bdCityText(input.payload);
  if (!cityText) {
    return { ok: false, status: 400, message: "payload.bdCity.text is required" };
  }
  const accountConfig = await input.linKeRepository.findAccountConfigByCity(cityText);
  if (!accountConfig) {
    return { ok: false, status: 400, message: `lin_ke_account_config_not_found_for_city:${cityText}` };
  }

  try {
    const result = await input.checkCookieFn(input.settings, accountConfig);
    if (result.ok === true && result.cookieValid !== false) {
      return { ok: true };
    }
    const checkMessage = readLinKeCookieCheckMessage(result);
    return {
      ok: false,
      status: 400,
      message: checkMessage ? `林客 Cookie 无效：${checkMessage}` : "林客 Cookie 无效，请更新后重试",
    };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      message: `林客 Cookie 校验失败：${getBriefErrorMessage(error)}`,
    };
  }
}

async function recordLinKeDraftFailure(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  operator: Record<string, unknown>;
  message: string;
}): Promise<void> {
  await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_draft_failed",
    origin: {
      linkeDraftState: readRecordValue(input.payload, "linkeDraftState"),
      linkeDraftJobId: readRecordValue(input.payload, "linkeDraftJobId"),
      linkeDraftError: readRecordValue(input.payload, "linkeDraftError"),
    },
    current: {
      linkeDraftState: "failed",
      linkeDraftError: input.message,
      linkeDraftFailedAt: new Date().toISOString(),
    },
    operator: input.operator,
    remark: `林客草稿创建失败：${input.message}`,
  });
}

async function recordSkippedLinKeDraftSuccess(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  operator: Record<string, unknown>;
}): Promise<CreateTicketActionRecordResult | null> {
  return await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "info_optimized",
    origin: {
      linkeDraftUrl: readRecordValue(input.payload, "linkeDraftUrl"),
      linkeDraftState: readRecordValue(input.payload, "linkeDraftState"),
      linkeDraftError: readRecordValue(input.payload, "linkeDraftError"),
    },
    current: {
      linkeDraftUrl: buildMockLinKeUrl("draft", input.supplyGoodsId),
      linkeDraftState: "completed",
      linkeDraftError: "",
      linkeDraftCompletedAt: new Date().toISOString(),
    },
    operator: input.operator,
    remark: "测试模式跳过林客草稿创建，确认采用信息优化结果",
  });
}

async function recordSkippedLinKeFeeSetupSuccess(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  ticketPayload: Record<string, unknown>;
  linkeGoodsId: string;
  merchantId: string;
  rates: LinKeFeeRates;
  operator: Record<string, unknown>;
}): Promise<CreateTicketActionRecordResult | null> {
  return await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_fee_setup_completed",
    origin: {
      linkeFeeSetupState: readRecordValue(input.ticketPayload, "linkeFeeSetupState"),
      linkeFeeSettingUrl: readRecordValue(input.ticketPayload, "linkeFeeSettingUrl"),
      linkeFeeSetupError: readRecordValue(input.ticketPayload, "linkeFeeSetupError"),
      linkeFeeSetupSaveSubmitted: readRecordValue(input.ticketPayload, "linkeFeeSetupSaveSubmitted"),
      linkeFeeSetupSaveVersion: readRecordValue(input.ticketPayload, "linkeFeeSetupSaveVersion"),
    },
    current: {
      linkeGoodsId: input.linkeGoodsId,
      linkeMerchantId: input.merchantId,
      linkeFeeRates: input.rates,
      linkeFeeSetupState: "completed",
      linkeFeeSettingUrl: buildMockLinKeUrl("fee-setting", input.supplyGoodsId),
      linkeFeeSetupError: "",
      linkeFeeSetupCompletedAt: new Date().toISOString(),
      linkeFeeSetupSaveSubmitted: true,
      linkeFeeSetupSaveVersion: LIN_KE_FEE_SETUP_SAVE_VERSION,
    },
    operator: input.operator,
    remark: "测试模式跳过林客费用设置，同步结果按完成处理",
  });
}

async function recordSkippedLinKeProductTracking(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  operator: Record<string, unknown>;
}): Promise<CreateTicketActionRecordResult | null> {
  const now = new Date().toISOString();
  return await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "commission_configured",
    origin: {
      commissionConfigured: readRecordValue(input.payload, "commissionConfigured"),
      linkeProductTrackingState: readRecordValue(input.payload, "linkeProductTrackingState"),
      linkeProductTrackingJobId: readRecordValue(input.payload, "linkeProductTrackingJobId"),
    },
    current: {
      commissionConfigured: true,
      commissionConfiguredAt: now,
      linkeFeeSetupConfirmedAt: now,
      linkeProductTrackingState: "skipped",
      linkeProductTrackingJobId: "",
      linkeProductTrackingError: "",
      ...buildInitialProductTrackingPayload(now),
    },
    operator: input.operator,
    remark: "测试模式跳过林客商品状态追踪，等待人工确认上线",
  });
}

function getFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() || null : null;
}

function parseFormInteger(formData: FormData, key: string): number | null {
  const value = getFormString(formData, key);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseTags(formData: FormData): string[] {
  const raw = getFormString(formData, "tags");
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((value): value is string => typeof value === "string")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
  } catch {
    // 兼容逗号分隔的简单运维输入。
  }

  return raw.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function parseManifest(formData: FormData): Record<string, unknown> {
  const raw = getFormString(formData, "manifest");
  if (!raw) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("manifest 必须是 JSON 对象");
  }
  return parsed;
}

function parseMarketSkillStatus(value: string | null): MarketSkill["status"] {
  if (!value) return "published";
  if (value === "published" || value === "hidden" || value === "archived") return value;
  throw new Error("status 无效");
}

function sameObjectKeys(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

async function parseTicketActionRecordBody(context: Context): Promise<
  | {
      ok: true;
      value: {
        action: string;
        origin: Record<string, unknown>;
        current: Record<string, unknown>;
        operator: Record<string, unknown>;
        remark: string | null;
      };
    }
  | { ok: false; message: string }
> {
  const body = (await context.req.json().catch(() => null)) as unknown;
  if (!isRecord(body)) {
    return { ok: false, message: "请求体必须是 JSON 对象" };
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const origin = body.origin;
  const current = body.current;
  const operator = isRecord(body.operator) ? body.operator : {};
  const remark = typeof body.remark === "string" && body.remark.trim() ? body.remark.trim() : null;

  if (!action) return { ok: false, message: "action 不能为空" };
  if (!isRecord(origin)) return { ok: false, message: "origin 必须是 JSON 对象" };
  if (!isRecord(current)) return { ok: false, message: "current 必须是 JSON 对象" };
  if (!sameObjectKeys(origin, current)) return { ok: false, message: "origin 和 current 字段必须一致" };

  return {
    ok: true,
    value: {
      action,
      origin,
      current,
      operator,
      remark,
    },
  };
}

function isValidSkillSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
}

export function createServerApp(options: ServerAppOptions = {}) {
  const app = new Hono<{ Variables: ServerVariables }>();
  const jwtSecret = getJwtSecret();
  const userRepository = options.userRepository ?? getDefaultUserRepository();
  const skillRepository = options.skillRepository ?? getDefaultSkillRepository();
  const skillPublisher = options.skillPublisher ?? getDefaultSkillPublisher();
  const internalApiToken = resolveInternalApiToken(options.internalApiToken);
  const rebuildMetadataClient = options.rebuildMetadataClient ?? createRebuildMetadataClient();
  const supplyGoodsRecordRepository =
    options.supplyGoodsRecordRepository ?? getDefaultSupplyGoodsRecordRepository();
  const rebuildFieldMetadataRepository =
    options.rebuildFieldMetadataRepository ?? getDefaultRebuildFieldMetadataRepository();
  const rebuildSupplyGoodsClient = options.rebuildSupplyGoodsClient ?? createRebuildSupplyGoodsClient({
    fieldMetadataRepository: rebuildFieldMetadataRepository,
  });
  const listSupplyGoodsFields = createCachedRebuildFieldLoader(rebuildFieldMetadataRepository, "SupplyGoods");
  const listSupplyCompanyFields = createCachedRebuildFieldLoader(rebuildFieldMetadataRepository, "SupplyCompany");
  const listSupplyHostFields = createCachedRebuildFieldLoader(rebuildFieldMetadataRepository, "SupplyHost");
  const rebuildAssetUploader = options.rebuildAssetUploader ?? getDefaultRebuildAssetUploader();
  const rebuildSupplierRepository = options.rebuildSupplierRepository ?? getDefaultRebuildSupplierRecordRepository();
  const ticketRepository = options.ticketRepository ?? getDefaultTicketRepository();
  const gravityJobsQueue = options.gravityJobsQueue !== undefined ? options.gravityJobsQueue : getDefaultGravityJobsQueue();
  const fetchImpl = options.fetchImpl ?? fetch;
  const webSsoStates = new Map<string, WebSsoState>();
  const handoffSessions = new Map<string, HandoffSession>();
  const jwtMiddleware = jwt({
    secret: jwtSecret,
    alg: "HS256",
  });
  const requireApiUser = async (
    context: Context<{ Variables: ServerVariables }>,
    next: () => Promise<void>,
  ): Promise<void> => {
    const payload = context.get("jwtPayload");
    context.set("apiUser", await resolveUserFromTokenPayload(payload, userRepository));
    await next();
  };
  const linKeSettings = options.linKeRoutesOptions?.settings ?? getLinKeSettings();
  const optimizeLinKePayload = options.linKeRoutesOptions?.optimizePayload ?? optimizePayloadWithRetries;
  const checkLinKeCookie = options.linKeRoutesOptions?.checkCookie ?? checkCookie;
  const configuredLinKeRepository = options.linKeRoutesOptions?.repository;
  const resolveLinKeRepository = () => (
    configuredLinKeRepository !== undefined ? configuredLinKeRepository : getDefaultLinKeRepository()
  );
  const configuredLinKeDraftQueue = options.linKeDraftQueue;
  const resolveLinKeDraftQueue = () => (
    configuredLinKeDraftQueue !== undefined ? configuredLinKeDraftQueue : getDefaultLinKeDraftQueue()
  );
  const configuredLinKeFeeSetupQueue = options.linKeFeeSetupQueue;
  const resolveLinKeFeeSetupQueue = () => (
    configuredLinKeFeeSetupQueue !== undefined ? configuredLinKeFeeSetupQueue : getDefaultLinKeFeeSetupQueue()
  );

  app.use("/api/*", cors());
  app.route("/", createLinKeRoutes(options.linKeRoutesOptions));

  app.get("/health", (context) => {
    return context.json({ status: "ok" });
  });

  app.get("/api/status", (context) => {
    const status: ServerStatus = {
      name: "@proma/server",
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return context.json(status);
  });

  app.use("/api/internal/*", async (context, next) => {
    if (!internalApiToken) {
      return context.json({ error: "Service Unavailable", message: "未配置内部接口 Token" }, 503);
    }
    if (!isAuthorizedInternalRequest(context, internalApiToken)) {
      return context.json({ error: "Unauthorized", message: "内部接口 Token 无效" }, 401);
    }
    await next();
  });

  app.post("/api/auth/login", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }

    if (!isLoginRequest(body)) {
      return context.json({ error: "Bad Request", message: "账号和密码不能为空" }, 400);
    }

    const user = await authenticateLogin(body, userRepository);
    if (!user) {
      console.warn(`[认证] 登录失败: ${body.username.trim() || "<empty>"}`);
      return context.json({ error: "Unauthorized", message: "账号或密码错误" }, 401);
    }

    console.log(`[认证] 用户已登录: ${user.username}`);
    return context.json(await createLoginResponse(user, jwtSecret));
  });

  async function handleSsoInternalAuth(
    context: Context<{ Variables: ServerVariables }>,
    authAction: "create_user" | "sso_login",
  ) {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }
    logSsoPayload(body, authAction);

    const ssoUser = extractSsoUser(body);
    if (!ssoUser) {
      return context.json({ error: "Bad Request", message: "SSO 用户信息不完整" }, 400);
    }

    const user = userRepository
      ? await userRepository.ensureSsoUser(ssoUser)
      : ssoUser;

    console.log(`[认证] SSO 用户已换取内部 JWT: ${user.username} (${authAction})`);
    return context.json(await createLoginResponse(user, jwtSecret));
  }

  app.post("/create_user", (context) => handleSsoInternalAuth(context, "create_user"));
  app.get("/sso_login", (context) => {
    const configuredLoginUrl = resolveConfiguredWebSsoLoginUrl();
    if (configuredLoginUrl) {
      const redirectUrl = buildConfiguredWebSsoRedirectUrl(context, configuredLoginUrl);
      console.log(`[认证] Web SSO 登录跳转: ${redirectUrl}`);
      return context.redirect(redirectUrl, 302);
    }

    const pkce = createWebSsoPkce();
    const redirectUri = resolveWebSsoRedirectUri(context);
    webSsoStates.set(pkce.state, {
      verifier: pkce.verifier,
      returnTo: resolveWebSsoReturnTo(context),
      redirectUri,
      expiresAt: Date.now() + WEB_SSO_STATE_TTL_MS,
    });

    const redirectUrl = buildOidcAuthorizeUrl(resolveWebSsoConfig(), pkce, redirectUri);
    console.log(`[认证] Web SSO OIDC 登录跳转: ${redirectUrl}`);
    return context.redirect(redirectUrl, 302);
  });
  app.post("/sso_login", (context) => handleSsoInternalAuth(context, "sso_login"));

  async function handleWebSsoCallback(context: Context<{ Variables: ServerVariables }>) {
    const code = context.req.query("code")?.trim();
    const stateValue = context.req.query("state")?.trim();
    if (!code || !stateValue) {
      return context.text("SSO 回调缺少 code 或 state", 400);
    }

    const state = webSsoStates.get(stateValue);
    webSsoStates.delete(stateValue);
    if (!state || state.expiresAt < Date.now()) {
      return context.text("SSO 登录状态已失效，请重新登录", 400);
    }

    try {
      const config = resolveWebSsoConfig();
      const tokenSet = await exchangeWebSsoCode(fetchImpl, config, code, state);
      if (!tokenSet.access_token) {
        return context.text("SSO token 响应缺少 access_token", 502);
      }

      const account = await fetchWebSsoAccount(fetchImpl, config.issuer, tokenSet.access_token);
      const ssoUser = extractSsoUser(account);
      if (!ssoUser) {
        return context.text("SSO 用户信息不完整", 502);
      }

      const user = userRepository
        ? await userRepository.ensureSsoUser(ssoUser)
        : ssoUser;
      const session = await createLoginResponse(user, jwtSecret);
      const handoffToken = randomUUID();
      handoffSessions.set(handoffToken, {
        session,
        expiresAt: Date.now() + HANDOFF_TOKEN_TTL_MS,
      });

      const returnTo = new URL(state.returnTo, getRequestOrigin(context));
      returnTo.searchParams.set("handoff", handoffToken);
      console.log(`[认证] Web SSO 已完成，回跳前端: ${returnTo.origin}${returnTo.pathname}`);
      return context.redirect(returnTo.toString(), 302);
    } catch (error) {
      console.error(`[认证] Web SSO 回调失败: ${getErrorMessage(error)}`);
      return context.text("SSO 登录失败", 502);
    }
  }

  app.get("/callback", handleWebSsoCallback);
  app.get("/sso/callback", handleWebSsoCallback);

  app.post("/api/auth/handoff/exchange", async (context) => {
    const body = (await context.req.json().catch(() => null)) as unknown;
    const handoffToken = isRecord(body) && typeof body.handoffToken === "string"
      ? body.handoffToken.trim()
      : "";
    if (!handoffToken) {
      return context.json({ error: "Bad Request", message: "handoffToken 不能为空" }, 400);
    }

    const handoff = handoffSessions.get(handoffToken);
    handoffSessions.delete(handoffToken);
    if (!handoff || handoff.expiresAt < Date.now()) {
      return context.json({ error: "Unauthorized", message: "登录态桥接已失效，请重新登录" }, 401);
    }

    return context.json(handoff.session);
  });

  // 用户态业务接口统一从 JWT 解析当前用户，避免信任前端传入的操作者信息。
  app.use("/api/me", jwtMiddleware, requireApiUser);
  app.use("/api/tickets", jwtMiddleware, requireApiUser);
  app.use("/api/tickets/*", jwtMiddleware, requireApiUser);
  app.use("/api/rebuild/supplygoods/fields/sync", jwtMiddleware, requireApiUser);
  app.use("/api/rebuild/supplycompany/fields/sync", jwtMiddleware, requireApiUser);
  app.use("/api/rebuild/fields/options", jwtMiddleware, requireApiUser);
  app.use("/api/rebuild/references/*", jwtMiddleware, requireApiUser);

  async function handleSupplyGoodsCallback(context: Context<{ Variables: ServerVariables }>) {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }
    console.log(`[REBUILD] SupplyGoods callback payload（已脱敏）=${stringifyForLog(sanitizeForLog(body))}`);

    const supplyGoodsId = extractSupplyGoodsId(body);
    if (!supplyGoodsId) {
      return context.json({ error: "Bad Request", message: "supply_goods_id 不能为空" }, 400);
    }

    if (!supplyGoodsRecordRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await syncSupplyGoodsFromCallback({
        supplyGoodsId,
        rawPayload: isRecord(body) ? body : {},
        rebuildClient: rebuildSupplyGoodsClient,
        repository: supplyGoodsRecordRepository,
        assetUploader: rebuildAssetUploader,
        listFields: listSupplyGoodsFields,
        listSupplyCompanyFields,
        listSupplyHostFields,
      });
      await enqueueLinkedSupplierSyncJobs({
        queue: gravityJobsQueue,
        supplyGoodsId: result.supplyGoodsId,
        payload: result.normalizedPayload,
      });
      console.log(`[REBUILD] SupplyGoods 已同步: ${result.supplyGoodsId}`);
      return context.json({
        ok: true,
        supply_goods_id: result.supplyGoodsId,
        updated_at: result.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] SupplyGoods 回调同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: "同步 SupplyGoods 失败" }, 502);
    }
  }

  async function handleSupplyCompanyCallback(context: Context<{ Variables: ServerVariables }>) {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }
    const rawPayload = isRecord(body) ? body : {};
    console.log(`[REBUILD] SupplyCompany callback payload（已脱敏）=${stringifyForLog(sanitizeForLog(body))}`);

    const supplyCompanyId = extractSupplyCompanyIdFromCallback(rawPayload);
    if (!supplyCompanyId) {
      return context.json({ error: "Bad Request", message: "supply_company_id 不能为空" }, 400);
    }

    if (!rebuildSupplierRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await syncSupplyCompanyFromCallback({
        supplyCompanyId,
        rawPayload,
        rebuildClient: rebuildSupplyGoodsClient,
        repository: rebuildSupplierRepository,
        assetUploader: rebuildAssetUploader,
        listFields: rebuildFieldMetadataRepository ? listSupplyCompanyFields : undefined,
      });
      console.log(`[REBUILD] SupplyCompany 已同步: ${result.recordId}`);
      return context.json({
        ok: true,
        supply_company_id: result.recordId,
        updated_at: result.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] SupplyCompany 回调同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: "同步 SupplyCompany 失败" }, 502);
    }
  }

  async function handleSupplyHostCallback(context: Context<{ Variables: ServerVariables }>) {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }
    const rawPayload = isRecord(body) ? body : {};
    console.log(`[REBUILD] SupplyHost callback payload（已脱敏）=${stringifyForLog(sanitizeForLog(body))}`);

    const supplyHostId = extractSupplyHostIdFromCallback(rawPayload);
    if (!supplyHostId) {
      return context.json({ error: "Bad Request", message: "supply_host_id 不能为空" }, 400);
    }

    if (!rebuildSupplierRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await syncSupplyHostFromCallback({
        supplyHostId,
        rawPayload,
        rebuildClient: rebuildSupplyGoodsClient,
        repository: rebuildSupplierRepository,
        assetUploader: rebuildAssetUploader,
        listFields: rebuildFieldMetadataRepository ? listSupplyHostFields : undefined,
      });
      console.log(`[REBUILD] SupplyHost 已同步: ${result.recordId}`);
      return context.json({
        ok: true,
        supply_host_id: result.recordId,
        updated_at: result.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] SupplyHost 回调同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: "同步 SupplyHost 失败" }, 502);
    }
  }

  app.post("/api/rebuild/supplygoods/callback", handleSupplyGoodsCallback);
  app.post("/api/m/rebuild/saveReportSupplierGoodsInfo", handleSupplyGoodsCallback);
  app.post("/api/m/rebuild/saveReportSupplierCompanyInfo", handleSupplyCompanyCallback);
  app.post("/api/m/rebuild/saveReportSupplierHostInfo", handleSupplyHostCallback);

  app.post("/api/internal/skills", async (context) => {
    if (!skillRepository || !skillPublisher) {
      return context.json({ error: "Service Unavailable", message: "Skill 市场发布服务未配置" }, 503);
    }

    let formData: FormData;
    try {
      formData = await context.req.formData();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 multipart/form-data" }, 400);
    }

    const slug = getFormString(formData, "slug");
    const name = getFormString(formData, "name");
    const packageFile = formData.get("package");
    if (!slug || !isValidSkillSlug(slug)) {
      return context.json({ error: "Bad Request", message: "Skill slug 无效" }, 400);
    }
    if (!name) {
      return context.json({ error: "Bad Request", message: "Skill name 不能为空" }, 400);
    }
    if (!(packageFile instanceof File)) {
      return context.json({ error: "Bad Request", message: "必须上传 Skill package 文件" }, 400);
    }

    let manifest: Record<string, unknown>;
    let status: MarketSkill["status"];
    try {
      manifest = parseManifest(formData);
      status = parseMarketSkillStatus(getFormString(formData, "status"));
    } catch (error) {
      return context.json({ error: "Bad Request", message: error instanceof Error ? error.message : "发布参数无效" }, 400);
    }

    const packageBytes = new Uint8Array(await packageFile.arrayBuffer());
    const packageSha256 = sha256Bytes(packageBytes);
    const upload = await skillPublisher.publishSkillPackage({
      slug,
      packageBytes,
      contentType: packageFile.type || "application/zip",
      sha256: packageSha256,
    });
    const skill = await skillRepository.upsertSkill({
      slug,
      name,
      summary: getFormString(formData, "summary"),
      description: getFormString(formData, "description"),
      icon: getFormString(formData, "icon"),
      status,
      packageUrl: upload.packageUrl,
      packageSha256,
      packageSizeBytes: packageBytes.byteLength,
      unpackedSizeBytes: parseFormInteger(formData, "unpackedSizeBytes"),
      fileCount: parseFormInteger(formData, "fileCount"),
      manifest,
      tags: parseTags(formData),
    });

    return context.json({ packageUrl: upload.packageUrl, skill: toSkillDetail(skill) }, 201);
  });

  app.get("/api/skills", async (context) => {
    if (!skillRepository) {
      return context.json({ skills: [] });
    }

    const skills = await skillRepository.listSkills({
      query: context.req.query("query"),
      tag: context.req.query("tag"),
    });

    return context.json({ skills: skills.map(toSkillListItem) });
  });

  app.get("/api/skills/:slug", async (context) => {
    if (!skillRepository) {
      return context.json({ error: "Not Found", message: "Skill 不存在" }, 404);
    }

    const skill = await skillRepository.getSkillBySlug(context.req.param("slug"));
    if (!skill) {
      return context.json({ error: "Not Found", message: "Skill 不存在" }, 404);
    }

    return context.json({ skill: toSkillDetail(skill) });
  });

  app.get("/api/skills/:slug/download", async (context) => {
    if (!skillRepository) {
      return context.json({ error: "Not Found", message: "Skill 不存在" }, 404);
    }

    const skill = await skillRepository.recordDownload(context.req.param("slug"));
    if (!skill) {
      return context.json({ error: "Not Found", message: "Skill 不存在" }, 404);
    }

    return context.json({
      downloadUrl: skill.packageUrl,
      packageSha256: skill.packageSha256,
      packageSizeBytes: skill.packageSizeBytes,
    });
  });

  async function handleFieldMetadataSync(
    context: Context<{ Variables: ServerVariables }>,
    input: {
      label: string;
      sync: () => Promise<RebuildMetadataSyncResult>;
      afterSuccess?: () => void;
    },
  ) {
    if (!rebuildFieldMetadataRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await input.sync();
      input.afterSuccess?.();
      return context.json({
        ok: true,
        entity: result.entityName,
        fields: result.fieldCount,
        options: result.optionCount,
        updated_at: result.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] ${input.label} 字段元数据同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: `同步 ${input.label} 字段元数据失败` }, 502);
    }
  }

  app.post("/api/rebuild/supplygoods/fields/sync", async (context) => {
    return handleFieldMetadataSync(context, {
      label: "SupplyGoods",
      sync: () => syncSupplyGoodsFieldMetadata({
        metadataClient: rebuildMetadataClient,
        repository: rebuildFieldMetadataRepository!,
      }),
      afterSuccess: () => {
        rebuildSupplyGoodsClient.clearFieldCache?.();
        listSupplyGoodsFields.clearCache();
      },
    });
  });

  app.post("/api/rebuild/supplycompany/fields/sync", async (context) => {
    return handleFieldMetadataSync(context, {
      label: "SupplyCompany",
      sync: () => syncSupplyCompanyFieldMetadata({
        metadataClient: rebuildMetadataClient,
        repository: rebuildFieldMetadataRepository!,
      }),
      afterSuccess: () => {
        listSupplyCompanyFields.clearCache();
      },
    });
  });

  app.get("/api/rebuild/fields/options", async (context) => {
    if (!rebuildFieldMetadataRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const entityName = context.req.query("entity")?.trim() || "SupplyGoods";
    const fieldName = context.req.query("field")?.trim();
    if (!fieldName) {
      return context.json({ error: "Bad Request", message: "field 不能为空" }, 400);
    }

    const options = await rebuildFieldMetadataRepository.listFieldOptions(entityName, fieldName);
    return context.json({
      entity: entityName,
      field: fieldName,
      options: options.map(serializeFieldOption),
    });
  });

  app.get("/api/tickets", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const query = parseTicketQuery({
      status: context.req.query("status"),
      businessStatus: context.req.query("businessStatus"),
      q: context.req.query("q"),
      pageNo: context.req.query("pageNo"),
      pageSize: context.req.query("pageSize"),
    });
    return context.json(serializeTicketList(await ticketRepository.listTickets(query)));
  });

  app.post("/api/tickets/:supplyGoodsId/info-optimization/generate", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    const ticketSourcePayload = ticket.sourcePayload ?? {};
    const ticketPayload = ticket.payload ?? {};
    const sourcePayload = readRecordValue(ticketSourcePayload, "packages") ? ticketSourcePayload : ticketPayload;
    const originPackagesValue = readRecordValue(sourcePayload, "packages");

    const startedAt = new Date().toISOString();
    await ticketRepository.createActionRecord({
      supplyGoodsId,
      action: "info_optimization_started",
      origin: {
        infoOptimizationState: readRecordValue(ticket.payload, "infoOptimizationState"),
        infoOptimizationError: readRecordValue(ticket.payload, "infoOptimizationError"),
      },
      current: {
        infoOptimizationState: "running",
        infoOptimizationError: "",
        infoOptimizationStartedAt: startedAt,
      },
      operator: createTicketOperatorSnapshot(context.get("apiUser")),
      remark: "AI 优化开始，正在生成套餐名称建议",
    });

    try {
      const result = await optimizeLinKePayload(linKeSettings, sourcePayload);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "info_optimization_preview_generated",
        origin: {
          infoOptimizationState: "running",
          infoOptimizationError: readRecordValue(ticket.payload, "infoOptimizationError"),
        },
        current: {
          infoOptimizationState: "completed",
          infoOptimizationError: "",
          infoOptimizationCompletedAt: new Date().toISOString(),
          infoOptimizationChangeCount: result.changes.length,
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `AI 优化完成，生成 ${result.changes.length} 处建议，等待确认采用`,
      });
      return context.json({
        originPackages: displaySupplyGoodsPackages(originPackagesValue),
        optimizedPackages: displaySupplyGoodsPackages(readRecordValue(result.payload, "packages")),
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "info_optimization_failed",
        origin: {
          infoOptimizationState: "running",
          infoOptimizationError: readRecordValue(ticket.payload, "infoOptimizationError"),
        },
        current: {
          infoOptimizationState: "failed",
          infoOptimizationError: briefError,
          infoOptimizationFailedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `AI 优化失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[工单] 写入 AI 优化失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: getErrorMessage(error) }, 502);
    }
  });

  app.post("/api/tickets/:supplyGoodsId/info-optimization/confirm", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    const body = (await context.req.json().catch(() => null)) as unknown;
    if (!isRecord(body) || !isRecord(body.optimizedPackages)) {
      return context.json({ error: "Bad Request", message: "optimizedPackages 必须是 JSON 对象" }, 400);
    }
    const skipLinKeExternal = shouldSkipLinKeExternal(body);
    if (skipLinKeExternal && !isLinKeTestSkipEnabled()) {
      return context.json({ error: "Forbidden", message: "林客外部操作跳过模式未启用" }, 403);
    }
    const linKeDraftQueue = skipLinKeExternal ? null : resolveLinKeDraftQueue();
    if (!skipLinKeExternal && !linKeDraftQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    const sourcePayload = ticket.sourcePayload ?? ticket.payload;
    const sourcePackages = readRecordValue(sourcePayload, "packages");
    const currentPackages = readRecordValue(ticket.payload, "packages") ?? sourcePackages;
    const appliedPackages = applyEditablePackages(sourcePackages, body.optimizedPackages, currentPackages);

    const actionResult = await ticketRepository.createActionRecord({
      supplyGoodsId,
      action: "info_optimization_generated",
      origin: {
        packages: readRecordValue(ticket.payload, "packages"),
      },
      current: {
        packages: appliedPackages.packages,
      },
      operator: {
        source: "operator",
      },
      remark: "确认信息优化内容，等待创建林客草稿",
    });
    if (!actionResult) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    if (skipLinKeExternal) {
      const skippedActionResult = await recordSkippedLinKeDraftSuccess({
        ticketRepository,
        supplyGoodsId,
        payload: actionResult.ticket.payload,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
      });
      if (!skippedActionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(skippedActionResult.ticket),
        record: serializeTicketActionRecord(skippedActionResult.record),
        skippedLinKeExternal: true,
      });
    }

    const draftCookieValidation = await validateLinKeDraftCookie({
      linKeRepository: resolveLinKeRepository(),
      settings: linKeSettings,
      payload: actionResult.ticket.payload,
      checkCookieFn: checkLinKeCookie,
    });
    if (!draftCookieValidation.ok) {
      await recordLinKeDraftFailure({
        ticketRepository,
        supplyGoodsId,
        payload: actionResult.ticket.payload,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        message: draftCookieValidation.message,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入草稿 Cookie 校验失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json(
        {
          error: draftCookieValidation.status === 503 ? "Service Unavailable" : "Bad Request",
          message: draftCookieValidation.message,
        },
        draftCookieValidation.status,
      );
    }

    try {
      const jobId = await linKeDraftQueue!.addCreateDraftJob(supplyGoodsId);
      const startedActionResult = await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_draft_started",
        origin: {
          linkeDraftState: readRecordValue(actionResult.ticket.payload, "linkeDraftState"),
          linkeDraftJobId: readRecordValue(actionResult.ticket.payload, "linkeDraftJobId"),
          linkeDraftError: readRecordValue(actionResult.ticket.payload, "linkeDraftError"),
        },
        current: {
          linkeDraftState: "queued",
          linkeDraftJobId: jobId,
          linkeDraftError: "",
          linkeDraftStartedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客草稿创建任务已提交（任务 ${jobId}），等待后台执行`,
      });
      if (!startedActionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(startedActionResult.ticket),
        record: serializeTicketActionRecord(startedActionResult.record),
        jobId,
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_draft_failed",
        origin: {
          linkeDraftState: readRecordValue(actionResult.ticket.payload, "linkeDraftState"),
          linkeDraftJobId: readRecordValue(actionResult.ticket.payload, "linkeDraftJobId"),
          linkeDraftError: readRecordValue(actionResult.ticket.payload, "linkeDraftError"),
        },
        current: {
          linkeDraftState: "failed",
          linkeDraftError: briefError,
          linkeDraftFailedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客草稿任务入队失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入草稿入队失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: `林客草稿任务入队失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.get("/api/tickets/:supplyGoodsId/lin-ke-draft-jobs/:jobId", async (context) => {
    const linKeDraftQueue = resolveLinKeDraftQueue();
    if (!linKeDraftQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const jobId = context.req.param("jobId").trim();
    const status = await linKeDraftQueue.getCreateDraftJobStatus(jobId);
    if (!status) {
      return context.json({ error: "Not Found", message: "林客草稿任务不存在" }, 404);
    }
    return context.json(status);
  });

  app.post("/api/tickets/:supplyGoodsId/lin-ke-draft/retry", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    const body = (await context.req.json().catch(() => null)) as unknown;
    const skipLinKeExternal = shouldSkipLinKeExternal(body);
    if (skipLinKeExternal && !isLinKeTestSkipEnabled()) {
      return context.json({ error: "Forbidden", message: "林客外部操作跳过模式未启用" }, 403);
    }
    const linKeDraftQueue = skipLinKeExternal ? null : resolveLinKeDraftQueue();
    if (!skipLinKeExternal && !linKeDraftQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }
    if (!readRecordValue(ticket.payload, "packages")) {
      return context.json({ error: "Bad Request", message: "请先确认信息优化内容" }, 400);
    }

    if (skipLinKeExternal) {
      const skippedActionResult = await recordSkippedLinKeDraftSuccess({
        ticketRepository,
        supplyGoodsId,
        payload: ticket.payload,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
      });
      if (!skippedActionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(skippedActionResult.ticket),
        record: serializeTicketActionRecord(skippedActionResult.record),
        skippedLinKeExternal: true,
      });
    }

    const draftCookieValidation = await validateLinKeDraftCookie({
      linKeRepository: resolveLinKeRepository(),
      settings: linKeSettings,
      payload: ticket.payload,
      checkCookieFn: checkLinKeCookie,
    });
    if (!draftCookieValidation.ok) {
      await recordLinKeDraftFailure({
        ticketRepository,
        supplyGoodsId,
        payload: ticket.payload,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        message: draftCookieValidation.message,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入草稿重试 Cookie 校验失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json(
        {
          error: draftCookieValidation.status === 503 ? "Service Unavailable" : "Bad Request",
          message: draftCookieValidation.message,
        },
        draftCookieValidation.status,
      );
    }

    try {
      const jobId = await linKeDraftQueue!.addCreateDraftJob(supplyGoodsId);
      const actionResult = await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_draft_started",
        origin: {
          linkeDraftState: readRecordValue(ticket.payload, "linkeDraftState"),
          linkeDraftJobId: readRecordValue(ticket.payload, "linkeDraftJobId"),
          linkeDraftError: readRecordValue(ticket.payload, "linkeDraftError"),
        },
        current: {
          linkeDraftState: "queued",
          linkeDraftJobId: jobId,
          linkeDraftError: "",
          linkeDraftStartedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `已重新提交林客草稿创建任务（任务 ${jobId}）`,
      });
      if (!actionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(actionResult.ticket),
        record: serializeTicketActionRecord(actionResult.record),
        jobId,
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_draft_failed",
        origin: {
          linkeDraftState: readRecordValue(ticket.payload, "linkeDraftState"),
          linkeDraftJobId: readRecordValue(ticket.payload, "linkeDraftJobId"),
          linkeDraftError: readRecordValue(ticket.payload, "linkeDraftError"),
        },
        current: {
          linkeDraftState: "failed",
          linkeDraftError: briefError,
          linkeDraftFailedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客草稿任务入队失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入草稿重试失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: `林客草稿任务入队失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.post("/api/tickets/:supplyGoodsId/lin-ke-fee-setup/jobs", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    const body = (await context.req.json().catch(() => null)) as unknown;
    if (!isRecord(body)) {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON 对象" }, 400);
    }
    const skipLinKeExternal = shouldSkipLinKeExternal(body);
    if (skipLinKeExternal && !isLinKeTestSkipEnabled()) {
      return context.json({ error: "Forbidden", message: "林客外部操作跳过模式未启用" }, 403);
    }
    const linKeFeeSetupQueue = skipLinKeExternal ? null : resolveLinKeFeeSetupQueue();
    if (!skipLinKeExternal && !linKeFeeSetupQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }
    const validationMessage = validateLinKeFeeRates(body.rates);
    if (validationMessage) {
      return context.json({ error: "Bad Request", message: validationMessage }, 400);
    }
    const rates = normalizeLinKeFeeRates(body.rates);
    if (!rates) {
      return context.json({ error: "Bad Request", message: "费用比例格式无效" }, 400);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    const linkeGoodsId = typeof body.linkeGoodsId === "string" && body.linkeGoodsId.trim()
      ? body.linkeGoodsId.trim()
      : String(readRecordValue(ticket.payload, "linkeGoodsId") ?? "").trim();
    if (!linkeGoodsId) {
      return context.json({ error: "Bad Request", message: "linkeGoodsId 不能为空" }, 400);
    }
    const merchantId = resolveLinKeMerchantId(ticket.payload, ticket.sourcePayload ?? {});
    if (!merchantId) {
      return context.json({ error: "Bad Request", message: "company.guestId 不能为空" }, 400);
    }
    const requestMerchantId = typeof body.merchantId === "string" ? body.merchantId.trim() : "";
    if (!requestMerchantId) {
      return context.json({ error: "Bad Request", message: "merchantId 不能为空" }, 400);
    }
    if (requestMerchantId !== merchantId) {
      return context.json({ error: "Bad Request", message: "merchantId 与 company.guestId 不一致" }, 400);
    }

    if (skipLinKeExternal) {
      const skippedActionResult = await recordSkippedLinKeFeeSetupSuccess({
        ticketRepository,
        supplyGoodsId,
        ticketPayload: ticket.payload,
        linkeGoodsId,
        merchantId,
        rates,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
      });
      if (!skippedActionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(skippedActionResult.ticket),
        record: serializeTicketActionRecord(skippedActionResult.record),
        skippedLinKeExternal: true,
      });
    }

    try {
      const jobId = await linKeFeeSetupQueue!.addFeeSetupJob({
        supplyGoodsId,
        merchantId,
        linkeGoodsId,
        rates,
      });
      const actionResult = await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_fee_setup_started",
        origin: {
          linkeGoodsId: readRecordValue(ticket.payload, "linkeGoodsId"),
          linkeFeeRates: readRecordValue(ticket.payload, "linkeFeeRates"),
          linkeFeeSetupState: readRecordValue(ticket.payload, "linkeFeeSetupState"),
          linkeFeeSetupJobId: readRecordValue(ticket.payload, "linkeFeeSetupJobId"),
          linkeFeeSetupSaveSubmitted: readRecordValue(ticket.payload, "linkeFeeSetupSaveSubmitted"),
          linkeFeeSetupSaveVersion: readRecordValue(ticket.payload, "linkeFeeSetupSaveVersion"),
        },
        current: {
          linkeGoodsId,
          linkeMerchantId: merchantId,
          linkeFeeRates: rates,
          linkeFeeSetupState: "queued",
          linkeFeeSetupJobId: jobId,
          linkeFeeSetupError: "",
          linkeFeeSetupSaveSubmitted: false,
          linkeFeeSetupSaveVersion: "",
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `已提交林客费用设置任务（任务 ${jobId}）`,
      });
      if (!actionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(actionResult.ticket),
        record: serializeTicketActionRecord(actionResult.record),
        jobId,
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_fee_setup_failed",
        origin: {
          linkeGoodsId: readRecordValue(ticket.payload, "linkeGoodsId"),
          linkeFeeSetupState: readRecordValue(ticket.payload, "linkeFeeSetupState"),
          linkeFeeSetupError: readRecordValue(ticket.payload, "linkeFeeSetupError"),
        },
        current: {
          linkeGoodsId,
          linkeMerchantId: merchantId,
          linkeFeeRates: rates,
          linkeFeeSetupState: "failed",
          linkeFeeSetupError: briefError,
          linkeFeeSetupFailedAt: new Date().toISOString(),
          linkeFeeSetupSaveSubmitted: false,
          linkeFeeSetupSaveVersion: "",
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客费用设置任务入队失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入费用设置入队失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: `林客费用设置任务入队失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.get("/api/tickets/:supplyGoodsId/lin-ke-fee-setup/jobs/:jobId", async (context) => {
    const linKeFeeSetupQueue = resolveLinKeFeeSetupQueue();
    if (!linKeFeeSetupQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const jobId = context.req.param("jobId").trim();
    const status = await linKeFeeSetupQueue.getFeeSetupJobStatus(jobId);
    if (!status) {
      return context.json({ error: "Not Found", message: "林客费用设置任务不存在" }, 404);
    }
    return context.json(status);
  });

  app.post("/api/tickets/:supplyGoodsId/lin-ke-fee-setup/confirm", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    const body = (await context.req.json().catch(() => null)) as unknown;
    const skipLinKeExternal = shouldSkipLinKeExternal(body);
    if (skipLinKeExternal && !isLinKeTestSkipEnabled()) {
      return context.json({ error: "Forbidden", message: "林客外部操作跳过模式未启用" }, 403);
    }
    const linKeFeeSetupQueue = skipLinKeExternal ? null : resolveLinKeFeeSetupQueue();
    if (!skipLinKeExternal && !linKeFeeSetupQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }
    const feeSetupState = String(readRecordValue(ticket.payload, "linkeFeeSetupState") ?? "").trim();
    const feeSettingUrl = String(readRecordValue(ticket.payload, "linkeFeeSettingUrl") ?? "").trim();
    const saveSubmitted = readRecordValue(ticket.payload, "linkeFeeSetupSaveSubmitted") === true;
    const saveVersion = String(readRecordValue(ticket.payload, "linkeFeeSetupSaveVersion") ?? "").trim();
    if (
      feeSetupState !== "completed"
      || !feeSettingUrl
      || !saveSubmitted
      || saveVersion !== LIN_KE_FEE_SETUP_SAVE_VERSION
    ) {
      return context.json({ error: "Bad Request", message: "请先点击确认同步完成林客费用设置后再核对确认" }, 400);
    }

    if (skipLinKeExternal) {
      const skippedActionResult = await recordSkippedLinKeProductTracking({
        ticketRepository,
        supplyGoodsId,
        payload: ticket.payload,
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
      });
      if (!skippedActionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(skippedActionResult.ticket),
        record: serializeTicketActionRecord(skippedActionResult.record),
        skippedLinKeExternal: true,
      });
    }

    try {
      const now = new Date().toISOString();
      const trackingPayload = buildInitialProductTrackingPayload(now);
      const jobId = await linKeFeeSetupQueue!.addProductTrackingJob({
        supplyGoodsId,
        startedAt: now,
        checkCount: 1,
      });
      const actionResult = await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "commission_configured",
        origin: {
          commissionConfigured: readRecordValue(ticket.payload, "commissionConfigured"),
          linkeProductTrackingState: readRecordValue(ticket.payload, "linkeProductTrackingState"),
          linkeProductTrackingJobId: readRecordValue(ticket.payload, "linkeProductTrackingJobId"),
        },
        current: {
          commissionConfigured: true,
          commissionConfiguredAt: now,
          linkeFeeSetupConfirmedAt: now,
          linkeProductTrackingState: "queued",
          linkeProductTrackingJobId: jobId,
          linkeProductTrackingError: "",
          ...trackingPayload,
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `已确认林客费用同步，开始自动追踪商品状态（任务 ${jobId}）`,
      });
      if (!actionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(actionResult.ticket),
        record: serializeTicketActionRecord(actionResult.record),
        jobId,
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_product_tracking_failed",
        origin: {
          linkeProductTrackingState: readRecordValue(ticket.payload, "linkeProductTrackingState"),
          linkeProductTrackingJobId: readRecordValue(ticket.payload, "linkeProductTrackingJobId"),
          linkeProductTrackingError: readRecordValue(ticket.payload, "linkeProductTrackingError"),
        },
        current: {
          linkeProductTrackingState: "failed",
          linkeProductTrackingError: briefError,
          linkeProductTrackingFailedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客商品状态追踪任务入队失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入商品状态追踪入队失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: `林客商品状态追踪任务入队失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.post("/api/tickets/:supplyGoodsId/lin-ke-product-tracking/retry", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    const linKeFeeSetupQueue = resolveLinKeFeeSetupQueue();
    if (!linKeFeeSetupQueue) {
      return context.json({ error: "Service Unavailable", message: "REDIS_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }
    if (!resolveLinKeMerchantId(ticket.payload, ticket.sourcePayload ?? {})) {
      return context.json({ error: "Bad Request", message: "company.guestId 不能为空" }, 400);
    }
    if (!String(readRecordValue(ticket.payload, "linkeGoodsId") ?? "").trim()) {
      return context.json({ error: "Bad Request", message: "linkeGoodsId 不能为空" }, 400);
    }

    try {
      const now = new Date().toISOString();
      const trackingPayload = buildInitialProductTrackingPayload(now);
      const jobId = await linKeFeeSetupQueue.addProductTrackingJob({
        supplyGoodsId,
        startedAt: now,
        checkCount: 1,
      });
      const actionResult = await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_product_tracking_started",
        origin: {
          linkeProductTrackingState: readRecordValue(ticket.payload, "linkeProductTrackingState"),
          linkeProductTrackingJobId: readRecordValue(ticket.payload, "linkeProductTrackingJobId"),
          linkeProductTrackingError: readRecordValue(ticket.payload, "linkeProductTrackingError"),
        },
        current: {
          linkeProductTrackingState: "queued",
          linkeProductTrackingJobId: jobId,
          linkeProductTrackingError: "",
          ...trackingPayload,
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `已重新提交林客商品状态追踪任务（任务 ${jobId}）`,
      });
      if (!actionResult) {
        return context.json({ error: "Not Found", message: "工单不存在" }, 404);
      }
      return context.json({
        ticket: serializeTicket(actionResult.ticket),
        record: serializeTicketActionRecord(actionResult.record),
        jobId,
      });
    } catch (error) {
      const briefError = getBriefErrorMessage(error);
      await ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "lin_ke_product_tracking_failed",
        origin: {
          linkeProductTrackingState: readRecordValue(ticket.payload, "linkeProductTrackingState"),
          linkeProductTrackingJobId: readRecordValue(ticket.payload, "linkeProductTrackingJobId"),
          linkeProductTrackingError: readRecordValue(ticket.payload, "linkeProductTrackingError"),
        },
        current: {
          linkeProductTrackingState: "failed",
          linkeProductTrackingError: briefError,
          linkeProductTrackingFailedAt: new Date().toISOString(),
        },
        operator: createTicketOperatorSnapshot(context.get("apiUser")),
        remark: `林客商品状态追踪任务入队失败：${briefError}`,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入商品状态追踪重试失败日志失败: ${getBriefErrorMessage(recordError)}`);
      });
      return context.json({ error: "Bad Gateway", message: `林客商品状态追踪任务入队失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.get("/api/tickets/metadata", async (context) => {
    if (!rebuildFieldMetadataRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    return context.json(await buildTicketMetadataMap(rebuildFieldMetadataRepository, listSupplyGoodsFields));
  });

  app.get("/api/tickets/:supplyGoodsId", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    return context.json({
      ticket: serializeTicket(ticket),
    });
  });

  app.get("/api/tickets/:supplyGoodsId/action-records", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const ticket = await ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    return context.json({
      records: (await ticketRepository.listActionRecords(supplyGoodsId)).map(serializeTicketActionRecord),
    });
  });

  app.get("/api/rebuild/references/:entityName/metadata", async (context) => {
    const entityName = context.req.param("entityName").trim();
    if (entityName !== "SupplyCompany" && entityName !== "SupplyHost") {
      return context.json({ error: "Bad Request", message: "仅支持查询 SupplyCompany 或 SupplyHost" }, 400);
    }
    const listFields = entityName === "SupplyCompany" ? listSupplyCompanyFields : listSupplyHostFields;
    const metadata = await buildRebuildReferenceMetadataFieldsMap(rebuildFieldMetadataRepository, entityName, listFields);
    return context.json({
      entity: entityName,
      ...metadata,
    });
  });

  app.get("/api/rebuild/references/:entityName/:recordId", async (context) => {
    const entityName = context.req.param("entityName").trim();
    const recordId = context.req.param("recordId").trim();
    if (!recordId) {
      return context.json({ error: "Bad Request", message: "记录 ID 不能为空" }, 400);
    }
    if (entityName !== "SupplyCompany" && entityName !== "SupplyHost") {
      return context.json({ error: "Bad Request", message: "仅支持查询 SupplyCompany 或 SupplyHost" }, 400);
    }
    if (!rebuildSupplierRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }
    try {
      if (entityName === "SupplyCompany") {
        if (!rebuildSupplierRepository.findSupplyCompany) {
          return context.json({ error: "Service Unavailable", message: "SupplyCompany 查询不可用" }, 503);
        }
        const record = await rebuildSupplierRepository.findSupplyCompany(recordId);
        if (!record) {
          return context.json({ error: "Not Found", message: "SupplyCompany 记录不存在" }, 404);
        }
        return context.json({
          entity: entityName,
          id: recordId,
          payload: record.payload,
        });
      }

      if (entityName === "SupplyHost") {
        if (!rebuildSupplierRepository.findSupplyHost) {
          return context.json({ error: "Service Unavailable", message: "SupplyHost 查询不可用" }, 503);
        }
        const record = await rebuildSupplierRepository.findSupplyHost(recordId);
        if (!record) {
          return context.json({ error: "Not Found", message: "SupplyHost 记录不存在" }, 404);
        }
        return context.json({
          entity: entityName,
          id: recordId,
          payload: record.payload,
        });
      }
    } catch (error) {
      console.error(`[REBUILD] 查询 ${entityName} 详情失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: `查询 ${entityName} 详情失败：${getErrorMessage(error)}` }, 502);
    }
  });

  app.post("/api/tickets/:supplyGoodsId/action-records", async (context) => {
    if (!ticketRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    const supplyGoodsId = context.req.param("supplyGoodsId").trim();
    const parsed = await parseTicketActionRecordBody(context);
    if (!parsed.ok) {
      return context.json({ error: "Bad Request", message: parsed.message }, 400);
    }

    const result = await ticketRepository.createActionRecord({
      supplyGoodsId,
      ...parsed.value,
      operator: createTicketOperatorSnapshot(context.get("apiUser")),
    });
    if (!result) {
      return context.json({ error: "Not Found", message: "工单不存在" }, 404);
    }

    return context.json({
      ticket: serializeTicket(result.ticket),
      record: serializeTicketActionRecord(result.record),
    });
  });

  app.get("/api/me", async (context) => {
    return context.json({ user: context.get("apiUser") });
  });

  app.notFound((context) => {
    return context.json(
      {
        error: "Not Found",
        message: "请求的资源不存在",
      },
      404,
    );
  });

  return app;
}

export type ServerApp = ReturnType<typeof createServerApp>;

interface CachedRebuildFieldLoader {
  (): Promise<RebuildFieldMetadata[]>;
  clearCache: () => void;
}

const SUPPLY_GOODS_FIELD_CACHE_TTL_MS = 5 * 60 * 1000;

function createCachedRebuildFieldLoader(
  repository: RebuildFieldMetadataRepository | null,
  entityName: string,
): CachedRebuildFieldLoader {
  let cache: { expiresAt: number; fields: RebuildFieldMetadata[] } | null = null;
  const loader = async () => {
    if (!repository) return [];
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return cache.fields;
    }

    const fields = await repository.listFieldsByEntity(entityName);
    cache = {
      fields,
      expiresAt: now + SUPPLY_GOODS_FIELD_CACHE_TTL_MS,
    };
    return fields;
  };
  loader.clearCache = () => {
    cache = null;
  };
  return loader;
}

async function buildTicketFieldOptionsMap(
  repository: RebuildFieldMetadataRepository | null,
  listSupplyGoodsFields: CachedRebuildFieldLoader,
): Promise<TicketFieldOptionsApiMap> {
  if (!repository) return {};
  const fields = await listSupplyGoodsFields();
  return buildRebuildFieldOptionsMap(repository, "SupplyGoods", fields);
}

async function buildRebuildFieldOptionsMap(
  repository: RebuildFieldMetadataRepository,
  entityName: string,
  fields: RebuildFieldMetadata[],
): Promise<TicketFieldOptionsApiMap> {
  const entries = await Promise.all(
    getSupplyGoodsOptionFieldNames(fields).map(async (fieldName) => {
      const options = await repository.listFieldOptions(entityName, fieldName);
      return [fieldName, options.map(serializeFieldOption)] as const;
    }),
  );
  return Object.fromEntries(entries.filter(([, options]) => options.length > 0));
}

async function buildTicketMetadataMap(
  repository: RebuildFieldMetadataRepository | null,
  listSupplyGoodsFields: CachedRebuildFieldLoader,
): Promise<{
  field_options: TicketFieldOptionsApiMap;
  field_metadata: TicketFieldMetadataApiMap;
}> {
  if (!repository) {
    return {
      field_options: {},
      field_metadata: {},
    };
  }
  const allFields = await listSupplyGoodsFields();
  return {
    field_options: await buildTicketFieldOptionsMap(repository, listSupplyGoodsFields),
    field_metadata: serializeFieldMetadata(allFields),
  };
}

async function buildRebuildReferenceMetadataFieldsMap(
  repository: RebuildFieldMetadataRepository | null,
  entityName: string,
  listFields: CachedRebuildFieldLoader,
): Promise<{
  field_options: TicketFieldOptionsApiMap;
  field_metadata: TicketFieldMetadataApiMap;
}> {
  if (!repository) {
    return {
      field_options: {},
      field_metadata: {},
    };
  }
  const fields = await listFields();
  return {
    field_options: await buildRebuildFieldOptionsMap(repository, entityName, fields),
    field_metadata: serializeFieldMetadata(fields),
  };
}
