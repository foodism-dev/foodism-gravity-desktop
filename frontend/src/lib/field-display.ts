export interface TicketFieldOption {
  value: string;
  label: string;
  sortOrder: number | null;
  isDefault: boolean;
}

export interface TicketFieldMetadata {
  label: string;
  fieldType: string;
}

export type TicketFieldOptionsMap = Record<string, TicketFieldOption[]>;
export type TicketFieldMetadataMap = Record<string, TicketFieldMetadata>;

export interface FieldDisplayContext {
  fieldMetadata: TicketFieldMetadataMap;
  fieldOptions: TicketFieldOptionsMap;
}

interface PackageGroup {
  groupName?: unknown;
  groupSelectNum?: unknown;
  groupPrice?: unknown;
  list?: unknown;
}

interface PackageItem {
  title?: unknown;
  num?: unknown;
  price?: unknown;
}

export function getPayloadValue(payload: Record<string, unknown>, field: string): unknown {
  if (field in payload) return payload[field];
  return field.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, payload);
}

export function formatPayloadValue(value: unknown, field: string, context: FieldDisplayContext): string {
  if (value === null || value === undefined) return "";

  const normalizedField = normalizeFieldName(field);
  const fieldType = context.fieldMetadata[normalizedField]?.fieldType.toUpperCase() ?? "";
  const rawText = readTextValue(value, normalizedField, context);
  if (!rawText) return "";

  if (fieldType === "BOOL") return formatBoolean(rawText);
  if (fieldType === "DATE") return formatDate(rawText);
  if (fieldType === "DATETIME") return formatDateTime(rawText);
  if (fieldType === "DECIMAL") return formatDecimal(rawText);
  if (fieldType === "NUMBER") return formatNumber(rawText);
  if (fieldType === "WEBCOMPONENT") return formatWebComponent(rawText);

  return rawText;
}

export function getPayloadDisplayText(
  payload: Record<string, unknown>,
  fields: string[],
  context: FieldDisplayContext,
): string {
  for (const field of fields) {
    const text = formatPayloadValue(getPayloadValue(payload, field), field, context);
    if (text) return text;
  }
  return "";
}

export function getPayloadMediaItems(payload: Record<string, unknown>, ...fields: string[]): string[] {
  for (const field of fields) {
    const value = getPayloadValue(payload, field);
    const items = toMediaItems(value);
    if (items.length > 0) return items;
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFieldName(field: string): string {
  return field.endsWith(".text") ? field.slice(0, -5) : field;
}

function readTextValue(value: unknown, field: string, context: FieldDisplayContext): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => readTextValue(item, field, context))
      .filter((item) => item.length > 0)
      .join("、");
  }

  if (isRecord(value)) {
    const text = value.text;
    if (isRecord(text) && Array.isArray(text.text)) {
      return text.text
        .map((item) => {
          const rawText = String(item).trim();
          return resolveOptionLabel(field, rawText, context.fieldOptions) ?? rawText;
        })
        .filter(Boolean)
        .join("、");
    }
    if (Array.isArray(text)) {
      return text
        .map((item) => {
          const rawText = String(item).trim();
          return resolveOptionLabel(field, rawText, context.fieldOptions) ?? rawText;
        })
        .filter(Boolean)
        .join("、");
    }
    if (text !== null && text !== undefined) {
      const rawText = String(text).trim();
      return resolveOptionLabel(field, rawText, context.fieldOptions) ?? rawText;
    }
    const rawValue = value.value;
    if (rawValue !== null && rawValue !== undefined) {
      return resolveOptionLabel(field, String(rawValue).trim(), context.fieldOptions) ?? String(rawValue).trim();
    }
    return "";
  }

  const rawText = String(value).trim();
  return resolveOptionLabel(field, rawText, context.fieldOptions) ?? rawText;
}

function resolveOptionLabel(field: string, rawText: string, fieldOptions: TicketFieldOptionsMap): string | null {
  const options = fieldOptions[field];
  if (!options) return null;
  return options.find((option) => option.value === rawText)?.label ?? null;
}

function formatBoolean(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["t", "true", "1", "y", "yes", "是"].includes(normalized)) return "是";
  if (["f", "false", "0", "n", "no", "否"].includes(normalized)) return "否";
  return value;
}

function formatDecimal(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toFixed(2);
}

function formatNumber(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatWebComponent(value: string): string {
  const parsed = parseJsonRecord(value);
  if (!parsed) return value;
  if (Array.isArray(parsed.viewList)) {
    const lines = parsed.viewList.flatMap((group) => formatPackageGroup(group));
    const totalPrice = parsed.totalPrice === undefined ? "" : `合计原价：${String(parsed.totalPrice)}`;
    return [...lines, totalPrice].filter(Boolean).join("\n");
  }
  return value;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatPackageGroup(group: unknown): string[] {
  if (!isRecord(group)) return [];
  const packageGroup = group as PackageGroup;
  const header = [
    String(packageGroup.groupName ?? "").trim(),
    packageGroup.groupSelectNum === undefined ? "" : `任选 ${String(packageGroup.groupSelectNum)}`,
    packageGroup.groupPrice === undefined ? "" : `原价 ${String(packageGroup.groupPrice)}`,
  ].filter(Boolean).join(" · ");

  const items = Array.isArray(packageGroup.list)
    ? packageGroup.list.map((item) => formatPackageItem(item)).filter(Boolean)
    : [];
  return [header, ...items.map((item) => `  - ${item}`)].filter(Boolean);
}

function formatPackageItem(item: unknown): string {
  if (!isRecord(item)) return "";
  const packageItem = item as PackageItem;
  const title = String(packageItem.title ?? "").trim();
  if (!title) return "";
  const num = packageItem.num === undefined ? "" : ` x${String(packageItem.num)}`;
  const price = packageItem.price === undefined ? "" : ` (${String(packageItem.price)})`;
  return `${title}${num}${price}`;
}

function toMediaItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(toMediaItems);
  }
  if (isRecord(value)) {
    const url = value.url ?? value.path ?? value.file ?? value.name;
    return typeof url === "string" && url.trim() ? [url.trim()] : [];
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}
