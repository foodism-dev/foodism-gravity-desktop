import { Queue } from "bullmq";
import {
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  type CreateLinKeDraftJobData,
} from "../jobs/types.ts";
import type { JsonRecord } from "./utils.ts";

export { LIN_KE_DRAFT_JOB_NAME };
export const LIN_KE_DRAFT_QUEUE_NAME = GRAVITY_JOBS_QUEUE_NAME;

export interface LinKeDraftJobStatus {
  jobId: string;
  state: string;
  failedReason: string;
  returnValue: JsonRecord | null;
}

export interface LinKeDraftQueueClient {
  addCreateDraftJob: (supplyGoodsId: string) => Promise<string>;
  getCreateDraftJobStatus: (jobId: string) => Promise<LinKeDraftJobStatus | null>;
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

export function createBullMqLinKeDraftQueue(connection = makeConnectionOptions()): LinKeDraftQueueClient | null {
  if (!connection) {
    return null;
  }
  const queue = new Queue<CreateLinKeDraftJobData, JsonRecord, typeof LIN_KE_DRAFT_JOB_NAME>(
    LIN_KE_DRAFT_QUEUE_NAME,
    {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      },
    },
  );

  return {
    async addCreateDraftJob(supplyGoodsId: string): Promise<string> {
      const job = await queue.add(LIN_KE_DRAFT_JOB_NAME, { supplyGoodsId });
      return String(job.id);
    },

    async getCreateDraftJobStatus(jobId: string): Promise<LinKeDraftJobStatus | null> {
      const job = await queue.getJob(jobId);
      if (!job) return null;
      const state = await job.getState();
      return {
        jobId: String(job.id),
        state,
        failedReason: job.failedReason || "",
        returnValue: isJsonRecord(job.returnvalue) ? job.returnvalue : null,
      };
    },

    async close(): Promise<void> {
      await queue.close();
    },
  };
}

let defaultQueue: LinKeDraftQueueClient | null | undefined;

export function getDefaultLinKeDraftQueue(): LinKeDraftQueueClient | null {
  if (defaultQueue !== undefined) {
    return defaultQueue;
  }
  defaultQueue = createBullMqLinKeDraftQueue();
  if (!defaultQueue) {
    console.warn("[Lin-Ke] REDIS_URL 未配置，林客草稿任务队列不可用");
  }
  return defaultQueue;
}
