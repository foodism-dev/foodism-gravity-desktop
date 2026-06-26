import { describe, expect, test } from "bun:test";

import {
  confirmTicketInfoOptimization,
  createTicketActionRecord,
  generateTicketInfoOptimization,
  getLinKeDraftJobStatus,
  getTicket,
  getTicketActionRecords,
  getTicketMetadata,
} from "./api.ts";
import { storeSession } from "./auth.ts";

process.env.VITE_API_BASE_URL = "http://localhost:8787";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function installSessionStorage(input?: { href?: string; parent?: unknown }) {
  const values = new Map<string, string>();
  const sessionStorage: SessionStorageLike = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: {
      sessionStorage,
      location: {
        href: input?.href ?? "http://localhost:5173/tickets/944-detail?tab=workbench",
        assign(url: string) {
          this.href = url;
        },
      },
      parent: input?.parent,
    },
    configurable: true,
  });
  return sessionStorage;
}

function installFetchMock(
  handler: (url: string, init: RequestInit | undefined) => unknown,
  status = 200,
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return Response.json(handler(url, init), { status });
  };
  return calls;
}

describe("前端 API", () => {
  test("Given ticket detail response has no field dictionary, When getting ticket, Then it returns only ticket data", async () => {
    installSessionStorage();
    installFetchMock(() => ({
      ticket: {
        id: 1,
        supply_goods_id: "944-detail",
        status: "processing",
        business_status: "info_optimization_pending",
        payload: { commissionRate: 0.12 },
        source_payload: { goodsNameInput: "详情套餐" },
        created_at: "2026-06-24T10:00:00.000Z",
        updated_at: "2026-06-24T10:00:00.000Z",
      },
    }));

    const ticket = await getTicket("944-detail");

    expect(ticket.supplyGoodsId).toBe("944-detail");
    expect(ticket.status).toBe("processing");
    expect(ticket.businessStatus).toBe("info_optimization_pending");
    expect(ticket.payload.commissionRate).toBe(0.12);
    expect(ticket.sourcePayload.goodsNameInput).toBe("详情套餐");
    expect("fieldOptions" in ticket).toBe(false);
    expect("fieldMetadata" in ticket).toBe(false);
  });

  test("Given action records response, When loading records, Then it normalizes action record fields", async () => {
    installSessionStorage();
    installFetchMock(() => ({
      records: [
        {
          id: 1,
          ticket_id: 2,
          action: "commission_filled",
          origin: { commissionRate: null },
          current: { commissionRate: 0.12 },
          operator: { name: "运营A" },
          remark: "按 12% 设置",
          created_at: "2026-06-24T11:00:00.000Z",
        },
      ],
    }));

    const records = await getTicketActionRecords("944-detail");

    expect(records[0]?.ticketId).toBe(2);
    expect(records[0]?.current.commissionRate).toBe(0.12);
    expect(records[0]?.operator.name).toBe("运营A");
  });

  test("Given action record input, When creating record, Then it posts JSON and returns updated ticket", async () => {
    installSessionStorage();
    const calls = installFetchMock(() => ({
      ticket: {
        id: 1,
        supply_goods_id: "944-detail",
        status: "processing",
        business_status: "commission_setup_pending",
        payload: { commissionRate: 0.12 },
        source_payload: { goodsNameInput: "详情套餐" },
        created_at: "2026-06-24T10:00:00.000Z",
        updated_at: "2026-06-24T11:00:00.000Z",
      },
      record: {
        id: 1,
        ticket_id: 1,
        action: "commission_filled",
        origin: { commissionRate: null },
        current: { commissionRate: 0.12 },
        operator: {},
        remark: null,
        created_at: "2026-06-24T11:00:00.000Z",
      },
    }));

    const result = await createTicketActionRecord("944-detail", {
      action: "commission_filled",
      origin: { commissionRate: null },
      current: { commissionRate: 0.12 },
    });

    expect(result.ticket.payload.commissionRate).toBe(0.12);
    expect(result.ticket.status).toBe("processing");
    expect(result.ticket.businessStatus).toBe("commission_setup_pending");
    expect(calls[0]?.url).toBe("http://localhost:8787/api/tickets/944-detail/action-records");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        action: "commission_filled",
        origin: { commissionRate: null },
        current: { commissionRate: 0.12 },
      }),
    );
  });

  test("Given ticket metadata response, When loading metadata, Then it normalizes field dictionaries", async () => {
    installSessionStorage();
    const calls = installFetchMock(() => ({
      field_options: {
        showChannel: [
          {
            value: "show-douyin",
            label: "抖音来客（闭环）",
            sort_order: 1,
            is_default: false,
          },
        ],
      },
      field_metadata: {
        mainPic: {
          label: "商品主图",
          field_type: "IMAGE",
        },
      },
    }));

    const metadata = await getTicketMetadata();

    expect(metadata.fieldMetadata.mainPic?.fieldType).toBe("IMAGE");
    expect(metadata.fieldOptions.showChannel?.[0]?.label).toBe("抖音来客（闭环）");
    expect(calls.map((call) => call.url)).toEqual(["http://localhost:8787/api/tickets/metadata"]);
  });

  test("Given optimization response, When generating info optimization, Then it returns packages only", async () => {
    installSessionStorage();
    const calls = installFetchMock(() => ({
      originPackages: { viewList: [{ groupName: "原始组" }] },
      optimizedPackages: { viewList: [{ groupName: "优化组" }] },
    }));

    const result = await generateTicketInfoOptimization("944-detail");

    expect(result.originPackages.viewList).toEqual([{ groupName: "原始组" }]);
    expect(result.optimizedPackages.viewList).toEqual([{ groupName: "优化组" }]);
    expect(calls[0]?.url).toBe("http://localhost:8787/api/tickets/944-detail/info-optimization/generate");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("Given edited packages, When confirming optimization, Then it posts packages and returns draft job id", async () => {
    installSessionStorage();
    const calls = installFetchMock(() => ({
      ticket: {
        id: 1,
        supply_goods_id: "944-detail",
        status: "processing",
        business_status: "info_optimization_pending",
        payload: { packages: { viewList: [{ groupName: "优化组" }] } },
        source_payload: { packages: { viewList: [{ groupName: "原始组" }] } },
        created_at: "2026-06-24T10:00:00.000Z",
        updated_at: "2026-06-24T11:00:00.000Z",
      },
      record: {
        id: 3,
        ticket_id: 1,
        action: "info_optimization_generated",
        origin: { packages: null },
        current: { packages: { viewList: [{ groupName: "优化组" }] } },
        operator: {},
        remark: null,
        created_at: "2026-06-24T11:00:00.000Z",
      },
      jobId: "job-1",
    }));

    const result = await confirmTicketInfoOptimization("944-detail", { viewList: [{ groupName: "优化组" }] });

    expect(result.jobId).toBe("job-1");
    expect(result.record.action).toBe("info_optimization_generated");
    expect(calls[0]?.url).toBe("http://localhost:8787/api/tickets/944-detail/info-optimization/confirm");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ optimizedPackages: { viewList: [{ groupName: "优化组" }] } }));
  });

  test("Given draft job response, When reading job status, Then it returns BullMQ state", async () => {
    installSessionStorage();
    installFetchMock(() => ({
      jobId: "job-1",
      state: "completed",
      failedReason: "",
      returnValue: { draftUrl: "https://www.life-partner.cn/draft" },
    }));

    const result = await getLinKeDraftJobStatus("944-detail", "job-1");

    expect(result.state).toBe("completed");
    expect(result.returnValue?.draftUrl).toBe("https://www.life-partner.cn/draft");
  });

  test("Given Electron iframe provides apiToken in URL, When loading ticket data, Then it stores token and sends bearer auth", async () => {
    const sessionStorage = installSessionStorage({
      href: "http://localhost:5174/tickets?embedded=electron&apiToken=pc-token",
    });
    const calls = installFetchMock(() => ({
      ticket: {
        id: 1,
        supply_goods_id: "944-detail",
        payload: {},
        source_payload: {},
        created_at: "2026-06-24T10:00:00.000Z",
        updated_at: "2026-06-24T10:00:00.000Z",
      },
    }));

    await getTicket("944-detail");

    expect(sessionStorage.getItem("proma_frontend_token")).toBe("pc-token");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer pc-token");
    expect(globalThis.window.location.href).toBe("http://localhost:5174/tickets?embedded=electron");
  });

  test("Given API returns 401 in web, When loading ticket data, Then it clears session and redirects to SSO", async () => {
    const sessionStorage = installSessionStorage();
    storeSession({
      token: "expired-token",
      user: { id: "user-1", name: "运营A" },
    });
    installFetchMock(() => ({ message: "登录已过期" }), 401);

    await expect(getTicket("944-detail")).rejects.toThrow("登录已过期");

    expect(sessionStorage.getItem("proma_frontend_token")).toBeNull();
    expect(globalThis.window.location.href).toBe(
      "http://localhost:8787/sso_login?returnTo=http%3A%2F%2Flocalhost%3A5173%2Ftickets%2F944-detail%3Ftab%3Dworkbench",
    );
  });

  test("Given API returns 401 inside Electron, When loading ticket data, Then it opens Electron SSO login", async () => {
    installSessionStorage();
    let ssoLoginStarts = 0;
    Object.defineProperty(globalThis.window, "electronAPI", {
      value: {
        startSsoLogin: async () => {
          ssoLoginStarts += 1;
          return { authorizeUrl: "https://sso.example.com/oauth2/authorize" };
        },
      },
      configurable: true,
    });
    installFetchMock(() => ({ message: "登录已过期" }), 401);

    await expect(getTicket("944-detail")).rejects.toThrow("登录已过期");

    expect(ssoLoginStarts).toBe(1);
    expect(globalThis.window.location.href).toBe("http://localhost:5173/tickets/944-detail?tab=workbench");
  });

  test("Given API returns 401 in Electron iframe, When loading ticket data, Then it asks parent to open SSO", async () => {
    const parentMessages: unknown[] = [];
    installSessionStorage({
      href: "http://localhost:5174/tickets?embedded=electron",
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
    });
    installFetchMock(() => ({ message: "登录已过期" }), 401);

    await expect(getTicket("944-detail")).rejects.toThrow("登录已过期");

    expect(parentMessages).toEqual([{ type: "proma:start-sso-login" }]);
    expect(globalThis.window.location.href).toBe("http://localhost:5174/tickets?embedded=electron");
  });

  test("Given API returns 401 inside Electron webview, When loading ticket data, Then it asks host to open SSO", async () => {
    let hostLoginStarts = 0;
    const parentMessages: unknown[] = [];
    installSessionStorage({
      href: "http://localhost:5174/tickets?embedded=electron",
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
    });
    Object.defineProperty(globalThis.window, "promaElectronWebview", {
      value: {
        startSsoLogin() {
          hostLoginStarts += 1;
        },
      },
      configurable: true,
    });
    installFetchMock(() => ({ message: "登录已过期" }), 401);

    await expect(getTicket("944-detail")).rejects.toThrow("登录已过期");

    expect(hostLoginStarts).toBe(1);
    expect(parentMessages).toEqual([]);
    expect(globalThis.window.location.href).toBe("http://localhost:5174/tickets?embedded=electron");
  });
});
