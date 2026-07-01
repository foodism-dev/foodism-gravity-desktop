import { Worker, type Job } from "bullmq";
import { installConsoleTimestamp } from "../logger.ts";
import { getLinKeSettings, type LinKeSettings } from "../service/lin-ke/config.ts";
import { processLinKeDraftJob } from "../service/lin-ke/draft-worker.ts";
import { createLinKeFeeSetupWorker } from "../service/lin-ke/fee-setup-worker.ts";
import { getDefaultLinKeRepository, type LinKeRepository } from "../service/lin-ke/repository.ts";
import { saveSupplyGoodsDraft } from "../service/lin-ke/service.ts";
import { conciseError } from "../service/lin-ke/utils.ts";
import type { JsonRecord } from "../service/lin-ke/utils.ts";
import { getDefaultRebuildAssetUploader, type RebuildAssetUploader } from "../service/rebuild/assets.ts";
import { getDefaultRebuildFieldMetadataRepository, type RebuildFieldMetadataRepository } from "../service/rebuild/fields.ts";
import {
  processImportFromSupplyGoodsJob,
  type ImportFromSupplyGoodsWorkerOptions,
} from "../service/rebuild/import-from-supplygoods-worker.ts";
import {
  createRebuildSupplyGoodsClient,
  getDefaultSupplyGoodsRecordRepository,
  type RebuildSupplyGoodsClient,
  type SupplyGoodsRecordRepository,
} from "../service/rebuild/supplygoods.ts";
import {
  getDefaultRebuildSupplierRecordRepository,
  syncSupplyCompanyFromCallback,
  syncSupplyHostFromCallback,
  type RebuildSupplierRecordRepository,
} from "../service/rebuild/suppliers.ts";
import { getDefaultTicketRepository, type TicketRepository } from "../tickets.ts";
import {
  getDefaultGravityJobsQueue,
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
  REBUILD_SUPPLIER_SYNC_JOB_NAME,
} from "./queue.ts";
import type {
  CreateLinKeDraftJobData,
  GravityJobData,
  GravityJobName,
  GravityJobResult,
  ImportFromSupplyGoodsJobData,
  RebuildSupplierSyncJobData,
} from "./types.ts";

export interface GravityJobProcessorOptions extends ImportFromSupplyGoodsWorkerOptions {
  rebuildClient?: RebuildSupplyGoodsClient;
  repository?: SupplyGoodsRecordRepository | null;
  supplierRepository?: RebuildSupplierRecordRepository | null;
  fieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
  linKeSettings?: LinKeSettings;
  linKeRepository?: LinKeRepository | null;
  ticketRepository?: TicketRepository | null;
  saveDraft?: typeof saveSupplyGoodsDraft;
}

export type GravityJobsRuntimeMode = "all" | "scheduler" | "worker";

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

