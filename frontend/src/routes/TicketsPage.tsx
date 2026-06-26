import { AlertCircle, Clock3, Filter, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState, type WheelEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import type { AuthState } from "@/App.tsx";
import { ensureTicketMetadataAtom } from "@/atoms/ticket-metadata.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getPayloadText, listTickets, type TicketBusinessStatus, type TicketRecord } from "@/lib/api.ts";
import { formatTicketBusinessStatus } from "@/lib/ticket-detail-workbench.ts";
import { cn } from "@/lib/utils.ts";

interface TicketsPageProps {
  authState: AuthState;
}

interface BusinessStatusColumn {
  id: TicketBusinessStatus;
  label: string;
  cards: TicketRecord[];
}

const BUSINESS_STATUS_OPTIONS: Array<{ value: TicketBusinessStatus; label: string }> = [
  { value: "access_review_pending", label: "待准入审核" },
  { value: "info_optimization_pending", label: "待信息优化确认" },
  { value: "shelf_confirm_pending", label: "待货架上线确认" },
  { value: "commission_setup_pending", label: "待佣金设置" },
  { value: "product_online_pending", label: "待商品上线" },
  { value: "online", label: "商品上线" },
] as const;

export function TicketsPage({ authState }: TicketsPageProps) {
  const ensureTicketMetadata = useSetAtom(ensureTicketMetadataAtom);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [businessStatus, setBusinessStatus] = useState<"all" | TicketBusinessStatus>("all");

  const businessStatusParam = businessStatus === "all" ? undefined : businessStatus;

  useEffect(() => {
    void ensureTicketMetadata();
  }, [ensureTicketMetadata]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshTickets();
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [businessStatusParam, query]);

  async function refreshTickets() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const result = await listTickets({
        businessStatus: businessStatusParam,
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

  const columns = useMemo(() => buildBusinessStatusColumns(tickets), [tickets]);
  const selectedBusinessStatusLabel = businessStatus === "all"
    ? "全部节点"
    : BUSINESS_STATUS_OPTIONS.find((option) => option.value === businessStatus)?.label ?? businessStatus;

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
            <p className="mt-1 text-sm text-slate-500">按商品上架业务节点流转，筛选条件由后端 tickets 查询接口处理。</p>
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
                  {selectedBusinessStatusLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setBusinessStatus("all")}>全部节点</DropdownMenuItem>
                {BUSINESS_STATUS_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value} onSelect={() => setBusinessStatus(option.value)}>
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

      <section
        className="grid min-h-0 flex-1 auto-cols-[280px] grid-flow-col gap-4 overflow-x-auto pb-2 2xl:auto-cols-[300px]"
        onWheel={handleBoardWheel}
      >
        {columns.map((column) => (
          <BusinessStatusColumnView key={column.id} column={column} loading={isLoading} />
        ))}
      </section>
    </div>
  );
}

function handleBoardWheel(event: WheelEvent<HTMLElement>) {
  if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const board = event.currentTarget;
  if (board.scrollWidth <= board.clientWidth) return;

  event.preventDefault();
  board.scrollLeft += event.deltaY;
}

function buildBusinessStatusColumns(tickets: TicketRecord[]): BusinessStatusColumn[] {
  const columns = BUSINESS_STATUS_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    cards: [] as TicketRecord[],
  }));

  for (const ticket of tickets) {
    const target = columns.find((column) => column.id === ticket.businessStatus);
    (target ?? columns[0]!).cards.push(ticket);
  }

  return columns;
}

function BusinessStatusColumnView({ column, loading }: { column: BusinessStatusColumn; loading: boolean }) {
  const tone = getColumnTone(column.id);
  return (
    <Card className="flex min-h-0 w-full flex-col overflow-hidden shadow-sm">
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
  const sourcePayload = ticket.sourcePayload;
  const title = getPayloadText(sourcePayload, "hostNameInput") || getPayloadText(sourcePayload, "goodsName") || "未命名商品";
  const subtitle = getPayloadText(sourcePayload, "goodsNameInput") || getPayloadText(sourcePayload, "bdGroup") || ticket.supplyGoodsId;
  const city = getPayloadText(sourcePayload, "bdCity") || "未分配城市";
  const group = getPayloadText(sourcePayload, "bdGroup") || "未分配小组";
  const tone = getColumnTone(ticket.businessStatus);

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
          {formatTicketBusinessStatus(ticket.businessStatus)}
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

function getColumnTone(status: TicketBusinessStatus): { countClassName: string; pillClassName: string } {
  if (status === "access_review_pending") {
    return {
      countClassName: "bg-orange-100 text-orange-700",
      pillClassName: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
    };
  }
  if (status === "online") {
    return {
      countClassName: "bg-emerald-100 text-emerald-700",
      pillClassName: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    };
  }
  return {
    countClassName: "bg-sky-100 text-sky-700",
    pillClassName: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
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
