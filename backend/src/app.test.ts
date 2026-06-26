import { describe, expect, spyOn, test } from "bun:test";

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
import { SUPPLY_COMPANY_SYNC_FIELDS, SUPPLY_GOODS_SYNC_FIELDS } from "./rebuild/supplygoods.ts";
import { createRebuildSupplyGoodsClient } from "./rebuild/supplygoods.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsCallbackRecordInput,
  SupplyCompanyRecordUpsertInput,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "./rebuild/supplygoods.ts";
import type { RebuildAssetUploader } from "./rebuild/assets.ts";
import type { PublishSkillPackageInput, SkillPublisher } from "./skill-publisher.ts";
import type {
  CreateTicketActionRecordInput,
  TicketActionRecord,
  TicketQuery,
  TicketRepository,
  TicketWithSupplyGoods,
} from "./tickets.ts";
import { mergeTicketPayload } from "./tickets.ts";
import {
  getNextTicketFlowStateByAction,
  normalizeTicketBusinessStatus,
  normalizeTicketStatus,
  TICKET_BUSINESS_STATUS,
  TICKET_STATUS,
} from "./ticket-status.ts";
import type { UserRepository, UserWithPasswordHash } from "./users.ts";
import type { LinKeDraftJobStatus, LinKeDraftQueueClient } from "./lin-ke/draft-queue.ts";

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

interface FetchCall {
  url: URL;
  init?: RequestInit;
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
    status: string;
    business_status: string;
    payload: Record<string, unknown>;
    source_payload: Record<string, unknown>;
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

interface TicketActionRecordResponse {
  ticket: TicketsResponse["tickets"][number];
  record: {
    id: number;
    ticket_id: number;
    action: string;
    origin: Record<string, unknown>;
    current: Record<string, unknown>;
    operator: Record<string, unknown>;
    remark: string | null;
    created_at: string;
  };
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

async function createAuthHeaders(app: ReturnType<typeof createServerApp>): Promise<Record<string, string>> {
  const loginResponse = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "foodism123" }),
  });
  const body = (await loginResponse.json()) as LoginResponse;
  return { Authorization: `Bearer ${body.token}` };
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
  savedCompanies: SupplyCompanyRecordUpsertInput[];
  callbackRecords: SupplyGoodsCallbackRecordInput[];
} {
  const saved: SupplyGoodsRecordUpsertInput[] = [];
  const savedCompanies: SupplyCompanyRecordUpsertInput[] = [];
  const callbackRecords: SupplyGoodsCallbackRecordInput[] = [];
  return {
    saved,
    savedCompanies,
    callbackRecords,
    repository: {
      async upsertRecord(input: SupplyGoodsRecordUpsertInput): Promise<void> {
        saved.push(input);
        if (input.supplyCompany) savedCompanies.push(input.supplyCompany);
      },
      async createCallbackRecord(input: SupplyGoodsCallbackRecordInput): Promise<void> {
        callbackRecords.push(input);
      },
    },
  };
}

function createMemoryTicketRepository(records: TicketWithSupplyGoods[]): {
  repository: TicketRepository;
  queries: TicketQuery[];
  actionRecords: TicketActionRecord[];
} {
  const queries: TicketQuery[] = [];
  const actionRecords: TicketActionRecord[] = [];
  return {
    queries,
    actionRecords,
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

      async listActionRecords(supplyGoodsId: string) {
        const ticket = records.find((record) => record.supplyGoodsId === supplyGoodsId);
        if (!ticket) return [];
        return actionRecords.filter((record) => record.ticketId === ticket.id);
      },

      async createActionRecord(input: CreateTicketActionRecordInput) {
        const ticket = records.find((record) => record.supplyGoodsId === input.supplyGoodsId);
        if (!ticket) return null;

        const updatedAt = new Date("2026-06-24T11:00:00.000Z");
        ticket.payload = mergeTicketPayload(ticket.payload, input.current);
        const nextState = getNextTicketFlowStateByAction(input.action, {
          status: normalizeTicketStatus(ticket.status),
          businessStatus: normalizeTicketBusinessStatus(ticket.businessStatus),
        });
        ticket.status = nextState.status;
        ticket.businessStatus = nextState.businessStatus;
        ticket.updatedAt = updatedAt;

        const record: TicketActionRecord = {
          id: actionRecords.length + 1,
          ticketId: ticket.id,
          action: input.action,
          origin: input.origin,
          current: input.current,
          operator: input.operator,
          remark: input.remark,
          createdAt: updatedAt,
        };
        actionRecords.push(record);

        return { ticket, record };
      },
    },
  };
}

