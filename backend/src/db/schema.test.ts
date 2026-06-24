import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";

import { rebuildFieldOptions, rebuildFields, rebuildSupplyGoods, tickets } from "./schema.ts";

describe("数据库 schema", () => {
  test("SupplyGoods 落库表使用业务命名与 supply_goods_id 唯一键", () => {
    expect(getTableName(rebuildSupplyGoods)).toBe("rebuild_supply_goods");
    expect(rebuildSupplyGoods.supplyGoodsId.name).toBe("supply_goods_id");
    expect(rebuildSupplyGoods.assets.name).toBe("assets");
    expect("syncedAt" in rebuildSupplyGoods).toBe(false);
  });

  test("工单表关联 SupplyGoods 业务 ID 并保存审核状态", () => {
    expect(getTableName(tickets)).toBe("tickets");
    expect(tickets.supplyGoodsId.name).toBe("supply_goods_id");
    expect(tickets.approvalState.name).toBe("approval_state");
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
});
