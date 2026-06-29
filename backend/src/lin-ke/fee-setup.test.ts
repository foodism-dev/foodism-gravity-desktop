import { describe, expect, test } from "bun:test";

import {
  createDefaultLinKeFeeSetupClient,
  interpretLinKeProductStatus,
  normalizeLinKeFeeRates,
  resolveLinKeMerchantId,
  validateLinKeFeeRates,
} from "./fee-setup.ts";
import type { LifePartnerSession } from "./auth.ts";
import type { LinKeAccountConfig } from "./repository.ts";

describe("Lin-Ke fee setup helpers", () => {
  test("Given company guest id in packages, When resolving merchant id, Then package company is supported", () => {
    expect(resolveLinKeMerchantId({
      packages: {
        company: {
          guestId: "merchant-001",
        },
      },
    })).toBe("merchant-001");

    expect(resolveLinKeMerchantId({
      package: JSON.stringify({
        company: {
          guestId: "merchant-002",
        },
      }),
    })).toBe("merchant-002");
  });

  test("Given fee rates, When validating and normalizing, Then limits and stable keys are enforced", () => {
    const rates = {
      onlineOperation: "4.00",
      professionalAccount: "4",
      growthBooster: 4,
      acquisitionCard: "4%",
      offlineQrScan: "4.0",
    };

    expect(validateLinKeFeeRates(rates)).toBe("");
    expect(normalizeLinKeFeeRates(rates)).toEqual({
      onlineOperation: 4,
      professionalAccount: 4,
      growthBooster: 4,
      acquisitionCard: 4,
      offlineQrScan: 4,
    });
    expect(validateLinKeFeeRates({ ...rates, professionalAccount: 21 })).toBe("职人账号费用比例不能超过 20.00%");
  });

  test("Given numeric Lin-Ke statuses, When interpreting product state, Then ready and terminal states are mapped", () => {
    expect(interpretLinKeProductStatus({
      commission_status: 2,
      on_visible: 1,
    })).toEqual({
      feeStatus: "已设置",
      productStatus: "销售中",
      feeReady: true,
      productReady: true,
      negative: false,
    });

    expect(interpretLinKeProductStatus({
      commission_status: 5,
      on_visible: 2,
    })).toEqual({
      feeStatus: "已驳回",
      productStatus: "已下架",
      feeReady: false,
      productReady: false,
      negative: true,
    });

    expect(interpretLinKeProductStatus({
      product_commission_status: 201,
      product_detail: {
        product_status: 1,
      },
    })).toEqual({
      feeStatus: "待商家审批",
      productStatus: "销售中",
      feeReady: false,
      productReady: true,
      negative: false,
    });
  });

  test("Given HAR-shaped fee setup responses, When preparing fee setup, Then order and commission endpoints are used", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: {
        status_code: 0,
        data: {
          order_list: [{
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            partner_id: "7530573601330694179",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          }],
        },
      },
      orderDetail: {
        status_code: 0,
        data: {
          order: {
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            partner_id: "7530573601330694179",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          },
        },
      },
      productList: {
        status_code: 0,
        data: {
          product_item_list: [{
            product_id: "1839261398040620",
            product_commission_status: 0,
            product_detail: {
              product_id: "1839261398040620",
              product_name: "100元代金券丨周年回馈",
              product_status: 1,
            },
          }],
        },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    const result = await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig({ accountId: "1838519002138636" }),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 1,
        professionalAccount: 2,
        growthBooster: 3,
        acquisitionCard: 4,
        offlineQrScan: 5,
      },
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /life/partner/v2/order/list/",
      "GET /life/partner/v2/order/detail/",
      "GET /life/partner/v2/commission/product-commission/list/",
      "POST /life/partner/v2/commission/commission-save-info/mget",
      "POST /life/partner/v2/commission/product-commission/save/",
    ]);
    expect(JSON.stringify(calls)).not.toContain("/life/partner/v2/operation/aoi");
    expect(calls[0]?.query).toMatchObject({
      merchant_id: "7533179826136549428",
      template_type_list: 2,
      accountId: "1838519002138636",
    });
    expect(calls[2]?.query).toMatchObject({
      sku_order_id: "7654071148498012194",
      product_id: "1839261398040620",
      query_scene_list: 0,
    });
    expect(calls[3]?.payload).toEqual({
      sku_order_id: "7654071148498012194",
      product_id_list: ["1839261398040620"],
      need_tips_content: true,
    });
    expect(calls[4]?.query).toMatchObject({
      ac_app: 10159,
      accountId: "1838519002138636",
    });
    expect(calls[4]?.payload).toMatchObject({
      sku_order_id: "7654071148498012194",
      agreement_scene_list: [],
      product_item_list: [{
        product_id: "1839261398040620",
        waiting_accept_commission_ratio: "100",
        waiting_accept_commission_mode: 0,
        waiting_accept_commission_config: {
          "1": { commission_ratio: "100", commission_mode: 0 },
          "50": { commission_ratio: "200", commission_mode: 0 },
          "60": { commission_ratio: "300", commission_mode: 0 },
          "70": { commission_ratio: "400", commission_mode: 0 },
          "100": { commission_ratio: "500", commission_mode: 0 },
        },
        waiting_accept_stepped_commission_config: [],
      }],
    });
    const feeSettingUrl = new URL(result.feeSettingUrl);
    expect(feeSettingUrl.pathname).toBe("/vmok/order-detail");
    expect(feeSettingUrl.searchParams.get("__pid__")).toBe("7530573601330694179");
    expect(feeSettingUrl.searchParams.get("from_page")).toBe("order_management");
    expect(feeSettingUrl.searchParams.get("merchantId")).toBe("7533179826136549428");
    expect(feeSettingUrl.searchParams.get("orderId")).toBe("7654071148497995810");
    expect(feeSettingUrl.searchParams.get("queryScene")).toBe("0");
    expect(feeSettingUrl.searchParams.get("skuOrderId")).toBe("7654071148498012194");
    expect(feeSettingUrl.searchParams.get("tabName")).toBe("ChargeSetting");
    expect(feeSettingUrl.searchParams.has("product_id")).toBe(false);
  });

  test("Given order response lacks partner id, When building fee setting URL, Then root life account id is used as pid", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: {
        status_code: 0,
        data: {
          order_list: [{
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          }],
        },
      },
      orderDetail: {
        status_code: 0,
        data: {
          order: {
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          },
        },
      },
      productList: {
        status_code: 0,
        data: {
          product_item_list: [{
            product_id: "1839261398040620",
            product_commission_status: 0,
            product_detail: {
              product_id: "1839261398040620",
              product_name: "100元代金券丨周年回馈",
              product_status: 1,
            },
          }],
        },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    const result = await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig({
        accountId: "1838519002138636",
        rootLifeAccountId: "7530573601330694179",
      }),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 1,
        professionalAccount: 2,
        growthBooster: 3,
        acquisitionCard: 4,
        offlineQrScan: 5,
      },
    });

    const feeSettingUrl = new URL(result.feeSettingUrl);
    expect(feeSettingUrl.pathname).toBe("/vmok/order-detail");
    expect(feeSettingUrl.searchParams.get("__pid__")).toBe("7530573601330694179");
    expect(feeSettingUrl.searchParams.get("tabName")).toBe("ChargeSetting");
    expect(feeSettingUrl.searchParams.has("product_id")).toBe(false);
  });

  test("Given HAR-shaped tracking response, When getting product status, Then commission list statuses are interpreted", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: {
          product_item_list: [{
            product_id: "1839261398040620",
            product_commission_status: 0,
            product_detail: {
              product_id: "1839261398040620",
              product_status: 2,
            },
          }],
        },
      },
    });

    const status = await createDefaultLinKeFeeSetupClient().getProductStatus({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /life/partner/v2/order/list/",
      "GET /life/partner/v2/order/detail/",
      "GET /life/partner/v2/commission/product-commission/list/",
    ]);
    expect(JSON.stringify(calls)).not.toContain("/life/partner/v2/operation/aoi");
    expect(status).toMatchObject({
      feeStatus: "未设置",
      productStatus: "已下架",
      feeReady: false,
      productReady: false,
      negative: true,
    });
  });

  test("Given ready tracking response, When getting product status, Then both ready states are true", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: {
          product_item_list: [{
            product_id: "1839261398040620",
            product_commission_status: 1,
            product_detail: {
              product_id: "1839261398040620",
              product_status: 1,
            },
          }],
        },
      },
    });

    await expect(createDefaultLinKeFeeSetupClient().getProductStatus({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
    })).resolves.toMatchObject({
      feeStatus: "已设置",
      productStatus: "销售中",
      feeReady: true,
      productReady: true,
      negative: false,
    });
  });

  test("Given no signed order, When getting product status, Then a clear merchant error is thrown", async () => {
    const session = mockSession([], {
      orderList: { status_code: 0, data: { order_list: [] } },
    });

    await expect(createDefaultLinKeFeeSetupClient().getProductStatus({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
    })).rejects.toThrow("林客商户无签约订单: 7533179826136549428");
  });

  test("Given product is absent from commission list, When getting product status, Then a clear product error is thrown", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: { status_code: 0, data: { product_item_list: [] } },
    });

    await expect(createDefaultLinKeFeeSetupClient().getProductStatus({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
    })).rejects.toThrow("林客商品不存在: 1839261398040620");
  });

  test("Given no signed order, When preparing fee setup, Then a clear merchant error is thrown", async () => {
    const session = mockSession([], {
      orderList: { status_code: 0, data: { order_list: [] } },
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 4,
        professionalAccount: 4,
        growthBooster: 4,
        acquisitionCard: 4,
        offlineQrScan: 4,
      },
    })).rejects.toThrow("林客商户无签约订单: 7533179826136549428");
  });

  test("Given Lin-Ke save fails, When preparing fee setup, Then the save error is surfaced", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 1001, status_msg: "保存失败" },
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 4,
        professionalAccount: 4,
        growthBooster: 4,
        acquisitionCard: 4,
        offlineQrScan: 4,
      },
    })).rejects.toThrow("提交商品费用设置失败: 保存失败");
  });

  test("Given product is absent from commission list, When preparing fee setup, Then a clear product error is thrown", async () => {
    const session = mockSession([], {
      orderList: {
        status_code: 0,
        data: {
          order_list: [{
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          }],
        },
      },
      orderDetail: {
        status_code: 0,
        data: {
          order: {
            id: "7654071148497995810",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          },
        },
      },
      productList: { status_code: 0, data: { product_item_list: [] } },
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 4,
        professionalAccount: 4,
        growthBooster: 4,
        acquisitionCard: 4,
        offlineQrScan: 4,
      },
    })).rejects.toThrow("林客商品不存在: 1839261398040620");
  });

  test("Given Lin-Ke range is stricter, When fee rate exceeds it, Then the range error is explicit", async () => {
    const session = mockSession([], {
      orderList: {
        status_code: 0,
        data: {
          order_list: [{
            id: "7654071148497995810",
            merchant_id: "7533179826136549428",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          }],
        },
      },
      orderDetail: {
        status_code: 0,
        data: {
          order: {
            id: "7654071148497995810",
            sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
          },
        },
      },
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620", { onlineOperationMax: 300 }),
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        onlineOperation: 4,
        professionalAccount: 4,
        growthBooster: 4,
        acquisitionCard: 4,
        offlineQrScan: 4,
      },
    })).rejects.toThrow("线上经营费用比例超出林客范围 0.00% ~ 3.00%");
  });
});

