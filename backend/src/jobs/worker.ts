import { Worker, type Job } from "bullmq";
import { installConsoleTimestamp } from "../logger.ts";
import { getLinKeSettings, type LinKeSettings } from "../lin-ke/config.ts";
import { processLinKeDraftJob } from "../lin-ke/draft-worker.ts";
import { createLinKeFeeSetupWorker } from "../lin-ke/fee-setup-worker.ts";
import { getDefaultLinKeRepository, type LinKeRepository } from "../lin-ke/repository.ts";
import { saveSupplyGoodsDraft } from "../lin-ke/service.ts";
import { conciseError } from "../lin-ke/utils.ts";
import type { JsonRecord } from "../lin-ke/utils.ts";
import { getDefaultRebuildAssetUploader, type RebuildAssetUploader } from "../rebuild/assets.ts";
import { getDefaultRebuildFieldMetadataRepository, type RebuildFieldMetadataRepository } from "../rebuild/fields.ts";
import {
  processImportFromSupplyGoodsJob,
  type ImportFromSupplyGoodsWorkerOptions,
} from "../rebuild/import-from-supplygoods-worker.ts";
import {
  createRebuildSupplyGoodsClient,
  getDefaultSupplyGoodsRecordRepository,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "../rebuild/supplygoods.ts";
import { getDefaultTicketRepository, type TicketRepository } from "../tickets.ts";
import {
  getDefaultGravityJobsQueue,
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
} from "./queue.ts";
import type {
  CreateLinKeDraftJobData,
  GravityJobData,
  GravityJobName,
  GravityJobResult,
  ImportFromSupplyGoodsJobData,
} from "./types.ts";

export interface GravityJobProcessorOptions extends ImportFromSupplyGoodsWorkerOptions {
  rebuildClient?: RebuildSupplyGoodsClient;
  repository?: SupplyGoodsRecordRepository | null;
  fieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
  linKeSettings?: LinKeSettings;
  linKeRepository?: LinKeRepository | null;
  ticketRepository?: TicketRepository | null;
  saveDraft?: typeof saveSupplyGoodsDraft;
}

function readRedisUrl(): string {
  const redisUrl = Bun.env.REDIS_URL?.trim() || "";
  if (!redisUrl) {
    throw new Error("REDIS_URL 未配置，无法启动 Gravity jobs worker");
  }
  return redisUrl;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(Bun.env[name]?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeImportFromSupplyGoodsJobData(data: unknown): ImportFromSupplyGoodsJobData {
  if (!isRecord(data)) return {};
  return {
    pageNo: typeof data.pageNo === "number" ? data.pageNo : undefined,
    pageSize: typeof data.pageSize === "number" ? data.pageSize : undefined,
    pages: typeof data.pages === "number" ? data.pages : undefined,
  };
}

function normalizeLinKeDraftJobData(data: unknown): CreateLinKeDraftJobData {
  if (!isRecord(data) || typeof data.supplyGoodsId !== "string") {
    throw new Error("Lin-Ke 草稿任务缺少 supplyGoodsId");
  }
  return {
    supplyGoodsId: data.supplyGoodsId,
  };
}

function resolveImportFromSupplyGoodsDependencies(options: GravityJobProcessorOptions): {
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
  fieldMetadataRepository: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
} {
  const fieldMetadataRepository =
    options.fieldMetadataRepository !== undefined ? options.fieldMetadataRepository : getDefaultRebuildFieldMetadataRepository();
  const rebuildClient = options.rebuildClient ?? createRebuildSupplyGoodsClient({
    fieldMetadataRepository,
  });
  const repository = options.repository !== undefined ? options.repository : getDefaultSupplyGoodsRecordRepository();
  const assetUploader = options.assetUploader !== undefined ? options.assetUploader : getDefaultRebuildAssetUploader();

  if (!repository) {
    throw new Error("DATABASE_URL 未配置，从 SupplyGoods 导入 repository 不可用");
  }

  return {
    rebuildClient,
    repository,
    fieldMetadataRepository,
    assetUploader,
  };
}

function resolveLinKeDraftDependencies(options: GravityJobProcessorOptions): {
  settings: LinKeSettings;
  linKeRepository: LinKeRepository;
  ticketRepository: TicketRepository;
  saveDraft: typeof saveSupplyGoodsDraft;
} {
  const settings = options.linKeSettings ?? getLinKeSettings();
  const linKeRepository = options.linKeRepository !== undefined ? options.linKeRepository : getDefaultLinKeRepository();
  const ticketRepository = options.ticketRepository !== undefined ? options.ticketRepository : getDefaultTicketRepository();
  const saveDraft = options.saveDraft ?? saveSupplyGoodsDraft;

  if (!linKeRepository) {
    throw new Error("DATABASE_URL 未配置，Lin-Ke repository 不可用");
  }
  if (!ticketRepository) {
    throw new Error("DATABASE_URL 未配置，ticket repository 不可用");
  }

  return {
    settings,
    linKeRepository,
    ticketRepository,
    saveDraft,
  };
}

export async function processGravityJob(input: {
  name: string;
  data: unknown;
  jobId?: string;
  options?: GravityJobProcessorOptions;
}): Promise<GravityJobResult> {
  if (input.name === REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME) {
    return await processImportFromSupplyGoodsJob({
      jobData: normalizeImportFromSupplyGoodsJobData(input.data),
      ...resolveImportFromSupplyGoodsDependencies(input.options ?? {}),
    });
  }
  if (input.name === LIN_KE_DRAFT_JOB_NAME) {
    const jobData = normalizeLinKeDraftJobData(input.data);
    return await processLinKeDraftJob({
      supplyGoodsId: jobData.supplyGoodsId,
      jobId: input.jobId ?? "",
      ...resolveLinKeDraftDependencies(input.options ?? {}),
    });
  }
  throw new Error(`未注册的 Gravity job: ${input.name}`);
}

export function createGravityJobsWorker(options: GravityJobProcessorOptions = {}) {
  return new Worker<GravityJobData, GravityJobResult, GravityJobName>(
    GRAVITY_JOBS_QUEUE_NAME,
    async (job: Job<GravityJobData, GravityJobResult, GravityJobName>) => {
      return await processGravityJob({
        name: job.name,
        data: job.data,
        jobId: String(job.id),
        options,
      });
    },
    {
      connection: { url: readRedisUrl() },
      concurrency: readPositiveInteger("GRAVITY_JOBS_WORKER_CONCURRENCY", 1),
    },
  );
}

async function main() {
  installConsoleTimestamp();

  const queue = getDefaultGravityJobsQueue();
  if (!queue) {
    throw new Error("REDIS_URL 未配置，无法启动 Gravity jobs 队列");
  }
  const jobsQueue = queue;

  const scheduledJobIds = await jobsQueue.schedulePeriodicJobs();
  console.log(`[JOBS] Gravity jobs 定时任务已注册: jobs=${scheduledJobIds.join(",")}`);

  const worker = createGravityJobsWorker();
  const feeSetupWorker = createLinKeFeeSetupWorker();

  worker.on("completed", (job, result) => {
    if (job.name === REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME) {
      const importResult = result as Awaited<ReturnType<typeof processImportFromSupplyGoodsJob>>;
      console.log(
        `[JOBS] 从 SupplyGoods 导入完成: job=${job.id} listed=${importResult.listed} missing=${importResult.missing} synced=${importResult.synced} failed=${importResult.failed}`,
      );
      return;
    }
    if (job.name === LIN_KE_DRAFT_JOB_NAME) {
      const draftResult = result as JsonRecord;
      console.log(`[JOBS] 林客草稿任务完成: job=${job.id} supplyGoodsId=${draftResult.supplyGoodsId ?? ""}`);
      return;
    }
    console.log(`[JOBS] 任务完成: name=${job.name} job=${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.warn(`[JOBS] 任务失败: name=${job?.name ?? "<unknown>"} job=${job?.id ?? "<unknown>"} error=${conciseError(error)}`);
  });

  feeSetupWorker.on("completed", (job) => {
    console.log(`[JOBS] 林客费用设置/商品追踪任务完成: job=${job.id}`);
  });

  feeSetupWorker.on("failed", (job, error) => {
    console.warn(`[JOBS] 林客费用设置/商品追踪任务失败: job=${job?.id ?? "<unknown>"} error=${conciseError(error)}`);
  });

  console.log(`[JOBS] Gravity jobs worker 已启动: queue=${GRAVITY_JOBS_QUEUE_NAME}`);
  console.log("[JOBS] 林客费用设置/商品追踪 worker 已启动");

  async function shutdown() {
    await Promise.all([
      worker.close(),
      feeSetupWorker.close(),
      jobsQueue.close?.(),
    ]);
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

if (import.meta.main) {
  void main();
}
