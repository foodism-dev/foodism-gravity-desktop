import { eq } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../db/client.ts";
import {
  rebuildSupplyCompany,
  rebuildSupplyGoods,
  rebuildSupplyGoodsCallbackRecords,
  ticketActionRecords,
  tickets,
} from "../db/schema.ts";
import { buildRebuildOpenApiUrl, readJsonResponse } from "./openapi.ts";
import type { RebuildFieldMetadata, RebuildFieldMetadataRepository } from "./fields.ts";
import { mirrorRebuildAssets, replacePayloadAssetUrls, type RebuildAssetUploader } from "./assets.ts";
import {
  getTicketStatusByBusinessStatus,
  isApprovalStatePassed,
  matchTicketBusinessStatusByApproval,
  normalizeTicketBusinessStatus,
} from "../ticket-status.ts";

export interface SupplyGoodsRecordUpsertInput {
  supplyGoodsId: string;
  rawPayload: Record<string, unknown>;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  supplyCompany?: SupplyCompanyRecordUpsertInput | null;
  updatedAt: Date;
}

export interface SupplyCompanyRecordUpsertInput {
  supplyCompanyId: string;
  payload: Record<string, unknown>;
  updatedAt: Date;
}

export interface SupplyGoodsCallbackRecordInput {
  supplyGoodsId: string;
  rawPayload: Record<string, unknown>;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  status: "success" | "failed";
  errorMessage: string | null;
  createdAt: Date;
}

export interface SupplyGoodsRecordRepository {
  upsertRecord: (input: SupplyGoodsRecordUpsertInput) => Promise<void>;
  createCallbackRecord: (input: SupplyGoodsCallbackRecordInput) => Promise<void>;
}

export interface RebuildSupplyGoodsClient {
  getSupplyGoods: (supplyGoodsId: string) => Promise<Record<string, unknown>>;
  getSupplyCompany?: (supplyCompanyId: string) => Promise<Record<string, unknown>>;
  clearFieldCache?: () => void;
}

export interface RebuildSupplyGoodsClientOptions {
  fieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  fieldCacheTtlMs?: number;
  now?: () => number;
}

export interface SupplyGoodsCallbackResult {
  supplyGoodsId: string;
  updatedAt: Date;
}

export const SUPPLY_GOODS_ENTITY = "SupplyGoods";
export const SUPPLY_COMPANY_ENTITY = "SupplyCompany";
const DEFAULT_FIELD_CACHE_TTL_MS = 5 * 60 * 1000;
export const SUPPLY_COMPANY_SYNC_FIELDS = [
  "SupplyCompanyId",
  "supplyCompanyId",
  "companyName",
  "name",
  "legalPerson",
  "address",
  "telephone",
  "businessLicenseNo",
  "businessLicensePicture",
  "businessLicenseExpiryDate",
  "businessLicenseDate",
  "foodLicense",
  "guestId",
  "modifiedOn",
  "modifiedBy",
  "createdOn",
  "createdBy",
  "owningUser",
  "owningDept",
];
export const SUPPLY_GOODS_SYNC_FIELDS = [
  "SupplyGoodsId",
  "supplyGoodsId",
  "autoId",
  "acnLevel",
  "goodsId",
  "goodsName",
  "goodsNameInput",
  "hostNameInput",
  "targetGoods",
  "majorType",
  "selfRating",
  "selfRatingNew.text",
  "isTpGoods",
  "previewUrl",
  "presentingRemindWords",
  "presentingRemindConfirm",
  "signCity",
  "mainPic",
  "rbimages",
  "details",
  "detailImages",
  "businessLicensePicture",
  "businessLicenseExpiryDate",
  "businessLicenseDate",
  "businessLicenseNo",
  "foodLicense",
  "packageContract",
  "publicityContract",
  "freeSettleAmount",
  "freeSettleRatio",
  "freeSettleNote",
  "channelLimit",
  "guideline",
  "packages",
  "reservationRule",
  "reservationRule.text",
  "reservationType",
  "reservationMark",
  "reservation",
  "originPrice",
  "price",
  "discount",
  "supplyPrice",
  "classification",
  "signAmount",
  "excludeHost",
  "saleUntil",
  "holidayLimit",
  "reservationDays",
  "rbhost",
  "rbhost.hostId",
  "rbhost.hostName",
  "hostNum",
  "company",
  "company.SupplyCompanyId",
  "companyName",
  "legalPerson",
  "address",
  "telephone",
  "capacity",
  "bdUser",
  "bdUser.fullName",
  "auditStatus",
  "auditStatus.text",
  "approvalState",
  "approvalId",
  "OAApprovalNo",
  "OAApprovalType",
  "rejectRemark",
  "rejectOptions",
  "bdAuditor",
  "productAuditors",
  "saleAuditor",
  "isRejectedBySaleSupport",
  "limitation",
  "singleUserPurchaseLimit",
  "hostTpRightsBind.curTpRightsOrderNo",
  "hostTpRightsBind.tpRightsBindSupplyCompany.tpRightsBindSupplyCompanyId",
  "hostTpRightsBind.tpRightsBindSupplyCompany.skuId",
  "hostTpRightsBind.tpRightsBindSupplyCompany.tpRightsCpsValidPeriod",
  "hostTpRightsBind.tpRightsBindSupplyCompany.payScene",
  "supplyTpChannel.text",
  "supplyTpChannel.seq",
  "latestTpRights",
  "supplyTpOrder",
  "goodsFeatures",
  "salePoint",
  "hotReason",
  "useEndTime",
  "isPackage",
  "isUseBox",
  "isCoupoun",
  "eatPersonNum",
  "maxEatPersonNum",
  "isInsurance",
  "isFeeExceptHoliday",
  "isGetTicket",
  "acceptGroup.text",
  "isLimitSex",
  "isLimitHair",
  "isLimitExperience",
  "advanceBookDate",
  "timeUnit.text",
  "useStartTime",
  "capacityText",
  "isOutMeal",
  "useDate.text",
  "isCrossDay.text",
  "mealType.text",
  "onlineChannel",
  "settleType.text",
  "showChannel.text",
  "stockTime",
  "hasAchivedAll",
  "isHotPlanned",
  "hasSumitted",
  "isHostPOIIDMatch",
  "hasPushedMiddleSide",
  "hasOnlinePush",
  "hasCreateStorage",
  "hasBrief",
  "regionRatingCertificate",
  "isLimitSexNew.text",
  "isLimitHairNew.text",
  "modifiedOn",
  "modifiedBy",
  "createdOn",
  "createdBy",
  "owningUser",
  "owningDept",
  "validUntil",
  "saleBegin",
  "bdCity",
  "bdGroup",
  "bdRegion",
  "bdSubRegion",
];

