import { describe, expect, test } from "bun:test";

import { createServerApp } from "./app.ts";
import type { ApiUser } from "./auth.ts";
import {
  normalizeRebuildClassificationOptions,
  normalizeRebuildFieldOptions,
} from "./rebuild/fields.ts";
import type {
  RebuildFieldMetadata,
  RebuildFieldMetadataRepository,
  RebuildFieldOptionMetadata,
  RebuildMetadataClient,
} from "./rebuild/fields.ts";
import { SUPPLY_GOODS_SYNC_FIELDS } from "./rebuild/supplygoods.ts";
import { createRebuildSupplyGoodsClient } from "./rebuild/supplygoods.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "./rebuild/supplygoods.ts";
import type { RebuildAssetUploader } from "./rebuild/assets.ts";
import type { PublishSkillPackageInput, SkillPublisher } from "./skill-publisher.ts";
import type { TicketQuery, TicketRepository, TicketWithSupplyGoods } from "./tickets.ts";
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

interface MarketSkillListResponse {
  skills: Array<{
    slug: string;
    name: string;
    summary: string | null;
    icon: string | null;
    tags: string[];
    packageSha256: string;
    packageSizeBytes: number;
    downloadCount: number;
    updatedAt: string;
  }>;
}

interface MarketSkillDetailResponse {
  skill: {
    slug: string;
    name: string;
    summary: string | null;
    description: string | null;
    icon: string | null;
    tags: string[];
    packageSha256: string;
    packageSizeBytes: number;
    unpackedSizeBytes: number | null;
    fileCount: number | null;
    manifest: Record<string, unknown>;
    downloadCount: number;
    updatedAt: string;
  };
}

interface MarketSkillDownloadResponse {
  downloadUrl: string;
  packageSha256: string;
  packageSizeBytes: number;
}

interface PublishSkillResponse {
  packageUrl: string;
  skill: MarketSkillDetailResponse["skill"];
}

interface SupplyGoodsCallbackResponse {
  ok: boolean;
  supply_goods_id: string;
  updated_at: string;
}

