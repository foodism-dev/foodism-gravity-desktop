import { Queue } from "bullmq";
import type { LinKeFeeRates } from "./fee-setup.ts";
import type { JsonRecord } from "./utils.ts";

export const LIN_KE_FEE_SETUP_QUEUE_NAME = "lin-ke-fee-setup";
export const LIN_KE_FEE_SETUP_JOB_NAME = "setup-fee";
export const LIN_KE_PRODUCT_TRACKING_JOB_NAME = "track-product";
export const LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS = 60 * 60 * 1000;
export const LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS = 72 * 60 * 60 * 1000;

export interface CreateLinKeFeeSetupJobData {
  supplyGoodsId: string;
  merchantId: string;
  linkeGoodsId: string;
  rates: LinKeFeeRates;
}

export interface CreateLinKeProductTrackingJobData {
  supplyGoodsId: string;
  startedAt: string;
  checkCount: number;
}

export type LinKeFeeSetupQueueJobData =
  | CreateLinKeFeeSetupJobData
  | CreateLinKeProductTrackingJobData;

export type LinKeFeeSetupQueueJobName =
  | typeof LIN_KE_FEE_SETUP_JOB_NAME
  | typeof LIN_KE_PRODUCT_TRACKING_JOB_NAME;

export interface LinKeJobStatus {
  jobId: string;
  state: string;
  failedReason: string;
  returnValue: JsonRecord | null;
}

export interface LinKeFeeSetupQueueClient {
  addFeeSetupJob: (input: CreateLinKeFeeSetupJobData) => Promise<string>;
  addProductTrackingJob: (input: CreateLinKeProductTrackingJobData, delayMs?: number) => Promise<string>;
  getFeeSetupJobStatus: (jobId: string) => Promise<LinKeJobStatus | null>;
  getProductTrackingJobStatus: (jobId: string) => Promise<LinKeJobStatus | null>;
  close?: () => Promise<void>;
}

function readRedisUrl(): string {
  return Bun.env.REDIS_URL?.trim() || "";
}

function makeConnectionOptions(): { url: string } | null {
  const redisUrl = readRedisUrl();
  return redisUrl ? { url: redisUrl } : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createBullMqLinKeFeeSetupQueue(
  connection = makeConnectionOptions(),
): LinKeFeeSetupQueueClient | null {
  if (!connection) {
    return null;
  }
  const queue = new Queue<LinKeFeeSetupQueueJobData, JsonRecord, LinKeFeeSetupQueueJobName>(
    LIN_KE_FEE_SETUP_QUEUE_NAME,
    {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      },
    },
  );

  async function getJobStatus(jobId: string): Promise<LinKeJobStatus | null> {
    const job = await queue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      jobId: String(job.id),
      state,
      failedReason: job.failedReason || "",
      returnValue: isJsonRecord(job.returnvalue) ? job.returnvalue : null,
    };
  }

  return {
    async addFeeSetupJob(input: CreateLinKeFeeSetupJobData): Promise<string> {
      const job = await queue.add(LIN_KE_FEE_SETUP_JOB_NAME, input);
      return String(job.id);
    },

    async addProductTrackingJob(input: CreateLinKeProductTrackingJobData, delayMs = 0): Promise<string> {
      const job = await queue.add(LIN_KE_PRODUCT_TRACKING_JOB_NAME, input, { delay: Math.max(delayMs, 0) });
      return String(job.id);
    },

    getFeeSetupJobStatus: getJobStatus,
    getProductTrackingJobStatus: getJobStatus,

    async close(): Promise<void> {
      await queue.close();
    },
  };
}

let defaultQueue: LinKeFeeSetupQueueClient | null | undefined;

export function getDefaultLinKeFeeSetupQueue(): LinKeFeeSetupQueueClient | null {
  if (defaultQueue !== undefined) {
    return defaultQueue;
  }
  defaultQueue = createBullMqLinKeFeeSetupQueue();
  if (!defaultQueue) {
    console.warn("[Lin-Ke] REDIS_URL 未配置，林客费用设置任务队列不可用");
  }
  return defaultQueue;
}
