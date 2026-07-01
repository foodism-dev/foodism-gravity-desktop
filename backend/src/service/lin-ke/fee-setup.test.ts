import { describe, expect, test } from "bun:test";

import {
  createDefaultLinKeFeeSetupClient,
  interpretLinKeProductStatus,
  normalizeLinKeFeeRates,
  resolveLinKeMerchantId,
  type LinKeFeeRates,
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

  test("Given fee rates, When validating and normalizing, Then active keys and limits are enforced", () => {
    const rates = {
      ...feeRates(),
      values: {
        ...feeRates().values,
        "1000": "4.00",
        "4000": "80",
        "5000": "80",
      },
    };

    expect(validateLinKeFeeRates(rates)).toBe("");
    const normalized = normalizeLinKeFeeRates(rates);
    expect(normalized).toMatchObject({
      values: {
        "1000": 4,
        "4000": 80,
        "5000": 80,
      },
      singleSettings: {
        "1000": false,
        "2000": false,
        "3000": false,
        "5000": false,
        "7000": false,
      },
    });
    expect(Object.hasOwn(normalized?.values ?? {}, "1001")).toBe(false);
    expect(validateLinKeFeeRates({
      values: { "1000": 4 },
      singleSettings: {},
    })).toBe("请填写直播费用比例");
    expect(normalizeLinKeFeeRates({
      values: { "1000": 4 },
      singleSettings: {},
    })).toBeNull();
    expect(validateLinKeFeeRates(feeRates({ values: { "1000": 21 } }))).toBe("视频费用比例不能超过 20.00%");
    expect(validateLinKeFeeRates(feeRates({ values: { "5000": 81 } }))).toBe("获客卡费用比例不能超过 80.00%");
    expect(validateLinKeFeeRates(feeRates({
      singleSettings: { "1000": true },
      values: { "1001": 80, "1002": 80, "1003": 21 },
    }))).toBe("职人视频费用比例不能超过 20.00%");
    expect(validateLinKeFeeRates(feeRates({
      singleSettings: { "2000": true },
      values: { "2001": 80, "2002": 80, "2003": 21 },
    }))).toBe("职人直播费用比例不能超过 20.00%");
    expect(validateLinKeFeeRates(feeRates({
      singleSettings: { "3000": true },
      values: { "3001": 80, "3002": 21 },
    }))).toBe("职人码费用比例不能超过 20.00%");
    expect(validateLinKeFeeRates(feeRates({
      singleSettings: { "7000": true },
      values: { "7001": 80, "7002": 80, "7003": 21 },
    }))).toBe("职人内容费用比例不能超过 20.00%");
    expect(normalizeLinKeFeeRates(feeRates({
      singleSettings: { "1000": true },
      values: { "1001": 80, "1002": 80, "1003": 21 },
    }))).toBeNull();
    expect(validateLinKeFeeRates({
      ...feeRates({ singleSettings: { "1000": true } }),
      values: { ...feeRates().values, "1001": 80, "1002": 80, "1003": "80.001" },
    })).toBe("职人视频费用比例最多支持两位小数");
  });

  test("Given only legacy fee keys, When validating, Then current traffic source fields drive the error", () => {
    const message = validateLinKeFeeRates({
      values: {
        onlineOperation: 12,
        acquisitionCard: 12,
        offlineQrScan: 12,
        "线上经营": "12.00",
        "获客卡": "12.00",
      },
      singleSettings: {},
    });

    expect(message).toBe("请填写视频费用比例");
    expect(message).not.toContain("线上经营");
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
      rates: feeRates({
        values: {
          "1000": 1,
          "2000": 2,
          "3000": 3,
          "4000": 4,
          "5000": 80,
          "7000": 6,
          "7100": 7,
        },
      }),
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /life/partner/v2/order/list/",
      "GET /life/partner/v2/order/detail/",
      "GET /life/partner/v2/commission/product-commission/list/",
      "POST /life/partner/v2/commission/commission-display-component/mget",
      "GET /life/partner/v2/commission/save-white-list/get/",
      "POST /life/partner/v2/order/agreement/content/query/",
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
      need_setting_info: true,
    });
    expect(calls[4]?.query).toMatchObject({
      ac_app: 10159,
      order_id: "7654071148497995810",
      scene: 2,
      accountId: "1838519002138636",
    });
    expect(calls[5]?.query).toMatchObject({
      ac_app: 10159,
      accountId: "1838519002138636",
    });
    expect(calls[5]?.payload).toEqual({
      template_type: 2,
      sku_order_id: "7654071148498012194",
      save_cps_param: { contain_total_amount: false },
      scene: 1,
    });
    expect(calls[6]?.query).toMatchObject({
      ac_app: 10159,
      accountId: "1838519002138636",
    });
    expect(calls[6]?.payload).toMatchObject({
      sku_order_id: "7654071148498012194",
      agreement_scene_list: [],
      product_item_list: [{
        product_id: "1839261398040620",
        commission_ratio: "",
        waiting_accept_commission_ratio: "",
        waiting_accept_commission_mode: 0,
        waiting_accept_commission_config: {
          "1000": { commission_ratio: "100", commission_mode: 0 },
          "2000": { commission_ratio: "200", commission_mode: 0 },
          "3000": { commission_ratio: "300", commission_mode: 0 },
          "4000": { commission_ratio: "400", commission_mode: 0 },
          "5000": { commission_ratio: "8000", commission_mode: 0 },
          "7000": { commission_ratio: "600", commission_mode: 0 },
          "7100": { commission_ratio: "700", commission_mode: 0 },
        },
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

  test("Given single setting is enabled, When saving fees, Then child traffic sources are submitted instead of parents", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        singleSettings: { "1000": true, "3000": true },
        values: {
          "1001": 11,
          "1002": 12,
          "1003": 13,
          "2000": 0,
          "3001": 31,
          "3002": 13,
          "4000": 0,
          "5000": 0,
          "7000": 0,
          "7100": 0,
        },
      },
    });

    const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
    expect(savePayload).toMatchObject({
      product_item_list: [{
        waiting_accept_commission_config: {
          "1001": { commission_ratio: "1100", commission_mode: 0 },
          "1002": { commission_ratio: "1200", commission_mode: 0 },
          "1003": { commission_ratio: "1300", commission_mode: 0 },
          "2000": { commission_ratio: "0", commission_mode: 0 },
          "3001": { commission_ratio: "3100", commission_mode: 0 },
          "3002": { commission_ratio: "1300", commission_mode: 0 },
          "4000": { commission_ratio: "0", commission_mode: 0 },
          "5000": { commission_ratio: "0", commission_mode: 0 },
          "7000": { commission_ratio: "0", commission_mode: 0 },
          "7100": { commission_ratio: "0", commission_mode: 0 },
        },
      }],
    });
    expect(JSON.stringify(savePayload)).not.toContain('"1000"');
    expect(JSON.stringify(savePayload)).not.toContain('"3000"');
  });

  test("Given all configurable rows are enabled like feiyong1 HAR, When saving fees, Then only child traffic sources and fixed rows are submitted", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        singleSettings: {
          "1000": true,
          "2000": true,
          "3000": true,
          "5000": true,
          "7000": true,
        },
        values: {
          "1001": 2,
          "1002": 2,
          "1003": 2,
          "2001": 4,
          "2002": 23,
          "2003": 2,
          "3001": 5,
          "3002": 5,
          "4000": 5,
          "5001": 5,
          "5002": 5,
          "7001": 5,
          "7002": 5,
          "7003": 5,
          "7100": 12,
        },
      },
    });

    const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
    const savedConfig = ((savePayload as { product_item_list?: Array<{ waiting_accept_commission_config?: Record<string, unknown> }> })
      .product_item_list?.[0]?.waiting_accept_commission_config) ?? {};

    expect(Object.keys(savedConfig).sort()).toEqual([
      "1001",
      "1002",
      "1003",
      "2001",
      "2002",
      "2003",
      "3001",
      "3002",
      "4000",
      "5001",
      "5002",
      "7001",
      "7002",
      "7003",
      "7100",
    ].sort());
    expect(savedConfig).toMatchObject({
      "1001": { commission_ratio: "200", commission_mode: 0 },
      "2002": { commission_ratio: "2300", commission_mode: 0 },
      "7100": { commission_ratio: "1200", commission_mode: 0 },
    });
    expect(savedConfig).not.toHaveProperty("1000");
    expect(savedConfig).not.toHaveProperty("2000");
    expect(savedConfig).not.toHaveProperty("3000");
    expect(savedConfig).not.toHaveProperty("5000");
    expect(savedConfig).not.toHaveProperty("7000");
  });

  test("Given mixed rows like feiyong HAR, When saving fees, Then each row independently follows its switch state", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        singleSettings: {
          "1000": true,
          "2000": false,
          "3000": false,
          "5000": false,
          "7000": true,
        },
        values: {
          "1001": 3,
          "1002": 3,
          "1003": 3,
          "2000": 19,
          "3000": 19,
          "4000": 19,
          "5000": 19,
          "7001": 3,
          "7002": 3,
          "7003": 3,
          "7100": 19,
        },
      },
    });

    const savedConfig = savedCommissionConfig(calls);
    expect(Object.keys(savedConfig).sort()).toEqual([
      "1001",
      "1002",
      "1003",
      "2000",
      "3000",
      "4000",
      "5000",
      "7001",
      "7002",
      "7003",
      "7100",
    ].sort());
    expect(savedConfig).toMatchObject({
      "1001": { commission_ratio: "300", commission_mode: 0 },
      "2000": { commission_ratio: "1900", commission_mode: 0 },
      "7003": { commission_ratio: "300", commission_mode: 0 },
      "7100": { commission_ratio: "1900", commission_mode: 0 },
    });
    expect(savedConfig).not.toHaveProperty("1000");
    expect(savedConfig).not.toHaveProperty("2001");
    expect(savedConfig).not.toHaveProperty("2002");
    expect(savedConfig).not.toHaveProperty("2003");
    expect(savedConfig).not.toHaveProperty("7000");
  });

  test("Given any switch combination, When saving fees, Then parent and child sources are mutually exclusive per row", async () => {
    const switchSources = ["1000", "2000", "3000", "5000", "7000"];
    for (let mask = 0; mask < 2 ** switchSources.length; mask += 1) {
      const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
      const singleSettings = Object.fromEntries(
        switchSources.map((source, index) => [source, (mask & (1 << index)) !== 0]),
      );
      const session = mockSession(calls, {
        orderList: signedOrderListResponse(),
        orderDetail: signedOrderDetailResponse(),
        productList: {
          status_code: 0,
          data: { product_item_list: [{ product_id: "1839261398040620" }] },
        },
        saveInfo: saveInfoResponse("1839261398040620"),
        feeSave: { status_code: 0, status_msg: "" },
      });

      await createDefaultLinKeFeeSetupClient().setupFee({
        session,
        accountConfig: accountConfig(),
        merchantId: "7533179826136549428",
        linkeGoodsId: "1839261398040620",
        rates: feeRates({ singleSettings }),
      });

      const keys = Object.keys(savedCommissionConfig(calls)).sort();
      expect(keys).toEqual(expectedSourceKeys(singleSettings).sort());
      expect(keys).toContain("4000");
      expect(keys).toContain("7100");
      assertParentChildExclusive(keys, "1000", ["1001", "1002", "1003"]);
      assertParentChildExclusive(keys, "2000", ["2001", "2002", "2003"]);
      assertParentChildExclusive(keys, "3000", ["3001", "3002"]);
      assertParentChildExclusive(keys, "5000", ["5001", "5002"]);
      assertParentChildExclusive(keys, "7000", ["7001", "7002", "7003"]);
    }
  });

  test("Given Lin-Ke returns parent ranges only, When opened rows submit child rates, Then active children are saved", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: parentOnlySaveInfoResponse("1839261398040620"),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: {
        singleSettings: {
          "1000": true,
          "2000": false,
          "3000": false,
          "5000": false,
          "7000": true,
        },
        values: {
          "1001": 1,
          "1002": 2,
          "1003": 3,
          "2000": 12,
          "3000": 12,
          "4000": 12,
          "5000": 12,
          "7001": 4,
          "7002": 5,
          "7003": 6,
          "7100": 15,
        },
      },
    });

    const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
    expect(savePayload).toMatchObject({
      product_item_list: [{
        waiting_accept_commission_config: {
          "1001": { commission_ratio: "100", commission_mode: 0 },
          "1002": { commission_ratio: "200", commission_mode: 0 },
          "1003": { commission_ratio: "300", commission_mode: 0 },
          "2000": { commission_ratio: "1200", commission_mode: 0 },
          "3000": { commission_ratio: "1200", commission_mode: 0 },
          "4000": { commission_ratio: "1200", commission_mode: 0 },
          "5000": { commission_ratio: "1200", commission_mode: 0 },
          "7001": { commission_ratio: "400", commission_mode: 0 },
          "7002": { commission_ratio: "500", commission_mode: 0 },
          "7003": { commission_ratio: "600", commission_mode: 0 },
          "7100": { commission_ratio: "1500", commission_mode: 0 },
        },
      }],
    });
    expect(JSON.stringify(savePayload)).not.toContain('"1000"');
    expect(JSON.stringify(savePayload)).not.toContain('"7000"');
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
      rates: feeRates(),
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
      rates: feeRates(),
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
      rates: feeRates(),
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
      rates: feeRates(),
    })).rejects.toThrow("林客商品不存在: 1839261398040620");
  });

  test("Given save whitelist is empty, When preparing fee setup, Then active child sources still submit", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      whiteList: saveWhiteListResponse([]),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({
        singleSettings: { "1000": true },
        values: { "1001": 1, "1002": 2, "1003": 3 },
      }),
    });

    const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
    const savedConfig = ((savePayload as { product_item_list?: Array<{ waiting_accept_commission_config?: Record<string, unknown> }> })
      .product_item_list?.[0]?.waiting_accept_commission_config) ?? {};
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/order/agreement/content/query/");
    expect(Object.keys(savedConfig).sort()).toEqual([
      "1001",
      "1002",
      "1003",
      "2000",
      "3000",
      "4000",
      "5000",
      "7000",
      "7100",
    ].sort());
    expect(savedConfig).not.toHaveProperty("1000");
  });

  test("Given save whitelist omits active parent sources, When preparing fee setup, Then selected parent shape still submits", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      whiteList: saveWhiteListResponse(["9999"]),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({
        singleSettings: { "1000": false },
        values: { "1000": 1 },
      }),
    });

    const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
    const savedConfig = ((savePayload as { product_item_list?: Array<{ waiting_accept_commission_config?: Record<string, unknown> }> })
      .product_item_list?.[0]?.waiting_accept_commission_config) ?? {};
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/order/agreement/content/query/");
    expect(Object.keys(savedConfig).sort()).toEqual([
      "1000",
      "2000",
      "3000",
      "4000",
      "5000",
      "7000",
      "7100",
    ].sort());
    expect(savedConfig).not.toHaveProperty("1001");
    expect(savedConfig).not.toHaveProperty("1002");
    expect(savedConfig).not.toHaveProperty("1003");
  });

  test("Given save whitelist request fails, When preparing fee setup, Then final save still decides the result", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      whiteList: { status_code: 1001, status_msg: "白名单不可用" },
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates(),
    });

    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/commission/save-white-list/get/");
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/order/agreement/content/query/");
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/commission/product-commission/save/");
  });

  test("Given agreement content requires confirmation, When preparing fee setup, Then save is blocked before submit", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      agreementContent: agreementContentResponse([{ title: "费用协议" }]),
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates(),
    })).rejects.toThrow("林客返回待确认费用协议，请进入林客核对协议内容后重试");
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/order/agreement/content/query/");
    expect(calls.map((call) => call.path)).not.toContain("/life/partner/v2/commission/product-commission/save/");
  });

  test("Given Lin-Ke traffic tree misses an active parent source, When saving closed row fees, Then source keys still follow platform state", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620", {}, trafficTreeWithout("1000")),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates(),
    });

    const savedConfig = savedCommissionConfig(calls);
    expect(savedConfig).toHaveProperty("1000");
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/commission/product-commission/save/");
  });

  test("Given Lin-Ke traffic tree misses an active child source, When saving opened row fees, Then source keys still follow platform state", async () => {
    const calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }> = [];
    const session = mockSession(calls, {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620", {}, trafficTreeWithout("2002")),
      feeSave: { status_code: 0, status_msg: "" },
    });

    await createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({
        singleSettings: { "2000": true },
      }),
    });

    const savedConfig = savedCommissionConfig(calls);
    expect(savedConfig).toHaveProperty("2001");
    expect(savedConfig).toHaveProperty("2002");
    expect(savedConfig).toHaveProperty("2003");
    expect(calls.map((call) => call.path)).toContain("/life/partner/v2/commission/product-commission/save/");
  });

  test("Given Lin-Ke save fails, When submitting fees, Then active source keys are included in the error", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
      feeSave: { status_code: 1001, status_msg: "配置了不合法的费用流量来源，请刷新页面重试" },
    });

    let errorMessage = "";
    try {
      await createDefaultLinKeFeeSetupClient().setupFee({
        session,
        accountConfig: accountConfig(),
        merchantId: "7533179826136549428",
        linkeGoodsId: "1839261398040620",
        rates: feeRates({
          singleSettings: { "1000": true, "7000": true },
          values: {
            "1001": 1,
            "1002": 2,
            "1003": 3,
            "7001": 4,
            "7002": 5,
            "7003": 6,
          },
        }),
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toContain("配置了不合法的费用流量来源，请刷新页面重试");
    expect(errorMessage).toContain("平台开关: 视频=开, 直播=关, 线下扫码=关, 获客卡=关, 内容成交=开");
    expect(errorMessage).toContain("本次提交来源: 1001/1002/1003/2000/3000/4000/5000/7001/7002/7003/7100");
  });

  test("Given fee rate exceeds Lin-Ke range, When preparing fee setup, Then the range error is explicit", async () => {
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
      saveInfo: saveInfoResponse("1839261398040620"),
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({ values: { "1000": 21 } }),
    })).rejects.toThrow("视频费用比例超出林客范围 0.00% ~ 20.00%");
  });

  test("Given Lin-Ke child range is narrower than local fallback, When opened row exceeds it, Then Lin-Ke range wins", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620", {
        "1003": { upper_boundary: 1500, lower_boundary: 0 },
      }),
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({
        singleSettings: { "1000": true },
        values: { "1001": 1, "1002": 2, "1003": 16 },
      }),
    })).rejects.toThrow("职人视频费用比例超出林客范围 0.00% ~ 15.00%");
  });

  test("Given Lin-Ke child range is wider than local professional limit, When opened professional row exceeds 20 percent, Then local range wins", async () => {
    const session = mockSession([], {
      orderList: signedOrderListResponse(),
      orderDetail: signedOrderDetailResponse(),
      productList: {
        status_code: 0,
        data: { product_item_list: [{ product_id: "1839261398040620" }] },
      },
      saveInfo: saveInfoResponse("1839261398040620"),
    });

    await expect(createDefaultLinKeFeeSetupClient().setupFee({
      session,
      accountConfig: accountConfig(),
      merchantId: "7533179826136549428",
      linkeGoodsId: "1839261398040620",
      rates: feeRates({
        singleSettings: { "1000": true },
        values: { "1001": 80, "1002": 80, "1003": 21 },
      }),
    })).rejects.toThrow("职人视频费用比例超出允许范围 0.00% ~ 20.00%");
  });
});

