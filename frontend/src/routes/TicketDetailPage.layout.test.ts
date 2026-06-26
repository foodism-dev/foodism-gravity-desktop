import { describe, expect, test } from "bun:test";

describe("工单详情页布局", () => {
  test("Given medium desktop width, When rendering detail layout, Then action sidebar stays in the right column from lg breakpoint", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_260px]");
    expect(source).toContain("xl:grid-cols-[minmax(0,1fr)_280px]");
    expect(source).toContain("lg:sticky lg:top-4");
  });

  test("Given hidden app shell header, When rendering detail layout, Then detail page cancels outer horizontal gutters", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("-mx-4");
    expect(source).toContain("sm:-mx-6");
    expect(source).toContain("lg:-mx-8");
    expect(source).not.toContain("max-w-[1480px]");
  });
});
