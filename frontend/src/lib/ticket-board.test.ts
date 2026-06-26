import { describe, expect, test } from "bun:test";

import type { TicketBusinessStatus, TicketRecord, TicketStatus } from "./api.ts";
import { buildTicketStatusColumns } from "./ticket-board.ts";

function createTicket(input: {
  supplyGoodsId: string;
  status: TicketStatus;
  businessStatus: TicketBusinessStatus;
}): TicketRecord {
  return {
    id: Number(input.supplyGoodsId.replace(/\D/g, "")) || 1,
    supplyGoodsId: input.supplyGoodsId,
    status: input.status,
    businessStatus: input.businessStatus,
    payload: {},
    sourcePayload: {},
    createdAt: "2026-06-26T08:00:00.000Z",
    updatedAt: "2026-06-26T08:00:00.000Z",
  };
}

describe("工单看板", () => {
  test("Given tickets with mixed statuses, When building board columns, Then it groups by ticket status", () => {
    const tickets = [
      createTicket({
        supplyGoodsId: "ticket-0",
        status: "returned",
        businessStatus: "info_completion_pending",
      }),
      createTicket({
        supplyGoodsId: "ticket-1",
        status: "todo",
        businessStatus: "access_review_pending",
      }),
      createTicket({
        supplyGoodsId: "ticket-2",
        status: "processing",
        businessStatus: "access_review_pending",
      }),
      createTicket({
        supplyGoodsId: "ticket-3",
        status: "done",
        businessStatus: "online",
      }),
    ];

    const columns = buildTicketStatusColumns(tickets);

    expect(columns.map((column) => column.id)).toEqual(["returned", "todo", "processing", "done"]);
    expect(columns.map((column) => column.cards.map((ticket) => ticket.supplyGoodsId))).toEqual([
      ["ticket-0"],
      ["ticket-1"],
      ["ticket-2"],
      ["ticket-3"],
    ]);
  });
});
