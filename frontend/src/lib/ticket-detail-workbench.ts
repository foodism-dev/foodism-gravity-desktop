import type { TicketActionRecord, TicketBusinessStatus, TicketRecord } from "./api.ts";

export interface WorkbenchMetaItem {
  label: string;
  value: string;
}

export interface TicketHeaderBadge {
  label: string;
  variant: "success" | "muted";
}

export interface WorkbenchProgressStep {
  index: number;
  label: string;
  state: "done" | "active" | "pending";
}

export type TicketFlowKey =
  | "info_completion"
  | "access_review"
  | "info_optimization"
  | "shelf_confirm"
  | "commission_setup"
  | "product_online_pending"
  | "product_online";

export interface WorkbenchActionButton {
  label: string;
  tone: "primary" | "secondary" | "danger" | "ghost";
}

export interface WorkbenchActivityItem {
  title: string;
  description: string;
  operatorText: string;
  time: string;
}

export interface TicketWorkbenchModel {
  metaItems: WorkbenchMetaItem[];
  progressSteps: WorkbenchProgressStep[];
  currentFlow: TicketFlowKey;
  actionButtons: WorkbenchActionButton[];
  activityItems: WorkbenchActivityItem[];
}

const FLOW_STEPS: Array<{ key: TicketFlowKey; label: string }> = [
  { key: "access_review", label: "待准入审核" },
  { key: "info_optimization", label: "待信息优化确认" },
  { key: "shelf_confirm", label: "待货架上线确认" },
  { key: "commission_setup", label: "待佣金设置" },
  { key: "product_online_pending", label: "待商品上线" },
  { key: "product_online", label: "商品上线" },
];

const BUSINESS_STATUS_FLOW_MAP: Record<TicketBusinessStatus, TicketFlowKey> = {
  info_completion_pending: "info_completion",
  access_review_pending: "access_review",
  info_optimization_pending: "info_optimization",
  shelf_confirm_pending: "shelf_confirm",
  commission_setup_pending: "commission_setup",
  product_online_pending: "product_online_pending",
  online: "product_online",
};

const BUSINESS_STATUS_LABEL_MAP: Record<TicketBusinessStatus, string> = {
  info_completion_pending: "待完善信息",
  access_review_pending: "待准入审核",
  info_optimization_pending: "待信息优化确认",
  shelf_confirm_pending: "待货架上线确认",
  commission_setup_pending: "待佣金设置",
  product_online_pending: "待商品上线",
  online: "商品上线",
};

export function buildTicketWorkbenchModel(ticket: TicketRecord, records: TicketActionRecord[]): TicketWorkbenchModel {
  const currentPayload = buildCurrentPayload(ticket);
  const currentFlow = deriveTicketFlow(ticket, records);
  const currentStepIndex = FLOW_STEPS.findIndex((step) => step.key === currentFlow);
  return {
    metaItems: [
      { label: "工单编号", value: ticket.supplyGoodsId },
      { label: "商户名称", value: readPayloadText(currentPayload, "hostNameInput", "rbhost.hostName") },
      { label: "商品名称", value: readPayloadText(currentPayload, "goodsNameInput", "goodsName") },
      { label: "当前节点", value: formatTicketBusinessStatus(ticket.businessStatus) },
    ].map((item) => ({ ...item, value: item.value || "未提供" })),
    progressSteps: FLOW_STEPS.map((step, index) => ({
      index: index + 1,
      label: step.label,
      state: index < currentStepIndex ? "done" : index === currentStepIndex ? "active" : "pending",
    })),
    currentFlow,
    actionButtons: buildActionButtons(currentFlow, records),
    activityItems: records.slice(0, 4).map((record) => ({
      title: formatActionTitle(record),
      description: record.remark || `${formatActionTitle(record)} 已记录 ${Object.keys(record.current).length} 个字段`,
      operatorText: formatOperatorText(record.operator),
      time: formatShortDateTime(record.createdAt),
    })),
  };
}

