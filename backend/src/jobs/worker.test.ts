import { describe, expect, test } from "bun:test";

import {
  LIN_KE_DRAFT_JOB_NAME,
  REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
  REBUILD_SUPPLIER_SYNC_JOB_NAME,
} from "./queue.ts";
import { processGravityJob, resolveGravityJobsRuntimeMode } from "./worker.ts";
import type { LinKeSettings } from "../service/lin-ke/config.ts";
import type { LinKeAccountConfig, LinKeRepository } from "../service/lin-ke/repository.ts";
import type { JsonRecord } from "../service/lin-ke/utils.ts";
import type { RebuildAssetUploader } from "../service/rebuild/assets.ts";
import type { RebuildFieldMetadata, RebuildFieldMetadataRepository } from "../service/rebuild/fields.ts";
import type {
  RebuildSupplyGoodsClient,
  SupplyGoodsCallbackRecordInput,
  SupplyGoodsRecordRepository,
  SupplyGoodsRecordUpsertInput,
} from "../service/rebuild/supplygoods.ts";
import type {
  RebuildSupplierCallbackRecordInput,
  RebuildSupplierRecordRepository,
  SupplyCompanyRecordInput,
  SupplyHostRecordInput,
} from "../service/rebuild/suppliers.ts";
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
    cookie: "sessionid=test",
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

function supplierRepository(): {
  repository: RebuildSupplierRecordRepository;
  companies: SupplyCompanyRecordInput[];
  hosts: SupplyHostRecordInput[];
  callbacks: RebuildSupplierCallbackRecordInput[];
} {
  const companies: SupplyCompanyRecordInput[] = [];
  const hosts: SupplyHostRecordInput[] = [];
  const callbacks: RebuildSupplierCallbackRecordInput[] = [];
  return {
    companies,
    hosts,
    callbacks,
    repository: {
      async upsertSupplyCompany(input): Promise<void> {
        companies.push(input);
      },
      async upsertSupplyHost(input): Promise<void> {
        hosts.push(input);
      },
      async createCallbackRecord(input): Promise<void> {
        callbacks.push(input);
      },
    },
  };
}

