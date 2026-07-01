import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "../../db/client.ts";
import { rebuildFieldOptions, rebuildFields } from "../../db/schema.ts";
import { buildRebuildOpenApiUrl, readJsonResponse } from "./openapi.ts";
import { SUPPLY_COMPANY_ENTITY, SUPPLY_GOODS_ENTITY, SUPPLY_HOST_ENTITY } from "./supplygoods.ts";

export interface RebuildFieldMetadata {
  entityName: string;
  fieldName: string;
  label: string;
  fieldType: string;
  raw: Record<string, unknown>;
}

export interface RebuildFieldOptionMetadata {
  entityName: string;
  fieldName: string;
  optionValue: string;
  optionLabel: string;
  sortOrder: number | null;
  isDefault: boolean;
  raw: Record<string, unknown>;
}

export interface RebuildFieldMetadataRepository {
  upsertFields: (fields: RebuildFieldMetadata[], updatedAt: Date) => Promise<void>;
  upsertFieldOptions: (options: RebuildFieldOptionMetadata[], updatedAt: Date) => Promise<void>;
  listFieldsByEntity: (entityName: string) => Promise<RebuildFieldMetadata[]>;
  listFields: (entityName: string, fieldNames: string[]) => Promise<RebuildFieldMetadata[]>;
  listFieldOptions: (entityName: string, fieldName: string) => Promise<RebuildFieldOptionMetadata[]>;
}

export interface RebuildMetadataClient {
  listFields: (entityName: string) => Promise<RebuildFieldMetadata[]>;
  listPicklistOptions: (entityName: string, fieldName: string) => Promise<RebuildFieldOptionMetadata[]>;
  listMultiselectOptions: (entityName: string, fieldName: string) => Promise<RebuildFieldOptionMetadata[]>;
  listClassificationOptions: (entityName: string, fieldName: string) => Promise<RebuildFieldOptionMetadata[]>;
}

export interface RebuildMetadataSyncResult {
  entityName: string;
  fieldCount: number;
  optionCount: number;
  updatedAt: Date;
}

const SUPPLY_GOODS_PICKLIST_FIELDS = [
  "showChannel",
  "mealType",
  "supplyTpChannel",
  "settleType",
  "reservationRule",
  "acceptGroup",
  "timeUnit",
  "useDate",
  "isCrossDay",
  "isLimitSexNew",
  "isLimitHairNew",
  "selfRatingNew",
  "auditStatus",
  "channelLimit",
];

const SUPPLY_GOODS_MULTISELECT_FIELDS = [
  "rejectOptions",
];

const SUPPLY_GOODS_CLASSIFICATION_FIELDS = [
  "classification",
];

const SUPPLY_COMPANY_PICKLIST_FIELDS: string[] = [];
const SUPPLY_COMPANY_MULTISELECT_FIELDS: string[] = [];
const SUPPLY_COMPANY_CLASSIFICATION_FIELDS: string[] = [];
const SUPPLY_HOST_PICKLIST_FIELDS: string[] = [];
const SUPPLY_HOST_MULTISELECT_FIELDS: string[] = [];
const SUPPLY_HOST_CLASSIFICATION_FIELDS: string[] = [];

let defaultRepository: RebuildFieldMetadataRepository | null | undefined;
const FIELD_OPTION_UPSERT_BATCH_SIZE = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value === "true" || value === "1";
  }
  return false;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeField(entityName: string, raw: unknown): RebuildFieldMetadata | null {
  if (!isRecord(raw)) return null;
  const fieldName = readString(raw, ["name", "fieldName", "field", "key"]);
  if (!fieldName) return null;

  return {
    entityName,
    fieldName,
    label: readString(raw, ["label", "labelName", "text", "title", "name"]) || fieldName,
    fieldType: readString(raw, ["displayType", "type", "typeName", "fieldType"]) || "unknown",
    raw,
  };
}

function normalizeOption(
  entityName: string,
  fieldName: string,
  raw: unknown,
  index: number,
): RebuildFieldOptionMetadata | null {
  if (!isRecord(raw)) return null;
  const optionValue = readString(raw, ["id", "value", "itemId", "key", "mask", "text"]);
  if (!optionValue) return null;
  return {
    entityName,
    fieldName,
    optionValue,
    optionLabel: readString(raw, ["text", "label", "name", "value"]) || optionValue,
    sortOrder: readNumber(raw, ["seq", "sort", "sortOrder"]) ?? index,
    isDefault: readBoolean(raw, ["default", "isDefault"]),
    raw,
  };
}

