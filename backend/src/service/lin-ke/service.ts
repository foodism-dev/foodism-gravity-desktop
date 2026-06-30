import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { BACKEND_DIR, type LinKeSettings } from "./config.ts";
import { LifePartnerSession, loadCookieFile } from "./auth.ts";
import { ProductMappingError, resolveLinKeMapping } from "./mapping.ts";
import { bdCityText, normalizeSupplyGoodsForLinKe } from "./supply-goods.ts";
import {
  collectRequiredQuestions,
  DEFAULT_PERMISSION_PARAMS,
  DraftWorkflowError,
  ensureLifePartnerOk,
  MerchantResolutionError,
  preparePayloadContext,
  REFERER,
  resolveContext,
  resolveMerchantCandidate,
  resolvePoiSelection,
  saveDraft,
  SAVE_DRAFT_PATH,
  buildSavePayload,
  summarizeResponse,
} from "./draft.ts";
import type { LinKeAccountConfig, LinKeRepository } from "./repository.ts";
import { cleanString, conciseError, deepClone, isRecord, parseIntValue, type JsonRecord } from "./utils.ts";

export class LinKeServiceError extends Error {
  payload: JsonRecord;
  statusCode: number;

  constructor(payload: JsonRecord, statusCode = 400) {
    super(cleanString(payload.reason) || cleanString(payload.error) || "lin_ke_service_error");
    this.payload = payload;
    this.statusCode = statusCode;
  }
}

const OPTION_ENTITY_NAME = "SupplyGoods";
const LIN_KE_MAPPING_OPTION_FIELDS = ["mealType", "classification"] as const;

function optionLookupValue(payload: JsonRecord, fieldName: string): string {
  const value = payload[fieldName];
  if (isRecord(value)) {
    return cleanString(value.text) || cleanString(value.value) || cleanString(value.id);
  }
  return cleanString(payload[`${fieldName}.text`]) || cleanString(value);
}

async function payloadWithFieldOptionLabels(repository: LinKeRepository, payload: JsonRecord): Promise<JsonRecord> {
  const fieldValues = Object.fromEntries(
    LIN_KE_MAPPING_OPTION_FIELDS
      .map((fieldName) => [fieldName, optionLookupValue(payload, fieldName)] as const)
      .filter(([, value]) => Boolean(value)),
  );
  const labels = await repository.fetchRebuildFieldOptionLabels(OPTION_ENTITY_NAME, fieldValues);
  if (Object.keys(labels).length === 0) return payload;

  const resolved = deepClone(payload);
  for (const [fieldName, label] of Object.entries(labels)) {
    const value = resolved[fieldName];
    if (isRecord(value)) {
      value.text = label;
    } else if (fieldName in resolved) {
      resolved[fieldName] = { text: label, value: fieldValues[fieldName] || "" };
    } else {
      resolved[`${fieldName}.text`] = label;
    }
  }
  return resolved;
}

function makeDraftArgs(settings: LinKeSettings, linKeMapping: JsonRecord, poiId = "") {
  return {
    rootLifeAccountId: "",
    accountId: "",
    merchantName: "",
    categoryId: cleanString(linKeMapping.categoryId),
    productType: parseIntValue(linKeMapping.productType) || 0,
    settleType: "1",
    poiSetId: "",
    poiId,
    draftCacheId: "",
    recPersonNum: 0,
    recPersonNumMax: 0,
    validityDays: 0,
    validityEndDate: "",
    baseUrl: settings.lifePartnerBaseUrl,
    referer: REFERER,
    timeout: settings.lifePartnerTimeout,
  };
}

export function resolveCookieFilePath(cookieFilePath: string): string {
  const path = cleanString(cookieFilePath).replace(/^~/, Bun.env.HOME || "~");
  if (isAbsolute(path)) return path;
  return resolve(BACKEND_DIR, path);
}

function makeSession(settings: LinKeSettings, accountConfig: LinKeAccountConfig): LifePartnerSession {
  const cookiePath = resolveCookieFilePath(accountConfig.cookieFilePath);
  if (!existsSync(cookiePath)) {
    throw new LinKeServiceError(
      { ok: false, stage: "cookie", reason: "cookie_file_not_found", cookieFilePath: cookiePath },
      400,
    );
  }
  const cookie = loadCookieFile(cookiePath);
  if (!cookie) {
    throw new LinKeServiceError(
      { ok: false, stage: "cookie", reason: "empty_cookie", cookieFilePath: cookiePath },
      400,
    );
  }
  return new LifePartnerSession({
    cookie,
    timeout: settings.lifePartnerTimeout,
    baseUrl: settings.lifePartnerBaseUrl,
    referer: REFERER,
  });
}