interface CachedRebuildFields {
  expiresAt: number;
  fields: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function shouldRequestTextCompanion(field: RebuildFieldMetadata): boolean {
  const signature = [
    field.fieldType,
    readString(field.raw, ["displayType", "type", "typeName", "fieldType"]),
  ].join(" ").toLowerCase();
  return (
    signature.includes("picklist")
    || signature.includes("multiselect")
    || signature.includes("multi-select")
    || signature.includes("classification")
    || signature.includes("选项")
    || signature.includes("下拉")
    || signature.includes("多选")
    || signature.includes("分类")
  );
}

function buildRebuildSyncFieldsFromMetadata(fields: RebuildFieldMetadata[]): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    const fieldName = field.fieldName.trim();
    if (!fieldName) continue;
    names.add(fieldName);
    if (shouldRequestTextCompanion(field)) {
      names.add(`${fieldName}.text`);
    }
  }
  return [...names];
}

async function resolveRebuildSyncFields(input: {
  entityName: string;
  fallbackFields: string[];
  repository: RebuildFieldMetadataRepository | null | undefined;
  cache: CachedRebuildFields | null;
  cacheTtlMs: number;
  now: () => number;
  setCache: (cache: CachedRebuildFields) => void;
}): Promise<string[]> {
  if (!input.repository) return input.fallbackFields;

  const currentTime = input.now();
  if (input.cache && input.cache.expiresAt > currentTime) {
    return input.cache.fields;
  }

  const metadataFields = await input.repository.listFieldsByEntity(input.entityName);
  const fields = buildRebuildSyncFieldsFromMetadata(metadataFields);
  if (fields.length === 0) {
    console.warn(`[REBUILD] ${input.entityName} 字段元数据为空，回退使用内置字段列表`);
    input.setCache({
      fields: input.fallbackFields,
      expiresAt: currentTime + input.cacheTtlMs,
    });
    return input.fallbackFields;
  }

  input.setCache({
    fields,
    expiresAt: currentTime + input.cacheTtlMs,
  });
  return fields;
}

function buildRebuildEntityGetUrl(entity: string, id: string, fields: string[]): URL {
  return buildRebuildOpenApiUrl("entity/get", {
    entity,
    id,
    fields: fields.join(","),
  });
}

