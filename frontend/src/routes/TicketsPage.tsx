import { AlertCircle, Clock3, RefreshCw, Search } from "lucide-react";
import { useEffect, useState, type WheelEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import type { AuthState } from "@/App.tsx";
import { ensureTicketMetadataAtom } from "@/atoms/ticket-metadata.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getPayloadText, listAllTickets, type TicketRecord } from "@/lib/api.ts";
import { isElectronEmbedded, reloadWorkOrdersInElectron } from "@/lib/electron-bridge.ts";
import {
  getBusinessStatusPillClassName,
  getStatusColumnTone,
  TICKET_STATUS_OPTIONS,
  type TicketStatusColumn,
} from "@/lib/ticket-board.ts";
import { formatTicketBusinessStatus } from "@/lib/ticket-detail-workbench.ts";
import { cn } from "@/lib/utils.ts";

interface TicketsPageProps {
  authState: AuthState;
  onSignOut: () => void;
  isLinKeTestSkipVisible: boolean;
  skipLinKeExternal: boolean;
  onSkipLinKeExternalChange: (enabled: boolean) => void;
}

export function TicketsPage(props: TicketsPageProps) {
  const ensureTicketMetadata = useSetAtom(ensureTicketMetadataAtom);
  const [columns, setColumns] = useState<TicketStatusColumn[]>(() => createEmptyTicketStatusColumns());
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void ensureTicketMetadata();
  }, [ensureTicketMetadata]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshTickets();
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  async function refreshTickets() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const keyword = query.trim() || undefined;
      const nextColumns = await Promise.all(
        TICKET_STATUS_OPTIONS.map(async (option) => {
          const result = await listAllTickets({
            status: option.value,
            q: keyword,
          });
          return {
            id: option.value,
            label: option.label,
            cards: result.tickets,
          };
        }),
      );
      setColumns(nextColumns);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载工单失败");
      setColumns(createEmptyTicketStatusColumns());
    } finally {
      setIsLoading(false);
    }
  }

  function handleRefreshClick() {
    if (isElectronEmbedded() && reloadWorkOrdersInElectron()) return;
    void refreshTickets();
  }

  return (
    <div className="ticket-scrollbar flex h-[calc(100vh-1.5rem)] min-h-[640px] flex-col gap-4">
      <section className="rounded-lg bg-white px-4 py-3 shadow-panel">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-950">我的工单</h1>
            {props.isLinKeTestSkipVisible ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                role="switch"
                aria-checked={props.skipLinKeExternal}
                className={cn(
                  "h-7 rounded-full px-3 text-xs",
                  props.skipLinKeExternal
                    ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                )}
                onClick={() => props.onSkipLinKeExternalChange(!props.skipLinKeExternal)}
              >
                测试跳过林客：{props.skipLinKeExternal ? "开" : "关"}
              </Button>
            ) : null}
          </div>

          <div className="relative ml-auto min-w-[260px] flex-1 md:max-w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索城市、商品、门店、商品 ID等"
              className="pl-9"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="刷新工单"
            title="刷新工单"
            onClick={handleRefreshClick}
            className="shrink-0"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </section>

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {errorMessage}
        </div>
      ) : null}

      <section
        className="ticket-scrollbar grid min-h-0 flex-1 auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto pb-2 2xl:auto-cols-[300px]"
        onWheel={handleBoardWheel}
      >
        {columns.map((column) => (
          <TicketStatusColumnView key={column.id} column={column} loading={isLoading} />
        ))}
      </section>
    </div>
  );
}

function createEmptyTicketStatusColumns(): TicketStatusColumn[] {
  return TICKET_STATUS_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    cards: [],
  }));
}

function handleBoardWheel(event: WheelEvent<HTMLElement>) {
  if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const board = event.currentTarget;
  if (board.scrollWidth <= board.clientWidth) return;

  event.preventDefault();
  board.scrollLeft += event.deltaY;
}

function TicketStatusColumnView({ column, loading }: { column: TicketStatusColumn; loading: boolean }) {
  const tone = getStatusColumnTone(column.id);
  return (
    <Card className="flex min-h-0 w-full flex-col overflow-hidden shadow-sm">
      <CardHeader className="flex-row items-center justify-between px-3 py-3">
        <CardTitle className="text-sm">{column.label}</CardTitle>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone.countClassName)}>
          {column.cards.length}
        </span>
      </CardHeader>
      <CardContent className="ticket-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2 pt-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)
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
  const pillClassName = getBusinessStatusPillClassName(ticket.businessStatus);

  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: ticket.supplyGoodsId }}
      className="block rounded-lg bg-slate-50 p-4 text-left transition hover:bg-white hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-950">{title}</div>
          <div className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-slate-500">{subtitle}</div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", pillClassName)}>
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
