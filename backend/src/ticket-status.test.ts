import { describe, expect, test } from "bun:test";

import {
  getInitialTicketBusinessStatus,
  getNextTicketBusinessStatusByAction,
  getNextTicketFlowStateByAction,
  getTicketStatusByBusinessStatus,
  isApprovalStatePassed,
  isApprovalStateRejected,
  matchTicketBusinessStatusByApproval,
  matchTicketBusinessStatusByApprovalState,
  TICKET_BUSINESS_STATUS,
  TICKET_STATUS,
} from "./ticket-status.ts";

describe("工单状态", () => {
  test("Given Rebuild approval state, When creating ticket, Then it derives initial business status", () => {
    expect(getInitialTicketBusinessStatus(false)).toBe(TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING);
    expect(getInitialTicketBusinessStatus(true)).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
  });

  test("Given action record action, When recording workflow action, Then business status moves to the next node", () => {
    expect(getNextTicketBusinessStatusByAction(
      "info_optimized",
      TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    )).toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
    expect(getNextTicketBusinessStatusByAction(
      "shelf_online_confirmed",
      TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING,
    )).toBe(TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING);
    expect(getNextTicketBusinessStatusByAction(
      "commission_configured",
      TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING,
    )).toBe(TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING);
    expect(getNextTicketBusinessStatusByAction(
      "product_online_confirmed",
      TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
    )).toBe(TICKET_BUSINESS_STATUS.ONLINE);
    expect(getNextTicketBusinessStatusByAction(
      "return_to_sales_revision",
      TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    )).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
  });

  test("Given approval state changes, When matching business status, Then only access review follows approval and later workflow is preserved", () => {
    expect(matchTicketBusinessStatusByApproval(false, TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(matchTicketBusinessStatusByApproval(false, TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
    expect(matchTicketBusinessStatusByApproval(false, TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING);
    expect(matchTicketBusinessStatusByApproval(true, TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(matchTicketBusinessStatusByApproval(true, TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
  });

  test("Given approval state text, When matching business status, Then it supports Rebuild numeric and Chinese values", () => {
    expect(isApprovalStatePassed("10")).toBe(true);
    expect(isApprovalStatePassed("通过")).toBe(true);
    expect(isApprovalStatePassed("审核通过")).toBe(true);
    expect(isApprovalStatePassed("审批中")).toBe(false);
    expect(matchTicketBusinessStatusByApprovalState("通过", TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(matchTicketBusinessStatusByApprovalState("审批中", TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
  });

  test("Given Rebuild product is rejected, When matching business status, Then ticket returns to completion", () => {
    expect(isApprovalStateRejected("11")).toBe(true);
    expect(isApprovalStateRejected("驳回")).toBe(true);
    expect(isApprovalStateRejected("商品驳回")).toBe(true);
    expect(isApprovalStateRejected("被商品驳回")).toBe(true);
    expect(isApprovalStateRejected("审批中")).toBe(false);
    expect(matchTicketBusinessStatusByApprovalState("商品驳回", TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING))
      .toBe(TICKET_BUSINESS_STATUS.INFO_COMPLETION_PENDING);
  });

  test("Given business status, When deriving overall ticket status, Then only access review is todo and online is done", () => {
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.INFO_COMPLETION_PENDING)).toBe(TICKET_STATUS.RETURNED);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING)).toBe(TICKET_STATUS.TODO);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING)).toBe(TICKET_STATUS.PROCESSING);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING)).toBe(TICKET_STATUS.PROCESSING);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING)).toBe(TICKET_STATUS.PROCESSING);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING)).toBe(TICKET_STATUS.PROCESSING);
    expect(getTicketStatusByBusinessStatus(TICKET_BUSINESS_STATUS.ONLINE)).toBe(TICKET_STATUS.DONE);
  });

  test("Given workflow actions, When deriving next flow state, Then overall and business status move together", () => {
    expect(getNextTicketFlowStateByAction("info_optimization_started", {
      status: TICKET_STATUS.TODO,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    })).toEqual({
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    });
    expect(getNextTicketFlowStateByAction("info_optimization_generated", {
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    })).toEqual({
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    });
    expect(getNextTicketFlowStateByAction("info_optimized", {
      status: TICKET_STATUS.TODO,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    })).toEqual({
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING,
    });
    expect(getNextTicketFlowStateByAction("commission_configured", {
      status: TICKET_STATUS.TODO,
      businessStatus: TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING,
    })).toEqual({
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
    });
    expect(getNextTicketFlowStateByAction("product_online_confirmed", {
      status: TICKET_STATUS.PROCESSING,
      businessStatus: TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
    })).toEqual({
      status: TICKET_STATUS.DONE,
      businessStatus: TICKET_BUSINESS_STATUS.ONLINE,
    });
  });
});
