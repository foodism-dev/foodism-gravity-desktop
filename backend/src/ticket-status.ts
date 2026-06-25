export const TICKET_STATUS = {
  TODO: "todo",
  PROCESSING: "processing",
  DONE: "done",
} as const;

export const TICKET_BUSINESS_STATUS = {
  ACCESS_REVIEW_PENDING: "access_review_pending",
  INFO_OPTIMIZATION_PENDING: "info_optimization_pending",
  SHELF_CONFIRM_PENDING: "shelf_confirm_pending",
  COMMISSION_SETUP_PENDING: "commission_setup_pending",
  ONLINE: "online",
} as const;

export type TicketStatus = typeof TICKET_STATUS[keyof typeof TICKET_STATUS];
export type TicketBusinessStatus = typeof TICKET_BUSINESS_STATUS[keyof typeof TICKET_BUSINESS_STATUS];

export interface TicketFlowState {
  status: TicketStatus;
  businessStatus: TicketBusinessStatus;
}

export function getInitialTicketBusinessStatus(isApprovalPassed: boolean): TicketBusinessStatus {
  return matchTicketBusinessStatusByApproval(isApprovalPassed);
}

export function matchTicketBusinessStatusByApproval(
  isApprovalPassed: boolean,
  currentBusinessStatus?: TicketBusinessStatus,
): TicketBusinessStatus {
  if (!isApprovalPassed) return TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING;
  if (!currentBusinessStatus || currentBusinessStatus === TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING) {
    return TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING;
  }
  return currentBusinessStatus;
}

export function isApprovalStatePassed(approvalState: string): boolean {
  return ["10", "通过", "审核通过"].includes(approvalState.trim());
}

export function matchTicketBusinessStatusByApprovalState(
  approvalState: string,
  currentBusinessStatus?: TicketBusinessStatus,
): TicketBusinessStatus {
  return matchTicketBusinessStatusByApproval(isApprovalStatePassed(approvalState), currentBusinessStatus);
}

export function getTicketStatusByBusinessStatus(businessStatus: TicketBusinessStatus): TicketStatus {
  if (businessStatus === TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING) return TICKET_STATUS.TODO;
  if (businessStatus === TICKET_BUSINESS_STATUS.ONLINE) return TICKET_STATUS.DONE;
  return TICKET_STATUS.PROCESSING;
}

export function getNextTicketBusinessStatusByAction(
  action: string,
  currentBusinessStatus: TicketBusinessStatus,
): TicketBusinessStatus {
  if (action === "info_optimized") return TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING;
  if (action === "shelf_online_confirmed") return TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING;
  if (action === "commission_configured") return TICKET_BUSINESS_STATUS.ONLINE;
  return currentBusinessStatus;
}

export function getNextTicketFlowStateByAction(
  action: string,
  current: TicketFlowState,
): TicketFlowState {
  const currentBusinessStatus = normalizeTicketBusinessStatus(current.businessStatus);
  if (action.endsWith("_started")) {
    return {
      status: TICKET_STATUS.PROCESSING,
      businessStatus: currentBusinessStatus,
    };
  }
  if (action.endsWith("_generated") || action.endsWith("_failed")) {
    return {
      status: getTicketStatusByBusinessStatus(currentBusinessStatus),
      businessStatus: currentBusinessStatus,
    };
  }

  const nextBusinessStatus = getNextTicketBusinessStatusByAction(action, currentBusinessStatus);
  return {
    status: getTicketStatusByBusinessStatus(nextBusinessStatus),
    businessStatus: nextBusinessStatus,
  };
}

export function normalizeTicketStatus(value: string | null | undefined): TicketStatus {
  return Object.values(TICKET_STATUS).includes(value as TicketStatus)
    ? value as TicketStatus
    : TICKET_STATUS.TODO;
}

export function normalizeTicketBusinessStatus(value: string | null | undefined): TicketBusinessStatus {
  return Object.values(TICKET_BUSINESS_STATUS).includes(value as TicketBusinessStatus)
    ? value as TicketBusinessStatus
    : TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING;
}
