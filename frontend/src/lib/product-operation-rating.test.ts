import { describe, expect, test } from "bun:test";

import {
  buildEmptyProductOperationRatingScores,
  buildProductOperationRating,
  getProductOperationRating,
  PRODUCT_OPERATION_RATING_FIELDS,
  PRODUCT_OPERATION_RATING_GRADE_RULES,
} from "./product-operation-rating.ts";

describe("商品运营评级", () => {
  test("Given empty scores, When building defaults, Then every rating item starts from zero", () => {
    const scores = buildEmptyProductOperationRatingScores();

    expect(Object.values(scores.merchantScores).every((score) => score === 0)).toBe(true);
    expect(Object.values(scores.productScores).every((score) => score === 0)).toBe(true);
  });

  test("Given merchant and product scores, When building rating result, Then total and grade follow the central rating thresholds", () => {
    const result = buildProductOperationRating({
      merchantScores: {
        monthlyRevenue: 0,
        platformRating: 0.5,
        chainOrRanking: 0.5,
        location: 0.3,
        storeQuality: 0.5,
      },
      productScores: {
        price: 1,
        discount: 0.5,
        packageMatch: 2,
        settlement: 0.5,
        valueForMoney: 0.8,
        seasonalFeature: 0.5,
      },
    }, "2026-06-29T10:00:00.000Z");

    expect(result.totalScore).toBe(7.1);
    expect(result.rating).toBe("B");
    expect(result.savedAt).toBe("2026-06-29T10:00:00.000Z");
  });

  test("Given score totals near boundaries, When calculating grade, Then each threshold matches the template", () => {
    expect(getProductOperationRating(5.99)).toBe("C-");
    expect(getProductOperationRating(6)).toBe("C");
    expect(getProductOperationRating(7)).toBe("B");
    expect(getProductOperationRating(8)).toBe("A");
    expect(getProductOperationRating(8.6)).toBe("S");
  });

  test("Given rating field definitions, When rendering a form, Then merchant and product groups match the template dimensions", () => {
    expect(PRODUCT_OPERATION_RATING_FIELDS.merchant.map((field) => field.key)).toEqual([
      "monthlyRevenue",
      "platformRating",
      "chainOrRanking",
      "location",
      "storeQuality",
    ]);
    expect(PRODUCT_OPERATION_RATING_FIELDS.product.map((field) => field.key)).toEqual([
      "price",
      "discount",
      "packageMatch",
      "settlement",
      "valueForMoney",
      "seasonalFeature",
    ]);
  });

  test("Given rating field definitions, When help is opened, Then each item exposes detailed scoring rules", () => {
    const monthlyRevenue = PRODUCT_OPERATION_RATING_FIELDS.merchant.find((field) => field.key === "monthlyRevenue");
    const packageMatch = PRODUCT_OPERATION_RATING_FIELDS.product.find((field) => field.key === "packageMatch");

    expect(monthlyRevenue?.details).toContain("≥2万：0.3分");
    expect(monthlyRevenue?.details).toContain("≥5万：0.5分");
    expect(packageMatch?.details).toContain("套餐性价比，补充细节（荤素比例、风格一致）：0.5分");
    expect(packageMatch?.details).toContain("内容细则（菜品质量高、菜品丰富、含招牌菜）：2分");
    expect(PRODUCT_OPERATION_RATING_FIELDS.merchant.every((field) => field.details.length > 0)).toBe(true);
    expect(PRODUCT_OPERATION_RATING_FIELDS.product.every((field) => field.details.length > 0)).toBe(true);
  });

  test("Given total score rules, When rendering final grade help, Then thresholds are available for display", () => {
    expect(PRODUCT_OPERATION_RATING_GRADE_RULES).toEqual([
      { label: "C-", description: "总分 < 6" },
      { label: "C", description: "6 ≤ 总分 < 7" },
      { label: "B", description: "7 ≤ 总分 < 8" },
      { label: "A", description: "8 ≤ 总分 < 8.6" },
      { label: "S", description: "总分 ≥ 8.6" },
    ]);
  });
});
