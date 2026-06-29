import { describe, expect, test } from "bun:test";

import {
  buildEmptyProductOperationRatingScores,
  buildProductOperationRating,
  getProductOperationRating,
  PRODUCT_OPERATION_RATING_FIELDS,
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
});
