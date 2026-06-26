import { Worker, type Job } from "bullmq";
import { getLinKeSettings, type LinKeSettings } from "./config.ts";
import {
  LIN_KE_DRAFT_JOB_NAME,
  LIN_KE_DRAFT_QUEUE_NAME,
  type CreateLinKeDraftJobData,
} from "./draft-queue.ts";
import {
  getDefaultLinKeRepository,
  type LinKeRepository,
} from "./repository.ts";
import { bdCityText } from "./supply-goods.ts";
import { saveSupplyGoodsDraft } from "./service.ts";
import { cleanString, conciseError, isRecord, type JsonRecord } from "./utils.ts";
import { getDefaultTicketRepository, type TicketRepository } from "../tickets.ts";

export interface LinKeDraftWorkerOptions {
  settings?: LinKeSettings;
  linKeRepository?: LinKeRepository | null;
  ticketRepository?: TicketRepository | null;
  saveDraft?: typeof saveSupplyGoodsDraft;
}

function readRedisUrl(): string {
  const redisUrl = Bun.env.REDIS_URL?.trim() || "";
  if (!redisUrl) {
    throw new Error("REDIS_URL 未配置，无法启动林客草稿任务 worker");
  }
  return redisUrl;
}

function readWorkerConcurrency(): number {
  const value = Number.parseInt(Bun.env.LIN_KE_DRAFT_WORKER_CONCURRENCY?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
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
  await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_draft_failed",
    origin: {},
    current: {},
    operator: {
      source: "lin_ke_draft_worker",
      jobId: input.jobId,
      error: conciseError(input.error),
    },
    remark: `林客草稿创建失败：${conciseError(input.error)}`,
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
      },
      current: {
        linkeDraftUrl: draftUrl,
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

export function createLinKeDraftWorker(options: LinKeDraftWorkerOptions = {}) {
  const settings = options.settings ?? getLinKeSettings();
  const linKeRepository = options.linKeRepository !== undefined ? options.linKeRepository : getDefaultLinKeRepository();
  const ticketRepository = options.ticketRepository !== undefined ? options.ticketRepository : getDefaultTicketRepository();
  const saveDraft = options.saveDraft ?? saveSupplyGoodsDraft;

  if (!linKeRepository) {
    throw new Error("DATABASE_URL 未配置，Lin-Ke repository 不可用");
  }
  if (!ticketRepository) {
    throw new Error("DATABASE_URL 未配置，ticket repository 不可用");
  }

  return new Worker<CreateLinKeDraftJobData, JsonRecord, typeof LIN_KE_DRAFT_JOB_NAME>(
    LIN_KE_DRAFT_QUEUE_NAME,
    async (job: Job<CreateLinKeDraftJobData, JsonRecord, typeof LIN_KE_DRAFT_JOB_NAME>) => {
      return await processLinKeDraftJob({
        supplyGoodsId: job.data.supplyGoodsId,
        jobId: String(job.id),
        settings,
        linKeRepository,
        ticketRepository,
        saveDraft,
      });
    },
    {
      connection: { url: readRedisUrl() },
      concurrency: readWorkerConcurrency(),
    },
  );
}
