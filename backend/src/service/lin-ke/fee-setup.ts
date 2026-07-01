import { LifePartnerSession } from "./auth.ts";
import type { LinKeAccountConfig } from "./repository.ts";
import { cleanString, conciseError, isRecord, type JsonRecord } from "./utils.ts";

export interface LinKeFeeRates {
  values: Record<string, number>;
  singleSettings: Record<string, boolean>;
}

export interface LinKeFeeSetupInput {
  session: LifePartnerSession;
  accountConfig: LinKeAccountConfig;
  merchantId: string;
  linkeGoodsId: string;
  rates: LinKeFeeRates;
}

export interface LinKeFeeSetupResult {
  feeSettingUrl: string;
  rawResponse?: unknown;
}

export interface LinKeProductStatusInput {
  session: LifePartnerSession;
  accountConfig: LinKeAccountConfig;
  merchantId: string;
  linkeGoodsId: string;
}

export interface LinKeProductStatusResult {
  feeStatus: string;
  productStatus: string;
  feeReady: boolean;
  productReady: boolean;
  negative: boolean;
  rawProduct?: JsonRecord;
}

export interface LinKeFeeSetupClient {
  setupFee: (input: LinKeFeeSetupInput) => Promise<LinKeFeeSetupResult>;
  getProductStatus: (input: LinKeProductStatusInput) => Promise<LinKeProductStatusResult>;
}

type LinKeFeeLookupInput = Pick<LinKeFeeSetupInput, "session" | "accountConfig" | "merchantId" | "linkeGoodsId">;

interface LinKeFeeTrafficChild {
  source: string;
  label: string;
  max?: number;
}

interface LinKeFeeTrafficRow {
  group: string;
  source: string;
  label: string;
  closedMax: number;
  singleSettingEnabled: boolean;
  children: LinKeFeeTrafficChild[];
}

interface LinKeActiveFeeTrafficField {
  source: string;
  label: string;
  max: number;
  parentSource: string;
  parentLabel: string;
  isChild: boolean;
}

interface LinKeTrafficTopology {
  availableSources: Set<string>;
  childrenByParent: Map<string, string[]>;
  labelsBySource: Map<string, string>;
}

export const LIN_KE_FEE_TRAFFIC_ROWS: LinKeFeeTrafficRow[] = [
  {
    group: "常规成交",
    source: "1000",
    label: "视频",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "1001", label: "商家视频" },
      { source: "1002", label: "达人视频" },
      { source: "1003", label: "职人视频", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "2000",
    label: "直播",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "2001", label: "商家直播" },
      { source: "2002", label: "达人直播" },
      { source: "2003", label: "职人直播", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "3000",
    label: "线下扫码",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "3001", label: "直接下单" },
      { source: "3002", label: "职人码", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "4000",
    label: "搜索/商城",
    closedMax: 80,
    singleSettingEnabled: false,
    children: [],
  },
  {
    group: "常规成交",
    source: "5000",
    label: "获客卡",
    closedMax: 80,
    singleSettingEnabled: true,
    children: [
      { source: "5001", label: "门店卡/到店卡" },
      { source: "5002", label: "商品卡" },
    ],
  },
  {
    group: "增量宝",
    source: "7000",
    label: "内容成交",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "7001", label: "商家内容" },
      { source: "7002", label: "达人内容" },
      { source: "7003", label: "职人内容", max: 20 },
    ],
  },
  {
    group: "增量宝",
    source: "7100",
    label: "非内容成交",
    closedMax: 80,
    singleSettingEnabled: false,
    children: [],
  },
];

export const LIN_KE_FEE_SETUP_SAVE_VERSION = "product_commission_save_v3";

