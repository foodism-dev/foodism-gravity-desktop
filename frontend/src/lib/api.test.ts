import { describe, expect, test } from "bun:test";

import { getTicket, getTicketMetadata } from "./api.ts";

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
        approval_state: "通过",
        payload: { goodsNameInput: "详情套餐" },
        assets: {},
        created_at: "2026-06-24T10:00:00.000Z",
        updated_at: "2026-06-24T10:00:00.000Z",
      },
    }));

    const ticket = await getTicket("944-detail");

    expect(ticket.supplyGoodsId).toBe("944-detail");
    expect("fieldOptions" in ticket).toBe(false);
    expect("fieldMetadata" in ticket).toBe(false);
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
