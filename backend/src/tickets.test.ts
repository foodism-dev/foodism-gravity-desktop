import { describe, expect, test } from "bun:test";

import { normalizeTicketRowStatus } from "./tickets.ts";
import { TICKET_BUSINESS_STATUS, TICKET_STATUS } from "./ticket-status.ts";

describe("工单查询归一化", () => {
  test("Given returned ticket has stale business status, When normalizing row, Then it shows info completion", () => {
    const normalizedTicket = normalizeTicketRowStatus({
      id: 1,
      supplyGoodsId: "944-returned",
      status: TICKET_STATUS.RETURNED,
      businessStatus: TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING,
      payload: {},
      sourcePayload: {},
      createdAt: new Date("2026-06-26T08:00:00.000Z"),
      updatedAt: new Date("2026-06-26T08:00:00.000Z"),
    });

    expect(normalizedTicket.status).toBe(TICKET_STATUS.RETURNED);
    expect(normalizedTicket.businessStatus).toBe(TICKET_BUSINESS_STATUS.INFO_COMPLETION_PENDING);
  });
});
