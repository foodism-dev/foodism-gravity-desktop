import type { TicketBusinessStatus, TicketRecord, TicketStatus } from "./api.ts";

export interface TicketStatusColumn {
  id: TicketStatus;
  label: string;
  cards: TicketRecord[];
}

export interface StatusColumnTone {
  countClassName: string;
}

export const TICKET_STATUS_OPTIONS: Array<{ value: TicketStatus; label: string }> = [
  { value: "returned", label: "已驳回" },
  { value: "todo", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "done", label: "已完成" },
] as const;

export function buildTicketStatusColumns(tickets: TicketRecord[]): TicketStatusColumn[] {
  const columns = TICKET_STATUS_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    cards: [] as TicketRecord[],
  }));

  for (const ticket of tickets) {
    const target = columns.find((column) => column.id === ticket.status);
    (target ?? columns[0]!).cards.push(ticket);
  }

  return columns;
}

export function getStatusColumnTone(status: TicketStatus): StatusColumnTone {
  if (status === "returned") {
    return { countClassName: "bg-rose-100 text-rose-700" };
  }
  if (status === "todo") {
    return { countClassName: "bg-orange-100 text-orange-700" };
  }
  if (status === "done") {
    return { countClassName: "bg-emerald-100 text-emerald-700" };
  }
  return { countClassName: "bg-sky-100 text-sky-700" };
}

export function getBusinessStatusPillClassName(status: TicketBusinessStatus): string {
  if (status === "info_completion_pending") {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  }
  if (status === "access_review_pending") {
    return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
  }
  if (status === "online") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }
  return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
}