interface TicketsResponse {
  tickets: Array<{
    id: number;
    supply_goods_id: string;
    approval_state: string;
    payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
  total: number;
  pageNo: number;
  pageSize: number;
}

interface TicketDetailResponse {
  ticket: TicketsResponse["tickets"][number];
  field_options?: never;
  field_metadata?: never;
}

interface TicketMetadataResponse {
  field_options: Record<
    string,
    Array<{
      value: string;
      label: string;
      sort_order: number | null;
      is_default: boolean;
    }>
  >;
  field_metadata: Record<
    string,
    {
      label: string;
      field_type: string;
    }
  >;
}

interface RebuildFieldOptionsResponse {
  entity: string;
  field: string;
  options: TicketMetadataResponse["field_options"][string];
}

interface RebuildFieldSyncResponse {
  ok: boolean;
  entity: string;
  fields: number;
  options: number;
  updated_at: string;
}

interface MemoryMarketSkill {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  icon: string | null;
  status: "published" | "hidden" | "archived";
  packageUrl: string;
  packageSha256: string;
  packageSizeBytes: number;
  unpackedSizeBytes: number | null;
  fileCount: number | null;
  manifest: Record<string, unknown>;
  downloadCount: number;
  tags: string[];
  updatedAt: string;
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

function createMemorySkillRepository(initialSkills: MemoryMarketSkill[]) {
  const skills = initialSkills.map((skill) => ({ ...skill, tags: [...skill.tags] }));

  return {
    async listSkills(input: { query?: string; tag?: string }) {
      const query = input.query?.trim().toLowerCase();
      const tag = input.tag?.trim();
      return skills
        .filter((skill) => skill.status === "published")
        .filter((skill) => !tag || skill.tags.includes(tag))
        .filter((skill) => {
          if (!query) return true;
          return [skill.slug, skill.name, skill.summary, skill.description]
            .filter((value): value is string => typeof value === "string")
            .some((value) => value.toLowerCase().includes(query));
        });
    },

    async getSkillBySlug(slug: string) {
      return skills.find((skill) => skill.slug === slug && skill.status === "published") ?? null;
    },

    async recordDownload(slug: string) {
      const skill = skills.find((item) => item.slug === slug && item.status === "published");
      if (!skill) return null;
      skill.downloadCount += 1;
      return skill;
    },

    async upsertSkill(input: Omit<MemoryMarketSkill, "downloadCount" | "updatedAt">) {
      const now = "2026-06-24T01:00:00.000Z";
      const existing = skills.find((skill) => skill.slug === input.slug);
      if (existing) {
        Object.assign(existing, {
          ...input,
          downloadCount: existing.downloadCount,
          tags: [...input.tags],
          updatedAt: now,
        });
        return existing;
      }

      const created: MemoryMarketSkill = {
        ...input,
        downloadCount: 0,
        tags: [...input.tags],
        updatedAt: now,
      };
      skills.push(created);
      return created;
    },
  };
}

function createMemorySkillPublisher(packageUrl: string): SkillPublisher & { uploads: PublishSkillPackageInput[] } {
  const uploads: PublishSkillPackageInput[] = [];
  return {
    uploads,
    async publishSkillPackage(input: PublishSkillPackageInput) {
      uploads.push(input);
      return { packageUrl };
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

function createMemoryTicketRepository(records: TicketWithSupplyGoods[]): {
  repository: TicketRepository;
  queries: TicketQuery[];
} {
  const queries: TicketQuery[] = [];
  return {
    queries,
    repository: {
      async listTickets(query: TicketQuery) {
        queries.push(query);
        return {
          tickets: records,
          total: records.length,
          pageNo: query.pageNo,
          pageSize: query.pageSize,
        };
      },

      async getTicket(supplyGoodsId: string) {
        return records.find((record) => record.supplyGoodsId === supplyGoodsId) ?? null;
      },
    },
  };
}

function createMemoryFieldRepository(initialOptions: RebuildFieldOptionMetadata[] = []): {
  repository: RebuildFieldMetadataRepository;
  fields: RebuildFieldMetadata[];
  options: RebuildFieldOptionMetadata[];
} {
  const fields: RebuildFieldMetadata[] = [];
  const options: RebuildFieldOptionMetadata[] = [...initialOptions];
  return {
    fields,
    options,
    repository: {
      async upsertFields(nextFields: RebuildFieldMetadata[]): Promise<void> {
        fields.push(...nextFields);
      },

      async upsertFieldOptions(nextOptions: RebuildFieldOptionMetadata[]): Promise<void> {
        options.push(...nextOptions);
      },

      async listFieldOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        return options.filter((option) => option.entityName === entityName && option.fieldName === fieldName);
      },

      async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
        return fields.filter((field) => field.entityName === entityName);
      },

      async listFields(entityName: string, fieldNames: string[]): Promise<RebuildFieldMetadata[]> {
        return fields.filter((field) => field.entityName === entityName && fieldNames.includes(field.fieldName));
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
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("targetGoods");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("holidayLimit");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("reservationMark");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("owningUser");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("createdBy");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("hasPushedMiddleSide");
    expect(SUPPLY_GOODS_SYNC_FIELDS).toContain("regionRatingCertificate");
    expect(new Set(SUPPLY_GOODS_SYNC_FIELDS).size).toBe(SUPPLY_GOODS_SYNC_FIELDS.length);
  });

  test("Given SupplyGoods fields stored in database, When querying REBUILD twice, Then it uses cached database fields", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const originalAppId = Bun.env.REBUILD_APP_ID;
    const originalAppSecret = Bun.env.REBUILD_APP_SECRET;
    const queriedFields: string[] = [];
    let fieldReads = 0;

    Bun.env.REBUILD_BASE_URL = "https://rebuild.example.com";
    Bun.env.REBUILD_APP_ID = "app-id";
    Bun.env.REBUILD_APP_SECRET = "app-secret";
    const fetchMock = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [input] = args;
      const url = new URL(String(input));
      queriedFields.push(url.searchParams.get("fields") ?? "");
      return new Response(JSON.stringify({
        error_code: 0,
        error_msg: "",
        data: { SupplyGoodsId: url.searchParams.get("id") ?? "", mealType: { text: "主套餐A" } },
      }));
    };
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });

    const fieldRepository = {
      async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
        fieldReads += 1;
        return [
          {
            entityName,
            fieldName: "SupplyGoodsId",
            label: "商品ID",
            fieldType: "TEXT",
            raw: { name: "SupplyGoodsId", type: "TEXT" },
          },
          {
            entityName,
            fieldName: "mealType",
            label: "套餐类型",
            fieldType: "PICKLIST",
            raw: { name: "mealType", displayType: "PICKLIST" },
          },
        ];
      },
    } as unknown as RebuildFieldMetadataRepository;

