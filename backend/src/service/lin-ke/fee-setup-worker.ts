import { Worker, type Job } from "bullmq";
import { getLinKeSettings, type LinKeSettings } from "./config.ts";
import {
  LIN_KE_FEE_SETUP_SAVE_VERSION,
  createDefaultLinKeFeeSetupClient,
  resolveLinKeMerchantId,
  type LinKeFeeSetupClient,
} from "./fee-setup.ts";
import {
  createBullMqLinKeFeeSetupQueue,
  LIN_KE_FEE_SETUP_JOB_NAME,
  LIN_KE_FEE_SETUP_QUEUE_NAME,
  LIN_KE_PRODUCT_TRACKING_JOB_NAME,
  LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS,
  LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS,
  type CreateLinKeFeeSetupJobData,
  type CreateLinKeProductTrackingJobData,
  type LinKeFeeSetupQueueClient,
  type LinKeFeeSetupQueueJobData,
  type LinKeFeeSetupQueueJobName,
} from "./fee-setup-queue.ts";
import {
  getDefaultLinKeRepository,
  type LinKeAccountConfig,
  type LinKeRepository,
} from "./repository.ts";
import { bdCityText } from "./supply-goods.ts";
import { LifePartnerSession, cookieConfigToHeader } from "./auth.ts";
import { cleanString, conciseError, type JsonRecord } from "./utils.ts";
import { getDefaultTicketRepository, type TicketRepository, type TicketWithSupplyGoods } from "../../tickets.ts";

export interface LinKeFeeSetupWorkerOptions {
  settings?: LinKeSettings;
  linKeRepository?: LinKeRepository | null;
  ticketRepository?: TicketRepository | null;
  client?: LinKeFeeSetupClient;
  queueClient?: LinKeFeeSetupQueueClient | null;
}

const FEE_SETUP_REFERER_PATH = "/vmok/op-merchant-list/workbench";

function readRedisUrl(): string {
  const redisUrl = Bun.env.REDIS_URL?.trim() || "";
  if (!redisUrl) {
    throw new Error("REDIS_URL 未配置，无法启动林客费用设置任务 worker");
  }
  return redisUrl;
}

function readWorkerConcurrency(): number {
  const value = Number.parseInt(Bun.env.LIN_KE_FEE_SETUP_WORKER_CONCURRENCY?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function readPayloadValue(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : null;
}

function makeSession(settings: LinKeSettings, accountConfig: LinKeAccountConfig): LifePartnerSession {
  const cookie = cookieConfigToHeader(accountConfig.cookie);
  if (!cookie) {
    throw new Error("empty_cookie");
  }
  const baseUrl = settings.lifePartnerBaseUrl.replace(/\/+$/, "");
  return new LifePartnerSession({
    cookie,
    timeout: settings.lifePartnerTimeout,
    baseUrl,
    referer: `${baseUrl}${FEE_SETUP_REFERER_PATH}`,
  });
}

function mergeTicketPayload(ticket: TicketWithSupplyGoods): JsonRecord {
  return {
    ...(ticket.sourcePayload ?? {}),
    ...ticket.payload,
  };
}

function resolveTicketCityText(ticket: TicketWithSupplyGoods): string {
  return bdCityText(ticket.payload)
    || bdCityText(ticket.sourcePayload ?? {})
    || bdCityText(mergeTicketPayload(ticket));
}

async function resolveAccountConfig(input: {
  ticket: TicketWithSupplyGoods;
  linKeRepository: LinKeRepository;
}): Promise<LinKeAccountConfig> {
  const cityText = resolveTicketCityText(input.ticket);
  if (!cityText) throw new Error("payload.bdCity.text is required");
  const accountConfig = await input.linKeRepository.findAccountConfigByCity(cityText);
  if (!accountConfig) throw new Error(`lin_ke_account_config_not_found_for_city:${cityText}`);
  return accountConfig;
}

function resolveTrackingInput(ticket: TicketWithSupplyGoods): {
  merchantId: string;
  linkeGoodsId: string;
} {
  const merchantId = resolveLinKeMerchantId(ticket.payload, ticket.sourcePayload ?? {});
  const linkeGoodsId = cleanString(readPayloadValue(ticket.payload, "linkeGoodsId"));
  if (!merchantId) throw new Error("company.guestId 不能为空");
  if (!linkeGoodsId) throw new Error("linkeGoodsId 不能为空");
  return { merchantId, linkeGoodsId };
}

async function recordFeeSetupFailure(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  jobId: string;
  error: unknown;
}): Promise<void> {
  await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_fee_setup_failed",
    origin: {},
    current: {
      linkeFeeSetupState: "failed",
      linkeFeeSetupError: conciseError(input.error),
      linkeFeeSetupFailedAt: new Date().toISOString(),
      linkeFeeSetupSaveSubmitted: false,
      linkeFeeSetupSaveVersion: "",
    },
    operator: {
      source: "lin_ke_fee_setup_worker",
      jobId: input.jobId,
      error: conciseError(input.error),
    },
    remark: `林客费用设置失败：${conciseError(input.error)}`,
  });
}

