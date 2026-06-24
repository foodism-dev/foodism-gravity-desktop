import { describe, expect, test } from "bun:test";

import { createR2SkillPublisher, sha256Bytes } from "./skill-publisher.ts";

describe("skill publisher", () => {
  test("Given R2 config, When publishing a skill package, Then it uploads to R2 and returns the public URL", async () => {
    const packageBytes = new TextEncoder().encode("skill package");
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const publisher = createR2SkillPublisher(
      {
        endpointUrl: "https://account-id.r2.cloudflarestorage.com",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret",
        bucket: "skill-market-bucket",
        publicBaseUrl: "https://cdn.example.com",
        prefix: "upload_file",
        region: "auto",
      },
      async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response("", { status: 200 });
      },
    );

    const result = await publisher.publishSkillPackage({
      slug: "brief-writer",
      packageBytes,
      contentType: "application/zip",
      sha256: sha256Bytes(packageBytes),
    });

    expect(result.packageUrl).toBe("https://cdn.example.com/upload_file/skills/brief-writer.skill");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://account-id.r2.cloudflarestorage.com/skill-market-bucket/upload_file/skills/brief-writer.skill");
    expect(requests[0]?.init.method).toBe("PUT");
    const headers = new Headers(requests[0]?.init.headers);
    expect(headers.get("Content-Type")).toBe("application/zip");
    expect(headers.get("x-amz-content-sha256")).toBe(sha256Bytes(packageBytes));
    expect(headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.get("Authorization")).toContain("AWS4-HMAC-SHA256 Credential=test-access-key/");
    expect(headers.get("Authorization")).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
  });
});