function buildSupplyGoodsGetUrl(supplyGoodsId: string, fields: string[]): URL {
  return buildRebuildEntityGetUrl(SUPPLY_GOODS_ENTITY, supplyGoodsId, fields);
}

function buildSupplyCompanyGetUrl(supplyCompanyId: string, fields: string[]): URL {
  return buildRebuildEntityGetUrl(SUPPLY_COMPANY_ENTITY, supplyCompanyId, fields);
}

export function extractSupplyGoodsId(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const candidates = [body.supply_goods_id, body.supplyGoodsId, body.record_id, body.recordId, body.primaryId, body.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function createRebuildSupplyGoodsClient(options: RebuildSupplyGoodsClientOptions = {}): RebuildSupplyGoodsClient {
  let supplyGoodsFieldCache: CachedRebuildFields | null = null;
  let supplyCompanyFieldCache: CachedRebuildFields | null = null;
  const fieldCacheTtlMs = options.fieldCacheTtlMs ?? DEFAULT_FIELD_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  return {
    clearFieldCache(): void {
      supplyGoodsFieldCache = null;
      supplyCompanyFieldCache = null;
    },

    async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
      const fields = await resolveRebuildSyncFields({
        entityName: SUPPLY_GOODS_ENTITY,
        fallbackFields: SUPPLY_GOODS_SYNC_FIELDS,
        repository: options.fieldMetadataRepository,
        cache: supplyGoodsFieldCache,
        cacheTtlMs: fieldCacheTtlMs,
        now,
        setCache: (nextCache) => {
          supplyGoodsFieldCache = nextCache;
        },
      });
      const url = buildSupplyGoodsGetUrl(supplyGoodsId, fields);
      console.log(`[REBUILD] 回调同步 SupplyGoods: ${supplyGoodsId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyGoods 记录");
      }
      return result.data;
    },

    async getSupplyCompany(supplyCompanyId: string): Promise<Record<string, unknown>> {
      const fields = await resolveRebuildSyncFields({
        entityName: SUPPLY_COMPANY_ENTITY,
        fallbackFields: SUPPLY_COMPANY_SYNC_FIELDS,
        repository: options.fieldMetadataRepository,
        cache: supplyCompanyFieldCache,
        cacheTtlMs: fieldCacheTtlMs,
        now,
        setCache: (nextCache) => {
          supplyCompanyFieldCache = nextCache;
        },
      });
      const url = buildSupplyCompanyGetUrl(supplyCompanyId, fields);
      console.log(`[REBUILD] 回调同步 SupplyCompany: ${supplyCompanyId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyCompany 记录");
      }
      return result.data;
    },
  };
}

export function createDrizzleSupplyGoodsRecordRepository(db: ServerDatabase): SupplyGoodsRecordRepository {
  return {
    async upsertRecord(input: SupplyGoodsRecordUpsertInput): Promise<void> {
      const existingTicketRows = await db
        .select({
          id: tickets.id,
          businessStatus: tickets.businessStatus,
          payload: tickets.payload,
        })
        .from(tickets)
        .where(eq(tickets.supplyGoodsId, input.supplyGoodsId))
        .limit(1);
      const existingTicket = existingTicketRows[0];
      const approvalState = readApprovalState(input.normalizedPayload);
      const isApprovalPassed = isApprovalStatePassed(approvalState);
      const shouldSeedPayload = isApprovalPassed
        && (!existingTicket || isEmptyRecord(existingTicket.payload));
      const nextTicketPayload = shouldSeedPayload
        ? buildTicketPayloadFromSupplyGoods(input.normalizedPayload, input.supplyCompany)
        : hydrateTicketPayloadCompany(existingTicket?.payload ?? {}, input.supplyCompany);
      const nextBusinessStatus = matchTicketBusinessStatusByApproval(
        isApprovalPassed,
        existingTicket ? normalizeTicketBusinessStatus(existingTicket.businessStatus) : undefined,
      );
      const nextTicketStatus = getTicketStatusByBusinessStatus(nextBusinessStatus);

      await db
        .insert(rebuildSupplyGoods)
        .values({
          supplyGoodsId: input.supplyGoodsId,
          payload: input.normalizedPayload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: rebuildSupplyGoods.supplyGoodsId,
          set: {
            payload: input.normalizedPayload,
            updatedAt: input.updatedAt,
          },
        });

      if (input.supplyCompany) {
        await db
          .insert(rebuildSupplyCompany)
          .values({
            supplyCompanyId: input.supplyCompany.supplyCompanyId,
            payload: input.supplyCompany.payload,
            updatedAt: input.supplyCompany.updatedAt,
          })
          .onConflictDoUpdate({
            target: rebuildSupplyCompany.supplyCompanyId,
            set: {
              payload: input.supplyCompany.payload,
              updatedAt: input.supplyCompany.updatedAt,
            },
          });
      }
      await db
        .insert(tickets)
        .values({
          supplyGoodsId: input.supplyGoodsId,
          status: nextTicketStatus,
          businessStatus: nextBusinessStatus,
          payload: nextTicketPayload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: tickets.supplyGoodsId,
          set: {
            status: nextTicketStatus,
            businessStatus: nextBusinessStatus,
            payload: nextTicketPayload,
            updatedAt: input.updatedAt,
          },
        });

      if (shouldSeedPayload) {
        const ticketRows = await db
          .select({ id: tickets.id })
          .from(tickets)
          .where(eq(tickets.supplyGoodsId, input.supplyGoodsId))
          .limit(1);
        const ticketId = ticketRows[0]?.id;
        if (ticketId) {
          await db.insert(ticketActionRecords).values({
            ticketId,
            action: "import_from_rebuild",
            origin: buildEmptyOriginPayload(nextTicketPayload),
            current: nextTicketPayload,
            operator: { source: "rebuild" },
            remark: "Rebuild 审核通过后初始化 ticket payload",
            createdAt: input.updatedAt,
          });
        }
      }
    },

    async createCallbackRecord(input: SupplyGoodsCallbackRecordInput): Promise<void> {
      await db.insert(rebuildSupplyGoodsCallbackRecords).values({
        supplyGoodsId: input.supplyGoodsId,
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

let defaultRepository: SupplyGoodsRecordRepository | null | undefined;

export function getDefaultSupplyGoodsRecordRepository(): SupplyGoodsRecordRepository | null {
  if (defaultRepository !== undefined) {
    return defaultRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，SupplyGoods 回调不会写入数据库");
    defaultRepository = null;
    return defaultRepository;
  }

  defaultRepository = createDrizzleSupplyGoodsRecordRepository(createDatabase(databaseUrl));
  return defaultRepository;
}

export async function syncSupplyGoodsFromCallback(input: {
  supplyGoodsId: string;
  rawPayload: Record<string, unknown>;
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
  assetUploader?: RebuildAssetUploader | null;
  listFields?: () => Promise<RebuildFieldMetadata[]>;
  listSupplyCompanyFields?: () => Promise<RebuildFieldMetadata[]>;
  onSupplyCompanyDiscovered?: () => Promise<void>;
}): Promise<SupplyGoodsCallbackResult> {
  const updatedAt = new Date();
  let payload: Record<string, unknown> = {};
  let normalizedPayload: Record<string, unknown> = {};
  try {
    payload = await input.rebuildClient.getSupplyGoods(input.supplyGoodsId);
    normalizedPayload = await normalizeSupplyGoodsPayload({
      supplyGoodsId: input.supplyGoodsId,
      payload,
      assetUploader: input.assetUploader,
      fields: input.listFields ? await input.listFields() : [],
    });
    if (extractSupplyCompanyId(normalizedPayload)) {
      await input.onSupplyCompanyDiscovered?.();
    }
    const supplyCompany = await resolveSupplyCompanyRecord({
      payload: normalizedPayload,
      rebuildClient: input.rebuildClient,
      assetUploader: input.assetUploader,
      fields: input.listSupplyCompanyFields ? await input.listSupplyCompanyFields() : [],
      updatedAt,
    });
    await input.repository.upsertRecord({
      supplyGoodsId: input.supplyGoodsId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      supplyCompany,
      updatedAt,
    });
    await input.repository.createCallbackRecord({
      supplyGoodsId: input.supplyGoodsId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
      status: "success",
      errorMessage: null,
      createdAt: updatedAt,
    });
  } catch (error) {
    await input.repository.createCallbackRecord({
      supplyGoodsId: input.supplyGoodsId,
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
    supplyGoodsId: input.supplyGoodsId,
    updatedAt,
  };
}

function readApprovalState(payload: Record<string, unknown>): string {
  const value = payload.approvalState;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isRecord(value)) {
    const text = value.text;
    if (typeof text === "string" || typeof text === "number" || typeof text === "boolean") {
      return String(text);
    }
    const rawValue = value.value;
    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      return String(rawValue);
    }
  }
  return "unknown";
}

export function isSupplyGoodsApprovalPassed(payload: Record<string, unknown>): boolean {
  return isApprovalStatePassed(readApprovalState(payload));
}

export function buildTicketPayloadFromSupplyGoods(
  payload: Record<string, unknown>,
  supplyCompany?: SupplyCompanyRecordUpsertInput | null,
): Record<string, unknown> {
  if (!isSupplyGoodsApprovalPassed(payload)) return {};
  return mergeSupplyCompanyIntoTicketPayload(payload, supplyCompany);
}

export function mergeSupplyCompanyIntoTicketPayload(
  payload: Record<string, unknown>,
  supplyCompany?: SupplyCompanyRecordUpsertInput | null,
): Record<string, unknown> {
  return hydrateTicketPayloadCompany(payload, supplyCompany);
}

export function hydrateTicketPayloadCompany(
  payload: Record<string, unknown>,
  supplyCompany?: SupplyCompanyRecordUpsertInput | null,
): Record<string, unknown> {
  if (!supplyCompany) return { ...payload };
  const company = payload.company;
  if (!isRecord(company)) return { ...payload };
  const guestId = supplyCompany.payload.guestId;
  if (typeof guestId !== "string" || !guestId.trim()) return { ...payload };
  return {
    ...payload,
    company: {
      ...company,
      guestId: guestId.trim(),
    },
  };
}

export function extractSupplyCompanyId(payload: Record<string, unknown>): string | null {
  const company = payload.company;
  if (!isRecord(company)) return null;
  const entity = company.entity;
  if (entity !== undefined && entity !== SUPPLY_COMPANY_ENTITY) return null;
  const candidates = [
    company.id,
    company.SupplyCompanyId,
    company.supplyCompanyId,
    company.value,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

async function resolveSupplyCompanyRecord(input: {
  payload: Record<string, unknown>;
  rebuildClient: RebuildSupplyGoodsClient;
  assetUploader?: RebuildAssetUploader | null;
  fields: RebuildFieldMetadata[];
  updatedAt: Date;
}): Promise<SupplyCompanyRecordUpsertInput | null> {
  const supplyCompanyId = extractSupplyCompanyId(input.payload);
  if (!supplyCompanyId || !input.rebuildClient.getSupplyCompany) return null;

  try {
    const payload = await input.rebuildClient.getSupplyCompany(supplyCompanyId);
    return {
      supplyCompanyId,
      payload: await normalizeSupplyCompanyPayload({
        supplyCompanyId,
        payload,
        assetUploader: input.assetUploader,
        fields: input.fields,
      }),
      updatedAt: input.updatedAt,
    };
  } catch (error) {
    console.warn(`[REBUILD] SupplyCompany 同步失败: ${supplyCompanyId} ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function normalizeSupplyGoodsPayload(input: {
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  assetUploader?: RebuildAssetUploader | null;
  fields: RebuildFieldMetadata[];
}): Promise<Record<string, unknown>> {
  const normalizedPayload = await normalizeRebuildPayload({
    entityName: SUPPLY_GOODS_ENTITY,
    recordId: input.supplyGoodsId,
    payload: input.payload,
    assetUploader: input.assetUploader,
    fields: input.fields,
  });
  if (isRecord(input.payload.company)) {
    normalizedPayload.company = { ...input.payload.company };
  }
  return normalizedPayload;
}

export async function normalizeSupplyCompanyPayload(input: {
  supplyCompanyId: string;
  payload: Record<string, unknown>;
  assetUploader?: RebuildAssetUploader | null;
  fields: RebuildFieldMetadata[];
}): Promise<Record<string, unknown>> {
  return normalizeRebuildPayload({
    entityName: SUPPLY_COMPANY_ENTITY,
    recordId: input.supplyCompanyId,
    payload: input.payload,
    assetUploader: input.assetUploader,
    fields: input.fields,
  });
}

export async function normalizeRebuildPayload(input: {
  entityName: string;
  recordId: string;
  payload: Record<string, unknown>;
  assetUploader?: RebuildAssetUploader | null;
  fields: RebuildFieldMetadata[];
}): Promise<Record<string, unknown>> {
  if (!input.assetUploader) return { ...input.payload };
  const assets = await mirrorRebuildAssets({
    entityName: input.entityName,
    recordId: input.recordId,
    payload: input.payload,
    fields: input.fields,
    uploader: input.assetUploader,
  });
  return replacePayloadAssetUrls(input.payload, assets);
}

export function buildEmptyOriginPayload(payload: Record<string, unknown>): Record<string, null> {
  return Object.fromEntries(Object.keys(payload).map((key) => [key, null]));
}

function isEmptyRecord(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).length === 0;
}
