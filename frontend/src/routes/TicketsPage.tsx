import { AlertCircle, Clock3, Filter, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import type { AuthState } from "@/App.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getPayloadText, listTickets, type TicketRecord } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";

interface TicketsPageProps {
  authState: AuthState;
}

interface ApprovalColumn {
  id: string;
  label: string;
  value: number;
  cards: TicketRecord[];
}

const APPROVAL_OPTIONS = [
  { value: "1", label: "草稿" },
  { value: "2", label: "审批中" },
  { value: "10", label: "通过" },
  { value: "11", label: "驳回" },
  { value: "12", label: "撤回" },
  { value: "13", label: "撤销" },
] as const;

export function TicketsPage({ authState }: TicketsPageProps) {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [approvalState, setApprovalState] = useState<string>("all");

  const approvalStateParam = approvalState === "all" ? undefined : approvalState;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshTickets();
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [approvalStateParam, query]);

  async function refreshTickets() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const result = await listTickets({
        approvalState: approvalStateParam,
        q: query.trim() || undefined,
        pageNo: 1,
        pageSize: 80,
      });
      setTickets(result.tickets);
      setTotal(result.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载工单失败");
      setTickets([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }

  const columns = useMemo(() => buildApprovalColumns(tickets), [tickets]);
  const selectedApprovalLabel = approvalState === "all"
    ? "全部状态"
    : APPROVAL_OPTIONS.find((option) => option.value === approvalState)?.label ?? approvalState;

  return (
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[640px] flex-col gap-4">
      <section className="rounded-lg bg-white p-4 shadow-panel">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-950">我的工单</h1>
              <Badge variant={authState.token ? "success" : "muted"}>
                {authState.token ? "已桥接登录态" : "本地接口"}
              </Badge>
              <Badge variant="secondary">{total} 条</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">按 SupplyGoods 审核状态流转，筛选条件由后端 tickets 查询接口处理。</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索商品、门店、supply_goods_id"
                className="pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Filter className="h-4 w-4" />
                  {selectedApprovalLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setApprovalState("all")}>全部状态</DropdownMenuItem>
                {APPROVAL_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value} onSelect={() => setApprovalState(option.value)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => void refreshTickets()}>
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {errorMessage}
        </div>
      ) : null}

      <section className="grid min-h-0 flex-1 gap-4 overflow-x-auto pb-2 xl:grid-cols-6">
        {columns.map((column) => (
          <ApprovalColumnView key={column.id} column={column} loading={isLoading} />
        ))}
      </section>
    </div>
  );
}

function buildApprovalColumns(tickets: TicketRecord[]): ApprovalColumn[] {
  const columns = APPROVAL_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    value: Number(option.value),
    cards: [] as TicketRecord[],
  }));

  for (const ticket of tickets) {
    const stateValue = getApprovalStateValue(ticket);
    const target = columns.find((column) => column.value === stateValue);
    (target ?? columns[0]!).cards.push(ticket);
  }

  return columns;
}

function ApprovalColumnView({ column, loading }: { column: ApprovalColumn; loading: boolean }) {
  const tone = getColumnTone(column.value);
  return (
    <Card className="flex min-h-0 min-w-[260px] flex-col overflow-hidden shadow-sm">
      <CardHeader className="flex-row items-center justify-between p-4">
        <CardTitle className="text-sm">{column.label}</CardTitle>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone.countClassName)}>
          {column.cards.length}
        </span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pt-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
        ) : column.cards.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-8 text-center text-xs text-slate-400">暂无工单</div>
        ) : (
          column.cards.map((ticket) => <TicketCard key={ticket.supplyGoodsId} ticket={ticket} />)
        )}
      </CardContent>
    </Card>
  );
}

function TicketCard({ ticket }: { ticket: TicketRecord }) {
  const title = getPayloadText(ticket.payload, "hostNameInput") || getPayloadText(ticket.payload, "goodsName") || "未命名商品";
  const subtitle = getPayloadText(ticket.payload, "goodsNameInput") || getPayloadText(ticket.payload, "bdGroup") || ticket.supplyGoodsId;
  const city = getPayloadText(ticket.payload, "bdCity") || "未分配城市";
  const group = getPayloadText(ticket.payload, "bdGroup") || "未分配小组";
  const tone = getColumnTone(getApprovalStateValue(ticket));

  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: ticket.supplyGoodsId }}
      className="block rounded-lg bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{title}</div>
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{subtitle}</div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", tone.pillClassName)}>
          {ticket.approvalState}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-white px-2 py-1 text-[11px] text-slate-500">{city}</span>
        <span className="rounded-md bg-white px-2 py-1 text-[11px] text-slate-500">{group}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-400">
        <span className="truncate">{ticket.supplyGoodsId}</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatDateTime(ticket.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

function getApprovalStateValue(ticket: TicketRecord): number {
  const parsed = Number.parseInt(ticket.approvalState, 10);
  if (Number.isFinite(parsed)) return parsed;
  const option = APPROVAL_OPTIONS.find((item) => item.label === ticket.approvalState);
  if (option) return Number(option.value);

  const payloadValue = getPayloadText(ticket.payload, "approvalState");
  const payloadParsed = Number.parseInt(payloadValue, 10);
  if (Number.isFinite(payloadParsed)) return payloadParsed;
  return 1;
}

function getColumnTone(stateValue: number): { countClassName: string; pillClassName: string } {
  if (stateValue === 2) {
    return {
      countClassName: "bg-orange-100 text-orange-700",
      pillClassName: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
    };
  }
  if (stateValue === 10) {
    return {
      countClassName: "bg-emerald-100 text-emerald-700",
      pillClassName: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    };
  }
  if (stateValue >= 11) {
    return {
      countClassName: "bg-rose-100 text-rose-700",
      pillClassName: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    };
  }
  return {
    countClassName: "bg-slate-200 text-slate-700",
    pillClassName: "bg-slate-100 text-slate-600",
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