const ORDER_LIST_PATH = "/life/partner/v2/order/list/";
const ORDER_DETAIL_PATH = "/life/partner/v2/order/detail/";
const PRODUCT_COMMISSION_LIST_PATH = "/life/partner/v2/commission/product-commission/list/";
const COMMISSION_DISPLAY_COMPONENT_PATH = "/life/partner/v2/commission/commission-display-component/mget";
const SAVE_WHITE_LIST_PATH = "/life/partner/v2/commission/save-white-list/get/";
const ORDER_AGREEMENT_CONTENT_QUERY_PATH = "/life/partner/v2/order/agreement/content/query/";
const PRODUCT_COMMISSION_SAVE_PATH = "/life/partner/v2/commission/product-commission/save/";
const SUCCESS_FEE_STATUS = "已设置";
const SUCCESS_PRODUCT_STATUS = "销售中";
const NEGATIVE_STATUS_KEYWORDS = ["驳回", "不通过", "失败", "下架", "停售", "删除"];
const CHILD_OPEN_MAX = 80;
const FEE_STATUS_LABELS: Record<number, string> = {
  1: "未设置",
  2: SUCCESS_FEE_STATUS,
  3: "待商家审批",
  4: "待服务商管理员审核",
  5: "已驳回",
};
const PRODUCT_COMMISSION_STATUS_LABELS: Record<number, string> = {
  0: "未设置",
  1: SUCCESS_FEE_STATUS,
  201: "待商家审批",
};
const PRODUCT_STATUS_LABELS: Record<number, string> = {
  1: SUCCESS_PRODUCT_STATUS,
  2: "已下架",
  10: "待平台审核",
  20: "待商家审核",
  101: "确认中",
  102: "确认失败",
  202: "平台审核失败",
};

export function normalizeLinKeFeeRates(value: unknown): LinKeFeeRates | null {
  if (!isRecord(value)) return null;
  const rawValues = isRecord(value.values) ? value.values : null;
  const rawSingleSettings = isRecord(value.singleSettings) ? value.singleSettings : {};
  if (!rawValues) return null;

  const singleSettings = Object.fromEntries(
    LIN_KE_FEE_TRAFFIC_ROWS
      .filter((row) => row.singleSettingEnabled)
      .map((row) => [row.source, rawSingleSettings[row.source] === true]),
  );
  const normalized: Record<string, number> = {};
  const activeFields = getActiveTrafficFields({ singleSettings });

  for (const field of activeFields) {
    const parsed = parseRateValue(rawValues[field.source]);
    if (!parsed.ok) return null;
    if (parsed.value < 0 || parsed.value > field.max) return null;
    normalized[field.source] = parsed.value;
  }

  return { values: normalized, singleSettings };
}

export function validateLinKeFeeRates(value: unknown): string {
  if (!isRecord(value)) return "费用比例必须是 JSON 对象";
  const rawValues = isRecord(value.values) ? value.values : null;
  if (!rawValues) return "费用比例 values 必须是 JSON 对象";
  const rawSingleSettings = isRecord(value.singleSettings) ? value.singleSettings : {};
  const singleSettings = Object.fromEntries(
    LIN_KE_FEE_TRAFFIC_ROWS
      .filter((row) => row.singleSettingEnabled)
      .map((row) => [row.source, rawSingleSettings[row.source] === true]),
  );
  for (const field of getActiveTrafficFields({ singleSettings })) {
    const parsed = parseRateValue(rawValues[field.source]);
    if (!parsed.ok && parsed.reason === "too_many_decimals") return `${field.label}费用比例最多支持两位小数`;
    if (!parsed.ok) return `请填写${field.label}费用比例`;
    if (parsed.value < 0) return `${field.label}费用比例不能小于 0`;
    if (parsed.value > field.max) return `${field.label}费用比例不能超过 ${field.max.toFixed(2)}%`;
  }
  return "";
}

export function resolveLinKeMerchantId(payload: JsonRecord, sourcePayload: JsonRecord = {}): string {
  return cleanString(readPayloadPath(payload, ["company", "guestId"]))
    || cleanString(readContainerPath(payload, "package", ["company", "guestId"]))
    || cleanString(readPackagesPath(payload, ["company", "guestId"]))
    || cleanString(readPayloadPath(sourcePayload, ["company", "guestId"]))
    || cleanString(readContainerPath(sourcePayload, "package", ["company", "guestId"]))
    || cleanString(readPackagesPath(sourcePayload, ["company", "guestId"]));
}

export function buildFeeSettingUrl(input: {
  baseUrl: string;
  merchantId: string;
  partnerId: string;
  orderId?: string;
  skuOrderId?: string;
}): string {
  if (input.orderId && input.skuOrderId) {
    const query = new URLSearchParams({
      __pid__: input.partnerId,
      from_page: "order_management",
      merchantId: input.merchantId,
      orderId: input.orderId,
      queryScene: "0",
      skuOrderId: input.skuOrderId,
      tabName: "ChargeSetting",
    });
    return `${input.baseUrl.replace(/\/+$/, "")}/vmok/order-detail?${query.toString()}`;
  }
  const query = new URLSearchParams({
    __pid__: input.partnerId,
    menu_key: "product_manager",
    merchantId: input.merchantId,
  });
  return `${input.baseUrl.replace(/\/+$/, "")}/vmok/op-merchant-list/workbench?${query.toString()}`;
}

