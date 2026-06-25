import { describe, expect, test } from "bun:test";

import { createTicketActionRecord, getTicket, getTicketActionRecords, getTicketMetadata } from "./api.ts";

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

function installSessionStorage() {
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
    value: { sessionStorage },
    configurable: true,
  });
}

function installFetchMock(handler: (url: string, init: RequestInit | undefined) => unknown): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return Response.json(handler(url, init));
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
});
