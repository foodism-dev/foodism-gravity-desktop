import { describe, expect, test } from "bun:test";

describe("工单列表页布局", () => {
  test("Given compact work order toolbar, When rendering tickets page, Then global navigation and auth controls are hidden", async () => {
    const source = await Bun.file("frontend/src/routes/TicketsPage.tsx").text();

    expect(source).not.toContain("AppNavigation");
    expect(source).not.toContain("AppAuthControls");
    expect(source).toContain('aria-label="刷新工单"');
    expect(source).toContain('placeholder="搜索城市、商品、门店、商品 ID等"');
    expect(source).toContain("TICKET_STATUS_OPTIONS.map");
    expect(source).toContain("status: option.value");
    expect(source).not.toContain("buildTicketStatusColumns");
  });
});
