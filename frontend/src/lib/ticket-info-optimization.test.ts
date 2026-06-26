import { describe, expect, test } from "bun:test";

import { haveSameVisiblePackageNames, requestTicketInfoOptimization } from "./ticket-info-optimization.ts";
import type { TicketRecord } from "./api.ts";

process.env.VITE_API_BASE_URL = "http://localhost:8787";

function installSessionStorage() {
  Object.defineProperty(globalThis, "window", {
    value: {
      sessionStorage: {
        getItem() {
          return null;
        },
      },
    },
    configurable: true,
  });
}

const ticket: TicketRecord = {
  id: 1,
  supplyGoodsId: "944-info",
  status: "processing",
  businessStatus: "info_optimization_pending",
  payload: {
    goodsNameInput: "盐场鲜兔火锅双人套餐",
  },
  sourcePayload: {
    goodsNameInput: "盐场鲜兔火锅双人套餐",
  },
  createdAt: "2026-06-25T10:00:00.000Z",
  updatedAt: "2026-06-25T10:00:00.000Z",
};

describe("信息优化接口", () => {
  test("Given backend returns packages, When requesting optimization, Then it keeps package comparison result", async () => {
    installSessionStorage();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => Response.json({
      originPackages: { viewList: [{ groupName: "原始组" }] },
      optimizedPackages: { viewList: [{ groupName: "优化组" }] },
    }), { preconnect: originalFetch.preconnect });
    try {
      const result = await requestTicketInfoOptimization(ticket, 2);
      expect(result.generation).toBe(2);
      expect(result.originPackages).toEqual({ viewList: [{ groupName: "原始组" }] });
      expect(result.optimizedPackages).toEqual({ viewList: [{ groupName: "优化组" }] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Given package names are compared, When only visible names match, Then unchanged is detected", () => {
    const origin = {
      viewList: [
        {
          groupName: "主菜",
          list: [
            { title: "烤生蚝", price: "12.00" },
            { title: "蒜蓉生蚝", price: "13.00" },
          ],
        },
      ],
    };
    const sameNames = {
      viewList: [
        {
          groupName: "主菜",
          list: [
            { title: "烤生蚝", price: "99.00" },
            { title: "蒜蓉生蚝", price: "88.00" },
          ],
        },
      ],
    };
    const changedNames = {
      viewList: [
        {
          groupName: "主菜",
          list: [
            { title: "炭烤生蚝", price: "12.00" },
            { title: "蒜蓉生蚝", price: "13.00" },
          ],
        },
      ],
    };

    expect(haveSameVisiblePackageNames(origin, sameNames)).toBe(true);
    expect(haveSameVisiblePackageNames(origin, changedNames)).toBe(false);
  });
});
