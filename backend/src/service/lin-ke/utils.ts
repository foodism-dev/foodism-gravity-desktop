export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function entityText(value: unknown): string {
  if (isRecord(value)) {
    return cleanString(value.text);
  }
  return cleanString(value);
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replaceAll(",", "");
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const number = parseNumber(value);
  return number === null ? null : Math.trunc(number);
}

export function positiveNumber(value: unknown): boolean {
  const number = parseNumber(value);
  return number !== null && number > 0;
}

export function firstString(data: unknown, ...keys: string[]): string {
  if (!isRecord(data)) return "";
  for (const key of keys) {
    const value = cleanString(data[key]);
    if (value) return value;
  }
  return "";
}

export function conciseError(error: unknown, maxLength = 300): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\s+/).filter(Boolean).join(" ").slice(0, maxLength);
}

export function normalizeMatchText(value: unknown): string {
  return cleanString(value).toLowerCase().split(/\s+/).join("");
}

export function timestampSeconds(value: unknown): string {
  const text = cleanString(value);
  if (!text) return "";

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(text);
  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    return String(Math.trunc(new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime() / 1000));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : String(Math.trunc(parsed.getTime() / 1000));
}

export function parseDate(value: unknown): Date | null {
  const text = cleanString(value);
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toCents(value: unknown): string {
  const number = parseNumber(value);
  return number === null ? "0" : String(Math.round(number * 100));
}