export function resolveGravityJobsRuntimeMode(
  args: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = Bun.env,
): GravityJobsRuntimeMode {
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const modeValue = modeArg?.slice("--mode=".length) || env.GRAVITY_JOBS_RUNTIME_MODE?.trim() || "";
  if (args.includes("--scheduler") || modeValue === "scheduler") return "scheduler";
  if (args.includes("--worker") || modeValue === "worker") return "worker";
  if (args.includes("--all") || modeValue === "all") return "all";
  return "all";
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

function normalizeRebuildSupplierSyncJobData(data: unknown): RebuildSupplierSyncJobData {
  if (!isRecord(data)) {
    throw new Error("销售提报商户/公司同步任务 payload 无效");
  }
  const entityName = data.entityName;
  const recordId = typeof data.recordId === "string" ? data.recordId.trim() : "";
  const supplyGoodsId = typeof data.supplyGoodsId === "string" ? data.supplyGoodsId.trim() : "";
  if (entityName !== "SupplyCompany" && entityName !== "SupplyHost") {
    throw new Error("销售提报商户/公司同步任务 entityName 无效");
  }
  if (!recordId) {
    throw new Error("销售提报商户/公司同步任务缺少 recordId");
  }
  return {
    entityName,
    recordId,
    source: "supply_goods_callback",
    supplyGoodsId,
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

function resolveSupplierSyncDependencies(options: GravityJobProcessorOptions): {
  rebuildClient: RebuildSupplyGoodsClient;
  repository: RebuildSupplierRecordRepository;
  fieldMetadataRepository: RebuildFieldMetadataRepository | null;
  assetUploader?: RebuildAssetUploader | null;
} {
  const fieldMetadataRepository =
    options.fieldMetadataRepository !== undefined ? options.fieldMetadataRepository : getDefaultRebuildFieldMetadataRepository();
  const rebuildClient = options.rebuildClient ?? createRebuildSupplyGoodsClient({
    fieldMetadataRepository,
  });
  const repository = options.supplierRepository !== undefined ? options.supplierRepository : getDefaultRebuildSupplierRecordRepository();
  const assetUploader = options.assetUploader !== undefined ? options.assetUploader : getDefaultRebuildAssetUploader();

  if (!repository) {
    throw new Error("DATABASE_URL 未配置，销售提报商户/公司 repository 不可用");
  }

  return {
    rebuildClient,
    repository,
    fieldMetadataRepository,
    assetUploader,
  };
}

function listSupplierFields(
  repository: RebuildFieldMetadataRepository | null,
  entityName: "SupplyCompany" | "SupplyHost",
): (() => Promise<Awaited<ReturnType<RebuildFieldMetadataRepository["listFieldsByEntity"]>>>) | undefined {
  if (!repository) return undefined;
  return () => repository.listFieldsByEntity(entityName);
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
  if (input.name === REBUILD_SUPPLIER_SYNC_JOB_NAME) {
    const jobData = normalizeRebuildSupplierSyncJobData(input.data);
    const dependencies = resolveSupplierSyncDependencies(input.options ?? {});
    const rawPayload = {
      source: jobData.source,
      supplyGoodsId: jobData.supplyGoodsId,
    };
    if (jobData.entityName === "SupplyCompany") {
      const result = await syncSupplyCompanyFromCallback({
        supplyCompanyId: jobData.recordId,
        rawPayload,
        rebuildClient: dependencies.rebuildClient,
        repository: dependencies.repository,
        assetUploader: dependencies.assetUploader,
        listFields: listSupplierFields(dependencies.fieldMetadataRepository, "SupplyCompany"),
      });
      return {
        ok: true,
        entityName: result.entityName,
        recordId: result.recordId,
      };
    }

    const result = await syncSupplyHostFromCallback({
      supplyHostId: jobData.recordId,
      rawPayload,
      rebuildClient: dependencies.rebuildClient,
      repository: dependencies.repository,
      assetUploader: dependencies.assetUploader,
      listFields: listSupplierFields(dependencies.fieldMetadataRepository, "SupplyHost"),
    });
    return {
      ok: true,
      entityName: result.entityName,
      recordId: result.recordId,
    };
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

function bindGravityWorkerLogs(worker: ReturnType<typeof createGravityJobsWorker>): void {
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
    if (job.name === REBUILD_SUPPLIER_SYNC_JOB_NAME) {
      const supplierResult = result as JsonRecord;
      console.log(`[JOBS] 销售提报商户/公司同步完成: job=${job.id} entity=${supplierResult.entityName ?? ""} recordId=${supplierResult.recordId ?? ""}`);
      return;
    }
    console.log(`[JOBS] 任务完成: name=${job.name} job=${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.warn(`[JOBS] 任务失败: name=${job?.name ?? "<unknown>"} job=${job?.id ?? "<unknown>"} error=${conciseError(error)}`);
  });
}

function bindLinKeWorkerLogs(worker: ReturnType<typeof createLinKeFeeSetupWorker>): void {
  worker.on("completed", (job) => {
    console.log(`[JOBS] 林客费用设置/商品追踪任务完成: job=${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.warn(`[JOBS] 林客费用设置/商品追踪任务失败: job=${job?.id ?? "<unknown>"} error=${conciseError(error)}`);
  });
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  let closing = false;
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().finally(resolve);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

async function main() {
  installConsoleTimestamp();

  const mode = resolveGravityJobsRuntimeMode();
  const closeHandlers: Array<() => Promise<void> | void> = [];

  if (mode === "scheduler" || mode === "all") {
    const queue = getDefaultGravityJobsQueue();
    if (!queue) {
      throw new Error("REDIS_URL 未配置，无法启动 Gravity jobs 队列");
    }
    const jobsQueue = queue;
    const scheduledJobIds = await jobsQueue.schedulePeriodicJobs();
    console.log(`[JOBS] Gravity jobs 定时任务已注册: jobs=${scheduledJobIds.join(",")}`);
    closeHandlers.push(() => jobsQueue.close?.());
  }

  if (mode === "worker" || mode === "all") {
    const worker = createGravityJobsWorker();
    const feeSetupWorker = createLinKeFeeSetupWorker();
    bindGravityWorkerLogs(worker);
    bindLinKeWorkerLogs(feeSetupWorker);
    closeHandlers.push(() => worker.close(), () => feeSetupWorker.close());
    console.log(`[JOBS] Gravity jobs worker 已启动: queue=${GRAVITY_JOBS_QUEUE_NAME}`);
    console.log("[JOBS] 林客费用设置/商品追踪 worker 已启动");
  }

  if (mode === "scheduler") {
    const keepAlive = setInterval(() => undefined, 60 * 60 * 1000);
    closeHandlers.push(() => {
      clearInterval(keepAlive);
    });
    console.log(`[JOBS] Gravity jobs scheduler 已启动: queue=${GRAVITY_JOBS_QUEUE_NAME}`);
  }

  await waitForShutdown(async () => {
    await Promise.all(closeHandlers.map((close) => close()));
  });
}

if (import.meta.main) {
  void main();
}
