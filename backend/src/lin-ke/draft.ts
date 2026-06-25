import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { LifePartnerSession, BASE_URL } from "./auth.ts";
import {
  cleanString,
  conciseError,
  firstString,
  isRecord,
  normalizeMatchText,
  parseDate,
  parseIntValue,
  parseNumber,
  positiveNumber,
  timestampSeconds,
  toCents,
  type JsonRecord,
} from "./utils.ts";

export const REFERER = "https://www.life-partner.cn/subapp/goods/product-create";
const POI_KEY_PATH = "/proxy/life/tobias/v1/poi/choose/key/get";
const POI_AVAILABLE_PATH = "/proxy/life/tobias/poi/available/detail/page";
const POI_UPDATE_PATH = "/proxy/life/tobias/v1/poi/choose/update";
const MERCHANT_RELATION_SEARCH_PATH = "/proxy/life/account/v2/poi/relation/search";
const OPERATION_MERCHANT_LIST_PATH = "/life/partner/v3/operation/merchant/list/";
export const SAVE_DRAFT_PATH = "/proxy/life/tobias/product/cache/save/";
const IMAGE_UPLOAD_PATH = "/proxy/life/goods/attach/product/picture/update";

export const DEFAULT_PERMISSION_PARAMS =
  '{"SearchAllAccountPoiType":0,"ExpandToPoiAccount":true,'
  + '"SearchAllAccountPoiStatus":0,"RelationTypes":[1,8,10,12],'
  + '"SettleStatusBeforeClaim":[],"PermissionKeyList":["hermes.goods.product_create"],'
  + '"Selections":[]}';
const DEFAULT_PLATFORM_DESCRIPTION = JSON.stringify({
  note_type: 1,
  content: "如部分菜品因时令或其他不可抗因素导致无法提供，请联系商家协商处理，感谢您的理解。",
});
const DEFAULT_PRODUCT_QUALIFICATION = JSON.stringify({
  ProductQualifications: [],
  ProductQualificationCertifications: [],
  ProductQualificationUploadInfos: [],
});
const DEFAULT_CONSUMPTION_THRESHOLD = JSON.stringify({ enable: false, description: "" });
const DEFAULT_EXTRA_CONSUMPTION = JSON.stringify({ enable: false, itemList: [] });
const DEFAULT_FREEBIE_INFO = JSON.stringify({
  enable: false,
  freebieDesc: "",
  validDateDesc: "",
  exchangeRuleDesc: "",
  freebieName: "",
  totalStockNum: "0",
});
const DEFAULT_REFUND_DESCRIPTION = JSON.stringify([
  { note_type: 1, content: "到店核销：随时可退，过期未核销自动退" },
]);
const DEFAULT_BOOST_STRATEGY = JSON.stringify({ ai_recommend_title: "", ai_recommend_title_source: "" });

export class MerchantResolutionError extends Error {
  payload: JsonRecord;

  constructor(payload: JsonRecord) {
    super(cleanString(payload.reason) || "merchant_resolution_failed");
    this.payload = payload;
  }
}

export class DraftWorkflowError extends Error {
  payload: JsonRecord;
  exitCode: number;

  constructor(payload: JsonRecord, exitCode = 1) {
    super(cleanString(payload.reason) || cleanString(payload.error) || "draft_workflow_failed");
    this.payload = payload;
    this.exitCode = exitCode;
  }
}

export interface DraftArgs {
  rootLifeAccountId?: string;
  accountId?: string;
  merchantName?: string;
  categoryId?: string;
  productType?: number;
  settleType?: string;
  poiSetId?: string;
  poiId?: string;
  draftCacheId?: string;
  recPersonNum?: number;
  recPersonNumMax?: number;
  validityDays?: number;
  validityEndDate?: string;
}

export function resolveContext(product: JsonRecord, args: DraftArgs): JsonRecord {
  const category = isRecord(product.category) ? product.category : {};
  const categoryId = cleanString(args.categoryId) || cleanString(category.id) || cleanString(product.categoryId);
  const productType = args.productType || inferProductType(product);
  const [recPersonNum, recPersonNumMax, recPersonSource] = resolveRecPersonRange(product, args);
  return {
    rootLifeAccountId: cleanString(args.rootLifeAccountId),
    accountId: cleanString(args.accountId),
    merchantName: resolveMerchantName(product, args),
    categoryId,
    productType,
    settleType: cleanString(args.settleType) || "1",
    poiSetId: cleanString(args.poiSetId),
    poiId: cleanString(args.poiId),
    poiName: "",
    merchantId: "",
    skuOrderId: "",
    draftCacheId: cleanString(args.draftCacheId)
      || cleanString(product.lkDraftCacheId)
      || cleanString(product.draftCacheId)
      || cleanString(product.cacheId),
    recPersonNum,
    recPersonNumMax,
    recPersonSource,
    validityDays: args.validityDays || 0,
    validityEndDate: cleanString(args.validityEndDate),
  };
}

function resolveMerchantName(product: JsonRecord, args: DraftArgs): string {
  const explicit = cleanString(args.merchantName);
  if (explicit) return explicit;
  const merchant = isRecord(product.merchant) ? product.merchant : {};
  const name = cleanString(merchant.name);
  if (name) return name;
  const hosts = Array.isArray(product.hosts) ? product.hosts : [];
  for (const host of hosts) {
    if (isRecord(host) && cleanString(host.name)) return cleanString(host.name);
  }
  return "";
}

