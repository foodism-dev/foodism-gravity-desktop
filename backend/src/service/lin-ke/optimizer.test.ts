import { describe, expect, test } from "bun:test";

import type { LinKeSettings } from "./config.ts";
import { SYSTEM_PROMPT, buildUserPrompt, optimizePayloadWithRetries } from "./optimizer.ts";

function settings(): LinKeSettings {
  return {
    databaseUrl: null,
    openaiApiKey: "test",
    openaiBaseUrl: "https://openai.example/v1",
    optimizeModel: "gpt-4o-mini",
    optimizeConcurrency: 5,
    optimizeMaxBatchSize: 20,
    optimizeRetries: 3,
    lifePartnerBaseUrl: "https://www.life-partner.cn",
    lifePartnerTimeout: 60,
    rbImageBaseUrl: "",
  };
}

function samplePayload() {
  return {
    goodsName: "[测试门店]双人餐",
    hostName: "测试门店",
    classification: { text: "同城优享.烧烤.中式烧烤" },
    mealType: { text: "普通E" },
    bdCity: { text: "合肥市" },
    packages: JSON.stringify({
      viewList: [
        {
          groupName: "主菜",
          groupSelectNum: "1",
          groupId: 0,
          list: [{ title: "蟹", price: "88.00", num: "1", id: 0 }],
        },
      ],
    }),
  };
}

describe("Lin-Ke optimizer", () => {
  test("Given system prompt, Then it guides marketing naming while keeping constraints", () => {
    expect(SYSTEM_PROMPT).toContain("营销文案助手");
    expect(SYSTEM_PROMPT).toContain("宣传效果");
    expect(SYSTEM_PROMPT).toContain("风格统一、结构对称");
    expect(SYSTEM_PROMPT).toContain("默认应进行优化");
    expect(SYSTEM_PROMPT).toContain("食欲感");
    expect(SYSTEM_PROMPT).toContain("禁止虚构");
    expect(SYSTEM_PROMPT).toContain("不得修改价格、数量、ID、套餐结构、选择规则");
  });

  test("Given payload, When building prompt, Then context fields are included", () => {
    const parsed = JSON.parse(buildUserPrompt(samplePayload(), []));
    expect(parsed.goodsName).toBe("[测试门店]双人餐");
    expect(parsed.hostName).toBe("测试门店");
    expect(parsed.classification).toBe("同城优享.烧烤.中式烧烤");
    expect(parsed.mealType).toBe("普通E");
    expect(parsed.bdCity).toBe("合肥市");
  });

  test("Given successful model response, When optimizing, Then allowed names are changed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ groups: [{ index: 0, groupName: "招牌主菜", items: [{ index: 0, title: "鲜活蟹" }] }] }) } }],
    })), { preconnect: originalFetch.preconnect });
    try {
      const result = await optimizePayloadWithRetries(settings(), samplePayload());
      expect(result.fallback).toBe(false);
      expect(result.error).toBe("");
      const packages = JSON.parse(result.payload.packages as string);
      expect(packages.viewList[0].groupName).toBe("招牌主菜");
      expect(packages.viewList[0].list[0].title).toBe("鲜活蟹");
      expect(result.changes).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Given repeated model failures, When optimizing, Then it throws instead of returning original payload", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => new Response("model down", { status: 500 }), {
      preconnect: originalFetch.preconnect,
    });
    const original = samplePayload();
    try {
      await expect(optimizePayloadWithRetries(settings(), original)).rejects.toThrow("model down");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Given malformed packages, When optimizing, Then model is not called", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return new Response("{}");
    }, { preconnect: originalFetch.preconnect });
    const original = { goodsName: "测试商品", packages: "{bad json" };
    try {
      const result = await optimizePayloadWithRetries(settings(), original);
      expect(called).toBe(false);
      expect(result.fallback).toBe(false);
      expect(result.payload).toEqual(original);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