function normalizeClassificationOptions(
  entityName: string,
  fieldName: string,
  data: unknown,
): RebuildFieldOptionMetadata[] {
  if (!Array.isArray(data)) return [];

  const options: RebuildFieldOptionMetadata[] = [];
  let sortOrder = 0;

  function walk(items: unknown[], parentLabels: string[]): void {
    for (const item of items) {
      if (!isRecord(item)) continue;
      const optionValue = readString(item, ["id", "value", "itemId", "key"]);
      if (!optionValue) continue;
      const label = readString(item, ["text", "label", "name", "value"]) || optionValue;
      const labels = [...parentLabels, label];
      options.push({
        entityName,
        fieldName,
        optionValue,
        optionLabel: labels.join(" / "),
        sortOrder,
        isDefault: false,
        raw: {
          ...item,
          path: labels,
        },
      });
      sortOrder += 1;

      const children = item.children;
      if (Array.isArray(children)) {
        walk(children, labels);
      }
    }
  }

  walk(data, []);
  return options;
}

function readInlineOptions(entityName: string, field: RebuildFieldMetadata): RebuildFieldOptionMetadata[] {
  const options = field.raw.options;
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => normalizeOption(entityName, field.fieldName, option, index))
    .filter((option): option is RebuildFieldOptionMetadata => option !== null);
}

export function normalizeRebuildFieldList(entityName: string, data: unknown): {
  fields: RebuildFieldMetadata[];
  options: RebuildFieldOptionMetadata[];
} {
  const rawFields = Array.isArray(data) ? data : [];
  const fields = rawFields
    .map((item) => normalizeField(entityName, item))
    .filter((field): field is RebuildFieldMetadata => field !== null);
  return {
    fields,
    options: fields.flatMap((field) => readInlineOptions(entityName, field)),
  };
}

export function normalizeRebuildFieldOptions(
  entityName: string,
  fieldName: string,
  data: unknown,
): RebuildFieldOptionMetadata[] {
  const rawOptions = Array.isArray(data) ? data : [];
  return rawOptions
    .map((item, index) => normalizeOption(entityName, fieldName, item, index))
    .filter((option): option is RebuildFieldOptionMetadata => option !== null);
}

export function normalizeRebuildClassificationOptions(
  entityName: string,
  fieldName: string,
  data: unknown,
): RebuildFieldOptionMetadata[] {
  return normalizeClassificationOptions(entityName, fieldName, data);
}

