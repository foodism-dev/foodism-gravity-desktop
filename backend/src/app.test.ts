import { describe, expect, test } from "bun:test";

import { createServerApp } from "./app.ts";
import type { ApiUser } from "./auth.ts";
import { SUPPLY_GOODS_SYNC_FIELDS } from "./rebuild/supplygoods.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "./rebuild/supplygoods.ts";
import type { UserRepository, UserWithPasswordHash } from "./users.ts";

process.env.DATABASE_URL = "";
process.env.PROMA_SERVER_JWT_SECRET = "";

interface StatusResponse {
  name: string;
  status: string;
  uptime: number;
  timestamp: string;
}

interface NotFoundResponse {
  error: string;
  message: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface ErrorResponse {
  error: string;
  message: string;
}

interface SupplyGoodsCallbackResponse {
  ok: boolean;
  record_id: string;
  synced_at: string;
}

function createMemoryUserRepository(user: UserWithPasswordHash): UserRepository {
  let storedUser = user;
  return {
    async findById(id: string): Promise<ApiUser | null> {
      return storedUser.id === id
        ? {
            id: storedUser.id,
            username: storedUser.username,
            displayName: "数据库用户",
          }
        : null;
    },

    async findByUsername(username: string): Promise<UserWithPasswordHash | null> {
      return storedUser.username === username ? storedUser : null;
    },

    async ensureSsoUser(ssoUser: ApiUser): Promise<ApiUser> {
      storedUser = {
        ...storedUser,
        id: storedUser.username === ssoUser.username ? storedUser.id : ssoUser.id,
        username: ssoUser.username,
        displayName: ssoUser.displayName,
      };
      return {
        id: storedUser.id,
        username: storedUser.username,
        displayName: storedUser.displayName,
      };
    },
  };
}

function createMemorySupplyGoodsRepository(): {
  repository: SupplyGoodsRecordRepository;
  saved: SupplyGoodsRecordUpsertInput[];
} {
  const saved: SupplyGoodsRecordUpsertInput[] = [];
  return {
    saved,
    repository: {
      async upsertRecord(input: SupplyGoodsRecordUpsertInput): Promise<void> {
        saved.push(input);
      },
    },
  };
}

describe("server app", () => {
  test("Given SupplyGoods sync fields, When querying REBUILD, Then it requests rich record data", () => {
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("mainPic");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("rbimages");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("detailImages");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("company.SupplyCompanyId");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("rbhost.hostName");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("supplyPrice");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("settleType.text");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("OAApprovalNo");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("OAApprovalType");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("approvalId");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("rejectRemark");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("bdAuditor");
    expect(new Set(SUPPLY_GOODS_SYNC_FIELDS).size).toBe(SUPPLY_GOODS_SYNC_FIELDS.length);
  });

  test("Given the server is running, When health is requested, Then it returns ok", async () => {
    const app = createServerApp();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("Given the server is running, When status is requested, Then it returns service metadata", async () => {
    const app = createServerApp();

    const response = await app.request("/api/status");
    const body = (await response.json()) as StatusResponse;

    expect(response.status).toBe(200);
    expect(body.name).toBe("@proma/server");
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");
  });

  test("Given an unknown route, When it is requested, Then it returns a JSON 404", async () => {
    const app = createServerApp();

    const response = await app.request("/missing");
    const body = (await response.json()) as NotFoundResponse;

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("请求的资源不存在");
  });

  test("Given valid credentials, When login is requested, Then it returns a jwt token and user info", async () => {
    const app = createServerApp();

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "foodism123" }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user).toEqual({
      id: "admin",
      username: "admin",
      displayName: "管理员",
    });
  });

  test("Given invalid credentials, When login is requested, Then it rejects the request", async () => {
    const app = createServerApp();

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("账号或密码错误");
  });

  test("Given no token, When user info is requested, Then it rejects the request", async () => {
    const app = createServerApp();

    const response = await app.request("/api/me");

    expect(response.status).toBe(401);
  });

  test("Given a valid token, When user info is requested, Then it returns current user info", async () => {
    const app = createServerApp();

    const loginResponse = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "foodism123" }),
    });
    const loginBody = (await loginResponse.json()) as LoginResponse;

