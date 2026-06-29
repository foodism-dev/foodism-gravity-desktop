import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  LIN_KE_FEE_SETUP_SAVE_VERSION,
  type LinKeFeeSetupClient,
} from "./fee-setup.ts";
import {
  processLinKeFeeSetupJob,
  processLinKeProductTrackingJob,
} from "./fee-setup-worker.ts";
import {
  LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS,
  LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS,
  type CreateLinKeProductTrackingJobData,
  type LinKeFeeSetupQueueClient,
} from "./fee-setup-queue.ts";
import type { LinKeAccountConfig, LinKeRepository } from "./repository.ts";
import type { LinKeSettings } from "./config.ts";
import type {
  CreateTicketActionRecordInput,
  TicketActionRecord,
  TicketRepository,
  TicketWithSupplyGoods,
} from "../tickets.ts";
import { TICKET_BUSINESS_STATUS, TICKET_STATUS } from "../ticket-status.ts";

function createAccountConfig(cookieFilePath: string): LinKeAccountConfig {
  const now = new Date("2026-06-24T10:00:00.000Z");
  return {
    id: 1,
    name: "上海林客账号",
    bdCityTexts: ["上海"],
    cookieFilePath,
    groupId: "",
    rootLifeAccountId: "",
    accountId: "account-1",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function createSettings(): LinKeSettings {
  return {
    databaseUrl: null,
    openaiApiKey: "",
    openaiBaseUrl: "",
    optimizeModel: "gpt-4o-mini",
    optimizeConcurrency: 1,
    optimizeMaxBatchSize: 20,
    optimizeRetries: 1,
    lifePartnerBaseUrl: "https://www.life-partner.cn",
    lifePartnerTimeout: 1,
    rbImageBaseUrl: "",
  };
}

function createTicketRepository(ticket: TicketWithSupplyGoods): {
  repository: TicketRepository;
  actionRecords: TicketActionRecord[];
} {
  const actionRecords: TicketActionRecord[] = [];
  return {
    actionRecords,
    repository: {
      async listTickets(query) {
        return {
          tickets: [ticket],
          total: 1,
          pageNo: query.pageNo,
          pageSize: query.pageSize,
        };
      },
      async getTicket(supplyGoodsId) {
        return ticket.supplyGoodsId === supplyGoodsId ? ticket : null;
      },
      async listActionRecords() {
        return actionRecords;
      },
      async createActionRecord(input: CreateTicketActionRecordInput) {
        if (ticket.supplyGoodsId !== input.supplyGoodsId) return null;
        ticket.payload = { ...ticket.payload, ...input.current };
        const record: TicketActionRecord = {
          id: actionRecords.length + 1,
          ticketId: ticket.id,
          action: input.action,
          origin: input.origin,
          current: input.current,
          operator: input.operator,
          remark: input.remark,
          createdAt: new Date("2026-06-24T11:00:00.000Z"),
        };
        actionRecords.push(record);
        return { ticket, record };
      },
    },
  };
}

function createLinKeRepository(accountConfig: LinKeAccountConfig): LinKeRepository {
  return {
    async fetchSupplyGoodsPayloads() {
      return new Map();
    },
    async fetchRebuildFieldOptionLabels() {
      return {};
    },
    async listAccountConfigs() {
      return [accountConfig];
    },
    async getAccountConfig() {
      return accountConfig;
    },
    async findAccountConfigByCity() {
      return accountConfig;
    },
    async createAccountConfig() {
      return accountConfig;
    },
    async updateAccountConfig() {
      return accountConfig;
    },
    async deleteAccountConfig() {
      return true;
    },
    async updateSupplyGoodsLinKeMapping() {
      return true;
    },
  };
}

function createQueueClient(): {
  queueClient: LinKeFeeSetupQueueClient;
  trackingJobs: Array<{ input: CreateLinKeProductTrackingJobData; delayMs: number }>;
} {
  const trackingJobs: Array<{ input: CreateLinKeProductTrackingJobData; delayMs: number }> = [];
  return {
    trackingJobs,
    queueClient: {
      async addFeeSetupJob() {
        throw new Error("not used");
      },
      async addProductTrackingJob(input, delayMs = 0) {
        trackingJobs.push({ input, delayMs });
        return `tracking-job-${trackingJobs.length}`;
      },
      async getFeeSetupJobStatus() {
        return null;
      },
      async getProductTrackingJobStatus() {
        return null;
      },
    },
  };
}

describe("Lin-Ke fee setup worker", () => {
  test("Given Lin-Ke save succeeds, When processing fee setup job, Then it records real save marker", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lin-ke-fee-worker-"));
    const cookieFilePath = join(tempDir, "cookie.txt");
    writeFileSync(cookieFilePath, "sessionid=test", "utf-8");
    try {
      const ticket: TicketWithSupplyGoods = {
        id: 1,
        supplyGoodsId: "944-fee-worker",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.COMMISSION_SETUP_PENDING,
        payload: {
          bdCity: { text: "上海" },
          company: { guestId: "merchant-1" },
          linkeFeeSetupSaveSubmitted: false,
          linkeFeeSetupSaveVersion: "",
        },
        sourcePayload: {},
        createdAt: new Date("2026-06-24T10:00:00.000Z"),
        updatedAt: new Date("2026-06-24T10:00:00.000Z"),
      };
      const { repository: ticketRepository, actionRecords } = createTicketRepository(ticket);
      const accountConfig = createAccountConfig(cookieFilePath);
      const client: LinKeFeeSetupClient = {
        async setupFee() {
          return {
            feeSettingUrl: "https://www.life-partner.cn/vmok/op-merchant-list/workbench?product_id=linke-goods-1",
          };
        },
        async getProductStatus() {
          throw new Error("not used");
        },
      };

      const result = await processLinKeFeeSetupJob({
        supplyGoodsId: "944-fee-worker",
        merchantId: "merchant-1",
        linkeGoodsId: "linke-goods-1",
        rates: {
          onlineOperation: 4,
          professionalAccount: 4,
          growthBooster: 4,
          acquisitionCard: 4,
          offlineQrScan: 4,
        },
        jobId: "fee-job-1",
        settings: createSettings(),
        linKeRepository: createLinKeRepository(accountConfig),
        ticketRepository,
        client,
      });

      expect(result.ok).toBe(true);
      expect(actionRecords[0]?.action).toBe("lin_ke_fee_setup_completed");
      expect(actionRecords[0]?.current.linkeFeeSetupSaveSubmitted).toBe(true);
      expect(actionRecords[0]?.current.linkeFeeSetupSaveVersion).toBe(LIN_KE_FEE_SETUP_SAVE_VERSION);
      expect(ticket.payload.linkeFeeSetupSaveSubmitted).toBe(true);
      expect(ticket.payload.linkeFeeSetupSaveVersion).toBe(LIN_KE_FEE_SETUP_SAVE_VERSION);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("Given product status is not ready, When tracking job runs, Then it records status and schedules next check", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lin-ke-tracking-worker-"));
    const cookieFilePath = join(tempDir, "cookie.txt");
    writeFileSync(cookieFilePath, "sessionid=test", "utf-8");
    try {
      const ticket: TicketWithSupplyGoods = {
        id: 2,
        supplyGoodsId: "944-tracking-waiting",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
        payload: {
          bdCity: { text: "上海" },
          company: { guestId: "merchant-1" },
          linkeGoodsId: "linke-goods-1",
        },
        sourcePayload: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { repository: ticketRepository, actionRecords } = createTicketRepository(ticket);
      const accountConfig = createAccountConfig(cookieFilePath);
      const { queueClient, trackingJobs } = createQueueClient();
      const client: LinKeFeeSetupClient = {
        async setupFee() {
          throw new Error("not used");
        },
        async getProductStatus() {
          return {
            feeStatus: "未设置",
            productStatus: "待上线",
            feeReady: false,
            productReady: false,
            negative: false,
          };
        },
      };
      const startedAt = new Date().toISOString();

      const result = await processLinKeProductTrackingJob({
        supplyGoodsId: "944-tracking-waiting",
        startedAt,
        checkCount: 2,
        jobId: "tracking-job-2",
        settings: createSettings(),
        linKeRepository: createLinKeRepository(accountConfig),
        ticketRepository,
        client,
        queueClient,
      });

      expect(result.ready).toBe(false);
      expect(actionRecords[0]?.action).toBe("lin_ke_product_tracking_checked");
      expect(actionRecords[0]?.current.linkeFeeStatus).toBe("未设置");
      expect(actionRecords[0]?.current.linkeProductStatus).toBe("待上线");
      expect(actionRecords[0]?.current.linkeProductTrackingLastCheckCount).toBe(2);
      expect(actionRecords[0]?.current.linkeProductTrackingNextCheckCount).toBe(3);
      expect(
        new Date(String(actionRecords[0]?.current.linkeProductTrackingNextCheckAt)).getTime()
          - new Date(String(actionRecords[0]?.current.linkeProductTrackingLastCheckedAt)).getTime(),
      ).toBe(LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS);
      expect(
        new Date(String(actionRecords[0]?.current.linkeProductTrackingTimeoutAt)).getTime()
          - new Date(String(actionRecords[0]?.current.linkeProductTrackingStartedAt)).getTime(),
      ).toBe(LIN_KE_PRODUCT_TRACKING_TIMEOUT_MS);
      expect(trackingJobs).toEqual([
        {
          input: {
            supplyGoodsId: "944-tracking-waiting",
            startedAt,
            checkCount: 3,
          },
          delayMs: LIN_KE_PRODUCT_TRACKING_POLL_INTERVAL_MS,
        },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("Given product status is ready, When tracking job runs, Then it records final status without next check", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lin-ke-tracking-ready-"));
    const cookieFilePath = join(tempDir, "cookie.txt");
    writeFileSync(cookieFilePath, "sessionid=test", "utf-8");
    try {
      const ticket: TicketWithSupplyGoods = {
        id: 3,
        supplyGoodsId: "944-tracking-ready",
        status: TICKET_STATUS.PROCESSING,
        businessStatus: TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING,
        payload: {
          bdCity: { text: "上海" },
          company: { guestId: "merchant-1" },
          linkeGoodsId: "linke-goods-1",
        },
        sourcePayload: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { repository: ticketRepository, actionRecords } = createTicketRepository(ticket);
      const accountConfig = createAccountConfig(cookieFilePath);
      const { queueClient, trackingJobs } = createQueueClient();
      const client: LinKeFeeSetupClient = {
        async setupFee() {
          throw new Error("not used");
        },
        async getProductStatus() {
          return {
            feeStatus: "已设置",
            productStatus: "销售中",
            feeReady: true,
            productReady: true,
            negative: false,
          };
        },
      };

      const result = await processLinKeProductTrackingJob({
        supplyGoodsId: "944-tracking-ready",
        startedAt: new Date().toISOString(),
        checkCount: 4,
        jobId: "tracking-job-4",
        settings: createSettings(),
        linKeRepository: createLinKeRepository(accountConfig),
        ticketRepository,
        client,
        queueClient,
      });

      expect(result.ready).toBe(true);
      expect(actionRecords[0]?.action).toBe("product_online_confirmed");
      expect(actionRecords[0]?.current.linkeProductTrackingState).toBe("completed");
      expect(actionRecords[0]?.current.linkeFeeStatus).toBe("已设置");
      expect(actionRecords[0]?.current.linkeProductStatus).toBe("销售中");
      expect(actionRecords[0]?.current.linkeProductTrackingNextCheckAt).toBe("");
      expect(actionRecords[0]?.current.linkeProductTrackingLastCheckCount).toBe(4);
      expect(actionRecords[0]?.current.linkeProductTrackingNextCheckCount).toBe(0);
      expect(trackingJobs).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