describe("Gravity jobs worker", () => {
  test("Given runtime flags, When resolving worker runtime mode, Then scheduler and worker can run separately", () => {
    expect(resolveGravityJobsRuntimeMode(["--scheduler"], {})).toBe("scheduler");
    expect(resolveGravityJobsRuntimeMode(["--worker"], {})).toBe("worker");
    expect(resolveGravityJobsRuntimeMode(["--all"], {})).toBe("all");
    expect(resolveGravityJobsRuntimeMode([], { GRAVITY_JOBS_RUNTIME_MODE: "worker" })).toBe("worker");
    expect(resolveGravityJobsRuntimeMode([], {})).toBe("all");
  });

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

  test("Given import-from-supplygoods job has rebuild_fields asset type, When processing, Then it mirrors SupplyGoods asset fields", async () => {
    const saved: SupplyGoodsRecordUpsertInput[] = [];
    const repository: SupplyGoodsRecordRepository = {
      async findMissingSupplyGoodsIds(supplyGoodsIds): Promise<string[]> {
        return supplyGoodsIds;
      },
      async upsertRecord(input): Promise<void> {
        saved.push(input);
      },
      async createCallbackRecord(): Promise<void> {},
    };
    const rebuildClient: RebuildSupplyGoodsClient = {
      async listSupplyGoodsIds(): Promise<string[]> {
        return ["944-worker-asset"];
      },
      async getSupplyGoods(supplyGoodsId): Promise<Record<string, unknown>> {
        return {
          SupplyGoodsId: supplyGoodsId,
          extraMenuFile: ["rb/goods/worker-menu.pdf"],
        };
      },
    };
    const fieldMetadataRepository = {
      async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
        return [
          {
            entityName,
            fieldName: "extraMenuFile",
            label: "额外菜单附件",
            fieldType: "FILE",
            raw: { name: "extraMenuFile", type: "FILE" },
          },
        ];
      },
    } as unknown as RebuildFieldMetadataRepository;
    const assetUploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.entityName}/${input.recordId}/${input.fieldName}/asset.pdf`,
        };
      },
    };

    await processGravityJob({
      name: REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME,
      data: {},
      options: {
        rebuildClient,
        repository,
        fieldMetadataRepository,
        assetUploader,
      },
    });

    expect(saved[0]?.normalizedPayload.extraMenuFile).toEqual([
      "https://cdn.example.com/SupplyGoods/944-worker-asset/extraMenuFile/asset.pdf",
    ]);
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

  test("Given supplier sync job, When processing SupplyCompany, Then it stores normalized supplier detail", async () => {
    const { repository, companies, callbacks } = supplierRepository();
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(): Promise<Record<string, unknown>> {
        return {};
      },
      async getSupplyCompany(supplyCompanyId): Promise<Record<string, unknown>> {
        return {
          SupplyCompanyId: supplyCompanyId,
          companyName: "异步公司",
        };
      },
    };

    const result = await processGravityJob({
      name: REBUILD_SUPPLIER_SYNC_JOB_NAME,
      data: {
        entityName: "SupplyCompany",
        recordId: "945-worker-company",
        source: "supply_goods_callback",
        supplyGoodsId: "944-source",
      },
      options: {
        rebuildClient,
        supplierRepository: repository,
        assetUploader: null as RebuildAssetUploader | null,
      },
    });

    expect(result).toEqual({
      ok: true,
      entityName: "SupplyCompany",
      recordId: "945-worker-company",
    });
    expect(companies[0]?.payload.companyName).toBe("异步公司");
    expect(callbacks[0]?.rawPayload).toEqual({
      source: "supply_goods_callback",
      supplyGoodsId: "944-source",
    });
  });

  test("Given supplier sync job, When processing SupplyHost, Then it stores normalized supplier detail", async () => {
    const { repository, hosts, callbacks } = supplierRepository();
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(): Promise<Record<string, unknown>> {
        return {};
      },
      async getSupplyHost(supplyHostId): Promise<Record<string, unknown>> {
        return {
          SupplyHostId: supplyHostId,
          hostName: "异步商户",
        };
      },
    };

    const result = await processGravityJob({
      name: REBUILD_SUPPLIER_SYNC_JOB_NAME,
      data: {
        entityName: "SupplyHost",
        recordId: "946-worker-host",
        source: "supply_goods_callback",
        supplyGoodsId: "944-source",
      },
      options: {
        rebuildClient,
        supplierRepository: repository,
        assetUploader: null as RebuildAssetUploader | null,
      },
    });

    expect(result).toEqual({
      ok: true,
      entityName: "SupplyHost",
      recordId: "946-worker-host",
    });
    expect(hosts[0]?.payload.hostName).toBe("异步商户");
    expect(callbacks[0]?.rawPayload).toEqual({
      source: "supply_goods_callback",
      supplyGoodsId: "944-source",
    });
  });

  test("Given supplier sync job has SupplyHost rebuild_fields asset type, When processing, Then it mirrors host asset fields", async () => {
    const { repository, hosts } = supplierRepository();
    const rebuildClient: RebuildSupplyGoodsClient = {
      async getSupplyGoods(): Promise<Record<string, unknown>> {
        return {};
      },
      async getSupplyHost(supplyHostId): Promise<Record<string, unknown>> {
        return {
          SupplyHostId: supplyHostId,
          extraHostPermit: ["rb/host/worker-permit.pdf"],
        };
      },
    };
    const fieldMetadataRepository = {
      async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
        return [
          {
            entityName,
            fieldName: "extraHostPermit",
            label: "额外商户证照",
            fieldType: "FILE",
            raw: { name: "extraHostPermit", type: "FILE" },
          },
        ];
      },
    } as unknown as RebuildFieldMetadataRepository;
    const assetUploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.entityName}/${input.recordId}/${input.fieldName}/asset.pdf`,
        };
      },
    };

    await processGravityJob({
      name: REBUILD_SUPPLIER_SYNC_JOB_NAME,
      data: {
        entityName: "SupplyHost",
        recordId: "946-worker-host-asset",
        source: "supply_goods_callback",
        supplyGoodsId: "944-source",
      },
      options: {
        rebuildClient,
        supplierRepository: repository,
        fieldMetadataRepository,
        assetUploader,
      },
    });

    expect(hosts[0]?.payload.extraHostPermit).toEqual([
      "https://cdn.example.com/SupplyHost/946-worker-host-asset/extraHostPermit/asset.pdf",
    ]);
  });
});
