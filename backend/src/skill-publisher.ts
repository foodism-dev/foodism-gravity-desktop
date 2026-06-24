import { createHash, createHmac } from "node:crypto";

export interface PublishSkillPackageInput {
  slug: string;
  packageBytes: Uint8Array;
  contentType: string;
  sha256: string;
}

export interface PublishSkillPackageResult {
  packageUrl: string;
}

export interface SkillPublisher {
  publishSkillPackage: (input: PublishSkillPackageInput) => Promise<PublishSkillPackageResult>;
}

type R2Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface R2Config {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  prefix: string;
  region: string;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeEndpointUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodePathSegment).join("/");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function buildSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildR2SkillObjectKey(prefix: string, slug: string): string {
  const normalizedPrefix = trimSlashes(prefix);
  const suffix = `skills/${slug}.skill`;
  return normalizedPrefix ? `${normalizedPrefix}/${suffix}` : suffix;
}

function buildPublicUrl(publicBaseUrl: string, objectKey: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/${encodeObjectKey(objectKey)}`;
}

function buildUploadUrl(config: R2Config, objectKey: string): string {
  return `${normalizeEndpointUrl(config.endpointUrl)}/${encodePathSegment(config.bucket)}/${encodeObjectKey(objectKey)}`;
}

function signR2PutRequest(config: R2Config, uploadUrl: string, payloadSha256: string, now: Date): Headers {
  const url = new URL(uploadUrl);
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadSha256}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Bytes(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  const signature = createHmac("sha256", buildSigningKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");

  return new Headers({
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadSha256,
    "x-amz-date": amzDate,
  });
}

export function createR2SkillPublisher(config: R2Config, fetchImpl: R2Fetch = fetch): SkillPublisher {
  return {
    async publishSkillPackage(input: PublishSkillPackageInput): Promise<PublishSkillPackageResult> {
      const objectKey = buildR2SkillObjectKey(config.prefix, input.slug);
      const uploadUrl = buildUploadUrl(config, objectKey);
      const headers = signR2PutRequest(config, uploadUrl, input.sha256, new Date());
      headers.set("Content-Type", input.contentType || "application/zip");

      const response = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers,
        body: new Blob([input.packageBytes], { type: input.contentType || "application/zip" }),
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        console.warn(`[Skill 市场] R2 上传失败: ${response.status} ${response.statusText}`);
        throw new Error(responseText.trim() || `R2 上传失败: ${response.status}`);
      }

      return { packageUrl: buildPublicUrl(config.publicBaseUrl, objectKey) };
    },
  };
}

function getRequiredEnv(name: string): string | null {
  const value = Bun.env[name]?.trim();
  return value || null;
}

export function getDefaultSkillPublisher(): SkillPublisher | null {
  const endpointUrl = getRequiredEnv("CLOUDFLARE_R2_ENDPOINT_URL");
  const accessKeyId = getRequiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket = getRequiredEnv("CLOUDFLARE_R2_BUCKET");
  const publicBaseUrl = getRequiredEnv("CLOUDFLARE_R2_PUBLIC_BASE_URL");
  if (!endpointUrl || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }

  return createR2SkillPublisher({
    endpointUrl,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    prefix: Bun.env.CLOUDFLARE_R2_PREFIX?.trim() || "upload_file",
    region: Bun.env.CLOUDFLARE_R2_REGION?.trim() || "auto",
  });
}
