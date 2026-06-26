import { describe, expect, test } from "bun:test";

import {
  buildOpenBrowserTabMessage,
  buildOpenRebuildApprovalMessage,
  buildReloadWorkOrdersMessage,
  isElectronEmbedded,
  openBrowserTabInElectron,
  openRebuildApprovalInElectron,
  reloadWorkOrdersInElectron,
} from "./electron-bridge.ts";

describe("Electron 嵌入桥接消息", () => {
  test("Given supply goods id, When building RB approval message, Then message is stable", () => {
    expect(buildOpenRebuildApprovalMessage("F00-838")).toEqual({
      type: "proma:open-rebuild-approval",
      supplyGoodsId: "F00-838",
    });
  });

  test("Given work order reload request, When building host message, Then message is stable", () => {
    expect(buildReloadWorkOrdersMessage()).toEqual({
      type: "proma:reload-work-orders",
    });
  });

  test("Given http url, When building browser tab message, Then message is stable", () => {
    expect(buildOpenBrowserTabMessage(" https://www.life-partner.cn/draft/1 ")).toEqual({
      type: "proma:open-browser-tab",
      url: "https://www.life-partner.cn/draft/1",
    });
    expect(buildOpenBrowserTabMessage("javascript:alert(1)")).toBeNull();
  });

  test("Given page is inside iframe, When embedded query is missing, Then it still uses Electron bridge", () => {
    const currentWindow = { parent: null, location: { search: "" } } as unknown as Window;
    const parentWindow = {} as Window;

    expect(isElectronEmbedded({ currentWindow, parentWindow })).toBe(true);
  });

  test("Given page is inside Electron webview, When opening RB approval, Then it asks host to open a desktop tab", () => {
    const hostMessages: string[] = [];
    const parentMessages: unknown[] = [];
    const currentWindow = {
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
      location: { search: "?embedded=electron" },
      promaElectronWebview: {
        openRebuildApproval(supplyGoodsId: string) {
          hostMessages.push(supplyGoodsId);
        },
      },
    } as unknown as Window;

    expect(openRebuildApprovalInElectron("944-019efa94400a73d9", { currentWindow })).toBe(true);

    expect(hostMessages).toEqual(["944-019efa94400a73d9"]);
    expect(parentMessages).toEqual([]);
  });

  test("Given page is inside Electron webview, When refreshing work orders, Then it asks host to reload native webview", () => {
    let reloadCount = 0;
    const parentMessages: unknown[] = [];
    const currentWindow = {
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
      location: { search: "?embedded=electron" },
      promaElectronWebview: {
        reloadWorkOrders() {
          reloadCount += 1;
        },
      },
    } as unknown as Window;

    expect(reloadWorkOrdersInElectron({ currentWindow })).toBe(true);

    expect(reloadCount).toBe(1);
    expect(parentMessages).toEqual([]);
  });

  test("Given Electron webview bridge exists, When opening browser tab, Then it uses host bridge", () => {
    const openedUrls: string[] = [];
    const parentMessages: unknown[] = [];
    const currentWindow = {
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
      location: { search: "?embedded=electron" },
      promaElectronWebview: {
        openBrowserTab(url: string) {
          openedUrls.push(url);
        },
      },
    } as unknown as Window;

    expect(openBrowserTabInElectron("https://www.life-partner.cn/draft/1", { currentWindow })).toBe(true);

    expect(openedUrls).toEqual(["https://www.life-partner.cn/draft/1"]);
    expect(parentMessages).toEqual([]);
  });

  test("Given no Electron webview bridge, When opening browser tab in iframe, Then it posts host message to parent", () => {
    const parentMessages: unknown[] = [];
    const currentWindow = {
      parent: {
        postMessage(message: unknown) {
          parentMessages.push(message);
        },
      },
      location: { search: "" },
    } as unknown as Window;

    expect(openBrowserTabInElectron("https://www.life-partner.cn/draft/1", { currentWindow })).toBe(true);

    expect(parentMessages).toEqual([{
      type: "proma:open-browser-tab",
      url: "https://www.life-partner.cn/draft/1",
    }]);
  });

  test("Given unsafe url, When opening browser tab, Then it is rejected before host bridge", () => {
    const openedUrls: string[] = [];
    const currentWindow = {
      parent: {},
      location: { search: "?embedded=electron" },
      promaElectronWebview: {
        openBrowserTab(url: string) {
          openedUrls.push(url);
        },
      },
    } as unknown as Window;

    expect(openBrowserTabInElectron("javascript:alert(1)", { currentWindow })).toBe(false);
    expect(openedUrls).toEqual([]);
  });
});
