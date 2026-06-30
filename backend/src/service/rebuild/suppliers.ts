import { eq } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../../db/client.ts";
import {
  rebuildSupplyCompany,
  rebuildSupplyCompanyCallbackRecords,
  rebuildSupplyHost,
  rebuildSupplyHostCallbackRecords,
} from "../../db/schema.ts";
import type { RebuildAssetUploader } from "./assets.ts";
import type { RebuildFieldMetadata } from "./fields.ts";
import {
  normalizeRebuildPayload,
  SUPPLY_COMPANY_ENTITY,
  SUPPLY_HOST_ENTITY,
  type RebuildSupplyGoodsClient,
} from "./supplygoods.ts";

export type RebuildSupplierEntityName = typeof SUPPLY_COMPANY_ENTITY | typeof SUPPLY_HOST_ENTITY;

export interface SupplyCompanyRecordInput {
  supplyCompanyId: string;
  payload: Record<string, unknown>;
  updatedAt: Date;
}

export interface SupplyHostRecordInput {
  supplyHostId: string;
  payload: Record<string, unknown>;
  updatedAt: Date;
}

export interface RebuildSupplierCallbackRecordInput {
  entityName: RebuildSupplierEntityName;
  recordId: string;
  rawPayload: Record<string, unknown>;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  status: "success" | "failed";
  errorMessage: string | null;
  createdAt: Date;
}

export interface RebuildSupplierRecordRepository {
  findSupplyCompany?: (supplyCompanyId: string) => Promise<SupplyCompanyRecordInput | null>;
  findSupplyHost?: (supplyHostId: string) => Promise<SupplyHostRecordInput | null>;
  upsertSupplyCompany: (input: SupplyCompanyRecordInput) => Promise<void>;
  upsertSupplyHost: (input: SupplyHostRecordInput) => Promise<void>;
  createCallbackRecord: (input: RebuildSupplierCallbackRecordInput) => Promise<void>;
}

export interface RebuildSupplierCallbackResult {
  entityName: RebuildSupplierEntityName;
  recordId: string;
  updatedAt: Date;
}

const SUPPLY_COMPANY_ASSET_FIELDS = [
  "packageContract",
  "companyContract",
  "businessLicensePicture",
  "businessLicense",
  "foodLicense",
  "qualification",
  "authLetter",
  "coontractFile",
  "publicityContract",
  "authorizationCertificate",
  "authorizationLetter",
  "collectionAuthorizationLetter",
  "receiptAuthorizationLetter",
];

const SUPPLY_HOST_ASSET_FIELDS = [
  "hostPic",
  "headPic",
  "mainPic",
  "businessLicensePicture",
  "businessLicense",
  "foodLicense",
  "certification",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPayloadPath(payload: Record<string, unknown>, path: string): unknown {
  if (Object.hasOwn(payload, path)) return payload[path];
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, payload);
}

function readTextValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isRecord(value)) {
    return readTextValue(value.id)
      || readTextValue(value.value)
      || readTextValue(value.primaryId);
  }
  return "";
}

function extractIdFromPayload(payload: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = readTextValue(readPayloadPath(payload, field));
    if (value) return value;
  }
  return "";
}

function buildAssetFieldMetadata(entityName: RebuildSupplierEntityName): RebuildFieldMetadata[] {
  const fieldNames = entityName === SUPPLY_COMPANY_ENTITY ? SUPPLY_COMPANY_ASSET_FIELDS : SUPPLY_HOST_ASSET_FIELDS;
  return fieldNames.map((fieldName) => ({
    entityName,
    fieldName,
    label: fieldName,
    fieldType: "FILE",
    raw: { name: fieldName, displayType: "FILE" },
  }));
}

export function extractSupplyCompanyIdFromCallback(payload: Record<string, unknown>): string {
  return extractIdFromPayload(payload, [
    "supply_company_id",
    "supplyCompanyId",
    "SupplyCompanyId",
    "primaryId",
    "recordId",
    "id",
    "data.supply_company_id",
    "data.supplyCompanyId",
    "data.SupplyCompanyId",
    "data.primaryId",
    "data.id",
  ]);
}

