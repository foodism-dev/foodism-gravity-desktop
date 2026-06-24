import { createHash } from "node:crypto";
import {
  uploadObjectToR2,
  type R2Config,
  type R2Fetch,
} from "../skill-publisher.ts";
import type { RebuildFieldMetadata } from "./fields.ts";
import { getRebuildLoginSession, invalidateRebuildLoginSession } from "./login-session.ts";

export interface RebuildAssetItem {
  source: string;
  url: string;
}

export type RebuildAssetMap = Record<string, RebuildAssetItem[]>;

export interface RebuildAssetUploadInput {
  supplyGoodsId: string;
  fieldName: string;
  sourcePath: string;
}

export interface RebuildAssetUploader {
  uploadAsset: (input: RebuildAssetUploadInput) => Promise<RebuildAssetItem>;
}

interface DownloadedAsset {
  bytes: Uint8Array;
  contentType: string;
}

export interface RebuildAssetDownloader {
  downloadAsset: (sourcePath: string) => Promise<DownloadedAsset>;
}

interface RebuildR2AssetUploaderOptions {
  downloader: RebuildAssetDownloader;
  r2Config: R2Config;
  fetchImpl?: R2Fetch;
}

const ASSET_FIELD_TYPES = new Set(["IMAGE", "FILE", "ATTACHMENT"]);
const ASSET_FIELD_NAME_KEYWORDS = [
  "image",
  "images",
  "img",
  "pic",
  "picture",
  "photo",
  "file",
  "attachment",
  "contract",
  "license",
  "certificate",
];

const DEFAULT_R2_ASSET_PREFIX = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isAssetField(field: RebuildFieldMetadata): boolean {
  const fieldType = [
    field.fieldType,
    readString(field.raw, ["displayType", "type", "typeName", "fieldType"]),
  ].join(" ").toLowerCase();
  if ([...ASSET_FIELD_TYPES].some((type) => fieldType.includes(type.toLowerCase()))) {
    return true;
  }

  const fieldName = field.fieldName.toLowerCase();
  return ASSET_FIELD_NAME_KEYWORDS.some((keyword) => fieldName.includes(keyword));
}

function collectSourcePaths(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectSourcePaths);
  }
  if (isRecord(value)) {
    return collectSourcePaths(value.url ?? value.path ?? value.file ?? value.name ?? value.value);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function readFileName(sourcePath: string): string {
  const pathname = sourcePath.split("?")[0] ?? sourcePath;
  return sanitizePathSegment(pathname.split("/").pop() ?? "asset");
}

function inferContentType(sourcePath: string, fallback: string): string {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const normalized = sourcePath.toLowerCase().split("?")[0] ?? sourcePath.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildAssetObjectKey(input: {
  prefix: string;
  supplyGoodsId: string;
  fieldName: string;
  sourcePath: string;
  sha256: string;
}): string {
  const normalizedPrefix = input.prefix.replace(/^\/+|\/+$/g, "");
  const fileName = readFileName(input.sourcePath);
  const objectKey = [
    normalizedPrefix,
    "supplygoods",
    sanitizePathSegment(input.supplyGoodsId),
    sanitizePathSegment(input.fieldName),
    `${input.sha256.slice(0, 16)}-${fileName}`,
  ].filter(Boolean).join("/");
  return objectKey;
}

function resolveDownloadUrl(sourcePath: string): string {
  if (/^https?:\/\//i.test(sourcePath)) {
    return sourcePath;
  }

  const baseUrl = Bun.env.REBUILD_BASE_URL?.trim();
  if (!baseUrl) throw new Error("缺少 REBUILD_BASE_URL，无法下载 REBUILD 资产");
  const assetBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/gw\/api$/i, "");
  return new URL(sourcePath.replace(/^\/+/, ""), `${assetBaseUrl}/`).toString();
}

function isRebuildStoragePath(sourcePath: string): boolean {
  return sourcePath.replace(/^\/+/, "").startsWith("rb/");
}

function resolveRebuildWebUrl(pathname: string): string {
  const baseUrl = Bun.env.REBUILD_BASE_URL?.trim();
  if (!baseUrl) throw new Error("缺少 REBUILD_BASE_URL，无法下载 REBUILD 资产");
  const webBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/gw\/api$/i, "");
  return new URL(pathname.replace(/^\/+/, ""), `${webBaseUrl}/`).toString();
}

function isLoginRedirect(location: string | null): boolean {
  return Boolean(location && /\/user\/login(?:\?|$)/i.test(location));
}

async function readDownloadedAsset(response: Response): Promise<DownloadedAsset> {
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function readLocalDownloadResponse(response: Response, fetchImpl: R2Fetch): Promise<DownloadedAsset | null> {
  if (response.ok) {
    return readDownloadedAsset(response);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || isLoginRedirect(location)) {
      return null;
    }
    const redirectedResponse = await fetchImpl(new URL(location, resolveRebuildWebUrl("/")).toString());
    if (redirectedResponse.ok) {
      return readDownloadedAsset(redirectedResponse);
    }
  }

  return null;
}

async function requestRebuildLocalAsset(
  sourcePath: string,
  fetchImpl: R2Fetch,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const response = await fetchImpl(resolveRebuildWebUrl(`filex/download/${sourcePath.replace(/^\/+/, "")}`), {
    headers,
    redirect: "manual",
  });
  return response;
}

