import { describe, expect, test } from "bun:test";

import { buildOpenRebuildApprovalMessage, isElectronEmbedded, openRebuildApprovalInElectron } from "./electron-bridge.ts";

describe("Electron 嵌入桥接消息", () => {
  test("Given supply goods id, When building RB approval message, Then message is stable", () => {
    expect(buildOpenRebuildApprovalMessage("F00-838")).toEqual({
      type: "proma:open-rebuild-approval",
      supplyGoodsId: "F00-838",
    });
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
});
