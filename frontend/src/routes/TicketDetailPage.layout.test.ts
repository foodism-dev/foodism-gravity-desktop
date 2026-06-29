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

  test("Given access review page, When rendering detail content, Then product operation rating entry is present", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("ProductOperationRatingPanel");
    expect(source).toContain("PRODUCT_OPERATION_RATING_ACTION");
  });

  test("Given product operation rating panel, When rendering detail content, Then editability follows current flow", async () => {
    const detailSource = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const panelSource = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(detailSource).toContain("isProductOperationRatingEditable(workbenchModel.currentFlow)");
    expect(detailSource).toContain("isEditable={isProductOperationRatingEditable(workbenchModel.currentFlow)}");
    expect(panelSource).toContain("isEditable: boolean");
    expect(panelSource).toContain("disabled={!isEditable");
    expect(panelSource).toContain("{isEditable ? (");
  });

  test("Given product operation rating form, When rendering fields, Then merchant and product scoring use two columns from medium width", async () => {
    const source = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(source).toContain("md:grid-cols-2");
    expect(source).not.toContain("xl:grid-cols-2");
  });
});