async function recordProductTrackingFailure(input: {
  ticketRepository: TicketRepository;
  supplyGoodsId: string;
  jobId: string;
  error: unknown;
  feeStatus?: string;
  productStatus?: string;
  startedAt?: string;
  checkedAtMs?: number;
  checkCount?: number;
}): Promise<void> {
  await input.ticketRepository.createActionRecord({
    supplyGoodsId: input.supplyGoodsId,
    action: "lin_ke_product_tracking_failed",
    origin: {},
    current: {
      linkeProductTrackingState: "failed",
      linkeProductTrackingError: conciseError(input.error),
      linkeProductTrackingFailedAt: new Date().toISOString(),
      linkeFeeStatus: input.feeStatus ?? "",
      linkeProductStatus: input.productStatus ?? "",
      ...buildProductTrackingProgressPayload({
        startedAt: input.startedAt ?? "",
        checkedAtMs: input.checkedAtMs ?? Date.now(),
        lastCheckCount: input.checkCount ?? 0,
        nextCheckAtMs: null,
        nextCheckCount: 0,
      }),
    },
    operator: {
      source: "lin_ke_fee_setup_worker",
      jobId: input.jobId,
      error: conciseError(input.error),
    },
    remark: `林客商品状态追踪失败：${conciseError(input.error)}`,
  });
}

