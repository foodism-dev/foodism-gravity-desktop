import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../db/client.ts";
import { rebuildSupplyGoods, tickets } from "../db/schema.ts";
import { buildRebuildOpenApiUrl, readJsonResponse } from "./openapi.ts";
import type { RebuildFieldMetadata, RebuildFieldMetadataRepository } from "./fields.ts";

export interface SupplyGoodsRecordUpsertInput {
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  updatedAt: Date;
}

export interface SupplyGoodsRecordRepository {
  upsertRecord: (input: SupplyGoodsRecordUpsertInput) => Promise<void>;
}

export interface RebuildSupplyGoodsClient {
  getSupplyGoods: (supplyGoodsId: string) => Promise<Record<string, unknown>>;
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

interface CachedSupplyGoodsFields {
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

function buildSupplyGoodsSyncFieldsFromMetadata(fields: RebuildFieldMetadata[]): string[] {
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

async function resolveSupplyGoodsSyncFields(input: {
  repository: RebuildFieldMetadataRepository | null | undefined;
  cache: CachedSupplyGoodsFields | null;
  cacheTtlMs: number;
  now: () => number;
  setCache: (cache: CachedSupplyGoodsFields) => void;
}): Promise<string[]> {
  if (!input.repository) return SUPPLY_GOODS_SYNC_FIELDS;

  const currentTime = input.now();
  if (input.cache && input.cache.expiresAt > currentTime) {
    return input.cache.fields;
  }

  const metadataFields = await input.repository.listFieldsByEntity(SUPPLY_GOODS_ENTITY);
  const fields = buildSupplyGoodsSyncFieldsFromMetadata(metadataFields);
  if (fields.length === 0) {
    console.warn("[REBUILD] SupplyGoods 字段元数据为空，回退使用内置字段列表");
    input.setCache({
      fields: SUPPLY_GOODS_SYNC_FIELDS,
      expiresAt: currentTime + input.cacheTtlMs,
    });
    return SUPPLY_GOODS_SYNC_FIELDS;
  }

  input.setCache({
    fields,
    expiresAt: currentTime + input.cacheTtlMs,
  });
  return fields;
}

function buildSupplyGoodsGetUrl(supplyGoodsId: string, fields: string[]): URL {
  return buildRebuildOpenApiUrl("entity/get", {
    entity: SUPPLY_GOODS_ENTITY,
    id: supplyGoodsId,
    fields: fields.join(","),
  });
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
  let fieldCache: CachedSupplyGoodsFields | null = null;
  const fieldCacheTtlMs = options.fieldCacheTtlMs ?? DEFAULT_FIELD_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  return {
    clearFieldCache(): void {
      fieldCache = null;
    },

    async getSupplyGoods(supplyGoodsId: string): Promise<Record<string, unknown>> {
      const fields = await resolveSupplyGoodsSyncFields({
        repository: options.fieldMetadataRepository,
        cache: fieldCache,
        cacheTtlMs: fieldCacheTtlMs,
        now,
        setCache: (nextCache) => {
          fieldCache = nextCache;
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
  };
}

export function createDrizzleSupplyGoodsRecordRepository(db: ServerDatabase): SupplyGoodsRecordRepository {
  return {
    async upsertRecord(input: SupplyGoodsRecordUpsertInput): Promise<void> {
      await db
        .insert(rebuildSupplyGoods)
        .values({
          supplyGoodsId: input.supplyGoodsId,
          payload: input.payload,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: rebuildSupplyGoods.supplyGoodsId,
          set: {
            payload: input.payload,
            updatedAt: input.updatedAt,
          },
        });
      await db
        .insert(tickets)
        .values({
          supplyGoodsId: input.supplyGoodsId,
          approvalState: readApprovalState(input.payload),
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: tickets.supplyGoodsId,
          set: {
            approvalState: readApprovalState(input.payload),
            updatedAt: input.updatedAt,
          },
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
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
}): Promise<SupplyGoodsCallbackResult> {
  const payload = await input.rebuildClient.getSupplyGoods(input.supplyGoodsId);
  const updatedAt = new Date();
  await input.repository.upsertRecord({
    supplyGoodsId: input.supplyGoodsId,
    payload,
    updatedAt,
  });

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
