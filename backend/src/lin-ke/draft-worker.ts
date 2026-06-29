import type { LinKeSettings } from "./config.ts";
import type { LinKeRepository } from "./repository.ts";
import { bdCityText } from "./supply-goods.ts";
import { saveSupplyGoodsDraft } from "./service.ts";
import { cleanString, conciseError, isRecord, type JsonRecord } from "./utils.ts";
import type { TicketRepository } from "../tickets.ts";

export interface LinKeDraftWorkerOptions {
  settings?: LinKeSettings;
  linKeRepository?: LinKeRepository | null;
  ticketRepository?: TicketRepository | null;
  saveDraft?: typeof saveSupplyGoodsDraft;
}

function readPayloadValue(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : null;
}

async function recordDraftFailure(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  jobId: string;
  error: unknown;
}): Promise<void> {
  const errorMessage = conciseError(input.error);
  await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_draft_failed",
    origin: {},
    current: {
      linkeDraftState: "failed",
      linkeDraftError: errorMessage,
      linkeDraftFailedAt: new Date().toISOString(),
    },
    operator: {
      source: "lin_ke_draft_worker",
      jobId: input.jobId,
      error: errorMessage,
    },
    remark: `林客草稿创建失败：${errorMessage}`,
  });
}

export async function processLinKeDraftJob(input: {
  supplyGoodsId: string;
  jobId: string;
  settings: LinKeSettings;
  linKeRepository: LinKeRepository;
  ticketRepository: TicketRepository;
  saveDraft: typeof saveSupplyGoodsDraft;
}): Promise<JsonRecord> {
  const supplyGoodsId = cleanString(input.supplyGoodsId);
  if (!supplyGoodsId) throw new Error("supplyGoodsId 不能为空");

  try {
    const ticket = await input.ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) throw new Error("工单不存在");
    const payload = ticket.payload;
    const cityText = bdCityText(payload);
    if (!cityText) throw new Error("payload.bdCity.text is required");
    const accountConfig = await input.linKeRepository.findAccountConfigByCity(cityText);
    if (!accountConfig) throw new Error(`lin_ke_account_config_not_found_for_city:${cityText}`);

    const result = await input.saveDraft({
      settings: input.settings,
      repository: input.linKeRepository,
      payload,
      accountConfig,
      supplyGoodsId,
    });
    const draftUrl = isRecord(result) ? cleanString(result.draftUrl) : "";
    if (!draftUrl) throw new Error("林客未返回草稿链接");

    await input.ticketRepository.createActionRecord({
      supplyGoodsId,
      action: "info_optimized",
      origin: {
        linkeDraftUrl: readPayloadValue(payload, "linkeDraftUrl"),
        linkeDraftState: readPayloadValue(payload, "linkeDraftState"),
        linkeDraftError: readPayloadValue(payload, "linkeDraftError"),
      },
      current: {
        linkeDraftUrl: draftUrl,
        linkeDraftState: "completed",
        linkeDraftError: "",
        linkeDraftCompletedAt: new Date().toISOString(),
      },
      operator: {
        source: "lin_ke_draft_worker",
        jobId: input.jobId,
      },
      remark: "林客草稿创建成功，确认采用信息优化结果",
    });

    return {
      ok: true,
      supplyGoodsId,
      draftUrl,
    };
  } catch (error) {
    await recordDraftFailure({
      ticketRepository: input.ticketRepository,
      supplyGoodsId,
      jobId: input.jobId,
      error,
    }).catch((recordError) => {
      console.warn(`[Lin-Ke] 写入草稿失败动作记录失败: ${conciseError(recordError)}`);
    });
    throw error;
  }
}