async function tryDownloadRebuildLocalAsset(sourcePath: string, fetchImpl: R2Fetch): Promise<DownloadedAsset | null> {
  const anonymousAsset = await readLocalDownloadResponse(await requestRebuildLocalAsset(sourcePath, fetchImpl), fetchImpl);
  if (anonymousAsset) {
    return anonymousAsset;
  }

  const session = await getRebuildLoginSession({ fetchImpl });
  if (!session) {
    return null;
  }
  const loggedInAsset = await readLocalDownloadResponse(await requestRebuildLocalAsset(sourcePath, fetchImpl, session.cookie), fetchImpl);
  if (loggedInAsset) {
    return loggedInAsset;
  }

  await invalidateRebuildLoginSession(session.user);
  const refreshedSession = await getRebuildLoginSession({ fetchImpl });
  if (!refreshedSession) {
    return null;
  }
  return readLocalDownloadResponse(await requestRebuildLocalAsset(sourcePath, fetchImpl, refreshedSession.cookie), fetchImpl);
}

export function createRebuildAssetDownloader(fetchImpl: R2Fetch = fetch): RebuildAssetDownloader {
  return {
    async downloadAsset(sourcePath: string): Promise<DownloadedAsset> {
      if (isRebuildStoragePath(sourcePath)) {
        const localAsset = await tryDownloadRebuildLocalAsset(sourcePath, fetchImpl);
        if (localAsset) {
          return localAsset;
        }
        throw new Error(`REBUILD 本地文件下载失败: ${sourcePath}`);
      }

      const downloadUrl = resolveDownloadUrl(sourcePath);
      const response = await fetchImpl(downloadUrl);
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(responseText.trim() || `REBUILD 资产下载失败: ${response.status}`);
      }
      return readDownloadedAsset(response);
    },
  };
}

export async function mirrorSupplyGoodsAssets(input: {
  supplyGoodsId: string;
  payload: Record<string, unknown>;
  fields: RebuildFieldMetadata[];
  uploader: RebuildAssetUploader;
}): Promise<RebuildAssetMap> {
  const entries: Array<[string, RebuildAssetItem[]]> = [];
  for (const field of input.fields.filter(isAssetField)) {
    const sourcePaths = uniqueValues(collectSourcePaths(input.payload[field.fieldName]));
    if (sourcePaths.length === 0) continue;

    const items: RebuildAssetItem[] = [];
    for (const sourcePath of sourcePaths) {
      try {
        items.push(await input.uploader.uploadAsset({
          supplyGoodsId: input.supplyGoodsId,
          fieldName: field.fieldName,
          sourcePath,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[REBUILD] 资产镜像失败: ${field.fieldName} ${sourcePath} ${message}`);
      }
    }
    if (items.length > 0) entries.push([field.fieldName, items]);
  }
  return Object.fromEntries(entries);
}

export function replacePayloadAssetUrls(
  payload: Record<string, unknown>,
  assets: RebuildAssetMap,
): Record<string, unknown> {
  const nextPayload = { ...payload };
  for (const [fieldName, items] of Object.entries(assets)) {
    if (items.length > 0) {
      nextPayload[fieldName] = items.map((item) => item.url);
    }
  }
  return nextPayload;
}

export function createRebuildR2AssetUploader(options: RebuildR2AssetUploaderOptions): RebuildAssetUploader {
  return {
    async uploadAsset(input: RebuildAssetUploadInput): Promise<RebuildAssetItem> {
      const downloaded = await options.downloader.downloadAsset(input.sourcePath);
      const sha256 = sha256Bytes(downloaded.bytes);
      const objectKey = buildAssetObjectKey({
        prefix: options.r2Config.prefix,
        supplyGoodsId: input.supplyGoodsId,
        fieldName: input.fieldName,
        sourcePath: input.sourcePath,
        sha256,
      });
      const result = await uploadObjectToR2(options.r2Config, {
        objectKey,
        bytes: downloaded.bytes,
        contentType: inferContentType(input.sourcePath, downloaded.contentType),
        sha256,
      }, options.fetchImpl);
      return {
        source: input.sourcePath,
        url: result.publicUrl,
      };
    },
  };
}

export function resolveRebuildAssetR2Prefix(input: {
  rebuildAssetPrefix?: string | null;
  sharedR2Prefix?: string | null;
}): string {
  return input.rebuildAssetPrefix?.trim() ?? DEFAULT_R2_ASSET_PREFIX;
}

function readRequiredR2Env(name: string): string | null {
  const value = Bun.env[name]?.trim();
  return value || null;
}

export function getDefaultRebuildAssetUploader(): RebuildAssetUploader | null {
  const endpointUrl = readRequiredR2Env("CLOUDFLARE_R2_ENDPOINT_URL");
  const accessKeyId = readRequiredR2Env("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = readRequiredR2Env("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket = readRequiredR2Env("CLOUDFLARE_R2_BUCKET");
  const publicBaseUrl = readRequiredR2Env("CLOUDFLARE_R2_PUBLIC_BASE_URL");
  const hasAnyAssetConfig = Boolean(
    endpointUrl
      || accessKeyId
      || secretAccessKey
      || bucket
      || publicBaseUrl
      || Bun.env.REBUILD_BASE_URL?.trim(),
  );

  if (!endpointUrl || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl || !Bun.env.REBUILD_BASE_URL?.trim()) {
    if (hasAnyAssetConfig) {
      console.warn("[REBUILD] 资产镜像配置不完整，SupplyGoods 附件将保留原始路径");
    }
    return null;
  }

  return createRebuildR2AssetUploader({
    downloader: createRebuildAssetDownloader(),
    r2Config: {
      endpointUrl,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicBaseUrl,
      prefix: resolveRebuildAssetR2Prefix({
        rebuildAssetPrefix: Bun.env.REBUILD_ASSET_R2_PREFIX,
        sharedR2Prefix: Bun.env.CLOUDFLARE_R2_PREFIX,
      }),
      region: Bun.env.CLOUDFLARE_R2_REGION?.trim() || "auto",
    },
  });
}
