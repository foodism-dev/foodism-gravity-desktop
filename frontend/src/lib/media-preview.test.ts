import { describe, expect, test } from "bun:test";

import { buildMediaPreviewItems, getPreviewFileName } from "./media-preview.ts";

describe("工单素材预览", () => {
  test("Given payload has mirrored image url, When building preview items, Then it renders image preview", () => {
    const items = buildMediaPreviewItems({
      payload: {
        mainPic: ["https://fg.foodism.pro/supplygoods/944/mainPic/main.jpg"],
      },
      assets: {
        mainPic: [
          {
            source: "rb/20260624/main.jpg",
            url: "https://fg.foodism.pro/supplygoods/944/mainPic/main.jpg",
          },
        ],
      },
      fields: ["mainPic"],
    });

    expect(items).toEqual([
      {
        source: "rb/20260624/main.jpg",
        url: "https://fg.foodism.pro/supplygoods/944/mainPic/main.jpg",
        fileName: "main.jpg",
        kind: "image",
        canPreview: true,
      },
    ]);
  });

  test("Given image field has extensionless mirrored url, When building preview items, Then it still renders image preview", () => {
    const items = buildMediaPreviewItems({
      payload: {
        mainPic: [
          "https://fg.foodism.pro/supplygoods/944-019ef86947a01d4f/mainPic/d4979aeedb929207-82e385b4-19d3-4853-b959-69ad7ccbc8de",
        ],
      },
      assets: {
        mainPic: [
          {
            source: "https://gravity-api.foodism.cc/api/storage/82e385b4-19d3-4853-b959-69ad7ccbc8de",
            url: "https://fg.foodism.pro/supplygoods/944-019ef86947a01d4f/mainPic/d4979aeedb929207-82e385b4-19d3-4853-b959-69ad7ccbc8de",
          },
        ],
      },
      fields: ["mainPic"],
      fieldMetadata: {
        mainPic: {
          label: "商品主图",
          fieldType: "IMAGE",
        },
      },
    });

    expect(items[0]?.kind).toBe("image");
    expect(items[0]?.canPreview).toBe(true);
  });

  test("Given payload keeps rb path but assets has mirrored file url, When building preview items, Then it uses asset url", () => {
    const items = buildMediaPreviewItems({
      payload: {
        packageContract: ["rb/20260624/contract.pdf"],
      },
      assets: {
        packageContract: [
          {
            source: "rb/20260624/contract.pdf",
            url: "https://fg.foodism.pro/supplygoods/944/packageContract/contract.pdf",
          },
        ],
      },
      fields: ["packageContract"],
    });

    expect(items).toEqual([
      {
        source: "rb/20260624/contract.pdf",
        url: "https://fg.foodism.pro/supplygoods/944/packageContract/contract.pdf",
        fileName: "contract.pdf",
        kind: "pdf",
        canPreview: true,
      },
    ]);
  });

  test("Given pdf field has extensionless mirrored url, When building preview items, Then it still renders pdf preview", () => {
    const items = buildMediaPreviewItems({
      payload: {
        packageContract: [
          "https://fg.foodism.pro/supplygoods/944/packageContract/880c0471f76442e0-3a40b7d3-fd43-47af-a387-8eff4d97d9eb",
        ],
      },
      assets: {
        packageContract: [
          {
            source: "https://gravity-api.foodism.cc/api/storage/3a40b7d3-fd43-47af-a387-8eff4d97d9eb",
            url: "https://fg.foodism.pro/supplygoods/944/packageContract/880c0471f76442e0-3a40b7d3-fd43-47af-a387-8eff4d97d9eb",
          },
        ],
      },
      fields: ["packageContract"],
      kindHint: "pdf",
    });

    expect(items[0]?.kind).toBe("pdf");
    expect(items[0]?.canPreview).toBe(true);
  });

  test("Given only rb path exists, When building preview items, Then it marks item as waiting for mirror", () => {
    const items = buildMediaPreviewItems({
      payload: {
        businessLicensePicture: ["rb/20260624/license.jpg"],
      },
      assets: {},
      fields: ["businessLicensePicture"],
    });

    expect(items).toEqual([
      {
        source: "rb/20260624/license.jpg",
        url: "",
        fileName: "license.jpg",
        kind: "image",
        canPreview: false,
      },
    ]);
  });

  test("Given encoded url, When reading file name, Then it decodes the display name", () => {
    expect(getPreviewFileName("https://fg.foodism.pro/files/%E5%90%88%E5%90%8C.pdf?token=demo")).toBe("合同.pdf");
  });
});
