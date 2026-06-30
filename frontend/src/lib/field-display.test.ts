import { describe, expect, test } from "bun:test";

import {
  formatPayloadValue,
  getPayloadDisplayText,
  getPayloadMediaItems,
  type TicketFieldMetadataMap,
  type TicketFieldOptionsMap,
} from "./field-display.ts";

const fieldMetadata: TicketFieldMetadataMap = {
  isOutMeal: { label: "是否可以外带餐食", fieldType: "BOOL" },
  classification: { label: "商品类目", fieldType: "CLASSIFICATION" },
  onlineChannel: { label: "商品计划上线渠道", fieldType: "MULTISELECT" },
  channelLimit: { label: "上架渠道限制", fieldType: "PICKLIST" },
  approval_state: { label: "审核状态", fieldType: "PICKLIST" },
  rbhost: { label: "提报商户", fieldType: "REFERENCE" },
  price: { label: "售价", fieldType: "DECIMAL" },
  saleBegin: { label: "售卖开始时间", fieldType: "DATE" },
  mainPic: { label: "商品主图", fieldType: "IMAGE" },
  packages: { label: "套餐内容", fieldType: "WEBCOMPONENT" },
  certification: { label: "行业许可证", fieldType: "WEBCOMPONENT" },
  certificationType: { label: "行业许可证类型", fieldType: "MULTISELECT" },
};

const fieldOptions: TicketFieldOptionsMap = {
  classification: [
    {
      value: "cat-hotpot",
      label: "同城优享 / 周边美食 / 火锅",
      sortOrder: 1,
      isDefault: false,
    },
  ],
  onlineChannel: [
    {
      value: "1",
      label: "抖音来客（闭环）",
      sortOrder: 1,
      isDefault: false,
    },
  ],
  channelLimit: [
    {
      value: "012-017f538402dd04d1",
      label: "无限制",
      sortOrder: 0,
      isDefault: true,
    },
  ],
  approvalState: [
    {
      value: "10",
      label: "审核通过",
      sortOrder: 1,
      isDefault: false,
    },
  ],
};

describe("字段类型展示", () => {
  test("Given bool value, When formatting, Then it displays Chinese yes or no", () => {
    expect(formatPayloadValue("F", "isOutMeal", { fieldMetadata, fieldOptions })).toBe("否");
    expect(formatPayloadValue("T", "isOutMeal", { fieldMetadata, fieldOptions })).toBe("是");
  });

  test("Given classification id, When formatting, Then it displays option path", () => {
    expect(formatPayloadValue("cat-hotpot", "classification", { fieldMetadata, fieldOptions })).toBe(
      "同城优享 / 周边美食 / 火锅",
    );
  });

  test("Given multiselect object, When formatting, Then it displays selected labels", () => {
    expect(
      formatPayloadValue(
        { text: { id: 1, text: ["抖音来客（闭环）"] }, value: 1 },
        "onlineChannel",
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("抖音来客（闭环）");
  });

  test("Given picklist object whose text is an id, When formatting, Then it resolves option label", () => {
    expect(
      formatPayloadValue(
        { text: "012-017f538402dd04d1", value: "012-017f538402dd04d1" },
        "channelLimit",
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("无限制");
  });

  test("Given approval_state value and camel case options, When formatting, Then it displays approval label", () => {
    expect(formatPayloadValue(10, "approval_state", { fieldMetadata, fieldOptions })).toBe("审核通过");
  });

  test("Given approval_state options are missing, When formatting known code, Then it falls back to readable status", () => {
    expect(
      formatPayloadValue("10", "approval_state", {
        fieldMetadata,
        fieldOptions: {},
      }),
    ).toBe("审核通过");
  });

  test("Given launch channel and channel limit, When display field order prefers launch channel, Then it shows launch channel", () => {
    expect(
      getPayloadDisplayText(
        {
          onlineChannel: { text: { id: 1, text: ["抖音来客（闭环）"] }, value: 1 },
          channelLimit: { text: "012-017f538402dd04d1", value: "012-017f538402dd04d1" },
        },
        ["onlineChannel", "channelLimit"],
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("抖音来客（闭环）");
  });

  test("Given reference object, When formatting, Then it displays reference text", () => {
    expect(
      formatPayloadValue(
        { id: "946-1", text: "天津家宴妈妈菜", entity: "SupplyHost" },
        "rbhost",
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("天津家宴妈妈菜");
  });

  test("Given decimal and date values, When formatting, Then it normalizes the display", () => {
    expect(formatPayloadValue("168.00", "price", { fieldMetadata, fieldOptions })).toBe("168.00");
    expect(formatPayloadValue("2026-06-30", "saleBegin", { fieldMetadata, fieldOptions })).toBe("2026-06-30");
  });

  test("Given package json, When formatting, Then it returns readable package lines", () => {
    const packageJson = JSON.stringify({
      viewList: [
        {
          groupName: "主食",
          groupSelectNum: "1",
          groupPrice: "18.00",
          list: [{ title: "米饭", num: "6", price: "3.00" }],
        },
      ],
      totalPrice: "18.00",
    });

    expect(formatPayloadValue(packageJson, "packages", { fieldMetadata, fieldOptions })).toContain("主食");
    expect(formatPayloadValue(packageJson, "packages", { fieldMetadata, fieldOptions })).toContain("米饭");
    expect(formatPayloadValue(packageJson, "packages", { fieldMetadata, fieldOptions })).toContain("份数 6");
  });

  test("Given package json with item price fields, When formatting, Then it shows group, item, original price, quantity and unit price", () => {
    const packageJson = JSON.stringify({
      viewList: [
        {
          groupName: "双人套餐",
          list: [
            {
              title: "牛肉拼盘",
              originPrice: "88.00",
              num: "2",
              price: "39.00",
            },
          ],
        },
      ],
    });

    const formatted = formatPayloadValue(packageJson, "packages", { fieldMetadata, fieldOptions });

    expect(formatted).toContain("双人套餐");
    expect(formatted).toContain("牛肉拼盘");
    expect(formatted).toContain("原价 88.00");
    expect(formatted).toContain("份数 2");
    expect(formatted).toContain("单价 39.00");
  });

  test("Given industry license WebComponent, When certification type is empty, Then it displays license text", () => {
    const certification = JSON.stringify({
      viewList: [
        {
          text: "食品经营许可证",
          imgSrc: "rb/20260629/food-license.jpg",
        },
      ],
    });

    expect(
      getPayloadDisplayText(
        { certificationType: null, certification },
        ["certificationType", "certification"],
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("食品经营许可证");
  });

  test("Given media array, When reading media items, Then it preserves file paths", () => {
    expect(
      getPayloadMediaItems(
        { mainPic: ["rb/20260624/demo.jpg"] },
        "mainPic",
      ),
    ).toEqual(["rb/20260624/demo.jpg"]);
  });

  test("Given fallback fields, When first field is empty, Then it uses the next displayable value", () => {
    expect(
      getPayloadDisplayText(
        { missing: null, rbhost: { text: "天津家宴妈妈菜" } },
        ["missing", "rbhost"],
        { fieldMetadata, fieldOptions },
      ),
    ).toBe("天津家宴妈妈菜");
  });
});