export function extractSupplyHostIdFromCallback(payload: Record<string, unknown>): string {
  return extractIdFromPayload(payload, [
    "supply_host_id",
    "supplyHostId",
    "SupplyHostId",
    "hostId",
    "primaryId",
    "recordId",
    "id",
    "data.supply_host_id",
    "data.supplyHostId",
    "data.SupplyHostId",
    "data.hostId",
    "data.primaryId",
    "data.id",
  ]);
}

export async function normalizeSupplierPayload(input: {
  entityName: RebuildSupplierEntityName;
  recordId: string;
  payload: Record<string, unknown>;
  assetUploader?: RebuildAssetUploader | null;
  listFields?: () => Promise<RebuildFieldMetadata[]>;
}): Promise<Record<string, unknown>> {
  if (!input.assetUploader) return { ...input.payload };
  const fields = input.listFields ? await input.listFields() : buildAssetFieldMetadata(input.entityName);
  return normalizeRebuildPayload({
    entityName: input.entityName,
    recordId: input.recordId,
    payload: input.payload,
    assetUploader: input.assetUploader,
    fields,
  });
}

export async function syncSupplyCompanyFromCallback(input: {
  supplyCompanyId: string;
  rawPayload: Record<string, unknown>;
  rebuildClient: RebuildSupplyGoodsClient;
  repository: RebuildSupplierRecordRepository;
  assetUploader?: RebuildAssetUploader | null;
  listFields?: () => Promise<RebuildFieldMetadata[]>;
}): Promise<RebuildSupplierCallbackResult> {
  const updatedAt = new Date();
  let payload: Record<string, unknown> = {};
  let normalizedPayload: Record<string, unknown> = {};
  try {
    if (!input.rebuildClient.getSupplyCompany) {
      throw new Error("SupplyCompany 查询不可用");
    }
    payload = await input.rebuildClient.getSupplyCompany(input.supplyCompanyId);
    normalizedPayload = await normalizeSupplierPayload({
      entityName: SUPPLY_COMPANY_ENTITY,
      recordId: input.supplyCompanyId,
      payload,
      assetUploader: input.assetUploader,
      listFields: input.listFields,
    });
    await input.repository.upsertSupplyCompany({
      supplyCompanyId: input.supplyCompanyId,
      payload: normalizedPayload,
      updatedAt,
    });
    await input.repository.createCallbackRecord({
      entityName: SUPPLY_COMPANY_ENTITY,
      recordId: input.supplyCompanyId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      status: "success",
      errorMessage: null,
      createdAt: updatedAt,
    });
  } catch (error) {
    await input.repository.createCallbackRecord({
      entityName: SUPPLY_COMPANY_ENTITY,
      recordId: input.supplyCompanyId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      createdAt: updatedAt,
    });
    throw error;
  }

  return {
    entityName: SUPPLY_COMPANY_ENTITY,
    recordId: input.supplyCompanyId,
    updatedAt,
  };
}

export async function syncSupplyHostFromCallback(input: {
  supplyHostId: string;
  rawPayload: Record<string, unknown>;
  rebuildClient: RebuildSupplyGoodsClient;
  repository: RebuildSupplierRecordRepository;
  assetUploader?: RebuildAssetUploader | null;
  listFields?: () => Promise<RebuildFieldMetadata[]>;
}): Promise<RebuildSupplierCallbackResult> {
  const updatedAt = new Date();
  let payload: Record<string, unknown> = {};
  let normalizedPayload: Record<string, unknown> = {};
  try {
    if (!input.rebuildClient.getSupplyHost) {
      throw new Error("SupplyHost 查询不可用");
    }
    payload = await input.rebuildClient.getSupplyHost(input.supplyHostId);
    normalizedPayload = await normalizeSupplierPayload({
      entityName: SUPPLY_HOST_ENTITY,
      recordId: input.supplyHostId,
      payload,
      assetUploader: input.assetUploader,
      listFields: input.listFields,
    });
    await input.repository.upsertSupplyHost({
      supplyHostId: input.supplyHostId,
      payload: normalizedPayload,
      updatedAt,
    });
    await input.repository.createCallbackRecord({
      entityName: SUPPLY_HOST_ENTITY,
      recordId: input.supplyHostId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      status: "success",
      errorMessage: null,
      createdAt: updatedAt,
    });
  } catch (error) {
    await input.repository.createCallbackRecord({
      entityName: SUPPLY_HOST_ENTITY,
      recordId: input.supplyHostId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      createdAt: updatedAt,
    });
    throw error;
  }

  return {
    entityName: SUPPLY_HOST_ENTITY,
    recordId: input.supplyHostId,
    updatedAt,
  };
}