export function createDefaultLinKeFeeSetupClient(): LinKeFeeSetupClient {
  return {
    async setupFee(input: LinKeFeeSetupInput): Promise<LinKeFeeSetupResult> {
      const context = await prepareFeeSetupContext(input);
      const response = await submitFeeSetup(input, context.skuOrderId, context.product, context.agreementSceneList, context.activeFields);
      return {
        feeSettingUrl: buildFeeSettingUrl({
          baseUrl: input.session.baseUrl,
          merchantId: input.merchantId,
          partnerId: context.partnerId,
          orderId: context.orderId,
          skuOrderId: context.skuOrderId,
        }),
        rawResponse: response,
      };
    },

    async getProductStatus(input: LinKeProductStatusInput): Promise<LinKeProductStatusResult> {
      const { product } = await resolveCommissionProduct(input);
      return {
        ...interpretLinKeProductStatus(product),
        rawProduct: product,
      };
    },
  };
}

export function interpretLinKeProductStatus(product: JsonRecord): Pick<
  LinKeProductStatusResult,
  "feeStatus" | "productStatus" | "feeReady" | "productReady" | "negative"
> {
  const feeStatus = firstStatus(product, [
    "product_commission_status",
    "productCommissionStatus",
  ], PRODUCT_COMMISSION_STATUS_LABELS) || firstStatus(product, [
    "fee_status_text",
    "feeStatusText",
    "commission_status_text",
    "commissionStatusText",
    "commission_status_desc",
    "commissionStatusDesc",
    "rate_status_text",
    "rateStatusText",
    "fee_status",
    "feeStatus",
    "commission_status",
    "commissionStatus",
    "rate_status",
    "rateStatus",
  ], FEE_STATUS_LABELS);
  const productDetail = isRecord(product.product_detail) ? product.product_detail : {};
  const productStatus = firstStatus(productDetail, [
    "product_status_text",
    "productStatusText",
    "product_status_desc",
    "productStatusDesc",
    "status_text",
    "statusText",
    "on_visible_text",
    "onVisibleText",
    "product_status",
    "productStatus",
    "status",
    "on_visible",
    "onVisible",
  ], PRODUCT_STATUS_LABELS) || firstStatus(product, [
    "product_status_text",
    "productStatusText",
    "product_status_desc",
    "productStatusDesc",
    "status_text",
    "statusText",
    "on_visible_text",
    "onVisibleText",
    "product_status",
    "productStatus",
    "status",
    "on_visible",
    "onVisible",
  ], PRODUCT_STATUS_LABELS);
  return {
    feeStatus,
    productStatus,
    feeReady: feeStatus === SUCCESS_FEE_STATUS,
    productReady: productStatus === SUCCESS_PRODUCT_STATUS,
    negative: isNegativeStatus(feeStatus) || isNegativeStatus(productStatus),
  };
}

async function resolveCommissionProduct(input: LinKeFeeLookupInput): Promise<{
  orderId: string;
  skuOrderId: string;
  partnerId: string;
  product: JsonRecord;
}> {
  const order = await findSignedOrder(input);
  const orderId = firstString(order, ["id", "order_id", "orderId"]);
  if (!orderId) throw new Error(`林客商户无签约订单: ${input.merchantId}`);

  const detailResponse = await getFeeSetupJson(input, "查询签约订单详情", ORDER_DETAIL_PATH, {
    ac_app: 10159,
    order_id: orderId,
    ...accountQuery(input),
  });
  const detailOrder = extractOrderDetail(detailResponse) || order;
  const skuOrderId = extractSkuOrderId(detailOrder);
  if (!skuOrderId) throw new Error(`林客签约订单缺少 sku_order_id: ${orderId}`);
  const partnerId = extractPartnerId(detailOrder)
    || extractPartnerId(order)
    || cleanString(input.accountConfig.rootLifeAccountId);

  const product = await findCommissionProduct(input, skuOrderId);
  return { orderId, skuOrderId, partnerId, product };
}

