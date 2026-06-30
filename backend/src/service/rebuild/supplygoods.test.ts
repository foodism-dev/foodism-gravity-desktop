import { describe, expect, test } from "bun:test";

import {
  buildEmptyOriginPayload,
  buildTicketPayloadFromSupplyGoods,
  canEnterTicketFromSupplyGoodsPayload,
  extractSupplyCompanyId,
  getSupplyGoodsTicketFlowState,
  hydrateTicketPayloadCompany,
  isSupplyGoodsApprovalPassed,
  normalizeSupplyCompanyPayload,
  normalizeSupplyGoodsPayload,
} from "./supplygoods.ts";
import type { RebuildAssetUploader } from "./assets.ts";
import { TICKET_BUSINESS_STATUS, TICKET_STATUS } from "../../ticket-status.ts";

describe("SupplyGoods 工单 payload 初始化", () => {
  test("Given Rebuild approvalState value is passed, When building ticket payload, Then it copies Rebuild data", () => {
    const payload = {
      SupplyGoodsId: "944-approved",
      approvalState: { value: 10, text: "通过" },
      goodsNameInput: "招牌双人套餐",
      price: 99,
      supplyPrice: 70,
    };

    expect(isSupplyGoodsApprovalPassed(payload)).toBe(true);
    expect(buildTicketPayloadFromSupplyGoods(payload)).toEqual(payload);
    expect(Object.keys(buildEmptyOriginPayload(payload)).sort()).toEqual(Object.keys(payload).sort());
    expect(buildEmptyOriginPayload(payload).goodsNameInput).toBeNull();
  });

  test("Given ticket payload has company lookup, When company detail exists, Then it hydrates payload.company", () => {
    const payload = {
      SupplyGoodsId: "944-approved",
      approvalState: { value: 10, text: "通过" },
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
      },
    };

    const hydratedPayload = buildTicketPayloadFromSupplyGoods(payload, {
      supplyCompanyId: "945-company",
      payload: {
        SupplyCompanyId: "945-company",
        companyName: "测试公司",
        legalPerson: "张三",
        guestId: "guest-001",
      },
      updatedAt: new Date("2026-06-25T08:00:00.000Z"),
    });

    expect(hydratedPayload).toEqual({
      SupplyGoodsId: "944-approved",
      approvalState: { value: 10, text: "通过" },
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
        guestId: "guest-001",
      },
    });
    expect(hydratedPayload.supplyCompany).toBeUndefined();
  });

  test("Given existing ticket payload has company lookup, When hydrating, Then only company field changes", () => {
    const hydratedPayload = hydrateTicketPayloadCompany({
      goodsNameInput: "原始套餐",
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
      },
    }, {
      supplyCompanyId: "945-company",
      payload: {
        companyName: "测试公司",
        guestId: "guest-002",
      },
      updatedAt: new Date("2026-06-25T08:00:00.000Z"),
    });

    expect(hydratedPayload).toEqual({
      goodsNameInput: "原始套餐",
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
        guestId: "guest-002",
      },
    });
  });

  test("Given Rebuild approvalState is not passed, When building ticket payload, Then it keeps current payload empty", () => {
    const payload = {
      SupplyGoodsId: "944-pending",
      approvalState: { value: 2, text: "审批中" },
      goodsNameInput: "待审套餐",
    };

    expect(isSupplyGoodsApprovalPassed(payload)).toBe(false);
    expect(buildTicketPayloadFromSupplyGoods(payload)).toEqual({});
  });

  test("Given Rebuild approvalState is rejected, When deriving callback ticket state, Then ticket returns to completion", () => {
    expect(getSupplyGoodsTicketFlowState({
      SupplyGoodsId: "944-rejected",
      approvalState: { value: 11, text: "商品驳回" },
    }, TICKET_BUSINESS_STATUS.PRODUCT_ONLINE_PENDING)).toEqual({
      status: TICKET_STATUS.RETURNED,
      businessStatus: TICKET_BUSINESS_STATUS.INFO_COMPLETION_PENDING,
    });
  });

  test("Given Rebuild approvalState returns to processing, When deriving callback ticket state, Then ticket waits for access review", () => {
    expect(getSupplyGoodsTicketFlowState({
      SupplyGoodsId: "944-processing",
      approvalState: { value: 2, text: "审批中" },
    }, TICKET_BUSINESS_STATUS.INFO_COMPLETION_PENDING)).toEqual({
      status: TICKET_STATUS.TODO,
      businessStatus: TICKET_BUSINESS_STATUS.ACCESS_REVIEW_PENDING,
    });
  });

  test("Given goods company and host are processing or approved, When checking ticket entry, Then it can enter tickets", () => {
    expect(canEnterTicketFromSupplyGoodsPayload({
      SupplyGoodsId: "944-ready",
      approvalState: { value: 2, text: "审批中" },
      company: {
        id: "945-company",
        entity: "SupplyCompany",
        approvalState: { value: 10, text: "通过" },
      },
      rbhost: {
        id: "946-host",
        entity: "SupplyHost",
        approvalState: { value: 2, text: "审批中" },
      },
    })).toBe(true);
  });

  test("Given any linked approval state is not processing or approved, When checking ticket entry, Then it cannot enter tickets", () => {
    expect(canEnterTicketFromSupplyGoodsPayload({
      SupplyGoodsId: "944-company-rejected",
      approvalState: { value: 2, text: "审批中" },
      company: {
        id: "945-company",
        entity: "SupplyCompany",
        approvalState: { value: 11, text: "驳回" },
      },
      rbhost: {
        id: "946-host",
        entity: "SupplyHost",
        approvalState: { value: 2, text: "审批中" },
      },
    })).toBe(false);
    expect(canEnterTicketFromSupplyGoodsPayload({
      SupplyGoodsId: "944-host-missing",
      approvalState: { value: 10, text: "通过" },
      company: {
        id: "945-company",
        entity: "SupplyCompany",
        approvalState: { value: 10, text: "通过" },
      },
      rbhost: {
        id: "946-host",
        entity: "SupplyHost",
      },
    })).toBe(false);
  });

  test("Given asset uploader exists, When normalizing SupplyGoods payload, Then media fields are replaced by R2 urls", async () => {
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.fieldName}/main.jpg`,
        };
      },
    };

    const normalizedPayload = await normalizeSupplyGoodsPayload({
      supplyGoodsId: "944-asset",
      payload: {
        goodsNameInput: "带图套餐",
        mainPic: ["rb/main.jpg"],
      },
      assetUploader: uploader,
      fields: [
        {
          entityName: "SupplyGoods",
          fieldName: "mainPic",
          label: "商品主图",
          fieldType: "IMAGE",
          raw: { name: "mainPic", displayType: "IMAGE" },
        },
      ],
    });

    expect(normalizedPayload).toEqual({
      goodsNameInput: "带图套餐",
      mainPic: ["https://cdn.example.com/mainPic/main.jpg"],
    });
  });

  test("Given SupplyGoods payload has company reference, When normalizing, Then company keeps current Rebuild data", async () => {
    const payload = {
      goodsNameInput: "带公司套餐",
      company: {
        id: "945-company",
        text: "测试公司",
        entity: "SupplyCompany",
      },
    };

    const normalizedPayload = await normalizeSupplyGoodsPayload({
      supplyGoodsId: "944-company",
      payload,
      assetUploader: null,
      fields: [],
    });

    expect(normalizedPayload.company).toEqual({
      id: "945-company",
      text: "测试公司",
      entity: "SupplyCompany",
    });
    expect(extractSupplyCompanyId(normalizedPayload)).toBe("945-company");
  });

  test("Given SupplyCompany payload has media fields, When normalizing, Then company assets are replaced by R2 urls", async () => {
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.entityName}/${input.recordId}/${input.fieldName}/license.jpg`,
        };
      },
    };

    const normalizedPayload = await normalizeSupplyCompanyPayload({
      supplyCompanyId: "945-company",
      payload: {
        companyName: "测试公司",
        businessLicensePicture: ["rb/company/license.jpg"],
      },
      assetUploader: uploader,
      fields: [
        {
          entityName: "SupplyCompany",
          fieldName: "businessLicensePicture",
          label: "营业执照",
          fieldType: "IMAGE",
          raw: { name: "businessLicensePicture", displayType: "IMAGE" },
        },
      ],
    });

    expect(normalizedPayload).toEqual({
      companyName: "测试公司",
      businessLicensePicture: ["https://cdn.example.com/SupplyCompany/945-company/businessLicensePicture/license.jpg"],
    });
  });
});