function parseStartedAt(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function buildProductTrackingProgressPayload(input: {
  startedAt: string;
  checkedAtMs: number;
  lastCheckCount: number;
  nextCheckAtMs: number | null;
  nextCheckCount: number;
}): JsonRecord {
  const startedAtMs = parseStartedAt(input.startedAt);
  return {
    linkeProductTrackingStartedAt: new Date(startedAtMs).toISOString(),
    linkeProductTrackingTimeoutAt: new Date(startedAtMs + LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS).toISOString(),
    linkeProductTrackingNextCheckAt: input.nextCheckAtMs === null ? "" : new Date(input.nextCheckAtMs).toISOString(),
    linkeProductTrackingLastCheckedAt: new Date(input.checkedAtMs).toISOString(),
    linkeProductTrackingLastCheckCount: input.lastCheckCount,
    linkeProductTrackingNextCheckCount: input.nextCheckCount,
  };
}

export async function processLinKeFeeSetupJob(input: {
  supplyGoodsId: string;
  merchantId: string;
  linkeGoodsId: string;
  rates: CreateLinKeFeeSetupJobData["rates"];
  jobId: string;
  settings: LinKeSettings;
  linKeRepository: LinKeRepository;
  ticketRepository: TicketRepository;
  client: LinKeFeeSetupClient;
}): Promise<JsonRecord> {
  const supplyGoodsId = cleanString(input.supplyGoodsId);
  const requestedMerchantId = cleanString(input.merchantId);
  const linkeGoodsId = cleanString(input.linkeGoodsId);
  if (!supplyGoodsId) throw new Error("supplyGoodsId 不能为空");
  if (!requestedMerchantId) throw new Error("merchantId 不能为空");
  if (!linkeGoodsId) throw new Error("linkeGoodsId 不能为空");

  try {
    const ticket = await input.ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) throw new Error("工单不存在");
    const merchantId = resolveLinKeMerchantId(ticket.payload, ticket.sourcePayload ?? {});
    if (!merchantId) throw new Error("company.guestId 不能为空");
    if (requestedMerchantId !== merchantId) throw new Error("merchantId 与 company.guestId 不一致");

    const accountConfig = await resolveAccountConfig({
      ticket,
      linKeRepository: input.linKeRepository,
    });
    const session = makeSession(input.settings, accountConfig);
    const result = await input.client.setupFee({
      session,
      accountConfig,
      merchantId,
      linkeGoodsId,
      rates: input.rates,
    });

    const actionResult = await input.ticketRepository.createActionRecord({
      supplyGoodsId,
      action: "lin_ke_fee_setup_completed",
      origin: {
        linkeFeeSetupState: readPayloadValue(ticket.payload, "linkeFeeSetupState"),
        linkeFeeSettingUrl: readPayloadValue(ticket.payload, "linkeFeeSettingUrl"),
        linkeFeeSetupError: readPayloadValue(ticket.payload, "linkeFeeSetupError"),
        linkeFeeSetupSaveSubmitted: readPayloadValue(ticket.payload, "linkeFeeSetupSaveSubmitted"),
        linkeFeeSetupSaveVersion: readPayloadValue(ticket.payload, "linkeFeeSetupSaveVersion"),
      },
      current: {
        linkeGoodsId,
        linkeMerchantId: merchantId,
        linkeFeeRates: input.rates,
        linkeFeeSetupState: "completed",
        linkeFeeSettingUrl: result.feeSettingUrl,
        linkeFeeSetupError: "",
        linkeFeeSetupCompletedAt: new Date().toISOString(),
        linkeFeeSetupSaveSubmitted: true,
        linkeFeeSetupSaveVersion: LIN_KE_FEE_SETUP_SAVE_VERSION,
      },
      operator: {
        source: "lin_ke_fee_setup_worker",
        jobId: input.jobId,
      },
      remark: "林客费用设置已提交审核，等待人工核对后确认同步",
    });
    if (!actionResult) throw new Error("写入费用设置完成动作失败");

    return {
      ok: true,
      supplyGoodsId,
      linkeGoodsId,
      merchantId,
      feeSettingUrl: result.feeSettingUrl,
    };
  } catch (error) {
    await recordFeeSetupFailure({
      ticketRepository: input.ticketRepository,
      supplyGoodsId,
      jobId: input.jobId,
      error,
    }).catch((recordError) => {
      console.warn(`[Lin-Ke] 写入费用设置失败动作记录失败: ${conciseError(recordError)}`);
    });
    throw error;
  }
}

