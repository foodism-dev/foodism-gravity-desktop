import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanString, entityText, isRecord, type JsonRecord } from "./utils.ts";

const DEFAULT_MAPPING_PATH = fileURLToPath(new URL("./lin_ke_mappings.json", import.meta.url));
const REQUIRED_MEAL_TYPE_FIELDS = ["productType", "name"] as const;
const REQUIRED_CLASSIFICATION_FIELDS = ["categoryId", "thirdCategoryId", "categoryName", "categoryPath"] as const;

export class ProductMappingError extends Error {
  payload: JsonRecord;

  constructor(reason: string, details: JsonRecord = {}) {
    super(reason);
    this.payload = { ok: false, stage: "product_mapping_required", reason, ...details };
  }
}

export function normalizeClassificationLabel(value: unknown): string {
  const text = entityText(value);
  if (!text) return "";
  const normalized = text
    .replace(/\s*\.\s*/g, " / ")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\s+/g, " ");
  return normalized.split(" / ").map((part) => part.trim()).filter(Boolean).join(" / ");
}

export function loadMappingFile(path = DEFAULT_MAPPING_PATH): JsonRecord {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProductMappingError("mapping_file_invalid_json", { mappingPath: path, error: error.message });
    }
    throw new ProductMappingError("mapping_file_not_found", { mappingPath: path });
  }
  validateMappingFile(data, path);
  return data;
}

export function validateMappingFile(data: unknown, mappingPath = DEFAULT_MAPPING_PATH): asserts data is JsonRecord {
  if (!isRecord(data)) {
    throw new ProductMappingError("mapping_file_must_be_object", { mappingPath });
  }
  for (const section of ["mealTypes", "classifications", "excludedClassifications"]) {
    if (!(section in data)) {
      throw new ProductMappingError("mapping_file_missing_section", { mappingPath, section });
    }
  }
  if (!isRecord(data.mealTypes)) {
    throw new ProductMappingError("mapping_file_invalid_section", { mappingPath, section: "mealTypes" });
  }
  if (!isRecord(data.classifications)) {
    throw new ProductMappingError("mapping_file_invalid_section", { mappingPath, section: "classifications" });
  }
  if (!Array.isArray(data.excludedClassifications)) {
    throw new ProductMappingError("mapping_file_invalid_section", { mappingPath, section: "excludedClassifications" });
  }

  for (const [mealType, value] of Object.entries(data.mealTypes)) {
    if (!isRecord(value)) {
      throw new ProductMappingError("mapping_file_invalid_meal_type", { mappingPath, mealType });
    }
    const missingFields = REQUIRED_MEAL_TYPE_FIELDS.filter((field) => !(field in value));
    if (missingFields.length > 0) {
      throw new ProductMappingError("mapping_file_missing_meal_type_field", { mappingPath, mealType, missingFields });
    }
  }

  for (const [classification, value] of Object.entries(data.classifications)) {
    if (!isRecord(value)) {
      throw new ProductMappingError("mapping_file_invalid_classification", { mappingPath, classification });
    }
    const missingFields = REQUIRED_CLASSIFICATION_FIELDS.filter((field) => !(field in value));
    if (missingFields.length > 0) {
      throw new ProductMappingError("mapping_file_missing_classification_field", {
        mappingPath,
        classification,
        missingFields,
      });
    }
  }
}

function mealTypeText(payload: JsonRecord): string {
  return entityText(payload.mealType || payload["mealType.text"]);
}

function classificationText(payload: JsonRecord): string {
  return entityText(payload.classification || payload["classification.text"]);
}

function isExcludedClassification(classificationKey: string, excluded: unknown): boolean {
  if (!classificationKey || !Array.isArray(excluded)) return false;
  for (const rawPrefix of excluded) {
    const prefix = normalizeClassificationLabel(rawPrefix);
    if (prefix && (classificationKey === prefix || classificationKey.startsWith(`${prefix} / `))) {
      return true;
    }
  }
  return false;
}

export function resolveLinKeMapping(payload: JsonRecord, mappingPath = DEFAULT_MAPPING_PATH): JsonRecord {
  const mapping = loadMappingFile(mappingPath);
  const mealText = mealTypeText(payload);
  if (!mealText) {
    throw new ProductMappingError("missing_meal_type", { field: "mealType" });
  }
  const mealTypes = mapping.mealTypes as JsonRecord;
  const mealMapping = mealTypes[mealText];
  if (!isRecord(mealMapping)) {
    throw new ProductMappingError("unknown_meal_type", { mealType: mealText });
  }

  const rawClassificationText = classificationText(payload);
  const classificationKey = normalizeClassificationLabel(rawClassificationText);
  if (!classificationKey) {
    throw new ProductMappingError("missing_classification", { field: "classification" });
  }
  if (isExcludedClassification(classificationKey, mapping.excludedClassifications)) {
    throw new ProductMappingError("excluded_classification", { classificationKey });
  }
  const classifications = mapping.classifications as JsonRecord;
  const classificationMapping = classifications[classificationKey];
  if (!isRecord(classificationMapping)) {
    throw new ProductMappingError("unknown_classification", { classificationKey });
  }

  return {
    productType: Number.parseInt(cleanString(mealMapping.productType), 10),
    productTypeName: cleanString(mealMapping.name),
    categoryId: cleanString(classificationMapping.categoryId),
    thirdCategoryId: cleanString(classificationMapping.thirdCategoryId),
    categoryName: cleanString(classificationMapping.categoryName),
    categoryPath: cleanString(classificationMapping.categoryPath),
    mealTypeText: mealText,
    classificationText: rawClassificationText,
    classificationKey,
  };
}
