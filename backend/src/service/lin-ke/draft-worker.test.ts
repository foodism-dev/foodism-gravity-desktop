import { describe, expect, test } from "bun:test";
import type { LinKeSettings } from "./config.ts";
import { processLinKeDraftJob } from "./draft-worker.ts";
import type { LinKeAccountConfig, LinKeRepository } from "./repository.ts";
import type { JsonRecord } from "./utils.ts";
import {
  getNextTicketFlowStateByAction,
  normalizeTicketBusinessStatus,
  normalizeTicketStatus,
  TICKET_BUSINESS_STATUS,
  TICKET_STATUS,
} from "../../ticket-status.ts";
import type {
  CreateTicketActionRecordInput,
  TicketActionRecord,
  TicketRepository,
  TicketWithSupplyGoods,
} from "../../tickets.ts";

function settings(): LinKeSettings {
  return {
    databaseUrl: null,
    openaiApiKey: "",
    openaiBaseUrl: "",
    optimizeModel: "gpt-4o-mini",
    optimizeConcurrency: 1,
    optimizeMaxBatchSize: 20,
    optimizeRetries: 1,
    lifePartnerBaseUrl: "https://www.life-partner.cn",
    lifePartnerTimeout: 60,
    rbImageBaseUrl: "",
  };
}

function accountConfig(): LinKeAccountConfig {
  return {
    id: 1,
    name: "深圳",
    bdCityTexts: ["深圳一区"],
    cookie: "sessionid=test",
    groupId: "",
    rootLifeAccountId: "",
    accountId: "",
    active: true,
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
  };
}

function createRepository(ticket: TicketWithSupplyGoods): { repository: TicketRepository; records: TicketActionRecord[] } {
  const records: TicketActionRecord[] = [];
  return {
    records,
    repository: {
      async listTickets(query) {
        return { tickets: [ticket], total: 1, pageNo: query.pageNo, pageSize: query.pageSize };
      },
      async getTicket(supplyGoodsId) {
        return ticket.supplyGoodsId === supplyGoodsId ? ticket : null;
      },
      async listActionRecords() {
        return records;
      },
      async createActionRecord(input: CreateTicketActionRecordInput) {
        if (input.supplyGoodsId !== ticket.supplyGoodsId) return null;
        ticket.payload = { ...ticket.payload, ...input.current };
        const nextState = getNextTicketFlowStateByAction(input.action, {
          status: normalizeTicketStatus(ticket.status),
          businessStatus: normalizeTicketBusinessStatus(ticket.businessStatus),
        });
        ticket.status = nextState.status;
        ticket.businessStatus = nextState.businessStatus;
        const record = {
          id: records.length + 1,
          ticketId: ticket.id,
          action: input.action,
          origin: input.origin,
          current: input.current,
          operator: input.operator,
          remark: input.remark,
          createdAt: new Date("2026-06-25T01:00:00.000Z"),
        };
        records.push(record);
        return { ticket, record };
      },
    },
  };
}

function createLinKeRepository(config: LinKeAccountConfig): LinKeRepository {
  return {
    async fetchSupplyGoodsPayloads() {
      return new Map();
    },
    async fetchRebuildFieldOptionLabels() {
      return {};
    },
    async listAccountConfigs() {
      return [config];
    },
    async getAccountConfig() {
      return config;
    },
    async findAccountConfigByCity(cityText: string) {
      return cityText === "深圳一区" ? config : null;
    },
    async createAccountConfig() {
      return config;
    },
    async updateAccountConfig() {
      return config;
    },
    async deleteAccountConfig() {
      return true;
    },
    async updateSupplyGoodsLinKeMapping() {
      return true;
    },
  };
}

function ticket(): TicketWithSupplyGoods {
  return {
    id: 1,
    supplyGoodsId: "944-worker",
    status: TICKET_STATUS.PROCESSING,
    businessStatus: TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING,
    payload: {
      bdCity: { text: "深圳一区" },
      packages: { viewList: [] },
    },
    sourcePayload: {},
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
  };
}

describe("Lin-Ke draft worker", () => {
  test("Given draft creation succeeds, When processing job, Then ticket advances with draft URL", async () => {
    const currentTicket = ticket();
    const { repository, records } = createRepository(currentTicket);
    const result = await processLinKeDraftJob({
      supplyGoodsId: currentTicket.supplyGoodsId,
      jobId: "job-1",
      settings: settings(),
      linKeRepository: createLinKeRepository(accountConfig()),
      ticketRepository: repository,
      async saveDraft(input) {
        expect(input.supplyGoodsId).toBe("944-worker");
        return { ok: true, draftUrl: "https://www.life-partner.cn/draft/1" };
      },
    });

    expect(result.draftUrl).toBe("https://www.life-partner.cn/draft/1");
    expect(currentTicket.payload.linkeDraftUrl).toBe("https://www.life-partner.cn/draft/1");
    expect(currentTicket.businessStatus).toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
    expect(records[0]?.action).toBe("info_optimized");
  });

  test("Given draft creation fails, When processing job, Then failure is recorded without advancing", async () => {
    const currentTicket = ticket();
    const { repository, records } = createRepository(currentTicket);

    await expect(processLinKeDraftJob({
      supplyGoodsId: currentTicket.supplyGoodsId,
      jobId: "job-2",
      settings: settings(),
      linKeRepository: createLinKeRepository(accountConfig()),
      ticketRepository: repository,
      async saveDraft(): Promise<JsonRecord> {
        throw new Error("lin-ke down");
      },
    })).rejects.toThrow("lin-ke down");

    expect(currentTicket.businessStatus).toBe(TICKET_BUSINESS_STATUS.INFO_OPTIMIZATION_PENDING);
    expect(records[0]?.action).toBe("lin_ke_draft_failed");
  });
});