export async function resolveMerchantCandidate(
  session: LifePartnerSession,
  merchantName: string,
  context: JsonRecord,
): Promise<[JsonRecord | null, string, string, JsonRecord[], JsonRecord[]]> {
  const searchErrors: JsonRecord[] = [];
  let operationCandidates: JsonRecord[] = [];
  try {
    operationCandidates = await searchOperationMerchantCandidates(session, merchantName);
  } catch (error) {
    searchErrors.push({ source: "operation_merchant_search", error: conciseError(error) });
  }
  if (operationCandidates.length > 0) {
    const [selected, matchType, reason] = chooseMerchantCandidate(operationCandidates, merchantName);
    return [selected, matchType, reason, operationCandidates, searchErrors];
  }

  let relationCandidates: JsonRecord[] = [];
  try {
    relationCandidates = await searchPoiRelationCandidates(session, merchantName, context);
  } catch (error) {
    searchErrors.push({ source: "poi_relation_search", error: conciseError(error) });
  }
  if (relationCandidates.length > 0) {
    const [selected, matchType, reason] = chooseMerchantCandidate(relationCandidates, merchantName);
    return [selected, matchType, reason, relationCandidates, searchErrors];
  }

  return [null, "", searchErrors.length > 0 ? "search_failed" : "no_candidates", [], searchErrors];
}

async function searchOperationMerchantCandidates(session: LifePartnerSession, merchantName: string): Promise<JsonRecord[]> {
  const response = await session.postJson(OPERATION_MERCHANT_LIST_PATH, {
    filter_param: { merchant_name: merchantName },
    page_index: 1,
    page_size: 10,
  });
  ensureStatusOk(response, "商家概览搜索失败");
  return extractOperationMerchantItems(response)
    .map(normalizeOperationMerchantCandidate)
    .filter((candidate) => cleanString(candidate.name));
}

function extractOperationMerchantItems(response: unknown): unknown[] {
  if (!isRecord(response) || !isRecord(response.data)) return [];
  return Array.isArray(response.data.merchant_list) ? response.data.merchant_list : [];
}

function normalizeOperationMerchantCandidate(item: unknown): JsonRecord {
  if (!isRecord(item)) return {};
  const merchantId = firstString(item, "merchant_id", "root_account_id", "root_life_account_id");
  return {
    source: "operation_merchant",
    name: firstString(item, "merchant_name", "company_name", "account_name", "name"),
    address: firstString(item, "merchant_address", "address", "poi_address"),
    rootLifeAccountId: firstString(item, "root_account_id", "root_life_account_id") || merchantId,
    merchantId,
    skuOrderId: firstString(item, "sku_order_id", "skuOrderId"),
    accountId: firstString(item, "root_key_account_id", "key_account_id", "account_id"),
    poiId: firstString(item, "poi_id", "poiId"),
  };
}

async function searchPoiRelationCandidates(
  session: LifePartnerSession,
  merchantName: string,
  context: JsonRecord,
): Promise<JsonRecord[]> {
  const payload = {
    page_size: 15,
    page_index: 1,
    search_params: {
      relation_types: [1, 1, 5, 8, 10],
      permission_key_list: ["hermes.goods.product_create"],
      poi_name: merchantName,
      poi_aggregate_name: merchantName,
      filter_account_biz: false,
    },
    filter_params: {},
    permission_common_param: { all_selected_params: DEFAULT_PERMISSION_PARAMS },
  };
  const query: JsonRecord = {};
  if (context.rootLifeAccountId) query.root_life_account_id = context.rootLifeAccountId;
  const response = await session.postJson(MERCHANT_RELATION_SEARCH_PATH, payload, query);
  ensureStatusOk(response, "商家搜索失败");
  return extractCandidateItems(response).map(normalizeMerchantCandidate).filter((candidate) => cleanString(candidate.name));
}