export async function checkCookie(settings: LinKeSettings, accountConfig: LinKeAccountConfig): Promise<JsonRecord> {
  const session = makeSession(settings, accountConfig);
  try {
    await session.ensureCsrfToken();
  } catch (error) {
    return { ok: false, cookieValid: false, error: conciseError(error) };
  }
  return { ok: true, cookieValid: true, check: "secsdk_csrf_token" };
}

export async function saveSupplyGoodsDraft(input: {
  settings: LinKeSettings;
  repository: LinKeRepository;
  payload: JsonRecord;
  accountConfig: LinKeAccountConfig;
  supplyGoodsId: string;
  poiId?: string | null;
}): Promise<JsonRecord> {
  const mappingPayload = await payloadWithFieldOptionLabels(input.repository, input.payload);
  let linKeMapping: JsonRecord;
  try {
    linKeMapping = resolveLinKeMapping(mappingPayload);
  } catch (error) {
    if (error instanceof ProductMappingError) {
      throw new LinKeServiceError(error.payload, 400);
    }
    throw error;
  }

  const mappingSupplyGoodsId = cleanString(input.supplyGoodsId);
  if (mappingSupplyGoodsId) {
    await input.repository.updateSupplyGoodsLinKeMapping(mappingSupplyGoodsId, linKeMapping);
  }

  const session = makeSession(input.settings, input.accountConfig);
  try {
    await session.ensureCsrfToken();
  } catch (error) {
    throw new LinKeServiceError(
      { ok: false, stage: "cookie", reason: "csrf_failed", error: conciseError(error) },
      400,
    );
  }

  const product = normalizeSupplyGoodsForLinKe(input.payload, linKeMapping, input.settings.rbImageBaseUrl);
  const args = makeDraftArgs(input.settings, linKeMapping, cleanString(input.poiId));
  const context = resolveContext(product, args);
  context.rootLifeAccountId = input.accountConfig.rootLifeAccountId || context.rootLifeAccountId;
  context.accountId = input.accountConfig.accountId || context.accountId;
  context.thirdCategoryId = linKeMapping.thirdCategoryId || context.categoryId;

  let result: unknown;
  try {
    await resolveMerchantContext(session, product, context);
    if (!context.draftCacheId) {
      context.draftCacheId = await createInitialDraftCache(session, context);
    }
    const questions = collectRequiredQuestions(product, context);
    if (questions.length > 0) {
      throw new LinKeServiceError({
        ok: false,
        stage: "required_input",
        reason: "missing_required_fields",
        questions,
        missingFields: product.missingFields,
      }, 400);
    }
    const poiSelection = await resolvePoiSelection(session, context);
    context.poiSetId = poiSelection.poiSetId || context.poiSetId || "";
    context.poiId = poiSelection.poiId || context.poiId || "";
    context.poiName = poiSelection.poiName || context.poiName || "";
    await preparePayloadContext(session, product, context);
    const savePayload = buildSavePayload(product, context);
    const productDetail = savePayload.product_detail;
    if (isRecord(productDetail) && isRecord(productDetail.product) && isRecord(productDetail.product.extra_map)) {
      productDetail.product.extra_map.poi_set_id = context.poiSetId || "";
    }
    result = await saveDraft(session, savePayload, context);
    ensureLifePartnerOk(result, "save_draft", "保存草稿失败");
  } catch (error) {
    if (error instanceof LinKeServiceError) throw error;
    if (error instanceof DraftWorkflowError || error instanceof MerchantResolutionError) {
      throw new LinKeServiceError(error.payload, 400);
    }
    throw new LinKeServiceError(
      { ok: false, stage: "lin_ke_request", reason: "request_failed", error: conciseError(error) },
      502,
    );
  }

  const cacheId = isRecord(result) ? cleanString(result.cache_id) : "";
  if (!cacheId) {
    throw new LinKeServiceError(
      { ok: false, stage: "save_draft", reason: "missing_cache_id", response: summarizeResponse(result) },
      502,
    );
  }

  return {
    ok: true,
    bdCityText: bdCityText(input.payload),
    cacheId,
    draftUrl: buildWorkbenchDraftUrl(input.accountConfig, context, cacheId),
    productType: linKeMapping.productType,
    categoryId: linKeMapping.categoryId,
    thirdCategoryId: linKeMapping.thirdCategoryId,
    categoryPath: linKeMapping.categoryPath,
    merchant: context.merchant || {},
    poiSetId: context.poiSetId || "",
    poiId: context.poiId || "",
    poiName: context.poiName || "",
    accountConfig: {
      id: input.accountConfig.id,
      name: input.accountConfig.name,
      bdCityTexts: input.accountConfig.bdCityTexts,
    },
    statusMsg: isRecord(result) ? result.status_msg || "" : "",
  };
}