async function prepareFeeSetupContext(input: LinKeFeeSetupInput): Promise<{
  orderId: string;
  skuOrderId: string;
  partnerId: string;
  product: JsonRecord;
  saveInfoResponse: unknown;
  agreementSceneList: unknown[];
  activeFields: LinKeActiveFeeTrafficField[];
}> {
  const { orderId, skuOrderId, partnerId, product } = await resolveCommissionProduct(input);
  const displayComponentResponse = await postFeeSetupJson(input, "查询商品费用设置范围", COMMISSION_DISPLAY_COMPONENT_PATH, {
    sku_order_id: skuOrderId,
    product_id_list: [input.linkeGoodsId],
    need_setting_info: true,
  }, {
    ac_app: 10159,
    ...accountQuery(input),
  });
  const activeFields = resolveActiveTrafficFields(displayComponentResponse, input.linkeGoodsId, input.rates);
  await logSaveWhiteListDiagnostics(input, orderId, activeFields);
  validateFeeRanges(displayComponentResponse, input.linkeGoodsId, input.rates, activeFields);
  const agreementContentResponse = await postFeeSetupJson(input, "查询费用协议内容", ORDER_AGREEMENT_CONTENT_QUERY_PATH, {
    template_type: 2,
    sku_order_id: skuOrderId,
    save_cps_param: { contain_total_amount: false },
    scene: 1,
  }, {
    ac_app: 10159,
    ...accountQuery(input),
  });
  const agreementSceneList = validateAgreementContent(agreementContentResponse);

  return { orderId, skuOrderId, partnerId, product, saveInfoResponse: displayComponentResponse, agreementSceneList, activeFields };
}

async function logSaveWhiteListDiagnostics(
  input: LinKeFeeSetupInput,
  orderId: string,
  activeFields: LinKeActiveFeeTrafficField[],
): Promise<void> {
  const activeSourceKeys = getActiveTrafficSourceKeys(activeFields);
  try {
    const response = await getFeeSetupJson(input, "查询费用流量来源白名单", SAVE_WHITE_LIST_PATH, {
      ac_app: 10159,
      order_id: orderId,
      scene: 2,
      ...accountQuery(input),
    });
    const sources = extractConfigurableTrafficSources(response);
    const sourceCount = sources ? String(sources.size) : "missing";
    console.info(`[Lin-Ke][fee-setup] 费用流量来源白名单 diagnostic activeSources=${activeSourceKeys.join(",")} whitelistCount=${sourceCount}`);
  } catch (error) {
    console.warn(`[Lin-Ke][fee-setup] 费用流量来源白名单 diagnostic skipped activeSources=${activeSourceKeys.join(",")} error=${conciseError(error)}`);
  }
}

async function findSignedOrder(input: LinKeFeeLookupInput): Promise<JsonRecord> {
  const response = await getFeeSetupJson(input, "查询商户签约订单", ORDER_LIST_PATH, {
    ac_app: 10159,
    template_type_list: 2,
    merchant_id: input.merchantId,
    merchant_city_code_list: "",
    ops_agency_type: 0,
    merchant_district_code_list: "",
    region_unit_id_list: "",
    page_index: 1,
    page_size: 10,
    is_asc: false,
    ...accountQuery(input),
  });
  const order = extractOrders(response)
    .find((item) => firstString(item, ["merchant_id", "merchantId"]) === input.merchantId && extractSkuOrderId(item));
  if (!order) throw new Error(`林客商户无签约订单: ${input.merchantId}`);
  return order;
}

async function findCommissionProduct(input: LinKeFeeLookupInput, skuOrderId: string): Promise<JsonRecord> {
  const response = await getFeeSetupJson(input, "查询商品费用列表", PRODUCT_COMMISSION_LIST_PATH, {
    ac_app: 10159,
    sku_order_id: skuOrderId,
    query_scene_list: 0,
    manage_perm_list: "",
    product_id: input.linkeGoodsId,
    page_index: 1,
    page_size: 50,
    ...accountQuery(input),
  });
  const product = extractProducts(response)
    .find((item) => productIdMatches(item, input.linkeGoodsId));
  if (!product) throw new Error(`林客商品不存在: ${input.linkeGoodsId}`);
  return product;
}

