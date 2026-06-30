import { describe, expect, test } from "bun:test";

import { LIN_KE_DRAFT_JOB_NAME, REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME } from "./queue.ts";
import { processGravityJob } from "./worker.ts";
import type { LinKeSettings } from "../service/lin-ke/config.ts";
import type { LinKeAccountConfig, LinKeRepository } from "../service/lin-ke/repository.ts";
import type { JsonRecord } from "../service/lin-ke/utils.ts";
import type { RebuildAssetUploader } from "../service/rebuild/assets.ts";
import type { RebuildFieldMetadataRepository } from "../service/rebuild/fields.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsCallbackRecordInput,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "../service/rebuild/supplygoods.ts";
import {
  normalizeTicketBusinessStatus,
  normalizeTicketStatus,
  TICKET_BUSINESS_STATUS,
  TICKET_STATUS,
} from "../ticket-status.ts";
import { getNextTicketFlowStateByAction } from "../ticket-status.ts";
import type {
  CreateTicketActionRecordInput,
  TicketActionRecord,
  TicketRepository,
  TicketWithSupplyGoods,
} from "../tickets.ts";

function linKeSettings(): LinKeSettings {
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

function linKeAccountConfig(): LinKeAccountConfig {
  return {
    id: 1,
    name: "深圳",
    bdCityTexts: ["深圳一区"],
    cookieFilePath: "/tmp/cookie.json",
    groupId: "",
    rootLifeAccountId: "",
    accountId: "",
    active: true,
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
    updatedAt: new Date("2026-06-25T00:00:00.000Z"),
  };
}

function linKeRepository(config: LinKeAccountConfig): LinKeRepository {
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
    supplyGoodsId: "944-lin-ke-job",
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

function ticketRepository(currentTicket: TicketWithSupplyGoods): { repository: TicketRepository; records: TicketActionRecord[] } {
  const records: TicketActionRecord[] = [];
  return {
    records,
    repository: {
      async listTickets(query) {
        return { tickets: [currentTicket], total: 1, pageNo: query.pageNo, pageSize: query.pageSize };
      },
      async getTicket(supplyGoodsId) {
        return currentTicket.supplyGoodsId === supplyGoodsId ? currentTicket : null;
      },
      async listActionRecords() {
        return records;
      },
      async createActionRecord(input: CreateTicketActionRecordInput) {
        if (input.supplyGoodsId !== currentTicket.supplyGoodsId) return null;
        currentTicket.payload = { ...currentTicket.payload, ...input.current };
        const nextState = getNextTicketFlowStateByAction(input.action, {
          status: normalizeTicketStatus(currentTicket.status),
          businessStatus: normalizeTicketBusinessStatus(currentTicket.businessStatus),
        });
        currentTicket.status = nextState.status;
        currentTicket.businessStatus = nextState.businessStatus;
        const record = {
          id: records.length + 1,
          ticketId: currentTicket.id,
          action: input.action,
          origin: input.origin,
          current: input.current,
          operator: input.operator,
          remark: input.remark,
          createdAt: new Date("2026-06-25T01:00:00.000Z"),
        };
        records.push(record);
        return { ticket: currentTicket, record };
      },
    },
  };
}

describe("Gravity jobs worker", () => {
  test("Given import-from-supplygoods job, When processing gravity job, Then it dispatches to SupplyGoods importer", async () => {
    const saved: SupplyGoodsRecordUpsertInput[] = [];
    const callbackRecords: SupplyGoodsCallbackRecordInput[] = [];
    const repository: SupplyGoodsRecordRepository = {
      async findMissingSupplyGoodsIds(supplyGoodsIds): Promise<string[]> {
        return supplyGoodsIds;
      },
      async upsertRecord(input): Promise<void> {
        saved.push(input);
      },
      async createCallbackRecord(input): Promise<void> {
        callbackRecords.push(input);
      },
    };
    const rebuildClient: RebuildSupplyGoodsClient = {
      async listSupplyGoodsIds(): Promise<string[]> {
        return ["944-gravity-job"];
      },
      async getSupplyGoods(supplyGoodsId): Promise<Record<string, unknown>> {
        return {
          SupplyGoodsId: supplyGoodsId,
          approvalState: { value: 2, text: "审核中" },
          company: {
            id: "945-company",
            entity: "SupplyCompany",
            approvalState: { value: 10, text: "通过" },
          },
          rbhost: {
            id: "946-host",
            entity: "SupplyHost",
            approvalState: { value: 2, text: "审核中" },
          },
        };
      },
    };

    const result = await processGravityJob({
      name: REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
      data: {},
      options: {
        rebuildClient,
        repository,
        fieldMetadataRepository: null as RebuildFieldMetadataRepository | null,
        assetUploader: null as RebuildAssetUploader | null,
      },
    });

    expect(result).toMatchObject({
      listed: 1,
      missing: 1,
      synced: 1,
      failed: 0,
    });
    expect(saved.map((record) => record.supplyGoodsId)).toEqual(["944-gravity-job"]);
    expect(callbackRecords.map((record) => record.rawPayload)).toEqual([{}]);
  });

  test("Given Lin-Ke draft job, When processing gravity job, Then it dispatches to draft creator", async () => {
    const currentTicket = ticket();
    const { repository, records } = ticketRepository(currentTicket);

    const result = await processGravityJob({
      name: LIN_KE_DRAFT_JOB_NAME,
      data: { supplyGoodsId: currentTicket.supplyGoodsId },
      jobId: "job-lin-ke",
      options: {
        linKeSettings: linKeSettings(),
        linKeRepository: linKeRepository(linKeAccountConfig()),
        ticketRepository: repository,
        async saveDraft(input): Promise<JsonRecord> {
          expect(input.supplyGoodsId).toBe("944-lin-ke-job");
          return { ok: true, draftUrl: "https://www.life-partner.cn/draft/2" };
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      supplyGoodsId: "944-lin-ke-job",
      draftUrl: "https://www.life-partner.cn/draft/2",
    });
    expect(currentTicket.businessStatus).toBe(TICKET_BUSINESS_STATUS.SHELF_CONFIRM_PENDING);
    expect(records[0]?.action).toBe("info_optimized");
  });
});