async function resolveMerchantContext(
  session: LifePartnerSession,
  product: JsonRecord,
  context: JsonRecord,
): Promise<JsonRecord> {
  const merchantName = cleanString(context.merchantName);
  if (!merchantName) {
    throw new MerchantResolutionError({
      ok: false,
      stage: "merchant_resolution",
      merchantName: "",
      reason: "missing_merchant_name",
      candidates: [],
    });
  }
  const [selected, matchType, reason, candidates, searchErrors] = await resolveMerchantCandidate(session, merchantName, context);
  if (!selected) {
    const payload: JsonRecord = {
      ok: false,
      stage: "merchant_resolution",
      merchantName,
      reason,
      candidates,
    };
    if (searchErrors.length > 0) payload.searchErrors = searchErrors;
    throw new MerchantResolutionError(payload);
  }
  const rootId = cleanString(context.rootLifeAccountId) || cleanString(selected.rootLifeAccountId);
  const accountId = cleanString(context.accountId) || cleanString(selected.accountId);
  if (!rootId) {
    throw new MerchantResolutionError({
      ok: false,
      stage: "merchant_resolution",
      merchantName,
      reason: "missing_root_life_account_id",
      candidates,
    });
  }
  context.rootLifeAccountId = rootId;
  context.accountId = accountId;
  context.poiId = context.poiId || selected.poiId || "";
  context.poiName = context.poiName || selected.name || "";
  context.merchantId = selected.merchantId || "";
  context.skuOrderId = selected.skuOrderId || "";
  context.merchant = {
    name: selected.name || merchantName,
    rootLifeAccountId: rootId,
    accountId,
    merchantId: context.merchantId || "",
    skuOrderId: context.skuOrderId || "",
    poiId: context.poiId || "",
    address: selected.address || "",
    matchType,
  };
  return product;
}

async function createInitialDraftCache(session: LifePartnerSession, context: JsonRecord): Promise<string> {
  const payload = {
    product_detail: {
      product: {
        category_id: parseIntValue(context.categoryId),
        product_type: context.productType,
        template_sub_type: 0,
        comp_key_value_map: {},
        extra_map: {},
      },
    },
    save_product_draft_cache_type: 4,
    product_cache_scene: 1,
    version_info: { Enable: true, VersionName: "1.0.14" },
    permission_common_param: { all_selected_params: DEFAULT_PERMISSION_PARAMS },
  };
  const result = await session.postJson(
    SAVE_DRAFT_PATH,
    payload,
    { root_life_account_id: context.rootLifeAccountId },
  );
  ensureLifePartnerOk(result, "create_draft_cache", "创建草稿缓存失败");
  const cacheId = isRecord(result) ? cleanString(result.cache_id) : "";
  if (!cacheId) {
    throw new LinKeServiceError(
      { ok: false, stage: "create_draft_cache", reason: "missing_cache_id", response: summarizeResponse(result) },
      502,
    );
  }
  return cacheId;
}

export function buildWorkbenchDraftUrl(
  accountConfig: Pick<LinKeAccountConfig, "groupId"> | JsonRecord,
  context: JsonRecord,
  cacheId: string,
): string {
  const merchant = isRecord(context.merchant) ? context.merchant : {};
  const query = new URLSearchParams({
    enter_from: "spu_list_page",
    enter_method: "goods_list",
    filter_status: "7",
    goods_list_grey_tag: "mig",
    groupid: cleanString("groupId" in accountConfig ? accountConfig.groupId : accountConfig.group_id)
      || cleanString(context.accountId)
      || cleanString(context.rootLifeAccountId),
    industry: "tobias",
    isDraft: "1",
    isModifyMode: "1",
    is_internal_route: "1",
    menu_key: "product_manager",
    merchantId: cleanString(merchant.merchantId) || cleanString(context.merchantId),
    merchant_page_tab: "WORKBENCH",
    modifyFrom: "list",
    product_draft_cache_id: cacheId,
    product_id: "",
    product_type: cleanString(context.productType),
    sku_order_id: cleanString(merchant.skuOrderId) || cleanString(context.skuOrderId),
    third_category_id: cleanString(context.thirdCategoryId) || cleanString(context.categoryId),
    from_page: "merchant_operation_detail_workbench",
  });
  return `https://www.life-partner.cn/op-merchant/workbench/subapp/goods-list/form-type?${query.toString()}`;
}