export function createRebuildMetadataClient(): RebuildMetadataClient {
  return {
    async listFields(entityName: string): Promise<RebuildFieldMetadata[]> {
      const url = buildRebuildOpenApiUrl("metadata/fields", { entity: entityName });
      console.log(`[REBUILD] 同步字段定义: ${entityName}`);
      const result = await readJsonResponse<unknown>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      return normalizeRebuildFieldList(entityName, result.data).fields;
    },

    async listPicklistOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
      const url = buildRebuildOpenApiUrl("metadata/picklist-data", { entity: entityName, field: fieldName });
      console.log(`[REBUILD] 同步下拉字段选项: ${entityName}.${fieldName}`);
      const result = await readJsonResponse<unknown>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      return normalizeRebuildFieldOptions(entityName, fieldName, result.data);
    },

    async listMultiselectOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
      const url = buildRebuildOpenApiUrl("metadata/multiselect-data", { entity: entityName, field: fieldName });
      console.log(`[REBUILD] 同步多选字段选项: ${entityName}.${fieldName}`);
      const result = await readJsonResponse<unknown>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      return normalizeRebuildFieldOptions(entityName, fieldName, result.data);
    },

    async listClassificationOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
      const url = buildRebuildOpenApiUrl("metadata/classification-data", { entity: entityName, field: fieldName });
      console.log(`[REBUILD] 同步分类字段选项: ${entityName}.${fieldName}`);
      const result = await readJsonResponse<unknown>(await fetch(url));
      if (result.error_code !== 0) {
        throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`);
      }
      return normalizeRebuildClassificationOptions(entityName, fieldName, result.data);
    },
  };
}

export function createDrizzleRebuildFieldMetadataRepository(db: ServerDatabase): RebuildFieldMetadataRepository {
  return {
    async upsertFields(fields: RebuildFieldMetadata[], updatedAt: Date): Promise<void> {
      if (fields.length === 0) return;
      await db
        .insert(rebuildFields)
        .values(fields.map((field) => ({ ...field, updatedAt })))
        .onConflictDoUpdate({
          target: [rebuildFields.entityName, rebuildFields.fieldName],
          set: {
            label: sqlExcluded("label"),
            fieldType: sqlExcluded("field_type"),
            raw: sqlExcluded("raw"),
            updatedAt,
          },
        });
    },

    async upsertFieldOptions(options: RebuildFieldOptionMetadata[], updatedAt: Date): Promise<void> {
      if (options.length === 0) return;
      for (const batch of chunkArray(options, FIELD_OPTION_UPSERT_BATCH_SIZE)) {
        await db
          .insert(rebuildFieldOptions)
          .values(batch.map((option) => ({ ...option, updatedAt })))
          .onConflictDoUpdate({
            target: [rebuildFieldOptions.entityName, rebuildFieldOptions.fieldName, rebuildFieldOptions.optionValue],
            set: {
              optionLabel: sqlExcluded("option_label"),
              sortOrder: sqlExcluded("sort_order"),
              isDefault: sqlExcluded("is_default"),
              raw: sqlExcluded("raw"),
              updatedAt,
            },
          });
      }
    },

    async listFields(entityName: string, fieldNames: string[]): Promise<RebuildFieldMetadata[]> {
      if (fieldNames.length === 0) return [];
      return db
        .select({
          entityName: rebuildFields.entityName,
          fieldName: rebuildFields.fieldName,
          label: rebuildFields.label,
          fieldType: rebuildFields.fieldType,
          raw: rebuildFields.raw,
        })
        .from(rebuildFields)
        .where(and(eq(rebuildFields.entityName, entityName), inArray(rebuildFields.fieldName, fieldNames)))
        .orderBy(asc(rebuildFields.fieldName));
    },

    async listFieldsByEntity(entityName: string): Promise<RebuildFieldMetadata[]> {
      return db
        .select({
          entityName: rebuildFields.entityName,
          fieldName: rebuildFields.fieldName,
          label: rebuildFields.label,
          fieldType: rebuildFields.fieldType,
          raw: rebuildFields.raw,
        })
        .from(rebuildFields)
        .where(eq(rebuildFields.entityName, entityName))
        .orderBy(asc(rebuildFields.fieldName));
    },

    async listFieldOptions(entityName: string, fieldName: string): Promise<RebuildFieldOptionMetadata[]> {
      return db
        .select({
          entityName: rebuildFieldOptions.entityName,
          fieldName: rebuildFieldOptions.fieldName,
          optionValue: rebuildFieldOptions.optionValue,
          optionLabel: rebuildFieldOptions.optionLabel,
          sortOrder: rebuildFieldOptions.sortOrder,
          isDefault: rebuildFieldOptions.isDefault,
          raw: rebuildFieldOptions.raw,
        })
        .from(rebuildFieldOptions)
        .where(and(eq(rebuildFieldOptions.entityName, entityName), eq(rebuildFieldOptions.fieldName, fieldName)))
        .orderBy(asc(rebuildFieldOptions.sortOrder), asc(rebuildFieldOptions.optionLabel));
    },
  };
}

function sqlExcluded(columnName: string) {
  return sql.raw(`excluded.${columnName}`);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function getDefaultRebuildFieldMetadataRepository(): RebuildFieldMetadataRepository | null {
  if (defaultRepository !== undefined) {
    return defaultRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，REBUILD 字段元数据不会写入数据库");
    defaultRepository = null;
    return defaultRepository;
  }

  defaultRepository = createDrizzleRebuildFieldMetadataRepository(createDatabase(databaseUrl));
  return defaultRepository;
}

export async function syncSupplyGoodsFieldMetadata(input: {
  metadataClient: RebuildMetadataClient;
  repository: RebuildFieldMetadataRepository;
}): Promise<RebuildMetadataSyncResult> {
  return syncRebuildFieldMetadata({
    ...input,
    entityName: SUPPLY_GOODS_ENTITY,
    picklistFields: SUPPLY_GOODS_PICKLIST_FIELDS,
    multiselectFields: SUPPLY_GOODS_MULTISELECT_FIELDS,
    classificationFields: SUPPLY_GOODS_CLASSIFICATION_FIELDS,
  });
}

export async function syncSupplyCompanyFieldMetadata(input: {
  metadataClient: RebuildMetadataClient;
  repository: RebuildFieldMetadataRepository;
}): Promise<RebuildMetadataSyncResult> {
  return syncRebuildFieldMetadata({
    ...input,
    entityName: SUPPLY_COMPANY_ENTITY,
    picklistFields: SUPPLY_COMPANY_PICKLIST_FIELDS,
    multiselectFields: SUPPLY_COMPANY_MULTISELECT_FIELDS,
    classificationFields: SUPPLY_COMPANY_CLASSIFICATION_FIELDS,
  });
}

export async function syncSupplyHostFieldMetadata(input: {
  metadataClient: RebuildMetadataClient;
  repository: RebuildFieldMetadataRepository;
}): Promise<RebuildMetadataSyncResult> {
  return syncRebuildFieldMetadata({
    ...input,
    entityName: SUPPLY_HOST_ENTITY,
    picklistFields: SUPPLY_HOST_PICKLIST_FIELDS,
    multiselectFields: SUPPLY_HOST_MULTISELECT_FIELDS,
    classificationFields: SUPPLY_HOST_CLASSIFICATION_FIELDS,
  });
}

export async function syncRebuildFieldMetadata(input: {
  entityName: string;
  metadataClient: RebuildMetadataClient;
  repository: RebuildFieldMetadataRepository;
  picklistFields?: string[];
  multiselectFields?: string[];
  classificationFields?: string[];
}): Promise<RebuildMetadataSyncResult> {
  const updatedAt = new Date();
  const fields = await input.metadataClient.listFields(input.entityName);
  await input.repository.upsertFields(fields, updatedAt);

  const inlineOptions = fields.flatMap((field) => readInlineOptions(input.entityName, field));
  const explicitOptions: RebuildFieldOptionMetadata[] = [];
  const detectedFields = detectOptionFields(fields);
  await appendExplicitOptions({
    entityName: input.entityName,
    fieldNames: mergeFieldNames(input.picklistFields ?? [], detectedFields.picklist),
    optionTypeName: "下拉",
    fetchOptions: (fieldName) => input.metadataClient.listPicklistOptions(input.entityName, fieldName),
    into: explicitOptions,
  });
  await appendExplicitOptions({
    entityName: input.entityName,
    fieldNames: mergeFieldNames(input.multiselectFields ?? [], detectedFields.multiselect),
    optionTypeName: "多选",
    fetchOptions: (fieldName) => input.metadataClient.listMultiselectOptions(input.entityName, fieldName),
    into: explicitOptions,
  });
  await appendExplicitOptions({
    entityName: input.entityName,
    fieldNames: mergeFieldNames(input.classificationFields ?? [], detectedFields.classification),
    optionTypeName: "分类",
    fetchOptions: (fieldName) => input.metadataClient.listClassificationOptions(input.entityName, fieldName),
    into: explicitOptions,
  });

  const mergedOptions = dedupeOptions([...inlineOptions, ...explicitOptions]);
  await input.repository.upsertFieldOptions(mergedOptions, updatedAt);

  return {
    entityName: input.entityName,
    fieldCount: fields.length,
    optionCount: mergedOptions.length,
    updatedAt,
  };
}

export function getSupplyGoodsOptionFieldNames(fields?: RebuildFieldMetadata[]): string[] {
  if (fields) {
    const detectedFields = detectOptionFields(fields);
    return mergeFieldNames(detectedFields.picklist, detectedFields.multiselect, detectedFields.classification);
  }

  return mergeFieldNames(
    SUPPLY_GOODS_PICKLIST_FIELDS,
    SUPPLY_GOODS_MULTISELECT_FIELDS,
    SUPPLY_GOODS_CLASSIFICATION_FIELDS,
  );
}

function dedupeOptions(options: RebuildFieldOptionMetadata[]): RebuildFieldOptionMetadata[] {
  const map = new Map<string, RebuildFieldOptionMetadata>();
  for (const option of options) {
    map.set(`${option.entityName}:${option.fieldName}:${option.optionValue}`, option);
  }
  return [...map.values()];
}

function detectOptionFields(fields: RebuildFieldMetadata[]): {
  picklist: string[];
  multiselect: string[];
  classification: string[];
} {
  const picklist: string[] = [];
  const multiselect: string[] = [];
  const classification: string[] = [];

  for (const field of fields) {
    const signature = [
      field.fieldType,
      readString(field.raw, ["displayType", "type", "typeName", "fieldType"]),
    ].join(" ").toLowerCase();
    if (signature.includes("classification") || signature.includes("分类")) {
      classification.push(field.fieldName);
    } else if (signature.includes("multiselect") || signature.includes("multi-select") || signature.includes("多选")) {
      multiselect.push(field.fieldName);
    } else if (signature.includes("picklist") || signature.includes("选项") || signature.includes("下拉")) {
      picklist.push(field.fieldName);
    }
  }

  return { picklist, multiselect, classification };
}

function mergeFieldNames(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((fieldName) => fieldName.trim().length > 0))];
}

async function appendExplicitOptions(input: {
  entityName: string;
  fieldNames: string[];
  optionTypeName: string;
  fetchOptions: (fieldName: string) => Promise<RebuildFieldOptionMetadata[]>;
  into: RebuildFieldOptionMetadata[];
}): Promise<void> {
  for (const fieldName of input.fieldNames) {
    try {
      input.into.push(...await input.fetchOptions(fieldName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[REBUILD] ${input.optionTypeName}字段选项同步跳过 ${input.entityName}.${fieldName}: ${message}`);
    }
  }
}
