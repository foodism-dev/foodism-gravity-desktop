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
  extractSupplyGoodsId,
  getDefaultSupplyGoodsRecordRepository,
  syncSupplyGoodsFromCallback,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "./rebuild/supplygoods.ts";
import { getDefaultRebuildAssetUploader, type RebuildAssetUploader } from "./rebuild/assets.ts";
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
} from "./rebuild/fields.ts";
import {
  getDefaultTicketRepository,
  parseTicketQuery,
  serializeFieldOption,
  serializeFieldMetadata,
  serializeTicket,
  serializeTicketActionRecord,
  serializeTicketList,
  type TicketFieldMetadataApiMap,
  type TicketFieldOptionsApiMap,
  type TicketRepository,
} from "./tickets.ts";
import { getDefaultSkillPublisher, sha256Bytes, type SkillPublisher } from "./skill-publisher.ts";
import { getDefaultSkillRepository, type MarketSkill, type SkillRepository } from "./skills.ts";
import { getDefaultUserRepository, type UserRepository } from "./users.ts";

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
  supplyGoodsRecordRepository?: SupplyGoodsRecordRepository | null;
  rebuildFieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  ticketRepository?: TicketRepository | null;
  fetchImpl?: FetchLike;
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

function logSsoPayload(body: unknown, authAction: "create_user" | "sso_login"): void {
  const sanitized = sanitizeForLog(body);
  console.log(`[认证] SSO ${authAction} 请求 payload（已脱敏）: ${stringifyForLog(sanitized)}`);
  console.log(`[认证] SSO ${authAction} 顶层字段: ${getRecordKeys(body)}`);
  console.log(`[认证] SSO ${authAction} user 字段: ${getRecordKeys(getNestedRecord(body, ["user"]))}`);
  console.log(`[认证] SSO ${authAction} account 字段: ${getRecordKeys(getNestedRecord(body, ["account"]))}`);
  console.log(`[认证] SSO ${authAction} account.account 字段: ${getRecordKeys(getNestedRecord(body, ["account", "account"]))}`);
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
  const ensureSupplyCompanyFields = createCachedSupplyCompanyFieldSyncer({
    metadataClient: rebuildMetadataClient,
    repository: rebuildFieldMetadataRepository,
  });
  const rebuildAssetUploader = options.rebuildAssetUploader ?? getDefaultRebuildAssetUploader();
  const ticketRepository = options.ticketRepository ?? getDefaultTicketRepository();
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

  app.use("/api/*", cors());

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
        onSupplyCompanyDiscovered: async () => {
          await ensureSupplyCompanyFields();
          listSupplyCompanyFields.clearCache();
        },
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

  app.post("/api/rebuild/supplygoods/callback", handleSupplyGoodsCallback);
  app.post("/api/m/rebuild/saveReportSupplierGoodsInfo", handleSupplyGoodsCallback);

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
        ensureSupplyCompanyFields.clearCache();
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
const SUPPLY_COMPANY_FIELD_SYNC_CACHE_TTL_MS = 5 * 60 * 1000;

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

interface CachedSupplyCompanyFieldSyncer {
  (): Promise<void>;
  clearCache: () => void;
}

function createCachedSupplyCompanyFieldSyncer(input: {
  metadataClient: RebuildMetadataClient;
  repository: RebuildFieldMetadataRepository | null;
}): CachedSupplyCompanyFieldSyncer {
  let expiresAt = 0;

  const syncer = async () => {
    if (!input.repository) return;
    const now = Date.now();
    if (expiresAt > now) return;

    try {
      await syncSupplyCompanyFieldMetadata({
        metadataClient: input.metadataClient,
        repository: input.repository,
      });
      expiresAt = now + SUPPLY_COMPANY_FIELD_SYNC_CACHE_TTL_MS;
    } catch (error) {
      console.warn(`[REBUILD] SupplyCompany 字段元数据自动同步跳过: ${getErrorMessage(error)}`);
    }
  };

  syncer.clearCache = () => {
    expiresAt = 0;
  };
  return syncer;
}

async function buildTicketFieldOptionsMap(
  repository: RebuildFieldMetadataRepository | null,
  listSupplyGoodsFields: CachedRebuildFieldLoader,
): Promise<TicketFieldOptionsApiMap> {
  if (!repository) return {};
  const fields = await listSupplyGoodsFields();
  const entries = await Promise.all(
    getSupplyGoodsOptionFieldNames(fields).map(async (fieldName) => {
      const options = await repository.listFieldOptions("SupplyGoods", fieldName);
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