export async function processLinKeProductTrackingJob(input: {
  supplyGoodsId: string;
  startedAt: string;
  checkCount: number;
  jobId: string;
  settings: LinKeSettings;
  linKeRepository: LinKeRepository;
  ticketRepository: TicketRepository;
  client: LinKeFeeSetupClient;
  queueClient: LinKeFeeSetupQueueClient;
}): Promise<JsonRecord> {
  const supplyGoodsId = cleanString(input.supplyGoodsId);
  if (!supplyGoodsId) throw new Error("supplyGoodsId 不能为空");
  let failureRecorded = false;

  try {
    const ticket = await input.ticketRepository.getTicket(supplyGoodsId);
    if (!ticket) throw new Error("工单不存在");
    const { merchantId, linkeGoodsId } = resolveTrackingInput(ticket);
    const accountConfig = await resolveAccountConfig({
      ticket,
      linKeRepository: input.linKeRepository,
    });
    const session = makeSession(input.settings, accountConfig);
    const status = await input.client.getProductStatus({
      session,
      accountConfig,
      merchantId,
      linkeGoodsId,
    });
    const now = Date.now();
    const startedAtMs = parseStartedAt(input.startedAt);
    const startedAt = new Date(startedAtMs).toISOString();

    if (status.feeReady && status.productReady) {
      const actionResult = await input.ticketRepository.createActionRecord({
        supplyGoodsId,
        action: "product_online_confirmed",
        origin: {
          linkeProductTrackingState: readPayloadValue(ticket.payload, "linkeProductTrackingState"),
          linkeFeeStatus: readPayloadValue(ticket.payload, "linkeFeeStatus"),
          linkeProductStatus: readPayloadValue(ticket.payload, "linkeProductStatus"),
        },
        current: {
          productOnlineConfirmed: true,
          productOnlineConfirmedAt: new Date(now).toISOString(),
          linkeProductTrackingState: "completed",
          linkeProductTrackingError: "",
          linkeFeeStatus: status.feeStatus,
          linkeProductStatus: status.productStatus,
          ...buildProductTrackingProgressPayload({
            startedAt,
            checkedAtMs: now,
            lastCheckCount: input.checkCount,
            nextCheckAtMs: null,
            nextCheckCount: 0,
          }),
        },
        operator: {
          source: "lin_ke_fee_setup_worker",
          jobId: input.jobId,
          checkCount: input.checkCount,
        },
        remark: `林客商品状态达成：费用状态=${status.feeStatus || "-"}，商品状态=${status.productStatus || "-"}，自动确认上线`,
      });
      if (!actionResult) throw new Error("写入商品上线确认动作失败");
      return {
        ok: true,
        ready: true,
        supplyGoodsId,
        linkeGoodsId,
        merchantId,
        feeStatus: status.feeStatus,
        productStatus: status.productStatus,
      };
    }

    if (status.negative) {
      const error = new Error(`林客商品状态异常: 费用状态=${status.feeStatus || "-"} 商品状态=${status.productStatus || "-"}`);
      await recordProductTrackingFailure({
        ticketRepository: input.ticketRepository,
        supplyGoodsId,
        jobId: input.jobId,
        error,
        feeStatus: status.feeStatus,
        productStatus: status.productStatus,
        startedAt,
        checkedAtMs: now,
        checkCount: input.checkCount,
      });
      failureRecorded = true;
      throw error;
    }

    if (now - startedAtMs >= LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS) {
      const error = new Error("林客商品状态追踪超过 72 小时仍未完成");
      await recordProductTrackingFailure({
        ticketRepository: input.ticketRepository,
        supplyGoodsId,
        jobId: input.jobId,
        error,
        feeStatus: status.feeStatus,
        productStatus: status.productStatus,
        startedAt,
        checkedAtMs: now,
        checkCount: input.checkCount,
      });
      failureRecorded = true;
      throw error;
    }

    const nextCheckAtMs = now + LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS;
    const nextCheckCount = input.checkCount + 1;
    await input.ticketRepository.createActionRecord({
      supplyGoodsId,
      action: "lin_ke_product_tracking_checked",
      origin: {
        linkeProductTrackingState: readPayloadValue(ticket.payload, "linkeProductTrackingState"),
        linkeFeeStatus: readPayloadValue(ticket.payload, "linkeFeeStatus"),
        linkeProductStatus: readPayloadValue(ticket.payload, "linkeProductStatus"),
      },
      current: {
        linkeProductTrackingState: "waiting",
        linkeProductTrackingError: "",
        linkeFeeStatus: status.feeStatus,
        linkeProductStatus: status.productStatus,
        linkeProductTrackingCheckedAt: new Date(now).toISOString(),
        ...buildProductTrackingProgressPayload({
          startedAt,
          checkedAtMs: now,
          lastCheckCount: input.checkCount,
          nextCheckAtMs,
          nextCheckCount,
        }),
      },
      operator: {
        source: "lin_ke_fee_setup_worker",
        jobId: input.jobId,
        checkCount: input.checkCount,
      },
      remark: `林客商品状态尚未达成：费用状态=${status.feeStatus || "-"}，商品状态=${status.productStatus || "-"}，1 小时后自动重试`,
    });

    const nextJobId = await input.queueClient.addProductTrackingJob({
      supplyGoodsId,
      startedAt,
      checkCount: nextCheckCount,
    }, LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS);

    return {
      ok: true,
      ready: false,
      supplyGoodsId,
      linkeGoodsId,
      merchantId,
      feeStatus: status.feeStatus,
      productStatus: status.productStatus,
      nextJobId,
    };
  } catch (error) {
    if (!failureRecorded) {
      await recordProductTrackingFailure({
        ticketRepository: input.ticketRepository,
        supplyGoodsId,
        jobId: input.jobId,
        error,
        startedAt: input.startedAt,
        checkedAtMs: Date.now(),
        checkCount: input.checkCount,
      }).catch((recordError) => {
        console.warn(`[Lin-Ke] 写入商品状态追踪失败动作记录失败: ${conciseError(recordError)}`);
      });
    }
    throw error;
  }
}

