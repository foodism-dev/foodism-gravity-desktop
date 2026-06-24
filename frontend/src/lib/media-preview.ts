import { getPayloadMediaItems, type TicketFieldMetadataMap } from "./field-display.ts";

export interface MediaAssetItem {
  source: string;
  url: string;
}

export type MediaAssetMap = Record<string, MediaAssetItem[]>;

export type MediaPreviewKind = "image" | "pdf" | "file";

export interface MediaPreviewItem {
  source: string;
  url: string;
  fileName: string;
  kind: MediaPreviewKind;
  canPreview: boolean;
}

export interface BuildMediaPreviewItemsInput {
  payload: Record<string, unknown>;
  assets: MediaAssetMap;
  fields: string[];
  fieldMetadata?: TicketFieldMetadataMap;
  kindHint?: MediaPreviewKind;
}

export function buildMediaPreviewItems(input: BuildMediaPreviewItemsInput): MediaPreviewItem[] {
  const fieldName = input.fields.find((field) => getPayloadMediaItems(input.payload, field).length > 0)
    ?? input.fields.find((field) => (input.assets[field]?.length ?? 0) > 0);
  if (!fieldName) return [];

  const payloadItems = getPayloadMediaItems(input.payload, fieldName);
  const rawItems = payloadItems.length > 0
    ? payloadItems
    : (input.assets[fieldName] ?? []).map((item) => item.source || item.url).filter(Boolean);
  const assets = input.assets[fieldName] ?? [];
  const fieldKindHint = resolveFieldKindHint(fieldName, input.fieldMetadata) ?? input.kindHint;

  return uniqueValues(rawItems).map((rawItem) => {
    const asset = findAsset(rawItem, assets);
    const url = asset?.url || (looksLikeHttpUrl(rawItem) ? rawItem : "");
    const source = asset?.source || rawItem;
    const fileName = getPreviewFileName(source || url);
    const kind = inferPreviewKind(url || source, fieldKindHint);
    return {
      source,
      url,
      fileName,
      kind,
      canPreview: looksLikeHttpUrl(url),
    };
  });
}

export function getPreviewFileName(value: string): string {
  const withoutQuery = value.split("?")[0] ?? value;
  const fileName = withoutQuery.split("/").pop() || withoutQuery || "附件";
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

export function inferPreviewKind(value: string, kindHint?: MediaPreviewKind): MediaPreviewKind {
  if (isImagePath(value)) return "image";
  if (/\.pdf(?:\?.*)?$/i.test(value)) return "pdf";
  if (kindHint) return kindHint;
  return "file";
}

export function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function findAsset(rawItem: string, assets: MediaAssetItem[]): MediaAssetItem | undefined {
  return assets.find((asset) => asset.source === rawItem || asset.url === rawItem);
}

function isImagePath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(?:\?.*)?$/i.test(value);
}

function resolveFieldKindHint(fieldName: string, fieldMetadata: TicketFieldMetadataMap | undefined): MediaPreviewKind | null {
  const fieldType = fieldMetadata?.[fieldName]?.fieldType.toUpperCase() ?? "";
  if (fieldType === "IMAGE" || fieldType.includes("IMAGE")) return "image";
  return null;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
