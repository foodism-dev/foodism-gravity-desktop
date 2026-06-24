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
  extractSupplyGoodsRecordId,
  getDefaultSupplyGoodsRecordRepository,
  syncSupplyGoodsFromCallback,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "./rebuild/supplygoods.ts";
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
  rebuildSupplyGoodsClient?: RebuildSupplyGoodsClient;
  supplyGoodsRecordRepository?: SupplyGoodsRecordRepository | null;
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

export function createServerApp(options: ServerAppOptions = {}) {
  const app = new Hono<{ Variables: ServerVariables }>();
  const jwtSecret = getJwtSecret();
  const userRepository = options.userRepository ?? getDefaultUserRepository();
  const rebuildSupplyGoodsClient = options.rebuildSupplyGoodsClient ?? createRebuildSupplyGoodsClient();
  const supplyGoodsRecordRepository =
    options.supplyGoodsRecordRepository ?? getDefaultSupplyGoodsRecordRepository();

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

    const recordId = extractSupplyGoodsRecordId(body);
    if (!recordId) {
      return context.json({ error: "Bad Request", message: "record_id 不能为空" }, 400);
    }

    if (!supplyGoodsRecordRepository) {
      return context.json({ error: "Service Unavailable", message: "DATABASE_URL 未配置" }, 503);
    }

    try {
      const result = await syncSupplyGoodsFromCallback({
        recordId,
        rebuildClient: rebuildSupplyGoodsClient,
        repository: supplyGoodsRecordRepository,
      });
      console.log(`[REBUILD] SupplyGoods 已同步: ${result.recordId}`);
      return context.json({
        ok: true,
        record_id: result.recordId,
        synced_at: result.syncedAt.toISOString(),
      });
    } catch (error) {
      console.error(`[REBUILD] SupplyGoods 回调同步失败: ${getErrorMessage(error)}`);
      return context.json({ error: "Bad Gateway", message: "同步 SupplyGoods 失败" }, 502);
    }
  }

  app.post("/api/rebuild/supplygoods/callback", handleSupplyGoodsCallback);
  app.post("/api/m/rebuild/saveReportSupplierGoodsInfo", handleSupplyGoodsCallback);

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