async function submitFeeSetup(
  input: LinKeFeeSetupInput,
  skuOrderId: string,
  product: JsonRecord,
  agreementSceneList: unknown[],
  activeFields: LinKeActiveFeeTrafficField[],
): Promise<unknown> {
  const activeSourceKeys = getActiveTrafficSourceKeys(activeFields);
  const switchSummary = formatSingleSettingSummary(input.rates);
  console.info(`[Lin-Ke][fee-setup] 提交商品费用设置 switches=${switchSummary} activeSources=${activeSourceKeys.join(",")}`);
  try {
    return await postFeeSetupJson(
      input,
      "提交商品费用设置",
      PRODUCT_COMMISSION_SAVE_PATH,
      buildFeeSavePayload(input, skuOrderId, product, agreementSceneList, activeFields),
      {
        ac_app: 10159,
        ...accountQuery(input),
      },
    );
  } catch (error) {
    throw new Error(`${conciseError(error)}；平台开关: ${switchSummary}；本次提交来源: ${activeSourceKeys.join("/")}`);
  }
}

function buildFeeSavePayload(
  input: LinKeFeeSetupInput,
  skuOrderId: string,
  product: JsonRecord,
  agreementSceneList: unknown[],
  activeFields: LinKeActiveFeeTrafficField[],
): JsonRecord {
  const waitingAcceptCommissionConfig = Object.fromEntries(
    activeFields.map((field) => [
      field.source,
      {
        commission_ratio: toLinKeRatio(input.rates.values[field.source] ?? 0),
        commission_mode: 0,
      },
    ]),
  );
  return {
    sku_order_id: skuOrderId,
    product_item_list: [{
      ...product,
      commission_ratio: "",
      waiting_accept_commission_ratio: "",
      waiting_accept_commission_mode: 0,
      waiting_accept_commission_config: waitingAcceptCommissionConfig,
    }],
    agreement_scene_list: agreementSceneList,
  };
}

function getActiveTrafficSourceKeys(activeFields: LinKeActiveFeeTrafficField[]): string[] {
  return activeFields.map((field) => field.source);
}

function getActiveTrafficFields(rates: Pick<LinKeFeeRates, "singleSettings">): LinKeActiveFeeTrafficField[] {
  return LIN_KE_FEE_TRAFFIC_ROWS.flatMap((row) => {
    if (row.singleSettingEnabled && rates.singleSettings[row.source] === true) {
      const fields: LinKeActiveFeeTrafficField[] = row.children.map((child) => ({
        source: child.source,
        label: child.label,
        max: getChildOpenMax(child),
        parentSource: row.source,
        parentLabel: row.label,
        isChild: true,
      }));
      return fields;
    }
    const fields: LinKeActiveFeeTrafficField[] = [{
      source: row.source,
      label: row.label,
      max: row.closedMax,
      parentSource: row.source,
      parentLabel: row.label,
      isChild: false,
    }];
    return fields;
  });
}

function getChildOpenMax(child: LinKeFeeTrafficChild): number {
  return child.max ?? CHILD_OPEN_MAX;
}

function resolveActiveTrafficFields(response: unknown, linkeGoodsId: string, rates: LinKeFeeRates): LinKeActiveFeeTrafficField[] {
  const topology = extractTrafficTopology(response);
  const rangeMap = extractTrafficSourceRangeMap(response, linkeGoodsId);

  return getActiveTrafficFields(rates).map((field) => {
    const label = getTrafficSourceLabel(rangeMap, topology, field);
    return { ...field, label };
  });
}

function getTrafficSourceLabel(
  rangeMap: JsonRecord | null,
  topology: LinKeTrafficTopology | null,
  field: LinKeActiveFeeTrafficField,
): string {
  const range = rangeMap?.[field.source];
  if (isRecord(range)) {
    const label = cleanString(range.label);
    if (label) return label;
  }
  return topology?.labelsBySource.get(field.source) || field.label;
}

function formatSingleSettingSummary(rates: Pick<LinKeFeeRates, "singleSettings">): string {
  return LIN_KE_FEE_TRAFFIC_ROWS
    .filter((row) => row.singleSettingEnabled)
    .map((row) => `${row.label}=${rates.singleSettings[row.source] === true ? "开" : "关"}`)
    .join(", ");
}

