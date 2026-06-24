import { describe, expect, test } from "bun:test";
import { createStore } from "jotai/vanilla";

import { ensureTicketMetadataAtom, ticketMetadataStateAtom } from "./ticket-metadata.ts";

process.env.VITE_API_BASE_URL = "http://localhost:8787";

interface FetchCall {
  url: string;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function installSessionStorage() {
  const sessionStorage: SessionStorageLike = {
    getItem() {
      return null;
    },
    setItem() {
      return undefined;
    },
    removeItem() {
      return undefined;
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { sessionStorage },
    configurable: true,
  });
}

function installFetchMock(): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    calls.push({ url: String(input) });
    return Response.json({
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
    });
  };
  return calls;
}

describe("Ticket metadata atom", () => {
  test("Given metadata is requested twice, When using shared atom, Then it only fetches once", async () => {
    installSessionStorage();
    const calls = installFetchMock();
    const store = createStore();

    const [first, second] = await Promise.all([
      store.set(ensureTicketMetadataAtom),
      store.set(ensureTicketMetadataAtom),
    ]);
    const third = await store.set(ensureTicketMetadataAtom);

    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(store.get(ticketMetadataStateAtom).data?.fieldMetadata.mainPic?.fieldType).toBe("IMAGE");
    expect(calls.map((call) => call.url)).toEqual(["http://localhost:8787/api/tickets/metadata"]);
  });
});