function createMemoryLinKeDraftQueue(): LinKeDraftQueueClient & { jobs: string[]; statuses: Map<string, LinKeDraftJobStatus> } {
  const jobs: string[] = [];
  const statuses = new Map<string, LinKeDraftJobStatus>();
  return {
    jobs,
    statuses,
    async addCreateDraftJob(supplyGoodsId: string) {
      jobs.push(supplyGoodsId);
      const jobId = `job-${jobs.length}`;
      statuses.set(jobId, {
        jobId,
        state: "waiting",
        failedReason: "",
        returnValue: null,
      });
      return jobId;
    },
    async getCreateDraftJobStatus(jobId: string) {
      return statuses.get(jobId) ?? null;
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

  test("Given SupplyCompany sync fields, When querying REBUILD, Then it requests company detail data", () => {
    expect(SUPPLY_COMPANY_SYNC_FIELDS).toContain("SupplyCompanyId");
    expect(SUPPLY_COMPANY_SYNC_FIELDS).toContain("companyName");
    expect(SUPPLY_COMPANY_SYNC_FIELDS).toContain("legalPerson");
    expect(SUPPLY_COMPANY_SYNC_FIELDS).toContain("guestId");
    expect(new Set(SUPPLY_COMPANY_SYNC_FIELDS).size).toBe(SUPPLY_COMPANY_SYNC_FIELDS.length);
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

  test("Given SupplyCompany fields stored in database, When querying REBUILD, Then it requests current company fields", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const originalAppId = Bun.env.REBUILD_APP_ID;
    const originalAppSecret = Bun.env.REBUILD_APP_SECRET;
    const queriedFields: string[] = [];

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
        data: { SupplyCompanyId: url.searchParams.get("id") ?? "", guestId: "guest-001" },
      }));
    };
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });

    const fieldRepository = {
      async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
        return [
          {
            entityName,
            fieldName: "SupplyCompanyId",
            label: "商户ID",
            fieldType: "TEXT",
            raw: { name: "SupplyCompanyId", type: "TEXT" },
          },
          {
            entityName,
            fieldName: "guestId",
            label: "来客账户ID",
            fieldType: "TEXT",
            raw: { name: "guestId", displayType: "TEXT" },
          },
          {
            entityName,
            fieldName: "auditStatus",
            label: "审核状态",
            fieldType: "PICKLIST",
            raw: { name: "auditStatus", displayType: "PICKLIST" },
          },
        ];
      },
    } as unknown as RebuildFieldMetadataRepository;

    try {
      const client = createRebuildSupplyGoodsClient({
        fieldMetadataRepository: fieldRepository,
        fieldCacheTtlMs: 60_000,
      });

      await client.getSupplyCompany?.("945-current-fields");
    } finally {
      globalThis.fetch = originalFetch;
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
      Bun.env.REBUILD_APP_ID = originalAppId;
      Bun.env.REBUILD_APP_SECRET = originalAppSecret;
    }

    expect(queriedFields).toEqual(["SupplyCompanyId,guestId,auditStatus,auditStatus.text"]);
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

  test("Given a web browser opens sso_login, When returnTo is provided, Then it redirects to the OIDC authorize page", async () => {
    const app = createServerApp();
    const response = await app.request(
      "/sso_login?returnTo=http%3A%2F%2Flocalhost%3A5174%2Ftickets%2F944-detail",
    );
    const location = response.headers.get("Location");
    const url = new URL(location ?? "");

    expect(response.status).toBe(302);
    expect(url.origin).toBe("https://fawos.online");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("gravity-pc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/sso/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("login_hint")).toBe("dingtalk");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  test("Given SSO callback succeeds, When frontend exchanges handoff token, Then it receives the jwt session", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({ url, init });
      if (url.pathname === "/oauth2/token") {
        const body = new URLSearchParams(init?.body?.toString());
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe("gravity-pc");
        expect(body.get("code")).toBe("auth-code");
        expect(body.get("redirect_uri")).toBe("http://127.0.0.1:8787/sso/callback");
        expect(body.get("code_verifier")).toBeTruthy();
        return Response.json({ access_token: "access-token", token_type: "Bearer", expires_in: 1800 });
      }
      if (url.pathname === "/oauth2/account") {
        expect(init?.headers).toEqual({ Authorization: "Bearer access-token" });
        return Response.json({
          account: {
            account: {
              sub: "sso-user-1",
              preferred_username: "zhangsan",
              display_name: "张三",
            },
          },
        });
      }
      return Response.json({ message: "unexpected url" }, { status: 500 });
    };
    const app = createServerApp({ userRepository: null, fetchImpl });
    const loginResponse = await app.request(
      "/sso_login?returnTo=http%3A%2F%2Flocalhost%3A5174%2Ftickets%3Ftab%3Dworkbench",
    );
    const authorizeUrl = new URL(loginResponse.headers.get("Location") ?? "");
    const state = authorizeUrl.searchParams.get("state");

    const callbackResponse = await app.request(`/sso/callback?code=auth-code&state=${state}`);
    const callbackLocation = new URL(callbackResponse.headers.get("Location") ?? "");
    const handoffToken = callbackLocation.searchParams.get("handoff");

    expect(callbackResponse.status).toBe(302);
    expect(callbackLocation.origin).toBe("http://localhost:5174");
    expect(callbackLocation.pathname).toBe("/tickets");
    expect(callbackLocation.searchParams.get("tab")).toBe("workbench");
    expect(handoffToken).toBeTruthy();

    const exchangeResponse = await app.request("/api/auth/handoff/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoffToken }),
    });
    const session = (await exchangeResponse.json()) as LoginResponse;

    expect(exchangeResponse.status).toBe(200);
    expect(typeof session.token).toBe("string");
    expect(session.user).toEqual({
      id: "sso-user-1",
      username: "zhangsan",
      displayName: "张三",
    });
    expect(calls.map((call) => call.url.pathname)).toEqual(["/oauth2/token", "/oauth2/account"]);
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
    const { repository, saved, savedCompanies, callbackRecords } = createMemorySupplyGoodsRepository();
    const { repository: fieldRepository, fields: syncedFields, options: syncedOptions } = createMemoryFieldRepository();
    const queriedIds: string[] = [];
    const queriedCompanyIds: string[] = [];
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        queriedIds.push(supplyGoodsId);
        return {
          SupplyGoodsId: supplyGoodsId,
          goodsName: "测试商品",
          company: {
            id: "945-company",
            text: "测试公司",
            entity: "SupplyCompany",
          },
          approvalState: { value: 2, text: "审批中" },
        };
      },
      async getSupplyCompany(supplyCompanyId: string): Promise<Record<string, unknown>> {
        queriedCompanyIds.push(supplyCompanyId);
        return {
          SupplyCompanyId: supplyCompanyId,
          companyName: "测试公司",
          legalPerson: "张三",
        };
      },
    };
    const metadataClient: RebuildMetadataClient = {
      async listFields(entityName: string): Promise<RebuildFieldMetadata[]> {
        if (entityName !== "SupplyCompany") return [];
        return [
          {
            entityName,
            fieldName: "companyType",
            label: "商户类型",
            fieldType: "PICKLIST",
            raw: { name: "companyType", displayType: "PICKLIST" },
          },
        ];
      },

      async listPicklistOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (entityName !== "SupplyCompany" || fieldName !== "companyType") return [];
        return normalizeRebuildFieldOptions(entityName, fieldName, [{ id: "restaurant", text: "餐饮商户" }]);
      },

      async listMultiselectOptions(): Promise<RebuildFieldOptionMetadata[]> {
        return [];
      },

      async listClassificationOptions(): Promise<RebuildFieldOptionMetadata[]> {
        return [];
      },
    };
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      rebuildMetadataClient: metadataClient,
      supplyGoodsRecordRepository: repository,
      rebuildFieldMetadataRepository: fieldRepository,
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
    expect(queriedCompanyIds).toEqual(["945-company"]);
    expect(syncedFields.map((field) => `${field.entityName}.${field.fieldName}`)).toContain("SupplyCompany.companyType");
    expect(syncedOptions.map((option) => option.optionLabel)).toContain("餐饮商户");
    expect(saved).toHaveLength(1);
    expect(savedCompanies).toHaveLength(1);
    const savedCompany = savedCompanies[0]!;
    expect(savedCompany).toBeDefined();
    expect(savedCompanies).toEqual([
      {
        supplyCompanyId: "945-company",
        payload: {
          SupplyCompanyId: "945-company",
          companyName: "测试公司",
          legalPerson: "张三",
        },
        updatedAt: savedCompany.updatedAt,
      },
    ]);
    const savedRecord = saved[0];
    expect(savedRecord).toBeDefined();
    expect(savedRecord?.supplyGoodsId).toBe("944-019eee7db58948ec");
    expect(savedRecord?.rawPayload).toEqual({ supply_goods_id: "944-019eee7db58948ec" });
    expect(savedRecord?.payload).toEqual({
      SupplyGoodsId: "944-019eee7db58948ec",
      goodsName: "测试商品",
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
      },
      approvalState: { value: 2, text: "审批中" },
    });
    expect(savedRecord?.normalizedPayload).toEqual(savedRecord?.payload);
    expect(callbackRecords).toHaveLength(1);
    expect(callbackRecords[0]?.rawPayload).toEqual({ supply_goods_id: "944-019eee7db58948ec" });
    expect(callbackRecords[0]?.payload).toEqual(savedRecord?.payload);
    expect(callbackRecords[0]?.normalizedPayload).toEqual(savedRecord?.normalizedPayload);
    expect(callbackRecords[0]?.status).toBe("success");
  });

  test("Given a SupplyGoods callback with media fields, When asset uploader is configured, Then it saves converted asset urls", async () => {
    const { repository, saved, callbackRecords } = createMemorySupplyGoodsRepository();
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
    expect(saved[0]?.payload.mainPic).toEqual(["rb/20260624/main.jpg"]);
    expect(saved[0]?.normalizedPayload.mainPic).toEqual(["https://cdn.example.com/mainPic/main.jpg"]);
    expect(callbackRecords[0]?.payload.mainPic).toEqual(["rb/20260624/main.jpg"]);
    expect(callbackRecords[0]?.normalizedPayload.mainPic).toEqual(["https://cdn.example.com/mainPic/main.jpg"]);
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

  test("Given SupplyGoods callback sync fails, When logging the error, Then stack and cause are included", async () => {
    const cause = new Error("底层 PG 错误");
    cause.stack = "PostgresError: 底层 PG 错误\n    at postgres";
    const error = new Error("Drizzle 查询失败", { cause });
    error.stack = "Error: Drizzle 查询失败\n    at upsertRecord";
    const repository: SupplyGoodsRecordRepository = {
      async upsertRecord(): Promise<void> {
        throw error;
      },
      async createCallbackRecord(): Promise<void> {},
    };
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
        return {
          SupplyGoodsId: supplyGoodsId,
          goodsName: "日志测试商品",
        };
      },
    };
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const app = createServerApp({
      rebuildSupplyGoodsClient: rebuildClient,
      supplyGoodsRecordRepository: repository,
    });

    try {
      const response = await app.request("/api/rebuild/supplygoods/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supply_goods_id: "944-error-log" }),
      });

      expect(response.status).toBe(502);
      const logLine = String(errorSpy.mock.calls[0]?.[0] ?? "");
      expect(logLine).toContain("Error: Drizzle 查询失败");
      expect(logLine).toContain("at upsertRecord");
      expect(logLine).toContain("Cause:");
      expect(logLine).toContain("PostgresError: 底层 PG 错误");
      expect(logLine).toContain("at postgres");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("Given tickets exist, When list API is filtered, Then it delegates query and returns current and source payload", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository, queries } = createMemoryTicketRepository([
      {
        id: 1,
        supplyGoodsId: "944-019b72fc5f247d73",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING,
        payload: {
          commission: {
            commissionRate: 0.12,
          },
        },
        sourcePayload: {
          SupplyGoodsId: "944-019b72fc5f247d73",
          hostNameInput: "禧聚晟宴",
          goodsNameInput: "3-4人餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets?businessStatus=access_review_pending&q=%E7%A6%A7&pageNo=2&pageSize=10", {
      headers: await createAuthHeaders(app),
    });
    const body = (await response.json()) as TicketsResponse;

    expect(response.status).toBe(200);
    expect(queries).toEqual([
      {
        businessStatus: TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING,
        q: "禧",
        pageNo: 2,
        pageSize: 10,
      },
    ]);
    expect(body.total).toBe(1);
    expect(body.tickets[0]?.supply_goods_id).toBe("944-019b72fc5f247d73");
    expect(body.tickets[0]?.status).toBe(TICKET_STATUS.TODO);
    expect(body.tickets[0]?.business_status).toBe(TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING);
    expect(body.tickets[0]?.payload.commission).toEqual({ commissionRate: 0.12 });
    expect(body.tickets[0]?.source_payload.hostNameInput).toBe("禧聚晟宴");
  });

  test("Given no token, When ticket list API is requested, Then it rejects the request", async () => {
    const { repository } = createMemoryTicketRepository([]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets");

    expect(response.status).toBe(401);
  });

  test("Given a ticket exists, When detail API is requested, Then it returns that ticket", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 2,
        supplyGoodsId: "944-detail",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          copywriting: {
            optimizedTitle: "详情套餐",
          },
        },
        sourcePayload: {
          SupplyGoodsId: "944-detail",
          goodsNameInput: "详情套餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-detail", {
      headers: await createAuthHeaders(app),
    });
    const body = (await response.json()) as TicketDetailResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.supply_goods_id).toBe("944-detail");
    expect("approval_state" in body.ticket).toBe(false);
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect("field_options" in body).toBe(false);
    expect("field_metadata" in body).toBe(false);
  });

  test("Given an action record has mismatched fields, When creating it, Then the API rejects it", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 3,
        supplyGoodsId: "944-action",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "commission_filled",
        origin: {
          commissionMode: null,
          commissionRate: null,
        },
        current: {
          commissionMode: "rate",
          commissionAmount: 12,
        },
      }),
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.message).toBe("origin 和 current 字段必须一致");
  });

  test("Given a valid action record, When creating it, Then the ticket payload stores the latest current data", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 3,
        supplyGoodsId: "944-action",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          goodsNameInput: "原始套餐",
          commissionMode: null,
          commissionRate: null,
          commissionAmount: null,
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "commission_filled",
        origin: {
          commissionMode: null,
          commissionRate: null,
          commissionAmount: null,
        },
        current: {
          commissionMode: "rate",
          commissionRate: 0.12,
          commissionAmount: null,
        },
        operator: {
          name: "运营A",
        },
        remark: "按商品售价 12% 设置",
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.payload.goodsNameInput).toBe("原始套餐");
    expect(body.ticket.payload.commissionMode).toBe("rate");
    expect(body.ticket.payload.commissionRate).toBe(0.12);
    expect(body.ticket.payload.commissionAmount).toBeNull();
    expect(body.ticket.payload.commission).toBeUndefined();
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(body.record.action).toBe("commission_filled");
    expect(body.record.operator).toEqual({
      id: "admin",
      username: "admin",
      displayName: "管理员",
      source: "jwt",
    });
  });

  test("Given nested payload fields, When creating an action record, Then current data is deeply merged", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 4,
        supplyGoodsId: "944-nested-action",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          goodsNameInput: "原始套餐",
          company: {
            id: "945-company",
            text: "测试公司",
            entity: "SupplyCompany",
          },
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-nested-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "company_guest_bound",
        origin: {
          company: {
            guestId: null,
          },
        },
        current: {
          company: {
            guestId: "guest-001",
          },
        },
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.payload.company).toEqual({
      id: "945-company",
      text: "测试公司",
      entity: "SupplyCompany",
      guestId: "guest-001",
    });
  });

  test("Given an action record without module, When creating it, Then the API accepts the simplified action record", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 5,
        supplyGoodsId: "944-action-without-module",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-action-without-module/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "info_optimization_started",
        origin: {},
        current: {},
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.record.action).toBe("info_optimization_started");
    expect("module" in body.record).toBe(false);
  });

  test("Given an info optimized action record, When creating it, Then the ticket status moves to shelf confirmation", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 6,
        supplyGoodsId: "944-status-action",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          goodsNameInput: "原始套餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-status-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "info_optimized",
        origin: {
          goodsName: "原始套餐",
          goodsNameInput: "原始套餐",
        },
        current: {
          goodsName: "优化套餐",
          goodsNameInput: "优化套餐",
        },
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
    expect(body.ticket.payload.goodsName).toBe("优化套餐");
    expect(body.ticket.payload.goodsNameInput).toBe("优化套餐");
  });

  test("Given a processing action record, When creating it, Then only overall status changes", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 7,
        supplyGoodsId: "944-processing-action",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          goodsNameInput: "原始套餐",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-processing-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "info_optimization_started",
        origin: {},
        current: {},
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(body.ticket.payload.goodsNameInput).toBe("原始套餐");
  });

  test("Given a ticket, When generating info optimization, Then only original and optimized packages are returned", async () => {
    const originalPackages = JSON.stringify({
      viewList: [
        {
          groupName: "原始组",
          list: [{ title: "原始菜", price: "12.00", num: "1" }],
        },
      ],
    });
    const { repository, actionRecords } = createMemoryTicketRepository([
      {
        id: 9,
        supplyGoodsId: "944-info-generate",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: {
          packages: JSON.stringify({
            viewList: [
              {
                groupName: "历史优化组",
                list: [{ title: "历史优化菜", price: "12.00", num: "1" }],
              },
            ],
          }),
        },
        sourcePayload: { packages: originalPackages },
        createdAt: new Date("2026-06-24T10:00:00.000Z"),
        updatedAt: new Date("2026-06-24T10:00:00.000Z"),
      },
    ]);
    actionRecords.push({
      id: 1,
      ticketId: 9,
      action: "info_optimized",
      origin: {},
      current: {},
      operator: {},
      remark: "历史优化记录",
      createdAt: new Date("2026-06-24T10:30:00.000Z"),
    });
    const optimizedPayloads: Record<string, unknown>[] = [];
    const app = createServerApp({
      ticketRepository: repository,
      linKeRoutesOptions: {
        repository: null,
        async optimizePayload(_settings, payload) {
          optimizedPayloads.push(payload);
          return {
            payload: {
              ...payload,
              packages: JSON.stringify({
                viewList: [
                  {
                    groupName: "优化组",
                    list: [{ title: "优化菜", price: "12.00", num: "1" }],
                  },
                ],
              }),
            },
            changes: [],
            fallback: false,
            error: "",
          };
        },
      },
    });

    const response = await app.request("/api/tickets/944-info-generate/info-optimization/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({}),
    });
    const body = await response.json() as {
      originPackages: Record<string, unknown>;
      optimizedPackages: Record<string, unknown>;
      payload?: unknown;
      fallback?: unknown;
      error?: unknown;
    };

    expect(response.status).toBe(200);
    expect(optimizedPayloads).toHaveLength(1);
    expect(optimizedPayloads[0]?.packages).toBe(originalPackages);
    expect(((body.originPackages.viewList as Record<string, unknown>[])[0]?.groupName)).toBe("原始组");
    expect(((body.optimizedPackages.viewList as Record<string, unknown>[])[0]?.groupName)).toBe("优化组");
    expect(body.payload).toBeUndefined();
    expect(body.fallback).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  test("Given optimizer fails, When generating info optimization, Then API returns error without packages", async () => {
    const originalPackages = JSON.stringify({
      viewList: [
        {
          groupName: "原始组",
          list: [{ title: "原始菜", price: "12.00", num: "1" }],
        },
      ],
    });
    const { repository } = createMemoryTicketRepository([
      {
        id: 10,
        supplyGoodsId: "944-info-generate-failed",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: { packages: originalPackages },
        sourcePayload: { packages: originalPackages },
        createdAt: new Date("2026-06-24T10:00:00.000Z"),
        updatedAt: new Date("2026-06-24T10:00:00.000Z"),
      },
    ]);
    const app = createServerApp({
      ticketRepository: repository,
      linKeRoutesOptions: {
        repository: null,
        async optimizePayload() {
          throw new Error("model down");
        },
      },
    });

    const response = await app.request("/api/tickets/944-info-generate-failed/info-optimization/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({}),
    });
    const body = await response.json() as {
      error?: string;
      message?: string;
      originPackages?: unknown;
      optimizedPackages?: unknown;
    };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Bad Gateway");
    expect(body.message).toContain("model down");
    expect(body.originPackages).toBeUndefined();
    expect(body.optimizedPackages).toBeUndefined();
  });

  test("Given edited packages, When confirming info optimization, Then packages are stored and draft job is enqueued without advancing flow", async () => {
    const originalPackages = JSON.stringify({
      viewList: [
        {
          groupName: "原始组",
          list: [{ title: "原始菜", price: "12.00", num: "1" }],
        },
      ],
    });
    const { repository, actionRecords } = createMemoryTicketRepository([
      {
        id: 10,
        supplyGoodsId: "944-info-confirm",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
        payload: { packages: originalPackages },
        sourcePayload: { packages: originalPackages },
        createdAt: new Date("2026-06-24T10:00:00.000Z"),
        updatedAt: new Date("2026-06-24T10:00:00.000Z"),
      },
    ]);
    const queue = createMemoryLinKeDraftQueue();
    const app = createServerApp({
      ticketRepository: repository,
      linKeDraftQueue: queue,
      linKeRoutesOptions: { repository: null },
    });

    const response = await app.request("/api/tickets/944-info-confirm/info-optimization/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        optimizedPackages: {
          viewList: [
            {
              groupName: "优化组",
              list: [{ title: "优化菜", price: "99.00", num: "9" }],
            },
          ],
        },
      }),
    });
    const body = await response.json() as TicketActionRecordResponse & { jobId: string };
    const storedPackages = JSON.parse(body.ticket.payload.packages as string);

    expect(response.status).toBe(200);
    expect(body.jobId).toBe("job-1");
    expect(queue.jobs).toEqual(["944-info-confirm"]);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(storedPackages.viewList[0].groupName).toBe("优化组");
    expect(storedPackages.viewList[0].list[0].title).toBe("优化菜");
    expect(storedPackages.viewList[0].list[0].price).toBe("12.00");
    expect(storedPackages.viewList[0].list[0].num).toBe("1");
    expect(actionRecords[0]?.action).toBe("info_optimization_generated");
  });

  test("Given a shelf confirmation action record, When creating it, Then the ticket moves to commission setup", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 8,
        supplyGoodsId: "944-shelf-action",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING,
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-shelf-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "shelf_online_confirmed",
        origin: { linkeGoodsId: null },
        current: { linkeGoodsId: "123456" },
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING);
    expect(body.ticket.payload.linkeGoodsId).toBe("123456");
  });

  test("Given a commission configured action record, When creating it, Then the ticket waits for product online", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 8,
        supplyGoodsId: "944-commission-action",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING,
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-commission-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "commission_configured",
        origin: { commissionConfigured: null },
        current: { commissionConfigured: true },
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.status).toBe(TICKET_STATUS.PROCESSING);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING);
    expect(body.ticket.payload.commissionConfigured).toBe(true);
  });

  test("Given product online action record, When creating it, Then the ticket is done and online", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 10,
        supplyGoodsId: "944-product-online-action",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
        payload: {
          commissionConfigured: true,
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-product-online-action/action-records", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await createAuthHeaders(app) },
      body: JSON.stringify({
        action: "product_online_confirmed",
        origin: { productOnlineConfirmed: null },
        current: { productOnlineConfirmed: true },
      }),
    });
    const body = (await response.json()) as TicketActionRecordResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.status).toBe(TICKET_STATUS.DONE);
    expect(body.ticket.business_status).toBe(TICKET_BUSINESS_STATUS.ONLINE);
    expect(body.ticket.payload.productOnlineConfirmed).toBe(true);
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

    const response = await app.request("/api/tickets/metadata", {
      headers: await createAuthHeaders(app),
    });
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

  test("Given ticket source payload already has normalized media urls, When detail API is requested, Then it returns payload without asset side channel", async () => {
    const now = new Date("2026-06-24T10:00:00.000Z");
    const { repository } = createMemoryTicketRepository([
      {
        id: 4,
        supplyGoodsId: "944-asset-detail",
        status: TICKET_STATUS.TODO,
        businessStatus: TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING,
        payload: {},
        sourcePayload: {
          SupplyGoodsId: "944-asset-detail",
          mainPic: ["https://cdn.example.com/main.jpg"],
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const app = createServerApp({ ticketRepository: repository });

    const response = await app.request("/api/tickets/944-asset-detail", {
      headers: await createAuthHeaders(app),
    });
    const body = (await response.json()) as TicketDetailResponse;

    expect(response.status).toBe(200);
    expect(body.ticket.source_payload.mainPic).toEqual(["https://cdn.example.com/main.jpg"]);
    expect("assets" in body.ticket).toBe(false);
    expect("source_assets" in body.ticket).toBe(false);
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

    const response = await app.request("/api/rebuild/supplygoods/fields/sync", {
      method: "POST",
      headers: await createAuthHeaders(app),
    });
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

  test("Given REBUILD metadata client, When syncing SupplyCompany fields, Then it reuses entity metadata sync", async () => {
    const { repository, fields, options } = createMemoryFieldRepository();
    const metadataClient: RebuildMetadataClient = {
      async listFields(entityName: string): Promise<RebuildFieldMetadata[]> {
        return [
          {
            entityName,
            fieldName: "companyType",
            label: "商户类型",
            fieldType: "PICKLIST",
            raw: {
              name: "companyType",
              label: "商户类型",
              displayType: "PICKLIST",
            },
          },
          {
            entityName,
            fieldName: "businessScope",
            label: "经营范围",
            fieldType: "MULTISELECT",
            raw: {
              name: "businessScope",
              label: "经营范围",
              displayType: "MULTISELECT",
            },
          },
        ];
      },

      async listPicklistOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (fieldName !== "companyType") return [];
        return normalizeRebuildFieldOptions(entityName, fieldName, [{ id: "restaurant", text: "餐饮商户" }]);
      },

      async listMultiselectOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
        if (fieldName !== "businessScope") return [];
        return normalizeRebuildFieldOptions(entityName, fieldName, [{ mask: 1, text: "堂食" }]);
      },

      async listClassificationOptions(): Promise<RebuildFieldOptionMetadata[]> {
        return [];
      },
    };
    const app = createServerApp({
      rebuildMetadataClient: metadataClient,
      rebuildFieldMetadataRepository: repository,
    });

    const response = await app.request("/api/rebuild/supplycompany/fields/sync", {
      method: "POST",
      headers: await createAuthHeaders(app),
    });
    const body = (await response.json()) as RebuildFieldSyncResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entity).toBe("SupplyCompany");
    expect(body.fields).toBe(2);
    expect(body.options).toBe(2);
    expect(fields.map((field) => `${field.entityName}.${field.fieldName}`)).toEqual([
      "SupplyCompany.companyType",
      "SupplyCompany.businessScope",
    ]);
    expect(options.map((option) => option.optionLabel)).toEqual(["餐饮商户", "堂食"]);
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

    const response = await app.request("/api/rebuild/fields/options?entity=SupplyGoods&field=showChannel", {
      headers: await createAuthHeaders(app),
    });
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