function parseRateValue(value: unknown): { ok: true; value: number } | { ok: false; reason: "invalid" | "too_many_decimals" } {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, reason: "invalid" };
    return hasAtMostTwoDecimals(String(value)) ? { ok: true, value } : { ok: false, reason: "too_many_decimals" };
  }
  if (typeof value !== "string") return { ok: false, reason: "invalid" };
  const trimmed = value.replace("%", "").trim();
  if (!trimmed) return { ok: false, reason: "invalid" };
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return { ok: false, reason: "invalid" };
  if (!hasAtMostTwoDecimals(trimmed)) return { ok: false, reason: "too_many_decimals" };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, reason: "invalid" };
}

function hasAtMostTwoDecimals(value: string): boolean {
  const decimal = value.split(".")[1];
  return !decimal || decimal.length <= 2;
}

function toLinKeRatio(value: number): string {
  return String(Math.round(value * 100));
}

async function getFeeSetupJson(
  input: LinKeFeeLookupInput,
  stage: string,
  path: string,
  query: JsonRecord,
): Promise<unknown> {
  return logFeeSetupCall(input, stage, path, async () => {
    const response = await input.session.getJson(path, query);
    ensureLinKeOk(response, `${stage}失败`);
    return response;
  });
}

async function postFeeSetupJson(
  input: LinKeFeeLookupInput,
  stage: string,
  path: string,
  payload: JsonRecord,
  query: JsonRecord,
): Promise<unknown> {
  return logFeeSetupCall(input, stage, path, async () => {
    const response = await input.session.postJson(path, payload, query);
    ensureLinKeOk(response, `${stage}失败`);
    return response;
  });
}

async function logFeeSetupCall<T>(
  input: Pick<LinKeFeeSetupInput, "merchantId" | "linkeGoodsId">,
  stage: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  console.info(`[Lin-Ke][fee-setup] ${stage} start endpoint=${path} merchantId=${input.merchantId} linkeGoodsId=${input.linkeGoodsId}`);
  try {
    const result = await action();
    console.info(`[Lin-Ke][fee-setup] ${stage} ok endpoint=${path} durationMs=${Date.now() - startedAt} ${responseStatusSummary(result)}`);
    return result;
  } catch (error) {
    console.warn(`[Lin-Ke][fee-setup] ${stage} failed endpoint=${path} durationMs=${Date.now() - startedAt} error=${conciseError(error)}`);
    throw error;
  }
}

function responseStatusSummary(response: unknown): string {
  if (!isRecord(response)) return "";
  const code = response.status_code ?? response.statusCode ?? response.code ?? response.err_no ?? response.errno;
  const message = cleanString(response.status_msg) || cleanString(response.message) || cleanString(response.msg);
  return `status=${cleanString(code)} message=${message || "-"}`;
}

function accountQuery(input: Pick<LinKeFeeSetupInput, "accountConfig">): JsonRecord {
  const accountId = cleanString(input.accountConfig.accountId);
  return accountId ? { accountId } : {};
}

function ensureLinKeOk(response: unknown, message: string): void {
  if (!isRecord(response)) return;
  const statusCode = response.status_code ?? response.statusCode ?? response.code ?? response.err_no ?? response.errno;
  if (statusCode === undefined || statusCode === 0 || statusCode === "0") return;
  const statusMessage = cleanString(response.status_msg)
    || cleanString(response.message)
    || cleanString(response.msg)
    || conciseError(response);
  throw new Error(`${message}: ${statusMessage}`);
}

function extractProducts(response: unknown): JsonRecord[] {
  const roots = [response, isRecord(response) ? response.data : null].filter(isRecord);
  for (const root of roots) {
    for (const key of ["product_item_list", "product_list", "products", "list", "items"]) {
      const value = root[key];
      if (Array.isArray(value)) return value.filter(isRecord);
    }
  }
  return [];
}

function productIdMatches(product: JsonRecord, linkeGoodsId: string): boolean {
  if (firstString(product, ["product_id", "productId", "goods_id", "goodsId", "id"]) === linkeGoodsId) return true;
  const detail = product.product_detail;
  return isRecord(detail) && firstString(detail, ["product_id", "productId", "goods_id", "goodsId", "id"]) === linkeGoodsId;
}