function accountConfig(patch: Partial<LinKeAccountConfig> = {}): LinKeAccountConfig {
  return {
    id: 1,
    name: "深圳食义",
    bdCityTexts: ["深圳一区"],
    cookie: "",
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
    whiteList?: unknown;
    agreementContent?: unknown;
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
      if (path === "/life/partner/v2/commission/save-white-list/get/") return responses.whiteList ?? saveWhiteListResponse();
      throw new Error(`unexpected GET ${path}`);
    },
    async postJson(path: string, payload: unknown, query?: Record<string, unknown>) {
      calls.push({ method: "POST", path, payload, query });
      if (path === "/life/partner/v2/commission/commission-display-component/mget") return responses.saveInfo;
      if (path === "/life/partner/v2/order/agreement/content/query/") return responses.agreementContent ?? agreementContentResponse();
      if (path === "/life/partner/v2/commission/product-commission/save/") return responses.feeSave;
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as LifePartnerSession;
}

function feeRates(patch: {
  values?: Record<string, number>;
  singleSettings?: Record<string, boolean>;
} = {}): LinKeFeeRates {
  return {
    values: {
      "1000": 0,
      "1001": 0,
      "1002": 0,
      "1003": 0,
      "2000": 0,
      "2001": 0,
      "2002": 0,
      "2003": 0,
      "3000": 0,
      "3001": 0,
      "3002": 0,
      "4000": 0,
      "5000": 0,
      "5001": 0,
      "5002": 0,
      "7000": 0,
      "7001": 0,
      "7002": 0,
      "7003": 0,
      "7100": 0,
      ...patch.values,
    },
    singleSettings: {
      "1000": false,
      "2000": false,
      "3000": false,
      "5000": false,
      "7000": false,
      ...patch.singleSettings,
    },
  };
}

function savedCommissionConfig(
  calls: Array<{ method: string; path: string; query?: Record<string, unknown>; payload?: unknown }>,
): Record<string, unknown> {
  const savePayload = calls.find((call) => call.path === "/life/partner/v2/commission/product-commission/save/")?.payload;
  return ((savePayload as { product_item_list?: Array<{ waiting_accept_commission_config?: Record<string, unknown> }> } | undefined)
    ?.product_item_list?.[0]?.waiting_accept_commission_config) ?? {};
}

function expectedSourceKeys(singleSettings: Record<string, boolean>): string[] {
  return [
    ...(singleSettings["1000"] ? ["1001", "1002", "1003"] : ["1000"]),
    ...(singleSettings["2000"] ? ["2001", "2002", "2003"] : ["2000"]),
    ...(singleSettings["3000"] ? ["3001", "3002"] : ["3000"]),
    "4000",
    ...(singleSettings["5000"] ? ["5001", "5002"] : ["5000"]),
    ...(singleSettings["7000"] ? ["7001", "7002", "7003"] : ["7000"]),
    "7100",
  ];
}

function assertParentChildExclusive(keys: string[], parent: string, children: string[]): void {
  const hasParent = keys.includes(parent);
  const childCount = children.filter((child) => keys.includes(child)).length;
  expect(hasParent && childCount > 0).toBe(false);
  expect(hasParent || childCount === children.length).toBe(true);
}

function agreementContentResponse(agreementContentList: unknown[] = []) {
  return {
    status_code: 0,
    data: {
      agreement_content_list: agreementContentList,
    },
  };
}

function saveWhiteListResponse(sources = [
  "1000",
  "1001",
  "1002",
  "1003",
  "2000",
  "2001",
  "2002",
  "2003",
  "3000",
  "3001",
  "3002",
  "4000",
  "5000",
  "5001",
  "5002",
  "7000",
  "7001",
  "7002",
  "7003",
  "7100",
]) {
  return {
    status_code: 0,
    data: {
      configurable_commission_traffic_source: sources,
    },
  };
}

function saveInfoResponse(
  productId: string,
  rangePatch: Record<string, { upper_boundary: number; lower_boundary: number }> = {},
  trafficTree: unknown[] = standardTrafficTree(),
) {
  const trafficSourceRangeMap = {
    "1000": { upper_boundary: 2000, lower_boundary: 0 },
    "1001": { upper_boundary: 8000, lower_boundary: 0 },
    "1002": { upper_boundary: 8000, lower_boundary: 0 },
    "1003": { upper_boundary: 8000, lower_boundary: 0 },
    "2000": { upper_boundary: 2000, lower_boundary: 0 },
    "2001": { upper_boundary: 8000, lower_boundary: 0 },
    "2002": { upper_boundary: 8000, lower_boundary: 0 },
    "2003": { upper_boundary: 8000, lower_boundary: 0 },
    "3000": { upper_boundary: 2000, lower_boundary: 0 },
    "3001": { upper_boundary: 8000, lower_boundary: 0 },
    "3002": { upper_boundary: 8000, lower_boundary: 0 },
    "4000": { upper_boundary: 8000, lower_boundary: 0 },
    "5000": { upper_boundary: 8000, lower_boundary: 0 },
    "5001": { upper_boundary: 8000, lower_boundary: 0 },
    "5002": { upper_boundary: 8000, lower_boundary: 0 },
    "7000": { upper_boundary: 2000, lower_boundary: 0 },
    "7001": { upper_boundary: 8000, lower_boundary: 0 },
    "7002": { upper_boundary: 8000, lower_boundary: 0 },
    "7003": { upper_boundary: 8000, lower_boundary: 0 },
    "7100": { upper_boundary: 8000, lower_boundary: 0 },
    ...rangePatch,
  };
  return {
    status_code: 0,
    data: {
      commission_setting_info_map: {
        [productId]: {
          traffic_source_range_map: trafficSourceRangeMap,
        },
      },
      commission_traffic_display_tree_list: trafficTree,
    },
  };
}

function parentOnlySaveInfoResponse(productId: string) {
  return {
    status_code: 0,
    data: {
      commission_setting_info_map: {
        [productId]: {
          traffic_source_range_map: {
            "1000": { upper_boundary: 2000, lower_boundary: 0 },
            "2000": { upper_boundary: 2000, lower_boundary: 0 },
            "3000": { upper_boundary: 2000, lower_boundary: 0 },
            "4000": { upper_boundary: 8000, lower_boundary: 0 },
            "5000": { upper_boundary: 8000, lower_boundary: 0 },
            "7000": { upper_boundary: 2000, lower_boundary: 0 },
            "7100": { upper_boundary: 8000, lower_boundary: 0 },
          },
        },
      },
      commission_traffic_display_tree_list: standardTrafficTree(),
    },
  };
}

function standardTrafficTree() {
  return [
    {
      category: "常规成交",
      has_child: true,
      child_tree_list: [
        {
          traffic_source: 1000,
          has_child: true,
          child_tree_list: [
            { traffic_source: 1001, has_child: false },
            { traffic_source: 1002, has_child: false },
            { traffic_source: 1003, has_child: false },
          ],
        },
        {
          traffic_source: 2000,
          has_child: true,
          child_tree_list: [
            { traffic_source: 2001, has_child: false },
            { traffic_source: 2002, has_child: false },
            { traffic_source: 2003, has_child: false },
          ],
        },
        {
          traffic_source: 3000,
          has_child: true,
          child_tree_list: [
            { traffic_source: 3001, has_child: false },
            { traffic_source: 3002, has_child: false },
          ],
        },
        { traffic_source: 4000, has_child: false },
        {
          traffic_source: 5000,
          has_child: true,
          child_tree_list: [
            { traffic_source: 5001, has_child: false },
            { traffic_source: 5002, has_child: false },
          ],
        },
      ],
    },
    {
      category: "增量宝",
      has_child: true,
      child_tree_list: [
        {
          traffic_source: 7000,
          has_child: true,
          child_tree_list: [
            { traffic_source: 7001, has_child: false },
            { traffic_source: 7002, has_child: false },
            { traffic_source: 7003, has_child: false },
          ],
        },
        { traffic_source: 7100, has_child: false },
      ],
    },
  ];
}

function trafficTreeWithout(source: string): unknown[] {
  const removeSource = (nodes: unknown[]): unknown[] => nodes
    .filter((node) => !isTrafficNodeSource(node, source))
    .map((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return node;
      const record = node as Record<string, unknown>;
      const children = Array.isArray(record.child_tree_list) ? removeSource(record.child_tree_list) : record.child_tree_list;
      return { ...record, child_tree_list: children };
    });
  return removeSource(standardTrafficTree());
}

function isTrafficNodeSource(node: unknown, source: string): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  return String((node as Record<string, unknown>).traffic_source) === source;
}