export function createDrizzleRebuildSupplierRecordRepository(db: ServerDatabase): RebuildSupplierRecordRepository {
  return {
    async findSupplyCompany(supplyCompanyId: string): Promise<SupplyCompanyRecordInput | null> {
      const rows = await db
        .select({
          supplyCompanyId: rebuildSupplyCompany.supplyCompanyId,
          payload: rebuildSupplyCompany.payload,
          updatedAt: rebuildSupplyCompany.updatedAt,
        })
        .from(rebuildSupplyCompany)
        .where(eq(rebuildSupplyCompany.supplyCompanyId, supplyCompanyId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findSupplyHost(supplyHostId: string): Promise<SupplyHostRecordInput | null> {
      const rows = await db
        .select({
          supplyHostId: rebuildSupplyHost.supplyHostId,
          payload: rebuildSupplyHost.payload,
          updatedAt: rebuildSupplyHost.updatedAt,
        })
        .from(rebuildSupplyHost)
        .where(eq(rebuildSupplyHost.supplyHostId, supplyHostId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsertSupplyCompany(input: SupplyCompanyRecordInput): Promise<void> {
      await db
        .insert(rebuildSupplyCompany)
        .values({
          supplyCompanyId: input.supplyCompanyId,
          payload: input.payload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: rebuildSupplyCompany.supplyCompanyId,
          set: {
            payload: input.payload,
            updatedAt: input.updatedAt,
          },
        });
    },

    async upsertSupplyHost(input: SupplyHostRecordInput): Promise<void> {
      await db
        .insert(rebuildSupplyHost)
        .values({
          supplyHostId: input.supplyHostId,
          payload: input.payload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: rebuildSupplyHost.supplyHostId,
          set: {
            payload: input.payload,
            updatedAt: input.updatedAt,
          },
        });
    },

    async createCallbackRecord(input: RebuildSupplierCallbackRecordInput): Promise<void> {
      if (input.entityName === SUPPLY_COMPANY_ENTITY) {
        await db.insert(rebuildSupplyCompanyCallbackRecords).values({
          supplyCompanyId: input.recordId,
          rawPayload: input.rawPayload,
          payload: input.payload,
          normalizedPayload: input.normalizedPayload,
          status: input.status,
          errorMessage: input.errorMessage,
          createdAt: input.createdAt,
        });
        return;
      }

      await db.insert(rebuildSupplyHostCallbackRecords).values({
        supplyHostId: input.recordId,
        rawPayload: input.rawPayload,
        payload: input.payload,
        normalizedPayload: input.normalizedPayload,
        status: input.status,
        errorMessage: input.errorMessage,
        createdAt: input.createdAt,
      });
    },
  };
}

let defaultRepository: RebuildSupplierRecordRepository | null | undefined;

export function getDefaultRebuildSupplierRecordRepository(): RebuildSupplierRecordRepository | null {
  if (defaultRepository !== undefined) {
    return defaultRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，销售提报商户/公司回调不会写入数据库");
    defaultRepository = null;
    return defaultRepository;
  }

  defaultRepository = createDrizzleRebuildSupplierRecordRepository(createDatabase(databaseUrl));
  return defaultRepository;
}
