import { describe, expect, test } from "bun:test";

import { parseRecPersonText } from "./draft.ts";
import { buildWorkbenchDraftUrl } from "./service.ts";
import {
  applyMenuOptimization,
  extractMenuForOptimization,
  normalizeSupplyGoodsForLinKe,
} from "./supply-goods.ts";

function samplePayload() {
  return {
    SupplyGoodsId: "944-test",
    bdCity: { text: "合肥市" },
    hostName: "李小二",
    goodsName: "[李小二]3-4人餐",
    price: "78.00",
    originPrice: "259.00",
    signAmount: "5,000",
    mainPic: ["https://example.com/main.jpg"],
    detailImages: ["rb/20260624/detail.jpg"],
    packages: JSON.stringify({
      viewList: [
        {
          groupName: "主菜",
          groupSelectNum: "1",
          groupId: 0,
          groupPrice: "88.00",
          list: [{ price: "88.00", num: "1", id: 0, title: "蟹" }],
        },
      ],
      totalPrice: "88.00",
    }),
  };
}

describe("Lin-Ke SupplyGoods normalization", () => {
  test("Given model output, When applying menu optimization, Then only allowed names change", () => {
    const original = samplePayload();
    const { payload, changes } = applyMenuOptimization(original, {
      groups: [{ index: 0, groupName: "招牌主菜", items: [{ index: 0, title: "鲜活大闸蟹", price: "1.00" }] }],
    });

    expect(typeof payload.packages).toBe("string");
    const packages = JSON.parse(payload.packages as string);
    expect(packages.viewList[0].groupName).toBe("招牌主菜");
    expect(packages.viewList[0].list[0].title).toBe("鲜活大闸蟹");
    expect(packages.viewList[0].list[0].price).toBe("88.00");
    expect(changes).toHaveLength(2);
    expect(payload.goodsName).toBe(original.goodsName);
  });

  test("Given partial model output, When applying menu optimization, Then untouched items remain unchanged", () => {
    const original = {
      ...samplePayload(),
      packages: JSON.stringify({
        viewList: [
          {
            groupName: "主菜",
            groupSelectNum: "1",
            groupId: 0,
            groupPrice: "128.00",
            list: [
              { price: "88.00", num: "1", id: 0, title: "蟹" },
              { price: "40.00", num: "1", id: 1, title: "虾" },
            ],
          },
        ],
        totalPrice: "128.00",
      }),
    };
    const { payload, changes } = applyMenuOptimization(original, {
      groups: [{ index: 0, groupName: "招牌主菜", items: [{ index: 0, title: "鲜活大闸蟹" }] }],
    });

    const packages = JSON.parse(payload.packages as string);
    expect(packages.viewList[0].groupName).toBe("招牌主菜");
    expect(packages.viewList[0].list[0].title).toBe("鲜活大闸蟹");
    expect(packages.viewList[0].list[1].title).toBe("虾");
    expect(packages.viewList[0].list[1].price).toBe("40.00");
    expect(changes).toHaveLength(2);
  });

  test("Given malformed packages, When optimizing, Then payload is unchanged", () => {
    const original = { ...samplePayload(), packages: "{bad json" };
    expect(extractMenuForOptimization(original)).toEqual([]);
    const { payload, changes } = applyMenuOptimization(original, {
      groups: [{ index: 0, groupName: "不会应用", items: [{ index: 0, title: "不会应用" }] }],
    });
    expect(payload).toEqual(original);
    expect(changes).toEqual([]);
  });

  test("Given mapping, When normalizing for Lin-Ke, Then mapped category and images are used", () => {
    const product = normalizeSupplyGoodsForLinKe(samplePayload(), {
      categoryId: "1004001",
      thirdCategoryId: "1004001",
      categoryName: "烧烤",
      categoryPath: "美食 > 烧烤 > 烧烤",
      productType: 1,
      mealTypeText: "普通E",
      classificationKey: "同城优享 / 烧烤 / 中式烧烤",
    }, "https://assets.example/");

    expect((product.category as Record<string, unknown>).id).toBe("1004001");
    expect(product.productType).toBe(1);
    expect((product.fieldSources as Record<string, unknown>).linKeCategory).toBe("同城优享 / 烧烤 / 中式烧烤");
    expect(((product.itemGroups as any[])[0].items[0] as Record<string, unknown>).name).toBe("蟹");
    expect(((product.detailImages as any[])[0] as Record<string, unknown>).url).toBe("https://assets.example/rb/20260624/detail.jpg");
  });

  test("Given workbench context, When building draft URL, Then key query parameters are present", () => {
    const url = buildWorkbenchDraftUrl(
      { group_id: "1868051999515656" },
      {
        productType: 11,
        thirdCategoryId: "1003002",
        merchant: { merchantId: "7651539009109526564", skuOrderId: "7654505757261776948" },
      },
      "1868864068281379",
    );
    expect(url).toContain("/op-merchant/workbench/subapp/goods-list/form-type?");
    expect(url).toContain("product_draft_cache_id=1868864068281379");
    expect(url).toContain("merchantId=7651539009109526564");
    expect(url).toContain("sku_order_id=7654505757261776948");
    expect(url).toContain("product_type=11");
    expect(url).toContain("third_category_id=1003002");
  });

  test("Given Chinese person count text, When parsing, Then supported ranges are returned", () => {
    expect(parseRecPersonText("双人66元乳山生蚝自助")).toEqual([2, 2]);
    expect(parseRecPersonText("两人餐")).toEqual([2, 2]);
    expect(parseRecPersonText("三至四人套餐")).toEqual([3, 4]);
    expect(parseRecPersonText("10-12人聚餐")).toEqual([10, 12]);
  });
});