function accountConfig(patch: Partial<LinKeAccountConfig> = {}): LinKeAccountConfig {
  return {
    id: 1,
    name: "深圳食义",
    bdCityTexts: ["深圳一区"],
    cookieFilePath: "",
    groupId: "",
    rootLifeAccountId: "",
    accountId: "",
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...patch,
  };
}

function signedOrderListResponse() {
  return {
    status_code: 0,
    data: {
      order_list: [{
        id: "7654071148497995810",
        merchant_id: "7533179826136549428",
        partner_id: "7530573601330694179",
        sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
      }],
    },
  };
}

function signedOrderDetailResponse() {
  return {
    status_code: 0,
    data: {
      order: {
        id: "7654071148497995810",
        merchant_id: "7533179826136549428",
        partner_id: "7530573601330694179",
        sku_order_list: [{ id: "7654071148498012194", template_type: 2 }],
      },
    },
  };
}

function mockSession(
  calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }>,
  responses: {
    orderList?: unknown;
    orderDetail?: unknown;
    productList?: unknown;
    saveInfo?: unknown;
    feeSave?: unknown;
  },
): LifePartnerSession {
  return {
    baseUrl: "https://www.life-partner.cn",
    async getJson(path: string, query?: Record<string, unknown>) {
      calls.push({ method: "GET", path, query });
      if (path === "/life/partner/v2/order/list/") return responses.orderList;
      if (path === "/life/partner/v2/order/detail/") return responses.orderDetail;
      if (path === "/life/partner/v2/commission/product-commission/list/") return responses.productList;
      throw new Error(`unexpected GET ${path}`);
    },
    async postJson(path: string, payload: unknown, query?: Record<string, unknown>) {
      calls.push({ method: "POST", path, payload, query });
      if (path === "/life/partner/v2/commission/commission-save-info/mget") return responses.saveInfo;
      if (path === "/life/partner/v2/commission/product-commission/save/") return responses.feeSave;
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as LifePartnerSession;
}

function saveInfoResponse(productId: string, options: { onlineOperationMax?: number } = {}) {
  return {
    status_code: 0,
    data: {
      commission_range_map: {
        [productId]: {
          traffic_source_range_map: {
            "1": { max_commission_ratio: options.onlineOperationMax ?? 8000, min_commission_ratio: 0 },
            "50": { max_commission_ratio: 2000, min_commission_ratio: 0 },
            "60": { max_commission_ratio: 8000, min_commission_ratio: 0 },
            "70": { max_commission_ratio: 8000, min_commission_ratio: 0 },
            "100": { max_commission_ratio: 8000, min_commission_ratio: 0 },
          },
        },
      },
    },
  };
}
