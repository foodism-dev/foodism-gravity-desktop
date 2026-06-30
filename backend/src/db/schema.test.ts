import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";

import {
  rebuildFieldOptions,
  rebuildFields,
  rebuildSupplyCompany,
  rebuildSupplyGoods,
  rebuildSupplyGoodsCallbackRecords,
  linKeAccountConfigs,
  tickets,
} from "./schema.ts";

describe("数据库 schema", () => {
  test("SupplyGoods 落库表使用业务命名与 supply_goods_id 唯一键", () => {
    expect(getTableName(rebuildSupplyGoods)).toBe("rebuild_supply_goods");
    expect(rebuildSupplyGoods.supplyGoodsId.name).toBe("supply_goods_id");
    expect("syncedAt" in rebuildSupplyGoods).toBe(false);
    expect("linKeProductType" in rebuildSupplyGoods).toBe(false);
    expect("linKeCategoryId" in rebuildSupplyGoods).toBe(false);
    expect("linKeThirdCategoryId" in rebuildSupplyGoods).toBe(false);
    expect("linKeCategoryName" in rebuildSupplyGoods).toBe(false);
    expect("linKeCategoryPath" in rebuildSupplyGoods).toBe(false);
  });

  test("SupplyCompany 落库表使用业务命名与 supply_company_id 唯一键", () => {
    expect(getTableName(rebuildSupplyCompany)).toBe("rebuild_supply_company");
    expect(rebuildSupplyCompany.supplyCompanyId.name).toBe("supply_company_id");
    expect(rebuildSupplyCompany.payload.name).toBe("payload");
  });

  test("SupplyGoods callback 记录表保存原始、查询和标准化 payload", () => {
    expect(getTableName(rebuildSupplyGoodsCallbackRecords)).toBe("rebuild_supply_goods_callback_records");
    expect(rebuildSupplyGoodsCallbackRecords.rawPayload.name).toBe("raw_payload");
    expect(rebuildSupplyGoodsCallbackRecords.payload.name).toBe("payload");
    expect(rebuildSupplyGoodsCallbackRecords.normalizedPayload.name).toBe("normalized_payload");
  });

  test("工单表关联 SupplyGoods 业务 ID 并保存整体状态和业务状态", () => {
    expect(getTableName(tickets)).toBe("tickets");
    expect(tickets.supplyGoodsId.name).toBe("supply_goods_id");
    expect(tickets.status.name).toBe("status");
    expect(tickets.businessStatus.name).toBe("business_status");
    expect(tickets.payload.name).toBe("payload");
  });

  test("REBUILD 字段元数据表按实体和字段存储定义与选项", () => {
    expect(getTableName(rebuildFields)).toBe("rebuild_fields");
    expect(rebuildFields.entityName.name).toBe("entity_name");
    expect(rebuildFields.fieldName.name).toBe("field_name");
    expect(rebuildFields.raw.name).toBe("raw");

    expect(getTableName(rebuildFieldOptions)).toBe("rebuild_field_options");
    expect(rebuildFieldOptions.optionValue.name).toBe("option_value");
    expect(rebuildFieldOptions.optionLabel.name).toBe("option_label");
  });

  test("林客账号配置表直接保存 cookie 内容", () => {
    expect(getTableName(linKeAccountConfigs)).toBe("lin_ke_account_configs");
    expect(linKeAccountConfigs.cookie.name).toBe("cookie");
    expect("cookieFilePath" in linKeAccountConfigs).toBe(false);
  });
});
