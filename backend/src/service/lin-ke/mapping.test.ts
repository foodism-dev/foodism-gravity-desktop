import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ProductMappingError,
  loadMappingFile,
  normalizeClassificationLabel,
  resolveLinKeMapping,
} from "./mapping.ts";

function payload(mealType = "普通E", classification = "同城优享.烧烤.中式烧烤") {
  return {
    mealType: { text: mealType },
    classification: { text: classification },
  };
}

describe("Lin-Ke mapping", () => {
  test("Given mapping file, When loading, Then required sections exist", () => {
    const data = loadMappingFile();
    expect(data.mealTypes).toBeDefined();
    expect(data.classifications).toBeDefined();
    expect(data.excludedClassifications).toBeDefined();
  });

  test("Given missing classification fields, When loading mapping, Then it reports the field", () => {
    const dir = mkdtempSync(join(tmpdir(), "lin-ke-mapping-"));
    const path = join(dir, "mapping.json");
    writeFileSync(path, JSON.stringify({
      mealTypes: { 普通E: { productType: 1, name: "团购套餐" } },
      classifications: {
        "同城优享 / 烧烤 / 中式烧烤": {
          categoryId: "1004001",
          thirdCategoryId: "1004001",
          categoryName: "烧烤",
        },
      },
      excludedClassifications: [],
    }));

    try {
      expect(() => loadMappingFile(path)).toThrow(ProductMappingError);
    } catch (error) {
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Given known meal types, When resolving, Then product types match the Python behavior", () => {
    const expected = {
      普通E: 1,
      主套餐A: 1,
      常规B: 1,
      代金券C: 11,
      大单品D: 1,
      暖冬专享: 1,
    };
    for (const [mealType, productType] of Object.entries(expected)) {
      expect(resolveLinKeMapping(payload(mealType)).productType).toBe(productType);
    }
  });

  test("Given dot and slash classification text, When normalizing, Then keys match", () => {
    const dot = normalizeClassificationLabel("同城优享.火锅.川味/重庆火锅");
    const slash = normalizeClassificationLabel("同城优享 / 火锅 / 川味/重庆火锅");
    expect(dot).toBe(slash);
    const mapping = resolveLinKeMapping(payload("普通E", "同城优享.火锅.川味/重庆火锅"));
    expect(mapping.categoryId).toBe("1003002");
    expect(mapping.categoryPath).toBe("美食 > 火锅 > 川渝火锅");
  });

  test("Given excluded classification, When resolving, Then product mapping is required", () => {
    try {
      resolveLinKeMapping(payload("普通E", "同城优享.医疗健康.口腔"));
      throw new Error("expected mapping error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductMappingError);
      expect((error as ProductMappingError).payload.reason).toBe("excluded_classification");
    }
  });
});
