import { describe, expect, test } from "bun:test";

describe("工单详情页布局", () => {
  test("Given medium desktop width, When rendering detail layout, Then action sidebar stays in the right column from lg breakpoint", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_260px]");
    expect(source).toContain("xl:grid-cols-[minmax(0,1fr)_280px]");
    expect(source).toContain("lg:sticky lg:top-4");
  });

  test("Given full width app shell main, When rendering detail layout, Then detail page does not add negative horizontal gutters", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("ticket-scrollbar min-h-screen bg-slate-100");
    expect(source).not.toContain("-mx-4");
    expect(source).not.toContain("sm:-mx-6");
    expect(source).not.toContain("lg:-mx-8");
    expect(source).not.toContain("ticket-scrollbar -mx-4 min-h-screen bg-white sm:-mx-6 lg:-mx-8");
    expect(source).not.toContain("max-w-[1480px]");
  });

  test("Given ticket detail page, When rendering page grid, Then it uses full available width without horizontal padding", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const pageGridSource = source.slice(
      source.indexOf('<div className="ticket-scrollbar min-h-screen bg-slate-100">'),
      source.indexOf("<TicketHeader"),
    );
    const pageGridClass = /className=\{cn\(\n\s+"([^"]+)"/.exec(pageGridSource)?.[1] ?? "";

    expect(pageGridClass).toBe("grid gap-4 px-0 pb-4 pt-0 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-5");
    expect(pageGridClass).not.toContain("px-2");
    expect(pageGridClass).not.toContain("py-4");
    expect(pageGridClass).not.toContain("lg:px-3");
  });

  test("Given access review page, When rendering detail content, Then product operation rating entry is present", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("ProductOperationRatingPanel");
    expect(source).toContain("PRODUCT_OPERATION_RATING_ACTION");
  });

  test("Given access review page, When opening product rating, Then detail content switches to side by side comparison", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain('const canOpenRatingComparison = workbenchModel.currentFlow === "access_review";');
    expect(source).toContain("isRatingComparisonOpen && canOpenRatingComparison");
    expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]");
    expect(source).toContain("onOpenRatingComparison={openRatingComparison}");
    expect(source).toContain("商品评级");
  });

  test("Given rating comparison is open, When scrolling detail content, Then left and right panes scroll independently", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const panelSource = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(source).toContain("lg:h-[calc(100vh-156px)] lg:min-h-[560px] lg:overflow-hidden");
    expect(source).toContain("lg:items-stretch");
    expect(source).not.toContain("lg:items-start lg:gap-5 lg:space-y-0");
    expect(source).toContain('shouldShowRatingComparison && "pb-0"');
    expect(source).toContain("ticket-scrollbar h-full min-h-0 overflow-y-auto lg:pr-2");
    expect(source).toContain("h-full min-h-0 overflow-hidden lg:pl-1");
    expect(source).toContain('shouldShowRatingComparison && "pb-0 xl:pb-0"');
    expect(panelSource).toContain('Card className="flex h-full max-h-full flex-col border-0 bg-white shadow-sm"');
  });

  test("Given rating comparison is open, When rendering action sidebar, Then right information is collapsed", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("const [isActionSidebarCollapsed, setIsActionSidebarCollapsed] = useState(false);");
    expect(source).toContain("function closeRatingComparisonAndExpandActionSidebar()");
    expect(source).toContain("setIsRatingComparisonOpen(false);");
    expect(source).toContain("shouldShowRatingComparison && isActionSidebarCollapsed && \"lg:grid-cols-[minmax(0,1fr)_56px] xl:grid-cols-[minmax(0,1fr)_56px]\"");
    expect(source).toContain("isCollapsed={shouldShowRatingComparison && isActionSidebarCollapsed}");
    expect(source).toContain("onExpand={closeRatingComparisonAndExpandActionSidebar}");
    expect(source).not.toContain("canCollapse={shouldShowRatingComparison}");
    expect(source).not.toContain("onCollapse={() => setIsActionSidebarCollapsed(true)}");
    expect(source).not.toContain("canCollapse: boolean;");
    expect(source).not.toContain("onCollapse: () => void;");
    expect(source).not.toContain("收起工单操作");
    expect(source).toContain("工单操作");
    expect(source).toContain("[writing-mode:vertical-rl]");
  });

  test("Given action sidebar is expanded, When rendering sidebar content, Then sections share one aligned panel", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain('aside className="lg:sticky lg:top-4 lg:self-start"');
    expect(source).toContain('className="space-y-0 rounded-md bg-white p-4 shadow-sm"');
    expect(source).toContain('className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 text-xs"');
    expect(source).toContain('className="min-w-0 truncate text-left font-medium text-slate-800"');
    expect(source).not.toContain('className="grid grid-cols-[72px_1fr] gap-3 text-xs"');
    expect(source).toContain('className="border-b border-slate-100 py-5 first:pt-0 last:border-b-0 last:pb-0"');
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

  test("Given product operation rating form, When rendering fields, Then merchant and product scoring stay in one column", async () => {
    const source = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(source).toContain('className="grid gap-3"');
    expect(source).not.toContain("xl:grid-cols-2");
    expect(source).not.toContain("md:grid-cols-2");
  });

  test("Given product operation rating form, When rendering summary, Then top metric cards are shown", async () => {
    const source = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(source).toContain("RatingMetricCard");
    expect(source).toContain('label="销售自评"');
    expect(source).toContain('label="建议总分"');
    expect(source).toContain('label="确认总分"');
    expect(source).toContain('label="最终评级"');
  });

  test("Given product operation rating form, When scrolling fields, Then summary cards stay fixed and compact", async () => {
    const source = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(source).toContain('Card className="flex h-full max-h-full flex-col border-0 bg-white shadow-sm"');
    expect(source).toContain('CardContent className="flex min-h-0 flex-1 flex-col gap-3"');
    expect(source).toContain('className="grid shrink-0 gap-2 sm:grid-cols-2"');
    expect(source).toContain('className="ticket-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"');
    expect(source).toContain("px-2.5 py-2");
    expect(source).toContain("text-xl");
  });

  test("Given product operation rating form, When rendering sales self rating, Then it reuses detail area rating", async () => {
    const detailSource = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const panelSource = await Bun.file("frontend/src/components/tickets/ProductOperationRatingPanel.tsx").text();

    expect(detailSource).toContain('const salesSelfRating = displayPayloadText(currentPayload, metadata, "selfRatingNew.text", "selfRating", "acnLevel");');
    expect(detailSource).toContain("salesSelfRating={salesSelfRating}");
    expect(panelSource).toContain("salesSelfRating: string;");
    expect(panelSource).toContain('value={salesSelfRating || "未保存"}');
  });

  test("Given ticket detail page, When rendering business fields, Then only requested detail labels are configured", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    [
      "商品名称",
      "提报商户",
      "提报公司",
      "商品ID",
      "套餐类型",
      "签约城市",
      "商品类目",
      "适用门店数量",
      "建议使用人数",
      "套餐限购",
      "是否可以外带餐食",
      "是否可以使用包间",
      "是否额外收费",
      "套餐内容",
      "售价",
      "原价",
      "扣点",
      "折扣",
      "购买须知",
      "商品特色",
      "售卖开始时间",
      "售卖结束时间",
      "核销有效截止日期/核销使用天数",
      "签约份数",
      "免结算份数",
      "免结算金额",
      "免结算抽佣比例",
      "预约规则",
      "营业时间",
      "大区评级",
      "签约BD",
      "签约BD小组",
      "签约BD城市",
      "签约BD小区",
      "签约BD大区",
      "OA审批类型",
      "OA审批编号",
    ].forEach((label) => {
      expect(source).toContain(`label: "${label}"`);
    });

    [
      "商品主图",
      "商品轮播图",
      "套餐详情页配图",
      "商户近30天经营流水",
      "城市品审截图",
      "套餐合同",
    ].forEach((label) => {
      expect(source).toContain(`label: "${label}"`);
    });

    expect(source).toContain('empty: "未提供 OA 审批编号"');
    expect(source).not.toContain('label: "营业执照"');
    expect(source).not.toContain('label: "食品经营许可证"');
    expect(source).not.toContain('label: "是否可以打包"');
    expect(source).not.toContain('label: "是否包含保险"');
    expect(source).not.toContain('{ label: "商品类目", fields: ["classification"], kind: "long" }');
  });

  test("Given report merchant and company fields, When rendering detail page, Then external detail modal is available", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("ReportReferenceDetailDialog");
    expect(source).toContain("getRebuildReferenceDetail");
    expect(source).toContain("提报公司");
    expect(source).toContain("公司名称");
    expect(source).toContain("提报商户");
    expect(source).toContain("主商户名称");
  });

  test("Given report merchant license fields, When rendering detail page, Then industry license uses REBUILD certification field", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain('{ label: "行业许可证类型", fields: ["certificationType", "certification"] }');
    expect(source).toContain('{ label: "行业许可证", fields: ["certification"], kindHint: "image" }');
    expect(source).not.toContain('{ label: "商家食品证", fields: ["foodLicense"], kindHint: "image" }');
  });

  test("Given report company fields, When rendering company review status, Then it uses REBUILD auditStatus field", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain('{ label: "公司审核状态", fields: ["auditStatus"] }');
    expect(source).not.toContain('{ label: "公司审核状态", fields: ["approvalState", "approvalState.text"] }');
  });

  test("Given report company attachment fields, When rendering company modal, Then it uses REBUILD company asset field names", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain('{ label: "公司合同", fields: ["coontractFile", "publicityContract", "companyContract"], kindHint: "pdf" }');
    expect(source).toContain('{ label: "收款委托授权书", fields: ["authLetter", "authorizationLetter", "collectionAuthorizationLetter", "receiptAuthorizationLetter"], kindHint: "image" }');
  });

  test("Given report merchant and company links, When rendering basic fields, Then they can share one row without a trailing icon", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const dialogSource = source.slice(
      source.indexOf("function ReportReferenceDetailDialog"),
      source.indexOf("function ReportReferenceFieldView"),
    );

    expect(source).not.toContain("const isReference = field.kind === \"reference\";");
    expect(source).not.toContain('isLong || isReference');
    expect(source).toContain('cn("grid gap-1.5 text-[12px]", isLong && "sm:col-span-2 lg:col-span-3 2xl:col-span-4")');
    expect(dialogSource).not.toContain("<ExternalLink");
  });

  test("Given report reference modal, When rendering detail fields, Then fields use divider rows instead of boxed cards", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const fieldSource = source.slice(
      source.indexOf("function ReportReferenceFieldView"),
      source.indexOf("function MediaFieldsGroup"),
    );

    expect(fieldSource).toContain("border-b border-slate-100 py-2.5 last:border-b-0");
    expect(fieldSource).toContain("sm:grid-cols-[120px_minmax(0,1fr)]");
    expect(fieldSource).not.toContain("rounded-md bg-slate-50 px-3 py-2");
    expect(fieldSource).not.toContain("shadow-sm ring-1 ring-slate-200");
  });

  test("Given report reference modal, When rendering detail fields, Then it uses reference metadata for labels and values", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("getRebuildReferenceMetadata");
    expect(source).toContain("Promise.all([");
    expect(source).toContain("buildReferenceDisplayContext(displayContext, metadata)");
    expect(source).toContain("...metadata.fieldMetadata");
    expect(source).toContain("...metadata.fieldOptions");
    expect(source).toContain("resolveReportReferenceFieldLabel(field, displayContext)");
  });

  test("Given report reference modal has media fields, When rendering preview links, Then it shows preview text without trailing icon", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const fieldSource = source.slice(
      source.indexOf("function ReportReferenceFieldView"),
      source.indexOf("function resolveReportReferenceFieldLabel"),
    );

    expect(fieldSource).toContain("预览");
    expect(fieldSource).not.toContain("item.fileName");
    expect(fieldSource).not.toContain("<ExternalLink");
  });

  test("Given report reference modal has image media, When rendering previews, Then it reuses the detail image preview", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const previewSource = source.slice(
      source.indexOf("function ReportReferencePreviewItem"),
      source.indexOf("function resolveReportReferenceFieldLabel"),
    );

    expect(previewSource).toContain('item.kind === "image"');
    expect(previewSource).toContain("<ImagePreviewItem item={item} />");
  });

  test("Given report reference modal has file media, When clicking preview, Then it opens the detail file preview modal", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();
    const previewSource = source.slice(
      source.indexOf("function ReportReferencePreviewItem"),
      source.indexOf("function resolveReportReferenceFieldLabel"),
    );

    expect(previewSource).toContain("<Dialog>");
    expect(previewSource).toContain("<DialogTrigger asChild>");
    expect(previewSource).toContain("<FilePreviewDialog item={item} />");
    expect(previewSource).not.toContain('target="_blank"');
  });

  test("Given dense ticket detail fields, When rendering the page, Then field groups share one frame with responsive columns", async () => {
    const source = await Bun.file("frontend/src/routes/TicketDetailPage.tsx").text();

    expect(source).toContain("TicketInfoFrame");
    expect(source).not.toContain("工单信息");
    expect(source).toContain("sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4");
    expect(source).toContain("sm:col-span-2 lg:col-span-3 2xl:col-span-4");
    expect(source).toContain("MediaFieldsGroup");
    expect(source).toContain('className="space-y-5 pt-4"');
    expect(source).toContain("space-y-3 border-t border-slate-100 pt-5 first:border-t-0 first:pt-0");
    expect(source).toContain("gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4");
    expect(source).toContain('className="space-y-3"');
    expect(source).toContain("md:grid-cols-[96px_1fr]");
    expect(source).toContain("h-10 w-[min(220px,calc(100vw-48px))]");
    expect(source).toContain("h-6 w-6");
    expect(source).not.toContain("md:grid-cols-[128px_1fr]");
    expect(source).not.toContain("h-20 w-[min(320px,calc(100vw-48px))]");
    expect(source).not.toContain("h-14 w-[min(260px,calc(100vw-48px))]");
    expect(source).not.toContain("h-12 w-[min(220px,calc(100vw-48px))]");
    expect(source).toContain('text-[12px]');
    expect(source).toContain('text-[10px]');
    expect(source).toContain("text-slate-400");
    expect(source).toContain('isLong ? "whitespace-pre-wrap leading-5 text-slate-900"');
    expect(source).not.toContain("min-w-0 font-medium");
    expect(source).not.toContain('className="text-sm font-semibold text-slate-950"');
    expect(source).not.toContain('className="text-xs font-medium text-slate-500"');
    expect(source).not.toContain("rounded-md bg-slate-50 px-3 py-2 leading-6 text-slate-800");
    expect(source).not.toContain("主图、轮播图、详情页配图、经营流水与合同等素材。");
    expect(source).not.toContain("套餐规则、售卖价格、购买须知与商品特色。");
    expect(source).not.toContain("<DetailSections");
    expect(source).not.toContain("<MediaSection");
  });
});