export function createLinKeFeeSetupWorker(options: LinKeFeeSetupWorkerOptions = {}) {
  const settings = options.settings ?? getLinKeSettings();
  const linKeRepository = options.linKeRepository !== undefined ? options.linKeRepository : getDefaultLinKeRepository();
  const ticketRepository = options.ticketRepository !== undefined ? options.ticketRepository : getDefaultTicketRepository();
  const client = options.client ?? createDefaultLinKeFeeSetupClient();
  const connection = { url: readRedisUrl() };
  const queueClient = options.queueClient !== undefined
    ? options.queueClient
    : createBullMqLinKeFeeSetupQueue(connection);

  if (!linKeRepository) {
    throw new Error("DATABASE_URL 未配置，Lin-Ke repository 不可用");
  }
  if (!ticketRepository) {
    throw new Error("DATABASE_URL 未配置，ticket repository 不可用");
  }
  if (!queueClient) {
    throw new Error("REDIS_URL 未配置，林客费用设置任务队列不可用");
  }

  const worker = new Worker<LinKeFeeSetupQueueJobData, JsonRecord, LinKeFeeSetupQueueJobName>(
    LIN_KE_FEE_SETUP_QUEUE_NAME,
    async (job: Job<LinKeFeeSetupQueueJobData, JsonRecord, LinKeFeeSetupQueueJobName>) => {
      if (job.name === LIN_KE_FEE_SETUP_JOB_NAME) {
        const data = job.data as CreateLinKeFeeSetupJobData;
        return await processLinKeFeeSetupJob({
          supplyGoodsId: data.supplyGoodsId,
          merchantId: data.merchantId,
          linkeGoodsId: data.linkeGoodsId,
          rates: data.rates,
          jobId: String(job.id),
          settings,
          linKeRepository,
          ticketRepository,
          client,
        });
      }
      if (job.name === LIN_KE_PRODUCT_TRACKING_JOB_NAME) {
        const data = job.data as CreateLinKeProductTrackingJobData;
        return await processLinKeProductTrackingJob({
          supplyGoodsId: data.supplyGoodsId,
          startedAt: data.startedAt,
          checkCount: data.checkCount,
          jobId: String(job.id),
          settings,
          linKeRepository,
          ticketRepository,
          client,
          queueClient,
        });
      }
      throw new Error(`未知林客费用设置任务: ${job.name}`);
    },
    {
      connection,
      concurrency: readWorkerConcurrency(),
    },
  );

  const originalClose = worker.close.bind(worker);
  worker.close = async (force?: boolean): Promise<void> => {
    await originalClose(force);
    if (options.queueClient === undefined) {
      await queueClient.close?.();
    }
  };

  return worker;
}