function extractCandidateItems(response: unknown): unknown[] {
  if (!isRecord(response)) return [];
  if (Array.isArray(response.data)) return response.data;
  if (!isRecord(response.data)) return [];
  for (const key of ["list", "accounts", "poi_list", "items"]) {
    const value = response.data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeMerchantCandidate(item: unknown): JsonRecord {
  if (!isRecord(item)) return {};
  return {
    source: "poi_relation",
    name: firstString(item, "poi_name", "merchant_name", "account_name", "life_account_name", "name"),
    address: firstString(item, "poi_address", "address"),
    rootLifeAccountId: firstString(item, "root_life_account_id", "confer_root_life_account_id", "parent_life_account_id", "root_account_id"),
    merchantId: firstString(item, "merchant_id", "root_life_account_id", "root_account_id"),
    skuOrderId: firstString(item, "sku_order_id", "skuOrderId"),
    accountId: firstString(item, "account_id", "life_account_id", "poi_life_account_id", "key_account_id"),
    poiId: firstString(item, "poi_id", "poiId"),
  };
}

function chooseMerchantCandidate(candidates: JsonRecord[], merchantName: string): [JsonRecord | null, string, string] {
  if (candidates.length === 0) return [null, "", "no_candidates"];
  const keyword = normalizeMatchText(merchantName);
  const exact = candidates.filter((item) => normalizeMatchText(item.name) === keyword);
  if (exact.length === 1) return [exact[0]!, merchantMatchType(exact[0]!, "exact"), ""];
  if (exact.length > 1) return [null, "", "multiple_candidates"];

  const contains = candidates.filter((item) => isContainedMatch(keyword, normalizeMatchText(item.name)));
  if (contains.length === 1) return [contains[0]!, merchantMatchType(contains[0]!, "contains"), ""];
  if (contains.length > 1 || candidates.length > 1) return [null, "", "multiple_candidates"];
  return [null, "", "no_high_confidence_match"];
}

function merchantMatchType(candidate: JsonRecord, matchType: string): string {
  if (candidate.source === "operation_merchant") return `operation_merchant_${matchType}`;
  if (candidate.source === "poi_relation") return `poi_relation_${matchType}`;
  return matchType;
}

function isContainedMatch(keyword: string, candidate: string): boolean {
  if (!keyword || !candidate) return false;
  if (keyword.length < 4 && candidate.length < 4) return false;
  return keyword.includes(candidate) || candidate.includes(keyword);
}

export function inferProductType(product: JsonRecord): number {
  const value = parseIntValue(product.productType);
  if (value) return value;
  const grouponType = cleanString(product.grouponType).toLowerCase();
  if (["voucher", "11", "c"].includes(grouponType)) return 11;
  if (["multi-use", "multi_use", "15"].includes(grouponType)) return 15;
  return 0;
}

function resolveRecPersonRange(product: JsonRecord, args: DraftArgs): [number, number, string] {
  const explicitMin = parseIntValue(args.recPersonNum);
  const explicitMax = parseIntValue(args.recPersonNumMax);
  if (explicitMin) return [explicitMin, explicitMax || explicitMin, "args"];

  for (const [minKey, maxKey] of [
    ["recPersonNum", "recPersonNumMax"],
    ["recommendedPersonNum", "recommendedPersonNumMax"],
    ["personNum", "personNumMax"],
  ] as const) {
    const value = parseIntValue(product[minKey]);
    const maxValue = parseIntValue(product[maxKey]);
    if (value) return [value, maxValue || value, minKey];
  }

  for (const text of recPersonSourceTexts(product)) {
    const parsed = parseRecPersonText(text);
    if (parsed) return [parsed[0], parsed[1], "text"];
  }
  return [0, 0, ""];
}

function recPersonSourceTexts(product: JsonRecord): string[] {
  const texts = [cleanString(product.title)];
  const groups = Array.isArray(product.itemGroups) ? product.itemGroups : [];
  for (const group of groups) {
    if (isRecord(group)) texts.push(cleanString(group.name));
  }
  return texts.filter(Boolean);
}

export function parseRecPersonText(text: string): [number, number] | null {
  const normalized = cleanString(text);
  if (!normalized) return null;
  const tokenPattern = "\\d+|[一二两三四五六七八九十单双]+";
  const rangeMatch = new RegExp(`(${tokenPattern})\\s*[-~至到]\\s*(${tokenPattern})\\s*人`).exec(normalized);
  if (rangeMatch) {
    const start = parsePersonCountToken(rangeMatch[1] ?? "");
    const end = parsePersonCountToken(rangeMatch[2] ?? "");
    if (start > 0 && end >= start) return [start, end];
  }
  const singleMatch = new RegExp(`(${tokenPattern})\\s*人`).exec(normalized);
  if (singleMatch) {
    const value = parsePersonCountToken(singleMatch[1] ?? "");
    if (value > 0) return [value, value];
  }
  return null;
}

function parsePersonCountToken(token: string): number {
  const text = cleanString(token);
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const direct: Record<string, number> = { 单: 1, 一: 1, 双: 2, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (direct[text]) return direct[text];
  if (!text.includes("十")) return 0;
  const [left = "", right = ""] = text.split("十", 2);
  const digits: Record<string, number> = { ...direct, 十: 10 };
  const tens = left === "" ? 1 : digits[left] || 0;
  const ones = right === "" ? 0 : digits[right] || 0;
  return tens > 0 ? tens * 10 + ones : 0;
}

export function collectRequiredQuestions(product: JsonRecord, context: JsonRecord): JsonRecord[] {
  const questions: JsonRecord[] = [];
  const missingFields = Array.isArray(product.missingFields) ? product.missingFields : [];
  for (const field of missingFields) {
    if (field === "merchant.name" && isRecord(context.merchant) && context.merchant.matchType) continue;
    if (field === "category.id" && context.categoryId) continue;
    if (field === "productType" && context.productType) continue;
    if (field === "category.id") addQuestion(questions, "category.id", "林客商品类目ID", "--category-id", "missing");
    else if (field === "productType") addQuestion(questions, "productType", "林客商品类型", "--product-type", "missing");
    else addQuestion(questions, cleanString(field), cleanString(field), "", "missing");
  }

  const categoryId = cleanString(context.categoryId);
  if (!categoryId) addQuestion(questions, "category.id", "林客商品类目ID", "--category-id", "missing");
  else if (parseIntValue(categoryId) === null) addQuestion(questions, "category.id", "林客商品类目ID", "--category-id", "invalid", categoryId);
  if (!context.productType) addQuestion(questions, "productType", "林客商品类型", "--product-type", "missing");
  if (!context.rootLifeAccountId) addQuestion(questions, "rootLifeAccountId", "林客商家 root_life_account_id", "--root-life-account-id", "missing");
  if (!cleanString(product.title)) addQuestion(questions, "title", "商品名称", "", "missing");
  if (!positiveNumber(product.salePrice)) addQuestion(questions, "salePrice", "顾客实际需支付", "", "missing_or_invalid");
  if (!positiveNumber(product.originPrice)) addQuestion(questions, "originPrice", "划线价", "", "missing_or_invalid");
  if (!Array.isArray(product.images) || product.images.length === 0) addQuestion(questions, "images", "头图", "", "missing");
  if (context.productType !== 11 && (!Array.isArray(product.itemGroups) || product.itemGroups.length === 0)) {
    addQuestion(questions, "itemGroups", "套餐菜品", "", "missing");
  }
  if (!context.recPersonNum || !context.recPersonNumMax) {
    addQuestion(questions, "recPersonNum", "建议用餐人数", "--rec-person-num/--rec-person-num-max", "missing_unparseable");
  } else if (Number(context.recPersonNumMax) < Number(context.recPersonNum)) {
    addQuestion(questions, "recPersonNum", "建议用餐人数", "--rec-person-num/--rec-person-num-max", "invalid_range", `${context.recPersonNum}-${context.recPersonNumMax}`);
  }
  const validityIssue = validateConsumptionValidity(product, context);
  if (validityIssue) {
    addQuestion(questions, "validityPeriod.endDate", "消费有效期", "--validity-days 或 --validity-end-date", cleanString(validityIssue.reason), cleanString(validityIssue.currentValue));
  }
  if (!context.draftCacheId) addQuestion(questions, "draftCacheId", "林客创建页 use_cache_id", "--draft-cache-id", "missing");
  return questions;
}

function addQuestion(questions: JsonRecord[], field: string, label: string, param: string, reason: string, currentValue = ""): void {
  if (questions.some((item) => item.field === field)) return;
  const question: JsonRecord = { field, label, reason };
  if (param) question.param = param;
  if (currentValue) question.currentValue = currentValue;
  questions.push(question);
}

function validateConsumptionValidity(product: JsonRecord, context: JsonRecord): JsonRecord | null {
  const days = parseIntValue(context.validityDays);
  if (days && days > 0) return null;
  if (context.validityDays && days !== null && days <= 0) return { reason: "invalid_days", currentValue: String(context.validityDays) };

  const explicitEnd = cleanString(context.validityEndDate);
  const validity = isRecord(product.validityPeriod) ? product.validityPeriod : {};
  const sourceEnd = explicitEnd || cleanString(validity.endDate);
  if (!sourceEnd) return { reason: "missing" };
  const parsedEnd = parseDate(sourceEnd);
  if (!parsedEnd) return { reason: "invalid_date", currentValue: sourceEnd };
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (parsedEnd < todayDate) return { reason: "expired", currentValue: sourceEnd };
  return null;
}

export async function resolvePoiSelection(session: LifePartnerSession, context: JsonRecord): Promise<JsonRecord> {
  if (context.poiSetId) {
    return {
      poiSetId: cleanString(context.poiSetId),
      poiId: cleanString(context.poiId),
      poiName: cleanString(context.poiName),
      matchType: "provided",
    };
  }
  const poiSetId = await fetchPoiSetId(session, context);
  const candidates = await fetchAvailablePois(session, context);
  const selected = choosePoiCandidate(candidates, context);
  if (!selected) {
    throw new DraftWorkflowError({
      ok: false,
      stage: "poi_selection",
      reason: candidates.length > 0 ? "multiple_pois" : "no_available_pois",
      poiSetId,
      candidates,
    }, 2);
  }
  await updatePoiSelection(session, context, poiSetId, selected);
  return {
    poiSetId,
    poiId: cleanString(selected.poiId),
    poiName: cleanString(selected.name),
    matchType: context.poiId ? "explicit" : "single",
  };
}

async function fetchPoiSetId(session: LifePartnerSession, context: JsonRecord): Promise<string> {
  try {
    const step1 = await session.getJson(POI_KEY_PATH, {
      is_draft: "true",
      settle_type: context.settleType,
      category_id: context.categoryId,
      product_type: context.productType,
      root_life_account_id: context.rootLifeAccountId,
      all_selected_params: DEFAULT_PERMISSION_PARAMS,
    }, true);
    ensureLifePartnerOk(step1, "poi_set_id", "获取poi_set_id失败");
    const poiSetId = isRecord(step1) ? cleanString(step1.poi_set_id) : "";
    if (!poiSetId) {
      throw new DraftWorkflowError({ ok: false, stage: "poi_set_id", reason: "missing_poi_set_id", response: summarizeResponse(step1) });
    }
    return poiSetId;
  } catch (error) {
    if (error instanceof DraftWorkflowError) throw error;
    throw new DraftWorkflowError({ ok: false, stage: "poi_set_id", reason: "request_failed", error: conciseError(error) });
  }
}

async function fetchAvailablePois(session: LifePartnerSession, context: JsonRecord): Promise<JsonRecord[]> {
  try {
    const response = await session.postJson(
      POI_AVAILABLE_PATH,
      {
        category_id: context.categoryId,
        product_type: context.productType,
        settle_type: parseIntValue(context.settleType) || context.settleType,
        page: 1,
        page_size: 50,
        need_phone_opentime_check: true,
        product_sub_type: null,
      },
      { root_life_account_id: context.rootLifeAccountId },
    );
    ensureLifePartnerOk(response, "poi_available_detail", "查询可用门店失败");
    return extractPoiCandidates(response);
  } catch (error) {
    if (error instanceof DraftWorkflowError) throw error;
    throw new DraftWorkflowError({ ok: false, stage: "poi_available_detail", reason: "request_failed", error: conciseError(error) });
  }
}

async function updatePoiSelection(session: LifePartnerSession, context: JsonRecord, poiSetId: string, selected: JsonRecord): Promise<void> {
  try {
    const response = await session.postJson(
      POI_UPDATE_PATH,
      { poi_set_id: poiSetId, in_poi_ids: [selected.poiId] },
      { root_life_account_id: context.rootLifeAccountId },
    );
    ensureLifePartnerOk(response, "poi_choose_update", "同步门店选择失败", { poiSetId, poiId: selected.poiId });
  } catch (error) {
    if (error instanceof DraftWorkflowError) throw error;
    throw new DraftWorkflowError({
      ok: false,
      stage: "poi_choose_update",
      reason: "request_failed",
      poiSetId,
      poiId: selected.poiId,
      error: conciseError(error),
    });
  }
}

function extractPoiCandidates(response: unknown): JsonRecord[] {
  if (!isRecord(response)) return [];
  const rawItems: unknown = Array.isArray(response.poi_list) ? response.poi_list : response.selected_poi_list;
  const items: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  return items.map(normalizePoiCandidate).filter((candidate: JsonRecord) => candidate.poiId && candidate.canSelect !== false);
}

function normalizePoiCandidate(item: unknown): JsonRecord {
  if (!isRecord(item)) return {};
  return {
    poiId: firstString(item, "poi_id", "poiId"),
    name: firstString(item, "poi_name", "name"),
    address: firstString(item, "poi_address", "address"),
    city: firstString(item, "poi_city", "city"),
    canSelect: item.can_select ?? true,
    isSelect: item.is_select ?? false,
  };
}

function choosePoiCandidate(candidates: JsonRecord[], context: JsonRecord): JsonRecord | null {
  const explicitPoiId = cleanString(context.poiId);
  if (explicitPoiId) {
    const selected = candidates.find((candidate) => candidate.poiId === explicitPoiId);
    if (selected) return selected;
    throw new DraftWorkflowError({
      ok: false,
      stage: "poi_selection",
      reason: "poi_id_not_found",
      poiId: explicitPoiId,
      candidates,
    }, 2);
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

export function ensureLifePartnerOk(response: unknown, stage: string, defaultMessage: string, extra: JsonRecord = {}): void {
  if (!isRecord(response)) {
    throw new DraftWorkflowError({ ok: false, stage, reason: "invalid_response", error: defaultMessage, ...extra });
  }
  const status = response.status_code;
  if (status === 0 || status === null || status === undefined) return;
  throw new DraftWorkflowError({
    ok: false,
    stage,
    reason: "life_partner_error",
    status_code: status,
    status_msg: response.status_msg,
    response: summarizeResponse(response),
    ...extra,
  });
}

export async function saveDraft(session: LifePartnerSession, payload: JsonRecord, context: JsonRecord): Promise<unknown> {
  return session.postJson(SAVE_DRAFT_PATH, payload, { root_life_account_id: context.rootLifeAccountId });
}

export async function preparePayloadContext(session: LifePartnerSession, product: JsonRecord, context: JsonRecord): Promise<void> {
  const commodityJson = buildCommodity(normalizeItemGroupsForPayload(product));
  validateCommodityJson(commodityJson);
  context.commodityJson = commodityJson;
  const mainEntries = await uploadImageList(session, product.images, context, "images");
  const detailEntries = await uploadImageList(session, product.detailImages, context, "detailImages");
  context.mainImageJson = buildMainImageJsonFromEntries(mainEntries);
  context.dishesImageJson = buildImageJsonFromEntries(detailEntries);
}

export function buildSavePayload(product: JsonRecord, context: JsonRecord): JsonRecord {
  const productType = parseIntValue(context.productType) || 0;
  const compMap = {
    actualAmount: toCents(product.salePrice),
    appointment: JSON.stringify({ appointment: { needAppointment: false } }),
    "auto_renew-sold_end_time-sold_start_time": buildSaleTime(product.saleTime),
    canNoUseDate: JSON.stringify({ enable: false, daysOfWeek: [], holidays: [], dateList: [] }),
    canTakeGoodsAccountType: JSON.stringify({ label: "允许", value: true }),
    categoryId: context.categoryId,
    cateringVoucherLimitUseRule: JSON.stringify({ type: 1 }),
    codeSourceType: "1",
    commodity: context.commodityJson || buildCommodity(product.itemGroups),
    comsumptionThreshold: DEFAULT_CONSUMPTION_THRESHOLD,
    consumptionConvention: JSON.stringify([{ label: "可堂食", value: 1 }]),
    currencyType: "CNY",
    "customer_reserved_info-real_name_info": JSON.stringify({
      customerReservedInfo: { allow: false },
      realNameInfo: { enable: false },
    }),
    descriptionRichText: productDescriptionText(product),
    dishesImageList: context.dishesImageJson || buildImageJson(product.detailImages),
    "enable_multi_consume_once-enable_multi_user-free_pack-need_register_id_card-once_consumption_limit-private_room-superimposed_discounts": JSON.stringify({
      superimposedDiscounts: false,
      needRegisterIdCard: null,
      enableMultiUser: null,
      enableMultiConsumeOnce: null,
      freePack: null,
      privateRoom: false,
      onceConsumptionLimit: null,
    }),
    environmentImageList: "[]",
    extraConsumption: DEFAULT_EXTRA_CONSUMPTION,
    freebieInfo: DEFAULT_FREEBIE_INFO,
    fulfillmentMethod: "2",
    "image_1v1_list-image_list": context.mainImageJson || buildMainImageJson(product.images),
    isOriginAmountEdited: "false",
    limitBuyRule: buildLimitBuyRule(),
    originAmount: toCents(product.originPrice),
    platformUnifiedDescription: DEFAULT_PLATFORM_DESCRIPTION,
    productName: cleanString(product.title),
    productQualificationUnion: DEFAULT_PRODUCT_QUALIFICATION,
    productType: String(context.productType),
    "rec_person_num-rec_person_num_max": JSON.stringify({ value: context.recPersonNum, maxValue: context.recPersonNumMax }),
    refundDescription: DEFAULT_REFUND_DESCRIPTION,
    settleType: context.settleType,
    showChannel: "1",
    "sold_qty-stock_info": buildStockInfo(product.stockQty),
    testFlag: "false",
    "times_card_bind_product-times_card_type": JSON.stringify({
      timesCardType: productType === 15 ? 1 : 0,
      timesCardBindProduct: {},
    }),
    useDate: buildUseDate(product.validityPeriod, product.saleTime, context),
    useTime: JSON.stringify({ useTimeType: 1 }),
  };

  return {
    product_detail: {
      product: {
        category_id: parseIntValue(context.categoryId),
        product_type: context.productType,
        template_sub_type: 0,
        comp_key_value_map: compMap,
        extra_map: {
          product_draft_cache_id: context.draftCacheId || "",
          poi_set_id: context.poiSetId || "",
          poi_check_result: "",
          boost_strategy: DEFAULT_BOOST_STRATEGY,
        },
      },
    },
    save_product_draft_cache_type: 1,
    product_cache_scene: 1,
    version_info: { Enable: true, VersionName: "1.0.14" },
    permission_common_param: { all_selected_params: DEFAULT_PERMISSION_PARAMS },
  };
}

export function buildCommodity(groups: unknown): string {
  if (!Array.isArray(groups) || groups.length === 0) return "[]";
  const payload: JsonRecord[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    if (!isRecord(group)) continue;
    const items = Array.isArray(group.items) ? group.items : [];
    const normalizedItems: JsonRecord[] = [];
    let totalCount = 0;
    for (const [itemIndex, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const quantity = isRecord(item.quantity) ? item.quantity : {};
      const count = parseNumber(quantity.amount) || 1;
      totalCount += count;
      const unit = cleanString(quantity.unit) || "FEN";
      normalizedItems.push({
        itemId: cleanString(item.id) || `${groupIndex}-${itemIndex}`,
        name: cleanString(item.name),
        price: toCents(item.price || 0),
        unit: unit.toUpperCase(),
        count: String(count),
        "count-unit": JSON.stringify({ count, unit: unit.toUpperCase() }),
      });
    }
    const selectionRule = isRecord(group.selectionRule) ? group.selectionRule : {};
    payload.push({
      group_name: cleanString(group.name),
      total_count: parseIntValue(selectionRule.totalCount) || totalCount || normalizedItems.length,
      option_count: parseIntValue(selectionRule.optionCount) || normalizedItems.length,
      allow_repeated_item: Boolean(group.canRepeat || false),
      hide_spec_name: false,
      item_list: normalizedItems,
    });
  }
  return JSON.stringify(payload);
}

function normalizeItemGroupsForPayload(product: JsonRecord): JsonRecord[] {
  const groups = Array.isArray(product.itemGroups) ? product.itemGroups : [];
  const normalizedGroups: JsonRecord[] = [];
  for (const group of groups) {
    if (!isRecord(group)) continue;
    const copiedGroup: JsonRecord = { ...group, name: normalizeMenuName(cleanString(group.name)) };
    const items = Array.isArray(group.items) ? group.items : [];
    copiedGroup.items = items.filter(isRecord).map((item) => ({ ...item, name: normalizeMenuName(cleanString(item.name)) }));
    normalizedGroups.push(copiedGroup);
  }
  return normalizedGroups;
}

function normalizeMenuName(name: string): string {
  return name ? name.replace(/\s+/g, " ").trim().replaceAll("(", "（").replaceAll(")", "）") : name;
}

function validateCommodityJson(commodityJson: string): void {
  let groups: unknown;
  try {
    groups = JSON.parse(commodityJson) as unknown;
  } catch (error) {
    throw new DraftWorkflowError({ ok: false, stage: "commodity", reason: "invalid_json", error: conciseError(error) }, 2);
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new DraftWorkflowError({ ok: false, stage: "commodity", reason: "empty_groups", error: "菜品搭配不能为空" }, 2);
  }
  for (const [groupIndex, group] of groups.entries()) {
    if (!isRecord(group) || !cleanString(group.group_name)) {
      throw new DraftWorkflowError({ ok: false, stage: "commodity", reason: "empty_group_name", groupIndex, error: "菜品组名不能为空" }, 2);
    }
    const items = group.item_list;
    if (!Array.isArray(items) || items.length === 0) {
      throw new DraftWorkflowError({ ok: false, stage: "commodity", reason: "empty_item_list", groupIndex, groupName: group.group_name, error: "菜品组必须包含菜品" }, 2);
    }
    for (const [itemIndex, item] of items.entries()) {
      if (!isRecord(item) || !cleanString(item.name)) {
        throw new DraftWorkflowError({ ok: false, stage: "commodity", reason: "empty_item_name", groupIndex, itemIndex, groupName: group.group_name, error: "菜品名称不能为空" }, 2);
      }
    }
  }
}

function buildMainImageJson(images: unknown): string {
  return buildMainImageJsonFromEntries(buildImageEntries(images));
}

function buildMainImageJsonFromEntries(entries: JsonRecord[]): string {
  return JSON.stringify({ image_1v1_list: entries.slice(0, 1), image_list: entries.slice(1, 5) });
}

function buildImageJson(images: unknown): string {
  return buildImageJsonFromEntries(buildImageEntries(images));
}

function buildImageJsonFromEntries(entries: JsonRecord[]): string {
  return JSON.stringify(entries);
}

function buildImageEntries(images: unknown): JsonRecord[] {
  if (!Array.isArray(images)) return [];
  const entries: JsonRecord[] = [];
  for (const [index, image] of images.entries()) {
    let url = "";
    let uri = "";
    let name: string | null = null;
    let sortable = "";
    if (typeof image === "string") {
      url = image.trim();
      uri = url;
      sortable = url || String(index);
    } else if (isRecord(image)) {
      url = cleanString(image.url) || cleanString(image.uri);
      uri = cleanString(image.uri) || url;
      name = cleanString(image.name) || null;
      sortable = cleanString(image.sortableOnlyId) || uri || url || String(index);
    } else {
      continue;
    }
    if (!url && !uri) continue;
    entries.push({ url, uri, name, origin_uri: null, origin_url: null, sortableOnlyId: sortable });
  }
  return entries;
}

async function uploadImageList(
  session: LifePartnerSession,
  images: unknown,
  context: JsonRecord,
  fieldName: string,
): Promise<JsonRecord[]> {
  if (!Array.isArray(images)) return [];
  const entries: JsonRecord[] = [];
  for (const [index, image] of images.entries()) {
    const source = imageSource(image, index);
    if (!source) continue;
    if (source.url) {
      entries.push(await uploadImageSource(session, source, context, fieldName, index));
    } else if (source.uri) {
      entries.push({
        url: source.uri,
        uri: source.uri,
        name: source.name,
        origin_uri: null,
        origin_url: null,
        sortableOnlyId: source.sortableOnlyId || source.uri,
      });
    }
  }
  return entries;
}

function imageSource(image: unknown, index: number): JsonRecord | null {
  if (typeof image === "string") {
    const url = image.trim();
    if (!url) return null;
    return { url, uri: "", name: imageFileName(url, index), sortableOnlyId: url || String(index) };
  }
  if (!isRecord(image)) return null;
  let url = cleanString(image.url);
  const uri = cleanString(image.uri);
  if (!url && (uri.startsWith("http://") || uri.startsWith("https://"))) url = uri;
  if (!url && !uri) return null;
  return {
    url,
    uri,
    name: cleanString(image.name) || imageFileName(url || uri, index),
    sortableOnlyId: cleanString(image.sortableOnlyId) || uri || url || String(index),
  };
}

async function uploadImageSource(
  session: LifePartnerSession,
  source: JsonRecord,
  context: JsonRecord,
  fieldName: string,
  index: number,
): Promise<JsonRecord> {
  try {
    const { contentType, content } = await downloadImageContent(session, cleanString(source.url));
    const uploaded = await uploadProductPicture(
      session,
      content,
      cleanString(source.name) || imageFileName(cleanString(source.url), index),
      contentType,
      context,
    );
    const uri = cleanString(uploaded.uri);
    const url = cleanString(uploaded.url);
    if (!uri || !url) {
      throw new DraftWorkflowError({ ok: false, stage: "image_upload", reason: "missing_uploaded_image_url", field: fieldName, index, response: summarizeResponse(uploaded) }, 2);
    }
    return { url, uri, name: source.name || null, origin_uri: null, origin_url: null, sortableOnlyId: uri };
  } catch (error) {
    if (error instanceof DraftWorkflowError) throw error;
    throw new DraftWorkflowError({ ok: false, stage: "image_upload", reason: "request_failed", field: fieldName, index, url: source.url, error: conciseError(error) }, 2);
  }
}

async function downloadImageContent(session: LifePartnerSession, url: string): Promise<{ contentType: string; content: Uint8Array }> {
  const headers = session.commonHeaders();
  headers.Accept = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
  const response = await session.openUrl("GET", url, headers);
  const contentType = (response.headers.get("content-type") || "").split(";")[0] || "";
  if (!contentType.startsWith("image/")) throw new Error(`图片下载返回非图片类型: ${contentType}`);
  if (response.body.length === 0) throw new Error("图片下载结果为空");
  return { contentType, content: response.body };
}

async function uploadProductPicture(
  session: LifePartnerSession,
  content: Uint8Array,
  fileName: string,
  contentType: string,
  context: JsonRecord,
): Promise<JsonRecord> {
  const accountId = cleanString(context.accountId);
  const rootId = cleanString(context.rootLifeAccountId);
  if (!accountId) throw new Error("缺少 accountId，不能上传图片");
  if (!rootId) throw new Error("缺少 rootLifeAccountId，不能上传图片");
  const boundary = `----LinKeImageUpload${randomUUID().replaceAll("-", "")}`;
  const body = multipartBody(boundary, { cutRatio: "1" }, {
    file: { fileName, contentType: contentType || "application/octet-stream", content },
  });
  const headers = {
    ...session.commonHeaders(),
    Accept: "application/json, text/plain, */*",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    Origin: session.baseUrl,
    "x-secsdk-csrf-token": await session.ensureCsrfToken(),
  };
  const response = await session.openUrl(
    "POST",
    session.urlWithQuery(IMAGE_UPLOAD_PATH, { accountId, root_life_account_id: rootId }),
    headers,
    body,
  );
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as unknown;
  ensureLifePartnerOk(parsed, "image_upload", "图片上传失败");
  const result = isRecord(parsed) && Array.isArray(parsed.result) ? parsed.result[0] : {};
  const urlList = isRecord(result) && Array.isArray(result.url_list) ? result.url_list : [];
  return {
    uri: isRecord(result) ? cleanString(result.uri) : "",
    url: cleanString(urlList[0]),
  };
}

function multipartBody(
  boundary: string,
  fields: Record<string, unknown>,
  files: Record<string, { fileName: string; contentType: string; content: Uint8Array }>,
): Uint8Array {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`));
  }
  for (const [name, fileInfo] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${escapeMultipartHeader(fileInfo.fileName || "image")}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${fileInfo.contentType || "application/octet-stream"}\r\n\r\n`));
    chunks.push(Buffer.from(fileInfo.content));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function escapeMultipartHeader(value: string): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function imageFileName(url: string, index: number): string {
  let path = url;
  try {
    path = new URL(url, BASE_URL).pathname;
  } catch {
    path = url.split("?")[0] || "";
  }
  const name = basename(path);
  return name.includes(".") ? name : `image-${index}.jpg`;
}

function buildStockInfo(stock: unknown): string {
  let totalStock = 10_000_000_000;
  if (isRecord(stock)) {
    const parsed = parseIntValue(stock.totalStock);
    if (parsed !== null) totalStock = parsed;
  }
  return JSON.stringify({
    stockQtyLimitType: totalStock >= 10_000_000_000 ? 2 : 1,
    stockNum: totalStock,
    soldQty: 0,
  });
}

function buildSaleTime(saleTime: unknown): string {
  let start = "";
  let end = "";
  if (isRecord(saleTime)) {
    start = timestampSeconds(saleTime.startDate);
    end = timestampSeconds(saleTime.endDate);
  }
  return JSON.stringify({ soldStartTime: start, soldEndTime: end, autoRenew: false });
}

function buildUseDate(validity: unknown, saleTime: unknown, context: JsonRecord): string {
  const validityDays = parseIntValue(context.validityDays);
  if (validityDays && validityDays > 0) return JSON.stringify({ useDateType: 2, dayDuration: validityDays });

  let start = "";
  let end = "";
  const explicitEnd = cleanString(context.validityEndDate);
  if (isRecord(validity)) {
    start = cleanString(validity.startDate);
    end = explicitEnd || cleanString(validity.endDate);
  } else if (explicitEnd) {
    end = explicitEnd;
  }
  if (!start && isRecord(saleTime)) start = cleanString(saleTime.startDate);
  if (!end && isRecord(saleTime)) end = cleanString(saleTime.endDate);
  if (start || end) {
    return JSON.stringify({ useDateType: 1, useStartDate: start || null, useEndDate: end || null });
  }
  return JSON.stringify({ useDateType: 2, dayDuration: 30 });
}

function productDescriptionText(product: JsonRecord): string {
  const direct = cleanString(product.description) || cleanString(product.features);
  if (direct) return direct;
  const notice = isRecord(product.purchaseNotice) ? product.purchaseNotice : {};
  return cleanString(notice.additionalNotes);
}

function buildLimitBuyRule(): string {
  const unlimited = { unit: "份", isLimit: false, totalBuyNum: 0 };
  return JSON.stringify({
    limitRule: unlimited,
    orderLimitRule: null,
    limitRuleByDay: unlimited,
    limitRuleByMonth: unlimited,
  });
}

function ensureStatusOk(response: unknown, defaultMessage: string): void {
  if (!isRecord(response)) throw new Error(defaultMessage);
  const status = response.status_code;
  if (status === null || status === undefined) return;
  if (status !== 0) throw new Error(cleanString(response.status_msg) || defaultMessage);
}

export function summarizeResponse(response: unknown): JsonRecord {
  if (!isRecord(response)) return { type: typeof response };
  return {
    keys: Object.keys(response),
    status_code: response.status_code,
    status_msg: response.status_msg,
  };
}