    try {
      const client = createRebuildSupplyGoodsClient({
        fieldMetadataRepository: fieldRepository,
        fieldCacheTtlMs: 60_000,
      });

      await client.getSupplyGoods("944-first");
      await client.getSupplyGoods("944-second");
    } finally {
      globalThis.fetch = originalFetch;
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
      Bun.env.REBUILD_APP_ID = originalAppId;
      Bun.env.REBUILD_APP_SECRET = originalAppSecret;
    }

    expect(fieldReads).toBe(1);
    expect(queriedFields).toHaveLength(2);
    expect(queriedFields[0]?.split(",")).toContain("mealType");
    expect(queriedFields[0]?.split(",")).toContain("mealType.text");
    expect(queriedFields[1]).toBe(queriedFields[0]);
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

  test("Given published market skills, When the skill list is requested, Then it returns searchable public skills without user or version fields", async () => {
    const app = createServerApp({
      skillRepository: createMemorySkillRepository([
        {
          slug: "feedback-synthesis",
          name: "用户反馈分析",
          summary: "聚合反馈并生成主题",
          description: "把访谈、issue 和用户反馈整理为主题、证据和优先级。",
          icon: "message-square",
          status: "published",
          packageUrl: "https://cdn.example.com/skills/feedback-synthesis.skill",
          packageSha256: "sha256-feedback",
          packageSizeBytes: 1024,
          unpackedSizeBytes: 4096,
          fileCount: 5,
          manifest: { minAppVersion: "0.12.0" },
          downloadCount: 7,
          tags: ["research"],
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
        {
          slug: "internal-hidden",
          name: "隐藏 Skill",
          summary: null,
          description: null,
          icon: null,
          status: "hidden",
          packageUrl: "https://cdn.example.com/skills/internal-hidden.skill",
          packageSha256: "sha256-hidden",
          packageSizeBytes: 512,
          unpackedSizeBytes: null,
          fileCount: null,
          manifest: {},
          downloadCount: 0,
          tags: ["internal"],
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ]),
    });

    const response = await app.request("/api/skills?query=反馈&tag=research");
    const body = (await response.json()) as MarketSkillListResponse;

    expect(response.status).toBe(200);
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]).toEqual({
      slug: "feedback-synthesis",
      name: "用户反馈分析",
      summary: "聚合反馈并生成主题",
      icon: "message-square",
      tags: ["research"],
      packageSha256: "sha256-feedback",
      packageSizeBytes: 1024,
      downloadCount: 7,
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    expect(Object.keys(body.skills[0]!)).not.toContain("userId");
    expect(Object.keys(body.skills[0]!)).not.toContain("version");
    expect(Object.keys(body.skills[0]!)).not.toContain("featured");
  });

  test("Given a published market skill, When detail is requested, Then it returns package metadata for hash based updates", async () => {
    const app = createServerApp({
      skillRepository: createMemorySkillRepository([
        {
          slug: "docx",
          name: "Word 文档",
          summary: "处理 Word 文档",
          description: "创建、编辑和检查 docx 文件。",
          icon: "file-text",
          status: "published",
          packageUrl: "https://cdn.example.com/skills/docx.skill",
          packageSha256: "sha256-docx",
          packageSizeBytes: 2048,
          unpackedSizeBytes: 8192,
          fileCount: 8,
          manifest: { minAppVersion: "0.12.0" },
          downloadCount: 3,
          tags: ["document"],
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ]),
    });

    const response = await app.request("/api/skills/docx");
    const body = (await response.json()) as MarketSkillDetailResponse;

    expect(response.status).toBe(200);
    expect(body.skill.packageSha256).toBe("sha256-docx");
    expect(body.skill.manifest).toEqual({ minAppVersion: "0.12.0" });
    expect(Object.keys(body.skill)).not.toContain("version");
  });

  test("Given a published market skill, When download is requested, Then it increments the global download count and returns the current package", async () => {
    const skillRepository = createMemorySkillRepository([
      {
        slug: "sales-report",
        name: "销售报告",
        summary: "生成销售报告",
        description: "把销售数据整理成报告。",
        icon: null,
        status: "published",
        packageUrl: "https://cdn.example.com/skills/sales-report.skill",
        packageSha256: "sha256-sales",
        packageSizeBytes: 3072,
        unpackedSizeBytes: 12000,
        fileCount: 9,
        manifest: {},
        downloadCount: 10,
        tags: ["sales"],
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ]);
    const app = createServerApp({ skillRepository });

    const downloadResponse = await app.request("/api/skills/sales-report/download");
    const downloadBody = (await downloadResponse.json()) as MarketSkillDownloadResponse;
    const detailResponse = await app.request("/api/skills/sales-report");
    const detailBody = (await detailResponse.json()) as MarketSkillDetailResponse;

    expect(downloadResponse.status).toBe(200);
    expect(downloadBody).toEqual({
      downloadUrl: "https://cdn.example.com/skills/sales-report.skill",
      packageSha256: "sha256-sales",
      packageSizeBytes: 3072,
    });
    expect(detailBody.skill.downloadCount).toBe(11);
  });

  test("Given an internal token and skill package, When publishing a skill, Then it uploads the package and stores the R2 package URL", async () => {
    const skillRepository = createMemorySkillRepository([]);
    const skillPublisher = createMemorySkillPublisher("https://cdn.example.com/upload_file/skills/brief-writer.skill");
    const app = createServerApp({
      skillRepository,
      skillPublisher,
      internalApiToken: "internal-secret",
    });
    const packageBytes = new TextEncoder().encode("fake skill zip bytes");
    const formData = new FormData();
    formData.set("slug", "brief-writer");
    formData.set("name", "Brief Writer");
    formData.set("summary", "生成项目 brief");
    formData.set("description", "把输入整理成项目 brief。");
    formData.set("icon", "file-pen");
    formData.set("tags", JSON.stringify(["writing", "planning"]));
    formData.set("manifest", JSON.stringify({ minAppVersion: "0.12.0" }));
    formData.set("unpackedSizeBytes", "4096");
    formData.set("fileCount", "6");
    formData.set("package", new File([packageBytes], "brief-writer.skill", { type: "application/zip" }));

    const response = await app.request("/api/internal/skills", {
      method: "POST",
      headers: { Authorization: "Bearer internal-secret" },
      body: formData,
    });
    const body = (await response.json()) as PublishSkillResponse;
    const downloadResponse = await app.request("/api/skills/brief-writer/download");
    const downloadBody = (await downloadResponse.json()) as MarketSkillDownloadResponse;

    expect(response.status).toBe(201);
    expect(skillPublisher.uploads).toHaveLength(1);
    expect(skillPublisher.uploads[0]?.slug).toBe("brief-writer");
    expect(skillPublisher.uploads[0]?.packageBytes).toEqual(packageBytes);
    expect(body.packageUrl).toBe("https://cdn.example.com/upload_file/skills/brief-writer.skill");
    expect(body.skill).toMatchObject({
      slug: "brief-writer",
      name: "Brief Writer",
      summary: "生成项目 brief",
      description: "把输入整理成项目 brief。",
      icon: "file-pen",
      tags: ["writing", "planning"],
      packageSizeBytes: packageBytes.byteLength,
      unpackedSizeBytes: 4096,
      fileCount: 6,
      manifest: { minAppVersion: "0.12.0" },
      downloadCount: 0,
    });
    expect(body.skill.packageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(downloadBody.downloadUrl).toBe("https://cdn.example.com/upload_file/skills/brief-writer.skill");
    expect(downloadBody.packageSha256).toBe(body.skill.packageSha256);
    expect(downloadBody.packageSizeBytes).toBe(packageBytes.byteLength);
  });

  test("Given no internal token, When publishing a skill, Then it rejects the upload", async () => {
    const skillPublisher = createMemorySkillPublisher("https://cdn.example.com/upload_file/skills/brief-writer.skill");
    const app = createServerApp({
      skillRepository: createMemorySkillRepository([]),
      skillPublisher,
      internalApiToken: "internal-secret",
    });
    const formData = new FormData();
    formData.set("slug", "brief-writer");
    formData.set("name", "Brief Writer");
    formData.set("package", new File([new Uint8Array([1, 2, 3])], "brief-writer.skill"));

    const response = await app.request("/api/internal/skills", {
      method: "POST",
      body: formData,
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.message).toBe("内部接口 Token 无效");
    expect(skillPublisher.uploads).toHaveLength(0);
  });

  test("Given a SupplyGoods callback, When supply_goods_id is provided, Then it refreshes and saves the latest REBUILD record", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const queriedIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        queriedIds.push(supplyGoodsId);
        return {
          SupplyGoodsId: supplyGoodsId,
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
      body: JSON.stringify({ supply_goods_id: "944-019eee7db58948ec" }),
    });
    const body = (await response.json()) as SupplyGoodsCallbackResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.supply_goods_id).toBe("944-019eee7db58948ec");
    expect(typeof body.updated_at).toBe("string");
    expect(queriedIds).toEqual(["944-019eee7db58948ec"]);
    expect(saved).toHaveLength(1);
    const savedRecord = saved[0];
    expect(savedRecord).toBeDefined();
    expect(savedRecord?.supplyGoodsId).toBe("944-019eee7db58948ec");
    expect(savedRecord?.payload).toEqual({
      SupplyGoodsId: "944-019eee7db58948ec",
      goodsName: "测试商品",
      approvalState: { value: 2, text: "审批中" },
    });
  });

  test("Given a SupplyGoods callback with media fields, When asset uploader is configured, Then it saves converted asset urls", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const { repository: fieldRepository, fields } = createMemoryFieldRepository();
    fields.push({
      entityName: "SupplyGoods",
      fieldName: "mainPic",
      label: "商品主图",
      fieldType: "IMAGE",
      raw: { name: "mainPic", displayType: "IMAGE" },
    });
    const assetUploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.fieldName}/main.jpg`,
        };
      },
    };
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        return {
          SupplyGoodsId: supplyGoodsId,
          goodsName: "带图商品",
          mainPic: ["rb/20260624/main.jpg"],
        };
      },
    };
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      rebuildAssetUploader: assetUploader,
      rebuildFieldMetadataRepository: fieldRepository,
      supplyGoodsRecordRepository: repository,
    });

    const response = await app.request("/api/rebuild/supplygoods/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supply_goods_id: "944-asset" }),
    });

    expect(response.status).toBe(200);
    expect(saved[0]?.assets).toEqual({
      mainPic: [
        {
          source: "rb/20260624/main.jpg",
          url: "https://cdn.example.com/mainPic/main.jpg",
        },
      ],
    });
  });

  test("Given a REBUILD SupplyGoods hook callback, When primaryId is provided, Then the compatible URL also syncs the record", async () => {
    const { repository, saved } = createMemorySupplyGoodsRepository();
    const queriedIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        queriedIds.push(supplyGoodsId);
        return {
          SupplyGoodsId: supplyGoodsId,
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
    expect(body.supply_goods_id).toBe("944-compatible");
    expect(queriedIds).toEqual(["944-compatible"]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.payload).toEqual({
      SupplyGoodsId: "944-compatible",
      goodsName: "兼容路径商品",
    });
  });

  test("Given tickets exist, When list API is filtered, Then it delegates query and returns SupplyGoods payload", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository, queries } = createMemoryTicketRepository([
      {
        id: 1,
        supplyGoodsId: "944-019b72fc5f247d73",
        approvalState: "审批中",
        payload: {
          SupplyGoodsId: "944-019b72fc5f247d73",
          hostNameInput: "禧聚晟宴",
          goodsNameInput: "3-4人餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets?approvalState=%E5%AE%A1%E6%89%B9%E4%B8%AD&q=%E7%A6%A7&pageNo=2&pageSize=10");
    const body = (await response.json()) as TicketsResponse;

    expect(response.status).toBe(200);
    expect(queries).toEqual([
      {
        approvalState: "审批中",
        q: "禧",
        pageNo: 2,
        pageSize: 10,
      },
    ]);
    expect(body.total).toBe(1);
    expect(body.tickets[0]?.supply_goods_id).toBe("944-019b72fc5f247d73");
    expect(body.tickets[0]?.payload.hostNameInput).toBe("禧聚晟宴");
  });

  test("Given a ticket exists, When detail API is requested, Then it returns that ticket", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 2,
        supplyGoodsId: "944-detail",
        approvalState: "通过",
        payload: {
          SupplyGoodsId: "944-detail",
          goodsNameInput: "详情套餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-detail");
    const body = (await response.json()) as TicketDetailResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.supply_goods_id).toBe("944-detail");
    expect(body.ticket.approval_state).toBe("通过");
    expect("field_options" in body).toBe(false);
    expect("field_metadata" in body).toBe(false);
  });

  test("Given field options exist, When ticket metadata API is requested, Then it returns shared field dictionaries", async () => {
    const { repository: fieldRepository, fields } = createMemoryFieldRepository([
      {
        entityName: "SupplyGoods",
        fieldName: "showChannel",
        optionValue: "show-douyin",
        optionLabel: "抖音来客（闭环）",
        sortOrder: 1,
        isDefault: false,
        raw: { id: "show-douyin", text: "抖音来客（闭环）" },
      },
    ]);
    fields.push({
      entityName: "SupplyGoods",
      fieldName: "showChannel",
      label: "商品计划上线渠道",
      fieldType: "PICKLIST",
      raw: { name: "showChannel", label: "商品计划上线渠道", type: "PICKLIST" },
    });
    fields.push({
      entityName: "SupplyGoods",
      fieldName: "mainPic",
      label: "商品主图",
      fieldType: "IMAGE",
      raw: { name: "mainPic", label: "商品主图", type: "IMAGE" },
    });
    const app = createServerApp({
      rebuildFieldMetadataRepository: fieldRepository,
    });

    const response = await app.request("/api/tickets/metadata");
    const body = (await response.json()) as TicketMetadataResponse;

    expect(response.status).toBe(200);
    expect(body.field_options.showChannel?.[0]).toEqual({
      value: "show-douyin",
      label: "抖音来客（闭环）",
      sort_order: 1,
      is_default: false,
    });
    expect(body.field_metadata.showChannel).toEqual({
      label: "商品计划上线渠道",
      field_type: "PICKLIST",
    });
    expect(body.field_metadata.mainPic).toEqual({
      label: "商品主图",
      field_type: "IMAGE",
    });
  });

  test("Given ticket has mirrored assets, When detail API is requested, Then payload media paths are replaced by asset urls", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 4,
        supplyGoodsId: "944-asset-detail",
        approvalState: "审批中",
        payload: {
          SupplyGoodsId: "944-asset-detail",
          mainPic: ["rb/20260624/main.jpg"],
        },
        assets: {
          mainPic: [
            {
              source: "rb/20260624/main.jpg",
              url: "https://cdn.example.com/main.jpg",
            },
          ],
        },
        createdAt: now,
        updatedAt: now,
      } as TicketWithSupplyGoods,
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-asset-detail");
    const body = (await response.json()) as TicketDetailResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.payload.mainPic).toEqual(["https://cdn.example.com/main.jpg"]);
  });

  test("Given REBUILD metadata client, When syncing SupplyGoods fields, Then it stores fields and options in pg repository", async () => {
    const { repository, fields, options } = createMemoryFieldRepository();
    const metadataClient: RebuildMetadataClient = {
      async listFields(entityName: string): Promise<RebuildFieldMetadata[]> {
        return [
          {
            entityName,
            fieldName: "showChannel",
            label: "商品计划上线渠道",
            fieldType: "PICKLIST",
            raw: {
              name: "showChannel",
              label: "商品计划上线渠道",
              displayType: "PICKLIST",
              options: [{ id: "show-douyin", text: "抖音来客（闭环）" }],
            },
          },
          {
            entityName,
            fieldName: "channelLimit",
            label: "投放渠道",
            fieldType: "MULTISELECT",
            raw: {
              name: "channelLimit",
              label: "投放渠道",
              displayType: "MULTISELECT",
              options: [{ text: "直播间", mask: 1 }],
            },
          },
          {
            entityName,
            fieldName: "classification",
            label: "商品类目",
            fieldType: "CLASSIFICATION",
            raw: {
              name: "classification",
              label: "商品类目",
              displayType: "CLASSIFICATION",
            },
          },
        ];
      },

      async listPicklistOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (fieldName !== "showChannel") return [];
        return [
          {
            entityName,
            fieldName,
            optionValue: "show-douyin",
            optionLabel: "抖音来客（闭环）",
            sortOrder: 0,
            isDefault: false,
            raw: { id: "show-douyin", text: "抖音来客（闭环）" },
          },
        ];
      },

      async listMultiselectOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (fieldName !== "channelLimit") return [];
        return normalizeRebuildFieldOptions(entityName, fieldName, [{ text: "直播间", mask: 1 }]);
      },

      async listClassificationOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (fieldName !== "classification") return [];
        return normalizeRebuildClassificationOptions(entityName, fieldName, [
          {
            id: "cat-food",
            text: "同城玩享",
            children: [{ id: "cat-sport", text: "运动健身" }],
          },
        ]);
      },
    };
    const app = createServerApp({
      rebuildMetadataClient: metadataClient,
      rebuildFieldMetadataRepository: repository,
    });

    const response = await app.request("/api/rebuild/supplygoods/fields/sync", { method: "POST" });
    const body = (await response.json()) as RebuildFieldSyncResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entity).toBe("SupplyGoods");
    expect(body.fields).toBe(3);
    expect(body.options).toBe(4);
    expect(fields[0]?.fieldName).toBe("showChannel");
    expect(options.map((option) => option.optionLabel)).toContain("抖音来客（闭环）");
    expect(options.map((option) => option.optionLabel)).toContain("直播间");
    expect(options.map((option) => option.optionLabel)).toContain("同城玩享 / 运动健身");
  });

  test("Given stored field options, When options API is requested, Then it returns option values", async () => {
    const { repository } = createMemoryFieldRepository([
      {
        entityName: "SupplyGoods",
        fieldName: "showChannel",
        optionValue: "show-douyin",
        optionLabel: "抖音来客（闭环）",
        sortOrder: 2,
        isDefault: true,
        raw: { id: "show-douyin", text: "抖音来客（闭环）" },
      },
    ]);
    const app = createServerApp({ rebuildFieldMetadataRepository: repository });

    const response = await app.request("/api/rebuild/fields/options?entity=SupplyGoods&field=showChannel");
    const body = (await response.json()) as RebuildFieldOptionsResponse;

    expect(response.status).toBe(200);
    expect(body.entity).toBe("SupplyGoods");
    expect(body.field).toBe("showChannel");
    expect(body.options).toEqual([
      {
        value: "show-douyin",
        label: "抖音来客（闭环）",
        sort_order: 2,
        is_default: true,
      },
    ]);
  });

  test("Given a SupplyGoods callback, When supply_goods_id is missing, Then it rejects the request", async () => {
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
    expect(body.message).toBe("supply_goods_id 不能为空");
    expect(saved).toHaveLength(0);
  });
});