function extractOrders(response: unknown): JsonRecord[] {
  if (!isRecord(response) || !isRecord(response.data)) return [];
  const list = response.data.order_list;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function extractOrderDetail(response: unknown): JsonRecord | null {
  if (!isRecord(response) || !isRecord(response.data) || !isRecord(response.data.order)) return null;
  return response.data.order;
}

function extractSkuOrderId(order: JsonRecord): string {
  const direct = firstString(order, ["sku_order_id", "skuOrderId"]);
  if (direct) return direct;
  const skuOrders = order.sku_order_list;
  if (!Array.isArray(skuOrders)) return "";
  const records = skuOrders.filter(isRecord);
  const selected = records.find((item) => cleanString(item.template_type) === "2" || cleanString(item.service_type) === "2")
    || records[0];
  return selected ? firstString(selected, ["id", "sku_order_id", "skuOrderId"]) : "";
}

function extractPartnerId(order: JsonRecord): string {
  const direct = firstString(order, ["partner_id", "partnerId", "root_life_account_id", "rootLifeAccountId"]);
  if (direct) return direct;
  const skuOrders = order.sku_order_list;
  if (!Array.isArray(skuOrders)) return "";
  for (const item of skuOrders) {
    if (!isRecord(item)) continue;
    const partnerId = firstString(item, ["partner_id", "partnerId", "root_life_account_id", "rootLifeAccountId"]);
    if (partnerId) return partnerId;
  }
  return "";
}

function validateFeeRanges(
  response: unknown,
  linkeGoodsId: string,
  rates: LinKeFeeRates,
  activeFields: LinKeActiveFeeTrafficField[],
): void {
  const rangeMap = extractTrafficSourceRangeMap(response, linkeGoodsId);
  if (!rangeMap) throw new Error(`林客未返回商品费用比例范围: ${linkeGoodsId}`);

  for (const field of activeFields) {
    const parsed = parseRateValue(rates.values[field.source]);
    if (!parsed.ok && parsed.reason === "too_many_decimals") throw new Error(`${field.label}费用比例最多支持两位小数`);
    if (!parsed.ok) throw new Error(`请填写${field.label}费用比例`);
    const range = getTrafficSourceRange(rangeMap, field);
    const value = Number(toLinKeRatio(parsed.value));
    if (value < range.min || value > range.max) {
      const rangeLabel = range.source === "linke" ? "林客范围" : "允许范围";
      throw new Error(`${field.label}费用比例超出${rangeLabel} ${formatLinKeRatio(range.min)}% ~ ${formatLinKeRatio(range.max)}%`);
    }
  }
}

function extractConfigurableTrafficSources(response: unknown): Set<string> | null {
  const roots = [response, isRecord(response) ? response.data : null].filter(isRecord);
  for (const root of roots) {
    const rawSources = root.configurable_commission_traffic_source ?? root.configurableCommissionTrafficSource;
    if (!Array.isArray(rawSources)) continue;
    return new Set(rawSources.map((source) => cleanString(source)).filter(Boolean));
  }
  return null;
}

function validateAgreementContent(response: unknown): unknown[] {
  const agreementContentList = extractAgreementContentList(response);
  if (agreementContentList.length > 0) {
    throw new Error("林客返回待确认费用协议，请进入林客核对协议内容后重试");
  }
  return [];
}

function extractAgreementContentList(response: unknown): unknown[] {
  const roots = [response, isRecord(response) ? response.data : null].filter(isRecord);
  for (const root of roots) {
    const contentList = root.agreement_content_list ?? root.agreementContentList;
    if (Array.isArray(contentList)) return contentList;
  }
  return [];
}

function extractTrafficTopology(response: unknown): LinKeTrafficTopology | null {
  if (!isRecord(response) || !isRecord(response.data)) return null;
  const rawTree = response.data.commission_traffic_display_tree_list ?? response.data.commissionTrafficDisplayTreeList;
  if (!Array.isArray(rawTree)) return null;

  const availableSources = new Set<string>();
  const childrenByParent = new Map<string, string[]>();
  const labelsBySource = extractTrafficSourceLabels(response);

  const visit = (node: unknown): void => {
    if (!isRecord(node)) return;
    const source = cleanString(node.traffic_source ?? node.trafficSource);
    const children = Array.isArray(node.child_tree_list)
      ? node.child_tree_list
      : Array.isArray(node.childTreeList)
        ? node.childTreeList
        : [];
    if (source) {
      availableSources.add(source);
      const childSources = children
        .filter(isRecord)
        .map((child) => cleanString(child.traffic_source ?? child.trafficSource))
        .filter(Boolean);
      if (childSources.length > 0) childrenByParent.set(source, childSources);
    }
    for (const child of children) visit(child);
  };

  for (const node of rawTree) visit(node);
  return { availableSources, childrenByParent, labelsBySource };
}

function extractTrafficSourceLabels(response: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!isRecord(response) || !isRecord(response.data)) return labels;
  const roots = [response.data];
  const settingInfoMap = response.data.commission_setting_info_map;
  if (isRecord(settingInfoMap)) {
    for (const setting of Object.values(settingInfoMap)) {
      if (isRecord(setting)) roots.push(setting);
    }
  }

  for (const root of roots) {
    const rangeMap = isRecord(root.traffic_source_range_map)
      ? root.traffic_source_range_map
      : isRecord(root.commission_traffic_source_desc_map)
        ? root.commission_traffic_source_desc_map
        : null;
    if (rangeMap) {
      for (const [source, value] of Object.entries(rangeMap)) {
        if (!isRecord(value)) continue;
        const label = cleanString(value.label);
        if (label) labels.set(source, label);
      }
    }
    const descList = root.commission_traffic_source_desc_list ?? root.commissionTrafficSourceDescList;
    if (Array.isArray(descList)) {
      for (const item of descList) {
        if (!isRecord(item)) continue;
        const source = cleanString(item.traffic_source ?? item.trafficSource);
        const label = cleanString(item.label);
        if (source && label) labels.set(source, label);
      }
    }
  }

  return labels;
}

