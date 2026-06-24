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
  resolveUserFromTokenPayload,
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
import {
  createRebuildMetadataClient,
  getDefaultRebuildFieldMetadataRepository,
  getSupplyGoodsOptionFieldNames,
  syncSupplyGoodsFieldMetadata,
  type RebuildFieldMetadata,
  type RebuildFieldMetadataRepository,
  type RebuildMetadataClient,
} from "./rebuild/fields.ts";
import {
  getDefaultTicketRepository,
  parseTicketQuery,
  serializeFieldOption,
  serializeFieldMetadata,
  serializeTicket,
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
}

interface ServerAppOptions {
  userRepository?: UserRepository | null;
  skillRepository?: SkillRepository | null;
  skillPublisher?: SkillPublisher | null;
  internalApiToken?: string | null;
  rebuildSupplyGoodsClient?: RebuildSupplyGoodsClient;
  rebuildMetadataClient?: RebuildMetadataClient;
  supplyGoodsRecordRepository?: SupplyGoodsRecordRepository | null;
  rebuildFieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  ticketRepository?: TicketRepository | null;
}

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isAuthorizedInternalRequest(context: Context, expectedToken: string): boolean {
  const token = context.req.header("Authorization")?.trim();
  return Boolean(token && token === `Bearer ${expectedToken}`);
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
  const listSupplyGoodsFields = createCachedSupplyGoodsFieldLoader(rebuildFieldMetadataRepository);
  const ticketRepository = options.ticketRepository ?? getDefaultTicketRepository();

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
  app.post("/sso_login", (context) => handleSsoInternalAuth(context, "sso_login"));

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
        rebuildClient: rebuildSupplyGoodsClient,
        repository: supplyGoodsRecordRepository,
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

  app.post("/api/rebuild/supplygoods/fields/sync", async (context) => {
    if (!rebuildFieldMetadataRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await syncSupplyGoodsFieldMetadata({
        metadataClient: rebuildMetadataClient,
        repository: rebuildFieldMetadataRepository,
      });
      rebuildSupplyGoodsClient.clearFieldCache?.();
      listSupplyGoodsFields.clearCache();
      return context.json({
        ok: true,
        entity: result.entityName,
        fields: result.fieldCount,
        options: result.optionCount,
        updated_at: result.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] SupplyGoods 字段元数据同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: "同步 SupplyGoods 字段元数据失败" }, 502);
    }
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
      approvalState: context.req.query("approvalState"),
      q: context.req.query("q"),
      pageNo: context.req.query("pageNo"),
      pageSize: context.req.query("pageSize"),
    });
    return context.json(serializeTicketList(await ticketRepository.listTickets(query)));
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
      field_options: await buildTicketFieldOptionsMap(rebuildFieldMetadataRepository, listSupplyGoodsFields),
      field_metadata: await buildTicketFieldMetadataMap(rebuildFieldMetadataRepository, ticket.payload, listSupplyGoodsFields),
    });
  });

  app.use(
    "/api/me",
    jwt({
      secret: jwtSecret,
      alg: "HS256",
    }),
  );

  app.get("/api/me", async (context) => {
    const payload = context.get("jwtPayload");
    return context.json({ user: await resolveUserFromTokenPayload(payload, userRepository) });
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

interface CachedSupplyGoodsFieldLoader {
  (): Promise<RebuildFieldMetadata[]>;
  clearCache: () => void;
}

const SUPPLY_GOODS_FIELD_CACHE_TTL_MS = 5 * 60 * 1000;

function createCachedSupplyGoodsFieldLoader(
  repository: RebuildFieldMetadataRepository | null,
): CachedSupplyGoodsFieldLoader {
  let cache: { expiresAt: number; fields: RebuildFieldMetadata[] } | null = null;
  const loader = async () => {
    if (!repository) return [];
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return cache.fields;
    }

    const fields = await repository.listFieldsByEntity("SupplyGoods");
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
  listSupplyGoodsFields: CachedSupplyGoodsFieldLoader,
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

async function buildTicketFieldMetadataMap(
  repository: RebuildFieldMetadataRepository | null,
  payload: Record<string, unknown>,
  listSupplyGoodsFields: CachedSupplyGoodsFieldLoader,
): Promise<TicketFieldMetadataApiMap> {
  if (!repository) return {};
  const allFields = await listSupplyGoodsFields();
  const optionFieldNames = getSupplyGoodsOptionFieldNames(allFields);
  const selectedFields = await repository.listFields("SupplyGoods", [
    ...new Set([...Object.keys(payload).map(normalizePayloadFieldName), ...optionFieldNames]),
  ]);
  return serializeFieldMetadata(selectedFields);
}

function normalizePayloadFieldName(fieldName: string): string {
  return fieldName.includes(".") ? fieldName.split(".")[0] ?? fieldName : fieldName;
}
