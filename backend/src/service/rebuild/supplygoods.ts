import { eq, inArray } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../../db/client.ts";
import {
  rebuildSupplyCompany,
  rebuildSupplyGoods,
  rebuildSupplyGoodsCallbackRecords,
  ticketActionRecords,
  tickets,
} from "../../db/schema.ts";
import { buildRebuildOpenApiUrl, readJsonResponse } from "./openapi.ts";
import type { RebuildFieldMetadata, RebuildFieldMetadataRepository } from "./fields.ts";
import { mirrorRebuildAssets, replacePayloadAssetUrls, type RebuildAssetUploader } from "./assets.ts";
import {
  getTicketStatusByBusinessStatus,
  isApprovalStatePassed,
  isApprovalStateProcessing,
  matchTicketBusinessStatusByApprovalState,
  normalizeTicketBusinessStatus,
  type TicketBusinessStatus,
  type TicketFlowState,
} from "../../ticket-status.ts";

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
  findMissingSupplyGoodsIds?: (supplyGoodsIds: string[]) => Promise<string[]>;
  upsertRecord: (input: SupplyGoodsRecordUpsertInput) => Promise<void>;
  createCallbackRecord: (input: SupplyGoodsCallbackRecordInput) => Promise<void>;
}

export interface RebuildSupplyGoodsListInput {
  pageNo: number;
  pageSize: number;
}

export interface RebuildSupplyGoodsClient {
  getSupplyGoods: (supplyGoodsId: string) => Promise<Record<string, unknown>>;
  listSupplyGoodsIds?: (input: RebuildSupplyGoodsListInput) => Promise<string[]>;
  getSupplyCompany?: (supplyCompanyId: string) => Promise<Record<string, unknown>>;
  getSupplyHost?: (supplyHostId: string) => Promise<Record<string, unknown>>;
  getSupplyCompanyReference?: (supplyCompanyId: string) => Promise<Record<string, unknown>>;
  getSupplyHostReference?: (supplyHostId: string) => Promise<Record<string, unknown>>;
  clearFieldCache?: () => void;
}

export interface RebuildSupplyGoodsClientOptions {
  fieldMetadataRepository?: RebuildFieldMetadataRepository | null;
  fieldCacheTtlMs?: number;
  now?: () => number;
}

export interface SupplyGoodsCallbackResult {
  supplyGoodsId: string;
  normalizedPayload: Record<string, unknown>;
  updatedAt: Date;
}

export const SUPPLY_GOODS_ENTITY = "SupplyGoods";
export const SUPPLY_COMPANY_ENTITY = "SupplyCompany";
export const SUPPLY_HOST_ENTITY = "SupplyHost";
const DEFAULT_FIELD_CACHE_TTL_MS = 5 * 60 * 1000;
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

const SUPPLY_COMPANY_REFERENCE_FIELDS = ["SupplyCompanyId", "approvalState", "guestId"];
const SUPPLY_HOST_REFERENCE_FIELDS = ["SupplyHostId", "approvalState"];

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
  fallbackFields: string[] | null;
  repository: RebuildFieldMetadataRepository | null | undefined;
  cache: CachedRebuildFields | null;
  cacheTtlMs: number;
  now: () => number;
  setCache: (cache: CachedRebuildFields) => void;
}): Promise<string[]> {
  if (!input.repository) return input.fallbackFields ?? [];

  const currentTime = input.now();
  if (input.cache && input.cache.expiresAt > currentTime) {
    return input.cache.fields;
  }

  const metadataFields = await input.repository.listFieldsByEntity(input.entityName);
  const fields = buildRebuildSyncFieldsFromMetadata(metadataFields);
  if (fields.length === 0) {
    input.setCache({
      fields: [],
      expiresAt: currentTime + input.cacheTtlMs,
    });
    return [];
  }

  input.setCache({
    fields,
    expiresAt: currentTime + input.cacheTtlMs,
  });
  return fields;
}