function getTrafficSourceRange(
  rangeMap: JsonRecord,
  field: LinKeActiveFeeTrafficField,
): { min: number; max: number; source: "linke" | "local" } {
  const range = rangeMap[field.source];
  const localMax = field.max * 100;
  if (isRecord(range)) {
    const min = parseBoundary(range.lower_boundary ?? range.lowerBoundary ?? range.min ?? range.minimum);
    const max = parseBoundary(range.upper_boundary ?? range.upperBoundary ?? range.max ?? range.maximum);
    if (max !== null) {
      return {
        min: min ?? 0,
        max: Math.min(max, localMax),
        source: max <= localMax ? "linke" : "local",
      };
    }
  }
  return { min: 0, max: localMax, source: "local" };
}

function parseBoundary(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractTrafficSourceRangeMap(response: unknown, linkeGoodsId: string): JsonRecord | null {
  if (!isRecord(response) || !isRecord(response.data)) return null;
  const settingInfoMap = response.data.commission_setting_info_map;
  if (isRecord(settingInfoMap)) {
    const settingInfo = settingInfoMap[linkeGoodsId];
    if (isRecord(settingInfo) && isRecord(settingInfo.traffic_source_range_map)) {
      return settingInfo.traffic_source_range_map;
    }
  }
  const legacyRangeMap = response.data.commission_range_map;
  if (isRecord(legacyRangeMap)) {
    const productRange = legacyRangeMap[linkeGoodsId];
    if (isRecord(productRange) && isRecord(productRange.traffic_source_range_map)) {
      return productRange.traffic_source_range_map;
    }
  }
  return null;
}

function formatLinKeRatio(value: number): string {
  return (value / 100).toFixed(2);
}

function firstString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstStatus(payload: JsonRecord, keys: string[], labels: Record<number, string>): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      const numeric = Number(text);
      if (Number.isInteger(numeric) && labels[numeric]) return labels[numeric];
      return text;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return labels[value] || String(value);
    }
  }
  return "";
}

function isNegativeStatus(value: string): boolean {
  return NEGATIVE_STATUS_KEYWORDS.some((keyword) => value.includes(keyword));
}

function readPayloadPath(payload: JsonRecord, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, payload);
}

function readPackagesPath(payload: JsonRecord, path: string[]): unknown {
  return readContainerPath(payload, "packages", path);
}

function readContainerPath(payload: JsonRecord, containerKey: string, path: string[]): unknown {
  const packages = payload[containerKey];
  const parsed = typeof packages === "string" ? parsePackages(packages) : packages;
  return isRecord(parsed) ? readPayloadPath(parsed, path) : undefined;
}

function parsePackages(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