    const response = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = (await response.json()) as MeResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "admin",
      username: "admin",
      displayName: "管理员",
    });
  });

  test("Given a user repository, When login is requested, Then it verifies the stored password hash", async () => {
    const passwordHash = await Bun.password.hash("secret-password");
    const app = createServerApp({
      userRepository: createMemoryUserRepository({
        id: "11111111-1111-1111-1111-111111111111",
        username: "pg-user",
        displayName: "PG 用户",
        passwordHash,
      }),
    });

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pg-user", password: "secret-password" }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      username: "pg-user",
      displayName: "PG 用户",
    });
  });

  test("Given a valid token and user repository, When user info is requested, Then it returns the latest stored user info", async () => {
    const passwordHash = await Bun.password.hash("secret-password");
    const app = createServerApp({
      userRepository: createMemoryUserRepository({
        id: "11111111-1111-1111-1111-111111111111",
        username: "pg-user",
        displayName: "PG 用户",
        passwordHash,
      }),
    });

    const loginResponse = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pg-user", password: "secret-password" }),
    });
    const loginBody = (await loginResponse.json()) as LoginResponse;

    const response = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = (await response.json()) as MeResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      username: "pg-user",
      displayName: "数据库用户",
    });
  });

  test("Given an uninitialized SSO account, When create_user is requested, Then it creates a jwt session", async () => {
    const app = createServerApp({ userRepository: null });

    const response = await app.request("/create_user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: {
          id: "sso-user-1",
          username: "zhangsan",
          displayName: "张三",
        },
      }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.user).toEqual({
      id: "sso-user-1",
      username: "zhangsan",
      displayName: "张三",
    });
  });

  test("Given an initialized SSO account, When sso_login is requested, Then it upserts user and returns a jwt session", async () => {
    const passwordHash = await Bun.password.hash("secret-password");
    const app = createServerApp({
      userRepository: createMemoryUserRepository({
        id: "11111111-1111-1111-1111-111111111111",
        username: "zhangsan",
        displayName: "旧名称",
        passwordHash,
      }),
    });

    const response = await app.request("/sso_login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: {
          account: {
            sub: "sso-user-1",
            preferred_username: "zhangsan",
            display_name: "张三",
          },
        },
      }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      username: "zhangsan",
      displayName: "张三",
    });
  });

  test("Given a SupplyGoods callback, When record_id is provided, Then it refreshes and saves the latest REBUILD record", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const queriedIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(recordId: string): Promise<Record<string, unknown>> {
        queriedIds.push(recordId);
        return {
          SupplyGoodsId: recordId,
          goodsName: "测试商品",
          approvalState: { value: 2, text: "审批中" },
        };
      },
    };
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      supplyGoodsRecordRepository: repository,
    });

    const response = await app.request("/api/rebuild/supplygoods/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record_id: "944-019eee7db58948ec" }),
    });
    const body = (await response.json()) as SupplyGoodsCallbackResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.record_id).toBe("944-019eee7db58948ec");
    expect(typeof body.synced_at).toBe("string");
    expect(queriedIds).toEqual(["944-019eee7db58948ec"]);
    expect(saved).toHaveLength(1);
    const savedRecord = saved[0];
    expect(savedRecord).toBeDefined();
    expect(savedRecord?.recordId).toBe("944-019eee7db58948ec");
    expect(savedRecord?.payload).toEqual({
      SupplyGoodsId: "944-019eee7db58948ec",
      goodsName: "测试商品",
      approvalState: { value: 2, text: "审批中" },
    });
  });

  test("Given a REBUILD SupplyGoods hook callback, When primaryId is provided, Then the compatible URL also syncs the record", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const queriedIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(recordId: string): Promise<Record<string, unknown>> {
        queriedIds.push(recordId);
        return {
          SupplyGoodsId: recordId,
          goodsName: "兼容路径商品",
        };
      },
    };
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      supplyGoodsRecordRepository: repository,
    });

    const response = await app.request("/api/m/rebuild/saveReportSupplierGoodsInfo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primaryId: "944-compatible" }),
    });
    const body = (await response.json()) as SupplyGoodsCallbackResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.record_id).toBe("944-compatible");
    expect(queriedIds).toEqual(["944-compatible"]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.payload).toEqual({
      SupplyGoodsId: "944-compatible",
      goodsName: "兼容路径商品",
    });
  });

  test("Given a SupplyGoods callback, When record_id is missing, Then it rejects the request", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(): Promise<Record<string, unknown>> {
        throw new Error("不应该查询 REBUILD");
      },
    };
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      supplyGoodsRecordRepository: repository,
    });

    const response = await app.request("/api/rebuild/supplygoods/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(body.message).toBe("record_id 不能为空");
    expect(saved).toHaveLength(0);
  });
});