function assertRebuildFieldsAvailable(entityName: string, fields: string[]): void {
  if (fields.length > 0) return;
  throw new Error(`${entityName} 字段元数据为空，请先同步 rebuild_fields`);
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

function buildSupplyGoodsListUrl(input: RebuildSupplyGoodsListInput): URL {
  return buildRebuildOpenApiUrl("entity/list", {
    entity: SUPPLY_GOODS_ENTITY,
    fields: "SupplyGoodsId",
    approvalState: "审核中",
    page_no: input.pageNo,
    page_size: input.pageSize,
    sort_by: "modifiedOn:desc",
  });
}

function buildSupplyCompanyGetUrl(supplyCompanyId: string, fields: string[]): URL {
  return buildRebuildEntityGetUrl(SUPPLY_COMPANY_ENTITY, supplyCompanyId, fields);
}

function buildSupplyHostGetUrl(supplyHostId: string, fields: string[]): URL {
  return buildRebuildEntityGetUrl(SUPPLY_HOST_ENTITY, supplyHostId, fields);
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

function extractSupplyGoodsIdsFromListResponse(data: unknown): string[] {
  if (!isRecord(data)) return [];
  const list = Array.isArray(data.list)
    ? data.list
    : Array.isArray(data.data)
      ? data.data
      : [];
  const ids: string[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const supplyGoodsId = readString(item, ["SupplyGoodsId", "supplyGoodsId", "id", "value"]);
    if (supplyGoodsId) ids.push(supplyGoodsId);
  }
  return [...new Set(ids)];
}

export function createRebuildSupplyGoodsClient(options: RebuildSupplyGoodsClientOptions = {}): RebuildSupplyGoodsClient {
  let supplyGoodsFieldCache: CachedRebuildFields | null = null;
  let supplyCompanyFieldCache: CachedRebuildFields | null = null;
  let supplyHostFieldCache: CachedRebuildFields | null = null;
  const fieldCacheTtlMs = options.fieldCacheTtlMs ?? DEFAULT_FIELD_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  return {
    clearFieldCache(): void {
      supplyGoodsFieldCache = null;
      supplyCompanyFieldCache = null;
      supplyHostFieldCache = null;
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
      assertRebuildFieldsAvailable(SUPPLY_GOODS_ENTITY, fields);
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

    async listSupplyGoodsIds(input: RebuildSupplyGoodsListInput): Promise<string[]> {
      const url = buildSupplyGoodsListUrl(input);
      console.log(`[REBUILD] 查询 SupplyGoods 导入列表: page=${input.pageNo} size=${input.pageSize}`);
      const result = await readJsonResponse<unknown>(await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: SUPPLY_GOODS_ENTITY }),
      }));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      return extractSupplyGoodsIdsFromListResponse(result.data);
    },

    async getSupplyCompany(supplyCompanyId: string): Promise<Record<string, unknown>> {
      const fields = await resolveRebuildSyncFields({
        entityName: SUPPLY_COMPANY_ENTITY,
        fallbackFields: null,
        repository: options.fieldMetadataRepository,
        cache: supplyCompanyFieldCache,
        cacheTtlMs: fieldCacheTtlMs,
        now,
        setCache: (nextCache) => {
          supplyCompanyFieldCache = nextCache;
        },
      });
      assertRebuildFieldsAvailable(SUPPLY_COMPANY_ENTITY, fields);
      const url = buildSupplyCompanyGetUrl(supplyCompanyId, fields);
      console.log(`[REBUILD] 查询 SupplyCompany 详情: ${supplyCompanyId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyCompany 记录");
      }
      return result.data;
    },

    async getSupplyHost(supplyHostId: string): Promise<Record<string, unknown>> {
      const fields = await resolveRebuildSyncFields({
        entityName: SUPPLY_HOST_ENTITY,
        fallbackFields: null,
        repository: options.fieldMetadataRepository,
        cache: supplyHostFieldCache,
        cacheTtlMs: fieldCacheTtlMs,
        now,
        setCache: (nextCache) => {
          supplyHostFieldCache = nextCache;
        },
      });
      assertRebuildFieldsAvailable(SUPPLY_HOST_ENTITY, fields);
      const url = buildSupplyHostGetUrl(supplyHostId, fields);
      console.log(`[REBUILD] 查询 SupplyHost 详情: ${supplyHostId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyHost 记录");
      }
      return result.data;
    },

    async getSupplyCompanyReference(supplyCompanyId: string): Promise<Record<string, unknown>> {
      const url = buildSupplyCompanyGetUrl(supplyCompanyId, SUPPLY_COMPANY_REFERENCE_FIELDS);
      console.log(`[REBUILD] 回调同步 SupplyCompany 关联状态: ${supplyCompanyId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyCompany 关联状态");
      }
      return result.data;
    },

    async getSupplyHostReference(supplyHostId: string): Promise<Record<string, unknown>> {
      const url = buildSupplyHostGetUrl(supplyHostId, SUPPLY_HOST_REFERENCE_FIELDS);
      console.log(`[REBUILD] 回调同步 SupplyHost 关联状态: ${supplyHostId}`);
      const result = await readJsonResponse<Record<string, unknown>>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      if (!isRecord(result.data)) {
        throw new Error("REBUILD OpenAPI 未返回 SupplyHost 关联状态");
      }
      return result.data;
    },

  };
}

export function createDrizzleSupplyGoodsRecordRepository(db: ServerDatabase): SupplyGoodsRecordRepository {
  return {
    async findMissingSupplyGoodsIds(supplyGoodsIds: string[]): Promise<string[]> {
      const uniqueIds = [...new Set(supplyGoodsIds.map((id) => id.trim()).filter(Boolean))];
      if (uniqueIds.length === 0) return [];
      const existingRows = await db
        .select({ supplyGoodsId: rebuildSupplyGoods.supplyGoodsId })
        .from(rebuildSupplyGoods)
        .where(inArray(rebuildSupplyGoods.supplyGoodsId, uniqueIds));
      const existingIds = new Set(existingRows.map((row) => row.supplyGoodsId));
      return uniqueIds.filter((supplyGoodsId) => !existingIds.has(supplyGoodsId));
    },

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
      const nextTicketState = getSupplyGoodsTicketFlowState(
        input.normalizedPayload,
        existingTicket ? normalizeTicketBusinessStatus(existingTicket.businessStatus) : undefined,
      );

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

      if (!canEnterTicketFromSupplyGoodsPayload(input.normalizedPayload)) {
        return;
      }

      await db
        .insert(tickets)
        .values({
          supplyGoodsId: input.supplyGoodsId,
          status: nextTicketState.status,
          businessStatus: nextTicketState.businessStatus,
          payload: nextTicketPayload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: tickets.supplyGoodsId,
          set: {
            status: nextTicketState.status,
            businessStatus: nextTicketState.businessStatus,
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
    normalizedPayload = await hydrateSupplyGoodsReferenceStatus({
      payload: normalizedPayload,
      rebuildClient: input.rebuildClient,
    });
    await input.repository.upsertRecord({
      supplyGoodsId: input.supplyGoodsId,
      rawPayload: input.rawPayload,
      payload,
      normalizedPayload,
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
    normalizedPayload,
    updatedAt,
  };
}

function readApprovalState(payload: Record<string, unknown>): string {
  return readApprovalStateValue(payload.approvalState);
}

function readApprovalStateValue(value: unknown): string {
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

function isTicketEntryApprovalState(value: unknown): boolean {
  const approvalState = readApprovalStateValue(value);
  return isApprovalStateProcessing(approvalState) || isApprovalStatePassed(approvalState);
}

export function isSupplyGoodsApprovalPassed(payload: Record<string, unknown>): boolean {
  return isApprovalStatePassed(readApprovalState(payload));
}

export function canEnterTicketFromSupplyGoodsPayload(payload: Record<string, unknown>): boolean {
  if (!isTicketEntryApprovalState(payload.approvalState)) return false;
  if (!isRecord(payload.company) || !isTicketEntryApprovalState(payload.company.approvalState)) {
    return false;
  }
  if (!isRecord(payload.rbhost) || !isTicketEntryApprovalState(payload.rbhost.approvalState)) {
    return false;
  }
  return true;
}

export function getSupplyGoodsTicketFlowState(
  payload: Record<string, unknown>,
  currentBusinessStatus?: TicketBusinessStatus,
): TicketFlowState {
  const businessStatus = matchTicketBusinessStatusByApprovalState(
    readApprovalState(payload),
    currentBusinessStatus,
  );
  return {
    status: getTicketStatusByBusinessStatus(businessStatus),
    businessStatus,
  };
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

export function extractSupplyHostId(payload: Record<string, unknown>): string | null {
  const rbhost = payload.rbhost;
  if (!isRecord(rbhost)) return null;
  const entity = rbhost.entity;
  if (entity !== undefined && entity !== SUPPLY_HOST_ENTITY) return null;
  const candidates = [
    rbhost.id,
    rbhost.SupplyHostId,
    rbhost.supplyHostId,
    rbhost.value,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function copyPresentReferenceFields(
  reference: Record<string, unknown>,
  source: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const nextReference = { ...reference };
  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      nextReference[field] = source[field];
    }
  }
  return nextReference;
}

async function hydrateSupplyGoodsReferenceStatus(input: {
  payload: Record<string, unknown>;
  rebuildClient: RebuildSupplyGoodsClient;
}): Promise<Record<string, unknown>> {
  let hydratedPayload = { ...input.payload };

  const supplyCompanyId = extractSupplyCompanyId(hydratedPayload);
  if (supplyCompanyId && input.rebuildClient.getSupplyCompanyReference && isRecord(hydratedPayload.company)) {
    const companyReference = await input.rebuildClient.getSupplyCompanyReference(supplyCompanyId);
    hydratedPayload = {
      ...hydratedPayload,
      company: copyPresentReferenceFields(hydratedPayload.company, companyReference, ["approvalState", "guestId"]),
    };
  }

  const supplyHostId = extractSupplyHostId(hydratedPayload);
  if (supplyHostId && input.rebuildClient.getSupplyHostReference && isRecord(hydratedPayload.rbhost)) {
    const hostReference = await input.rebuildClient.getSupplyHostReference(supplyHostId);
    hydratedPayload = {
      ...hydratedPayload,
      rbhost: copyPresentReferenceFields(hydratedPayload.rbhost, hostReference, ["approvalState"]),
    };
  }

  return hydratedPayload;
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
