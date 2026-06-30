import { Queue } from "bullmq";
import {
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
  REBUILD_SUPPLIER_SYNC_JOB_NAME,
  type GravityJobData,
  type GravityJobDataMap,
  type GravityJobName,
  type GravityJobResult,
} from "./types.ts";

export {
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
  REBUILD_SUPPLIER_SYNC_JOB_NAME,
} from "./types.ts";

export interface ScheduledGravityJob<Name extends GravityJobName = GravityJobName> {
  name: Name;
  everyMs: number;
  data: GravityJobDataMap[Name];
}

export interface GravityJobsQueueClient {
  schedulePeriodicJobs: () => Promise<string[]>;
  addJob: <Name extends GravityJobName>(name: Name, data?: GravityJobDataMap[Name]) => Promise<string>;
  close?: () => Promise<void>;
}

function readRedisUrl(): string {
  return Bun.env.REDIS_URL?.trim() || "";
}

function makeConnectionOptions(): { url: string } | null {
  const redisUrl = readRedisUrl();
  return redisUrl ? { url: redisUrl } : null;
}

function readImportFromSupplyGoodsIntervalMs(): number {
  const value = Number.parseInt(
    Bun.env.IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS?.trim() ?? "",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 5 * 60 * 1000;
}

export function buildScheduledGravityJobs(): ScheduledGravityJob[] {
  return [
    {
      name: REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
      everyMs: readImportFromSupplyGoodsIntervalMs(),
      data: {},
    },
  ];
}

export function createBullMqGravityJobsQueue(connection = makeConnectionOptions()): GravityJobsQueueClient | null {
  if (!connection) return null;

  const queue = new Queue<GravityJobData, GravityJobResult, GravityJobName>(GRAVITY_JOBS_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
    },
  });

  return {
    async schedulePeriodicJobs(): Promise<string[]> {
      const jobIds: string[] = [];
      for (const scheduledJob of buildScheduledGravityJobs()) {
        const job = await queue.upsertJobScheduler(
          scheduledJob.name,
          { every: scheduledJob.everyMs },
          {
            name: scheduledJob.name,
            data: scheduledJob.data,
            opts: {
              removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
              removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
            },
          },
        );
        jobIds.push(String(job.id));
      }
      return jobIds;
    },

    async addJob<Name extends GravityJobName>(name: Name, data = {} as GravityJobDataMap[Name]): Promise<string> {
      const job = await queue.add(name, data, name === REBUILD_SUPPLIER_SYNC_JOB_NAME ? {
        attempts: 3,
        backoff: { type: "exponential", delay: 60 * 1000 },
      } : undefined);
      return String(job.id);
    },

    async close(): Promise<void> {
      await queue.close();
    },
  };
}

let defaultQueue: GravityJobsQueueClient | null | undefined;

export function getDefaultGravityJobsQueue(): GravityJobsQueueClient | null {
  if (defaultQueue !== undefined) return defaultQueue;
  defaultQueue = createBullMqGravityJobsQueue();
  if (!defaultQueue) {
    console.warn("[JOBS] REDIS_URL 未配置，Gravity jobs 队列不可用");
  }
  return defaultQueue;
}
