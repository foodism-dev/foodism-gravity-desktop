import type { TicketRecord } from "./api.ts";

export interface TicketInfoOptimizationResult {
  generation: number;
  origin: {
    goodsName: string;
    goodsNameInput: string;
  };
  current: {
    goodsName: string;
    goodsNameInput: string;
  };
}

export async function requestTicketInfoOptimization(
  ticket: TicketRecord,
  generation: number,
): Promise<TicketInfoOptimizationResult> {
  const originTitle = readTitle(ticket);
  return {
    generation,
    origin: {
      goodsName: originTitle,
      goodsNameInput: originTitle,
    },
    current: {
      goodsName: `${originTitle}｜AI优化版${generation}`,
      goodsNameInput: `${originTitle}｜AI优化版${generation}`,
    },
  };
}

function readTitle(ticket: TicketRecord): string {
  return readString(ticket.payload.goodsNameInput)
    || readString(ticket.payload.goodsName)
    || readString(ticket.sourcePayload.goodsNameInput)
    || readString(ticket.sourcePayload.goodsName)
    || "未命名商品";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
