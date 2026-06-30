import { describe, expect, test } from "bun:test";

import {
  buildScheduledGravityJobs,
  GRAVITY_JOBS_QUEUE_NAME,
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
} from "./queue.ts";
import {
  LIN_KE_DRAFT_JOB_NAME as LIN_KE_QUEUE_JOB_NAME,
  LIN_KE_DRAFT_QUEUE_NAME,
} from "../service/lin-ke/draft-queue.ts";

describe("Gravity jobs 队列", () => {
  test("Given scheduled jobs are built, When checking queue metadata, Then it uses gravity-jobs and includes SupplyGoods import", () => {
    const originalInterval = Bun.env.IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS;
    Bun.env.IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS = "120000";

    try {
      expect(GRAVITY_JOBS_QUEUE_NAME).toBe("gravity-jobs");
      expect(buildScheduledGravityJobs()).toEqual([
        {
          name: REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
          everyMs: 120000,
          data: {},
        },
      ]);
    } finally {
      Bun.env.IMPORT_FROM_SUPPLYGOODS_INTERVAL_MS = originalInterval;
    }
  });

  test("Given Lin-Ke draft queue is used, When checking queue metadata, Then it also publishes into gravity-jobs", () => {
    expect(LIN_KE_DRAFT_QUEUE_NAME).toBe(GRAVITY_JOBS_QUEUE_NAME);
    expect(LIN_KE_QUEUE_JOB_NAME).toBe(LIN_KE_DRAFT_JOB_NAME);
  });
});