export function deriveTicketFlow(ticket: TicketRecord, records: TicketActionRecord[]): TicketFlowKey {
  if (ticket.businessStatus) return BUSINESS_STATUS_FLOW_MAP[ticket.businessStatus];
  const actions = new Set(records.map((record) => record.action));
  if (!hasPayload(ticket.payload) || !actions.has("info_optimized")) return "info_optimization";
  if (!actions.has("shelf_online_confirmed")) return "shelf_confirm";
  if (!actions.has("commission_configured")) return "commission_setup";
  if (!actions.has("product_online_confirmed")) return "product_online_pending";
  return "product_online";
}

export function formatTicketBusinessStatus(status: TicketBusinessStatus): string {
  return BUSINESS_STATUS_LABEL_MAP[status];
}

export function isProductOperationRatingEditable(flow: TicketFlowKey): boolean {
  return flow === "access_review" || flow === "info_optimization";
}

export function buildTicketHeaderBadges(ticket: TicketRecord): TicketHeaderBadge[] {
  return [
    { label: formatTicketBusinessStatus(ticket.businessStatus), variant: "success" },
    { label: `工单 · ${formatOverallStatus(ticket.status)}`, variant: "muted" },
  ];
}

function buildActionButtons(flow: TicketFlowKey, records: TicketActionRecord[]): WorkbenchActionButton[] {
  if (flow === "info_completion" || flow === "access_review") {
    return [{ label: "跳转 Rebuild 审核", tone: "primary" }];
  }
  if (flow === "info_optimization") {
    if (records[0]?.action === "lin_ke_draft_failed") {
      return [
        { label: "重试创建草稿", tone: "primary" },
      ];
    }
    return [{ label: "确认采用优化", tone: "primary" }];
  }
  if (flow === "shelf_confirm") {
    return [{ label: "确认已上架", tone: "primary" }];
  }
  if (flow === "commission_setup") {
    return [
      { label: "同步佣金设置", tone: "primary" },
      { label: "手动修改", tone: "secondary" },
    ];
  }
  if (flow === "product_online_pending") {
    return [{ label: "确认商品上线", tone: "primary" }];
  }
  return [{ label: "查看上线任务", tone: "ghost" }];
}

function formatOverallStatus(status: TicketRecord["status"]): string {
  if (status === "returned") return "已驳回";
  if (status === "processing") return "处理中";
  if (status === "done") return "已完成";
  return "待处理";
}

function hasPayload(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).length > 0;
}

function buildCurrentPayload(ticket: TicketRecord): Record<string, unknown> {
  return {
    ...ticket.sourcePayload,
    ...ticket.payload,
  };
}

function formatActionTitle(record: TicketActionRecord): string {
  if (record.action === "import_from_rebuild") return "Rebuild";
  if (record.action === "info_optimization_generated") return "信息优化确认";
  if (record.action === "info_optimized") return "信息优化";
  if (record.action === "lin_ke_draft_failed") return "林客草稿失败";
  if (record.action === "shelf_online_confirmed") return "货架上线确认";
  if (record.action === "commission_configured") return "佣金设置";
  if (record.action === "product_online_confirmed") return "商品上线";
  if (record.action === "commission_manual_revision") return "佣金人工修改";
  if (record.action === "product_operation_rating_saved") return "商品运营评级";
  if (record.action === "return_to_manual_revision") return "返回人工修改";
  if (record.action.includes("agent")) return "Agent";
  return record.action;
}

function formatOperatorText(operator: Record<string, unknown>): string {
  return readPayloadText(operator, "displayName", "name", "username", "id");
}

function readPayloadText(payload: Record<string, unknown>, ...fields: string[]): string {
  for (const field of fields) {
    const value = readPayloadValue(payload, field);
    const text = formatValue(value);
    if (text) return text;
  }
  return "";
}

function readPayloadValue(payload: Record<string, unknown>, field: string): unknown {
  if (field in payload) return payload[field];
  return field.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, payload);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join("、");
  if (isRecord(value)) {
    const text = value.text ?? value.fullName ?? value.hostName ?? value.value;
    return formatValue(text);
  }
  return String(value).trim();
}

function formatShortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
