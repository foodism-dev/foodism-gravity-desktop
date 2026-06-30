import { LifePartnerSession } from "./auth.ts";
import type { LinKeAccountConfig } from "./repository.ts";
import { cleanString, conciseError, isRecord, type JsonRecord } from "./utils.ts";

export interface LinKeFeeRates {
  onlineOperation: number;
  professionalAccount: number;
  growthBooster: number;
  acquisitionCard: number;
  offlineQrScan: number;
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

export const LIN_KE_FEE_RATE_FIELDS: Array<{
  key: keyof LinKeFeeRates;
  label: string;
  max: number;
}> = [
  { key: "onlineOperation", label: "线上经营", max: 80 },
  { key: "professionalAccount", label: "职人账号", max: 20 },
  { key: "growthBooster", label: "增量宝", max: 80 },
  { key: "acquisitionCard", label: "获客卡", max: 80 },
  { key: "offlineQrScan", label: "线下扫码", max: 80 },
];

export const LIN_KE_FEE_SETUP_SAVE_VERSION = "product_commission_save_v1";

const ORDER_LIST_PATH = "/life/partner/v2/order/list/";
const ORDER_DETAIL_PATH = "/life/partner/v2/order/detail/";
const PRODUCT_COMMISSION_LIST_PATH = "/life/partner/v2/commission/product-commission/list/";
const COMMISSION_SAVE_INFO_PATH = "/life/partner/v2/commission/commission-save-info/mget";
const PRODUCT_COMMISSION_SAVE_PATH = "/life/partner/v2/commission/product-commission/save/";
const SUCCESS_FEE_STATUS = "已设置";
const SUCCESS_PRODUCT_STATUS = "销售中";
const NEGATIVE_STATUS_KEYWORDS = ["驳回", "不通过", "失败", "下架", "停售", "删除"];
const FEE_TRAFFIC_SOURCE_BY_FIELD: Record<keyof LinKeFeeRates, string> = {
  onlineOperation: "1",
  professionalAccount: "50",
  growthBooster: "60",
  acquisitionCard: "70",
  offlineQrScan: "100",
};
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
  const entries = LIN_KE_FEE_RATE_FIELDS.map((field) => {
    const direct = value[field.key];
    const legacy = value[field.label];
    const parsed = parseRateValue(direct ?? legacy);
    if (parsed === null || parsed < 0 || parsed > field.max) return null;
    return [field.key, parsed] as const;
  });
  if (entries.some((entry) => entry === null)) return null;
  return Object.fromEntries(entries as Array<readonly [keyof LinKeFeeRates, number]>) as unknown as LinKeFeeRates;
}

export function validateLinKeFeeRates(value: unknown): string {
  if (!isRecord(value)) return "费用比例必须是 JSON 对象";
  for (const field of LIN_KE_FEE_RATE_FIELDS) {
    const parsed = parseRateValue(value[field.key] ?? value[field.label]);
    if (parsed === null) return `请填写${field.label}费用比例`;
    if (parsed < 0) return `${field.label}费用比例不能小于 0`;
    if (parsed > field.max) return `${field.label}费用比例不能超过 ${field.max.toFixed(2)}%`;
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
      const response = await submitFeeSetup(input, context.skuOrderId, context.product);
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
}> {
  const { orderId, skuOrderId, partnerId, product } = await resolveCommissionProduct(input);
  const saveInfoResponse = await postFeeSetupJson(input, "查询商品费用设置范围", COMMISSION_SAVE_INFO_PATH, {
    sku_order_id: skuOrderId,
    product_id_list: [input.linkeGoodsId],
    need_tips_content: true,
  }, {
    ac_app: 10159,
    ...accountQuery(input),
  });
  validateFeeRanges(saveInfoResponse, input.linkeGoodsId, input.rates);

  return { orderId, skuOrderId, partnerId, product, saveInfoResponse };
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

async function submitFeeSetup(input: LinKeFeeSetupInput, skuOrderId: string, product: JsonRecord): Promise<unknown> {
  return postFeeSetupJson(
    input,
    "提交商品费用设置",
    PRODUCT_COMMISSION_SAVE_PATH,
    buildFeeSavePayload(input, skuOrderId, product),
    {
      ac_app: 10159,
      ...accountQuery(input),
    },
  );
}

function buildFeeSavePayload(input: LinKeFeeSetupInput, skuOrderId: string, product: JsonRecord): JsonRecord {
  const waitingAcceptCommissionConfig = Object.fromEntries(
    LIN_KE_FEE_RATE_FIELDS.map((field) => [
      FEE_TRAFFIC_SOURCE_BY_FIELD[field.key],
      {
        commission_ratio: toLinKeRatio(input.rates[field.key]),
        commission_mode: 0,
      },
    ]),
  );
  return {
    sku_order_id: skuOrderId,
    product_item_list: [{
      ...product,
      waiting_accept_commission_ratio: toLinKeRatio(input.rates.onlineOperation),
      waiting_accept_commission_mode: 0,
      waiting_accept_commission_config: waitingAcceptCommissionConfig,
      waiting_accept_stepped_commission_config: [],
    }],
    agreement_scene_list: [],
  };
}

function parseRateValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return roundRate(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? roundRate(parsed) : null;
}

function roundRate(value: number): number {
  return Number(value.toFixed(2));
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

function validateFeeRanges(response: unknown, linkeGoodsId: string, rates: LinKeFeeRates): void {
  const rangeMap = extractTrafficSourceRangeMap(response, linkeGoodsId);
  if (!rangeMap) throw new Error(`林客未返回商品费用比例范围: ${linkeGoodsId}`);

  for (const field of LIN_KE_FEE_RATE_FIELDS) {
    const trafficSource = FEE_TRAFFIC_SOURCE_BY_FIELD[field.key];
    const range = rangeMap[trafficSource];
    if (!isRecord(range)) throw new Error(`林客未返回${field.label}费用比例范围`);
    const min = parseRatioBoundary(range.min_commission_ratio ?? range.lower_boundary, 0);
    const max = parseRatioBoundary(range.max_commission_ratio ?? range.upper_boundary, field.max * 100);
    const value = Number(toLinKeRatio(rates[field.key]));
    if (value < min || value > max) {
      throw new Error(`${field.label}费用比例超出林客范围 ${formatLinKeRatio(min)}% ~ ${formatLinKeRatio(max)}%`);
    }
  }
}

function extractTrafficSourceRangeMap(response: unknown, linkeGoodsId: string): JsonRecord | null {
  if (!isRecord(response) || !isRecord(response.data) || !isRecord(response.data.commission_range_map)) return null;
  const productRange = response.data.commission_range_map[linkeGoodsId];
  if (!isRecord(productRange) || !isRecord(productRange.traffic_source_range_map)) return null;
  return productRange.traffic_source_range_map;
}

function parseRatioBoundary(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
