import { describe, expect, test } from "bun:test";

import {
  createRebuildR2AssetUploader,
  createRebuildAssetDownloader,
  mirrorSupplyGoodsAssets,
  replacePayloadAssetUrls,
  resolveRebuildAssetR2Prefix,
  type RebuildAssetUploader,
} from "./assets.ts";
import type { RebuildFieldMetadata } from "./fields.ts";
import { getRebuildLoginSession, resetRebuildLoginSessionForTests } from "./login-session.ts";

const fields: RebuildFieldMetadata[] = [
  {
    entityName: "SupplyGoods",
    fieldName: "mainPic",
    label: "商品主图",
    fieldType: "IMAGE",
    raw: { name: "mainPic", displayType: "IMAGE" },
  },
  {
    entityName: "SupplyGoods",
    fieldName: "packageContract",
    label: "套餐合同",
    fieldType: "FILE",
    raw: { name: "packageContract", displayType: "FILE" },
  },
  {
    entityName: "SupplyGoods",
    fieldName: "goodsName",
    label: "商品名称",
    fieldType: "TEXT",
    raw: { name: "goodsName", displayType: "TEXT" },
  },
];

describe("REBUILD 资产镜像", () => {
  test("Given media fields in SupplyGoods payload, When mirroring assets, Then it stores field to converted url mappings", async () => {
    const uploads: Array<{ fieldName: string; sourcePath: string }> = [];
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        uploads.push({ fieldName: input.fieldName, sourcePath: input.sourcePath });
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.supplyGoodsId}/${input.fieldName}/${input.sourcePath.split("/").pop()}`,
        };
      },
    };

    const assets = await mirrorSupplyGoodsAssets({
      supplyGoodsId: "944-asset",
      payload: {
        goodsName: "不应上传的文本",
        mainPic: ["rb/20260624/main.jpg"],
        packageContract: { url: "rb/20260624/contract.pdf" },
      },
      fields,
      uploader,
    });

    expect(uploads).toEqual([
      { fieldName: "mainPic", sourcePath: "rb/20260624/main.jpg" },
      { fieldName: "packageContract", sourcePath: "rb/20260624/contract.pdf" },
    ]);
    expect(assets).toEqual({
      mainPic: [
        {
          source: "rb/20260624/main.jpg",
          url: "https://cdn.example.com/944-asset/mainPic/main.jpg",
        },
      ],
      packageContract: [
        {
          source: "rb/20260624/contract.pdf",
          url: "https://cdn.example.com/944-asset/packageContract/contract.pdf",
        },
      ],
    });
  });

  test("Given saved assets, When serializing payload, Then media fields are replaced by converted urls", () => {
    const payload = {
      goodsName: "原始商品名",
      mainPic: ["rb/20260624/main.jpg"],
      packageContract: { url: "rb/20260624/contract.pdf" },
    };

    expect(
      replacePayloadAssetUrls(payload, {
        mainPic: [{ source: "rb/20260624/main.jpg", url: "https://cdn.example.com/main.jpg" }],
        packageContract: [{ source: "rb/20260624/contract.pdf", url: "https://cdn.example.com/contract.pdf" }],
      }),
    ).toEqual({
      goodsName: "原始商品名",
      mainPic: ["https://cdn.example.com/main.jpg"],
      packageContract: ["https://cdn.example.com/contract.pdf"],
    });
    expect(payload.mainPic).toEqual(["rb/20260624/main.jpg"]);
  });

  test("Given rb asset path and local download is available, When downloading, Then it uses local file endpoint first", async () => {
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const requests: Array<{ url: string; method: string; body: string }> = [];

    Bun.env.REBUILD_BASE_URL = "https://sale.foodism.cc/gw/api";

    try {
      const downloader = createRebuildAssetDownloader(async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
        });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      });

      const result = await downloader.downloadAsset("rb/20260624/main.jpg");

      expect(requests).toEqual([
        {
          url: "https://sale.foodism.cc/filex/download/rb/20260624/main.jpg",
          method: "GET",
          body: "",
        },
      ]);
      expect(result.contentType).toBe("image/jpeg");
    } finally {
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
    }
  });

  test("Given local download redirects to login and no login config, When downloading rb asset, Then it fails locally", async () => {
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const originalLoginUser = Bun.env.REBUILD_LOGIN_USER;
    const originalLoginPassword = Bun.env.REBUILD_LOGIN_PASSWORD;
    const requests: Array<{ url: string; method: string; body: string; redirect: string | undefined }> = [];

    Bun.env.REBUILD_BASE_URL = "https://sale.foodism.cc/gw/api";
    delete Bun.env.REBUILD_LOGIN_USER;
    delete Bun.env.REBUILD_LOGIN_PASSWORD;

    try {
      const downloader = createRebuildAssetDownloader(async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : "",
          redirect: init?.redirect,
        });
        if (String(input).includes("/filex/download/")) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://sale.foodism.cc/user/login?nexturl=%2Ffilex%2Fdownload%2Frb%2F20260624%2Fmain.jpg" },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      });

      await expect(downloader.downloadAsset("rb/20260624/main.jpg")).rejects.toThrow("REBUILD 本地文件下载失败");

      expect(requests).toEqual([
        {
          url: "https://sale.foodism.cc/filex/download/rb/20260624/main.jpg",
          method: "GET",
          body: "",
          redirect: "manual",
        },
      ]);
    } finally {
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
      Bun.env.REBUILD_LOGIN_USER = originalLoginUser;
      Bun.env.REBUILD_LOGIN_PASSWORD = originalLoginPassword;
    }
  });

  test("Given rebuild login is configured, When local download redirects to login, Then it signs in and retries local download", async () => {
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const originalAppId = Bun.env.REBUILD_APP_ID;
    const originalAppSecret = Bun.env.REBUILD_APP_SECRET;
    const originalLoginUser = Bun.env.REBUILD_LOGIN_USER;
    const originalLoginPassword = Bun.env.REBUILD_LOGIN_PASSWORD;
    const requests: Array<{ url: string; method: string; cookie: string; redirect: string | undefined }> = [];

    Bun.env.REBUILD_BASE_URL = "https://sale.foodism.cc/gw/api";
    Bun.env.REBUILD_APP_ID = "app-id";
    Bun.env.REBUILD_APP_SECRET = "app-secret";
    Bun.env.REBUILD_LOGIN_USER = "tester";
    Bun.env.REBUILD_LOGIN_PASSWORD = "secret";

    try {
      const downloader = createRebuildAssetDownloader(async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          cookie: headers.get("cookie") ?? "",
          redirect: init?.redirect,
        });
        if (String(input).includes("/filex/download/") && headers.get("cookie") !== "JSESSIONID=session-1") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://sale.foodism.cc/user/login?nexturl=%2Ffilex%2Fdownload%2Frb%2F20260624%2Fmain.jpg" },
          });
        }
        if (String(input).includes("/gw/api/login-token")) {
          return new Response(JSON.stringify({
            error_code: 0,
            error_msg: "调用成功",
            data: { login_url: "https://sale.foodism.cc/user/login?token=login-token-1" },
          }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (String(input).includes("/user/login?token=login-token-1")) {
          return new Response(null, {
            status: 302,
            headers: {
              "set-cookie": "JSESSIONID=session-1; Path=/; HttpOnly",
              location: "https://sale.foodism.cc/",
            },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        });
      });

      const result = await downloader.downloadAsset("rb/20260624/main.jpg");

      expect(requests).toEqual([
        {
          url: "https://sale.foodism.cc/filex/download/rb/20260624/main.jpg",
          method: "GET",
          cookie: "",
          redirect: "manual",
        },
        expect.objectContaining({
          url: expect.stringContaining("https://sale.foodism.cc/gw/api/login-token?"),
          method: "GET",
          cookie: "",
          redirect: undefined,
        }),
        {
          url: "https://sale.foodism.cc/user/login?token=login-token-1",
          method: "GET",
          cookie: "",
          redirect: "manual",
        },
        {
          url: "https://sale.foodism.cc/filex/download/rb/20260624/main.jpg",
          method: "GET",
          cookie: "JSESSIONID=session-1",
          redirect: "manual",
        },
      ]);
      expect(requests[1]?.url).toContain("user=tester");
      expect(result.contentType).toBe("application/pdf");
    } finally {
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
      Bun.env.REBUILD_APP_ID = originalAppId;
      Bun.env.REBUILD_APP_SECRET = originalAppSecret;
      Bun.env.REBUILD_LOGIN_USER = originalLoginUser;
      Bun.env.REBUILD_LOGIN_PASSWORD = originalLoginPassword;
    }
  });

  test("Given cached rebuild cookie is expired, When local download redirects to login, Then it refreshes cookie and retries", async () => {
    const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
    const originalAppId = Bun.env.REBUILD_APP_ID;
    const originalAppSecret = Bun.env.REBUILD_APP_SECRET;
    const originalLoginUser = Bun.env.REBUILD_LOGIN_USER;
    const originalLoginPassword = Bun.env.REBUILD_LOGIN_PASSWORD;
    const requests: Array<{ url: string; cookie: string }> = [];

    Bun.env.REBUILD_BASE_URL = "https://sale.foodism.cc/gw/api";
    Bun.env.REBUILD_APP_ID = "app-id";
    Bun.env.REBUILD_APP_SECRET = "app-secret";
    Bun.env.REBUILD_LOGIN_USER = "tester";
    Bun.env.REBUILD_LOGIN_PASSWORD = "secret";
    resetRebuildLoginSessionForTests();

    try {
      await getRebuildLoginSession({
        cache: null,
        async fetchImpl(input) {
          if (String(input).includes("/gw/api/login-token")) {
            return new Response(JSON.stringify({
              error_code: 0,
              error_msg: "调用成功",
              data: { login_url: "https://sale.foodism.cc/user/login?token=old-token" },
            }));
          }
          return new Response(null, {
            status: 302,
            headers: { "set-cookie": "JSESSIONID=old-session; Path=/; HttpOnly" },
          });
        },
      });

      const downloader = createRebuildAssetDownloader(async (input, init) => {
        const headers = new Headers(init?.headers);
        const cookie = headers.get("cookie") ?? "";
        requests.push({ url: String(input), cookie });
        if (String(input).includes("/filex/download/") && cookie !== "JSESSIONID=new-session") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://sale.foodism.cc/user/login?nexturl=%2Ffilex%2Fdownload%2Frb%2F20260624%2Fmain.jpg" },
          });
        }
        if (String(input).includes("/gw/api/login-token")) {
          return new Response(JSON.stringify({
            error_code: 0,
            error_msg: "调用成功",
            data: { login_url: "https://sale.foodism.cc/user/login?token=new-token" },
          }));
        }
        if (String(input).includes("/user/login?token=new-token")) {
          return new Response(null, {
            status: 302,
            headers: { "set-cookie": "JSESSIONID=new-session; Path=/; HttpOnly" },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        });
      });

      const result = await downloader.downloadAsset("rb/20260624/main.jpg");

      expect(requests.map((request) => request.cookie)).toEqual([
        "",
        "JSESSIONID=old-session",
        "",
        "",
        "JSESSIONID=new-session",
      ]);
      expect(result.contentType).toBe("application/pdf");
    } finally {
      Bun.env.REBUILD_BASE_URL = originalBaseUrl;
      Bun.env.REBUILD_APP_ID = originalAppId;
      Bun.env.REBUILD_APP_SECRET = originalAppSecret;
      Bun.env.REBUILD_LOGIN_USER = originalLoginUser;
      Bun.env.REBUILD_LOGIN_PASSWORD = originalLoginPassword;
      resetRebuildLoginSessionForTests();
    }
  });

  test("Given non-media field with asset-like label, When mirroring assets, Then it does not upload boolean values", async () => {
    const uploads: string[] = [];
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        uploads.push(`${input.fieldName}:${input.sourcePath}`);
        return { source: input.sourcePath, url: "https://cdn.example.com/unused" };
      },
    };

    const assets = await mirrorSupplyGoodsAssets({
      supplyGoodsId: "944-bool",
      payload: {
        hasSumitted: "F",
      },
      fields: [
        {
          entityName: "SupplyGoods",
          fieldName: "hasSumitted",
          label: "是否提交合同",
          fieldType: "BOOL",
          raw: { name: "hasSumitted", type: "BOOL", label: "是否提交合同" },
        },
      ],
      uploader,
    });

    expect(uploads).toEqual([]);
    expect(assets).toEqual({});
  });

  test("Given license number text field, When mirroring assets, Then it does not upload the identifier", async () => {
    const uploads: Array<{ fieldName: string; sourcePath: string }> = [];
    const uploader: RebuildAssetUploader = {
      async uploadAsset(input) {
        uploads.push({ fieldName: input.fieldName, sourcePath: input.sourcePath });
        return {
          source: input.sourcePath,
          url: `https://cdn.example.com/${input.fieldName}`,
        };
      },
    };

    const assets = await mirrorSupplyGoodsAssets({
      supplyGoodsId: "944-license",
      payload: {
        businessLicenseNo: "92310110MAK616385H",
      },
      fields: [
        {
          entityName: "SupplyCompany",
          fieldName: "businessLicenseNo",
          label: "营业执照编号",
          fieldType: "TEXT",
          raw: { name: "businessLicenseNo", displayType: "TEXT" },
        },
      ],
      uploader,
    });

    expect(uploads).toEqual([]);
    expect(assets).toEqual({});
  });

  test("Given no asset prefix, When uploading asset to R2, Then object key starts from supplygoods", async () => {
    const putUrls: string[] = [];
    const uploader = createRebuildR2AssetUploader({
      downloader: {
        async downloadAsset() {
          return {
            bytes: new Uint8Array([1, 2, 3]),
            contentType: "image/jpeg",
          };
        },
      },
      r2Config: {
        endpointUrl: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "foodism-gravity-desktop",
        publicBaseUrl: "https://fg.foodism.pro",
        prefix: "",
        region: "auto",
      },
      async fetchImpl(input, init) {
        if (init?.method === "PUT") {
          putUrls.push(String(input));
        }
        return new Response(null, { status: init?.method === "HEAD" ? 404 : 200 });
      },
    });

    const result = await uploader.uploadAsset({
      supplyGoodsId: "944-demo",
      fieldName: "mainPic",
      sourcePath: "rb/20260624/main.jpg",
    });

    expect(putUrls[0]).toContain("/foodism-gravity-desktop/supplygoods/944-demo/mainPic/");
    expect(result.url).toContain("https://fg.foodism.pro/supplygoods/944-demo/mainPic/");
    expect(result.url).not.toContain("upload_file");
    expect(result.url).not.toContain("rebuild/supplygoods");
  });

  test("Given R2 public object already exists, When uploading asset, Then it reuses the existing url without PUT", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const uploader = createRebuildR2AssetUploader({
      downloader: {
        async downloadAsset() {
          return {
            bytes: new Uint8Array([1, 2, 3]),
            contentType: "image/jpeg",
          };
        },
      },
      r2Config: {
        endpointUrl: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "foodism-gravity-desktop",
        publicBaseUrl: "https://fg.foodism.pro",
        prefix: "",
        region: "auto",
      },
      async fetchImpl(input, init) {
        requests.push({ url: String(input), method: init?.method ?? "GET" });
        return new Response(null, { status: init?.method === "HEAD" ? 200 : 500 });
      },
    });

    const result = await uploader.uploadAsset({
      supplyGoodsId: "944-demo",
      fieldName: "mainPic",
      sourcePath: "rb/20260624/main.jpg",
    });

    expect(requests.map((request) => request.method)).toEqual(["HEAD"]);
    expect(result.url).toContain("https://fg.foodism.pro/supplygoods/944-demo/mainPic/");
  });

  test("Given skill R2 prefix exists, When resolving asset prefix, Then assets do not inherit it", () => {
    expect(resolveRebuildAssetR2Prefix({
      rebuildAssetPrefix: "",
      sharedR2Prefix: "foodism-gravity-desktop/upload_file",
    })).toBe("");
    expect(resolveRebuildAssetR2Prefix({
      rebuildAssetPrefix: "custom-assets",
      sharedR2Prefix: "foodism-gravity-desktop/upload_file",
    })).toBe("custom-assets");
  });
});
