import { describe, expect, test } from "bun:test";

import { requestTicketInfoOptimization } from "./ticket-info-optimization.ts";
import type { TicketRecord } from "./api.ts";

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

describe("信息优化 mock 接口", () => {
  test("Given ticket payload has title, When requesting optimization, Then it only changes title", async () => {
    const result = await requestTicketInfoOptimization(ticket, 2);

    expect(result.generation).toBe(2);
    expect(result.origin).toEqual({
      goodsName: "盐场鲜兔火锅双人套餐",
      goodsNameInput: "盐场鲜兔火锅双人套餐",
    });
    expect(result.current).toEqual({
      goodsName: "盐场鲜兔火锅双人套餐｜AI优化版2",
      goodsNameInput: "盐场鲜兔火锅双人套餐｜AI优化版2",
    });
  });
});
