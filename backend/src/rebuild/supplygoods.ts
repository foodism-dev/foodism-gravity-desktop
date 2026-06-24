import { createHash } from "node:crypto";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../db/client.ts";
import { rebuildSupplyGoodsRecords } from "../db/schema.ts";

export interface SupplyGoodsRecordUpsertInput {
  recordId: string;
  payload: Record<string, unknown>;
  syncedAt: Date;
}

export interface SupplyGoodsRecordRepository {
  upsertRecord: (input: SupplyGoodsRecordUpsertInput) => Promise<void>;
}

export interface RebuildSupplyGoodsClient {
  getSupplyGoods: (recordId: string) => Promise<Record<string, unknown>>;
}

export interface SupplyGoodsCallbackResult {
  recordId: string;
  syncedAt: Date;
}

interface RebuildSignedQueryInput {
  appId: string;
  appSecret: string;
  timestamp?: number;
  params: Record<string, string | number | boolean | null | undefined>;
}

interface RebuildOpenApiResponse<T> {
  error_code: number;
  error_msg: string;
  data?: T;
  error_data?: unknown;
}

const SUPPLY_GOODS_ENTITY = "SupplyGoods";
export const SUPPLY_GOODS_SYNC_FIELDS = [
  "SupplyGoodsId",
  "supplyGoodsId",
  "autoId",
  "acnLevel",
  "goodsId",
  "goodsName",
  "goodsNameInput",
  "hostNameInput",
  "majorType",
  "selfRating",
  "selfRatingNew.text",
  "isTpGoods",
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
  "freeSettleAmount",
  "channelLimit",
  "guideline",
  "packages",
  "reservationRule",
  "reservationRule.text",
  "originPrice",
  "price",
  "supplyPrice",
  "classification",
  "signAmount",
  "excludeHost",
  "saleUntil",
  "reservationDays",
  "rbhost",
  "rbhost.hostId",
  "rbhost.hostName",
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
  "bdAuditor",
  "limitation",
  "singleUserPurchaseLimit",
  "hostTpRightsBind.curTpRightsOrderNo",
  "hostTpRightsBind.tpRightsBindSupplyCompany.tpRightsBindSupplyCompanyId",
  "hostTpRightsBind.tpRightsBindSupplyCompany.skuId",
  "hostTpRightsBind.tpRightsBindSupplyCompany.tpRightsCpsValidPeriod",
  "hostTpRightsBind.tpRightsBindSupplyCompany.payScene",
  "supplyTpChannel.text",
  "supplyTpChannel.seq",
  "goodsFeatures",
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
  "isLimitSexNew.text",
  "isLimitHairNew.text",
  "modifiedOn",
  "createdOn",
  "validUntil",
  "saleBegin",
  "bdCity",
  "bdGroup",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRebuildBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("REBUILD_BASE_URL 不能为空");
  }
  if (trimmed.endsWith("/gw/api")) {
    return `${trimmed}/`;
  }
  return `${trimmed}/gw/api/`;
}

function readRequiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少 REBUILD OpenAPI 配置: ${name}`);
  }
  return value;
}

function stringifyParam(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function buildRebuildSignedQuery(input: RebuildSignedQueryInput): Record<string, string> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.params)) {
    const normalized = stringifyParam(value);
    if (normalized !== null) params[key] = normalized;
  }

  params.appid = input.appId;
  params.timestamp = timestamp;
  params.sign_type = "MD5";

  const signBody = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  params.sign = createHash("md5")
    .update(`${signBody}&${input.appId}.${input.appSecret}`)
    .digest("hex");

  return params;
}

function buildSupplyGoodsGetUrl(recordId: string): URL {
  const params = buildRebuildSignedQuery({
    appId: readRequiredEnv("REBUILD_APP_ID"),
    appSecret: readRequiredEnv("REBUILD_APP_SECRET"),
    params: {
      entity: SUPPLY_GOODS_ENTITY,
      id: recordId,
      fields: SUPPLY_GOODS_SYNC_FIELDS.join(","),
    },
  });

  const url = new URL("entity/get", normalizeRebuildBaseUrl(readRequiredEnv("REBUILD_BASE_URL")));
  for (const [key, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function readJsonResponse<T>(response: Response): Promise<RebuildOpenApiResponse<T>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`REBUILD OpenAPI 请求失败 (${response.status}): ${text || response.statusText}`);
  }

  try {
    return JSON.parse(text) as RebuildOpenApiResponse<T>;
  } catch (error) {
    console.error("[REBUILD] 响应不是合法 JSON:", error);
    throw new Error("REBUILD OpenAPI 返回格式错误");
  }
}

export function extractSupplyGoodsRecordId(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const candidates = [body.record_id, body.recordId, body.primaryId, body.id, body.supplyGoodsId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function createRebuildSupplyGoodsClient(): RebuildSupplyGoodsClient {
  return {
    async getSupplyGoods(recordId: string): Promise<Record<string, unknown>> {
      const url = buildSupplyGoodsGetUrl(recordId);
      console.log(`[REBUILD] 回调同步 SupplyGoods: ${recordId}`);
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
        .insert(rebuildSupplyGoodsRecords)
        .values({
          recordId: input.recordId,
          payload: input.payload,
          syncedAt: input.syncedAt,
          updatedAt: input.syncedAt,
        })
        .onConflictDoUpdate({
          target: rebuildSupplyGoodsRecords.recordId,
          set: {
            payload: input.payload,
            syncedAt: input.syncedAt,
            updatedAt: input.syncedAt,
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
  recordId: string;
  rebuildClient: RebuildSupplyGoodsClient;
  repository: SupplyGoodsRecordRepository;
}): Promise<SupplyGoodsCallbackResult> {
  const payload = await input.rebuildClient.getSupplyGoods(input.recordId);
  const syncedAt = new Date();
  await input.repository.upsertRecord({
    recordId: input.recordId,
    payload,
    syncedAt,
  });

  return {
    recordId: input.recordId,
    syncedAt,
  };
}
