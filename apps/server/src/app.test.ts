import { describe, expect, test } from "bun:test";

import { createServerApp } from "./app.ts";
import type { ApiUser } from "./auth.ts";
import type { PublishSkillPackageInput, SkillPublisher } from "./skill-publisher.ts";
import type { UserRepository, UserWithPasswordHash } from "./users.ts";

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

describe("server app", () => {
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
});
