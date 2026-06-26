import { describe, expect, test } from "bun:test";

import { buildTicketHeaderBadges, buildTicketWorkbenchModel, deriveTicketFlow } from "./ticket-detail-workbench.ts";
import type { TicketActionRecord, TicketRecord } from "./api.ts";

const ticket: TicketRecord = {
  id: 38,
  supplyGoodsId: "F00-838",
  status: "todo",
  businessStatus: "access_review_pending",
  payload: {},
  sourcePayload: {
    goodsNameInput: "双人套餐（牛买双拼）",
    hostNameInput: "星河烤肉·人民广场店",
    bdUser: { fullName: "张达岩" },
    modifiedOn: "2026-06-21T18:00:00.000Z",
  },
  createdAt: "2026-06-21T09:45:00.000Z",
  updatedAt: "2026-06-21T18:00:00.000Z",
};

const records: TicketActionRecord[] = [
  {
    id: 1,
    ticketId: 38,
    action: "import_from_rebuild",
    origin: { goodsNameInput: null },
    current: { goodsNameInput: "双人套餐（牛买双拼）" },
    operator: { source: "rebuild" },
    remark: "Rebuild 审核通过后初始化 ticket payload",
    createdAt: "2026-06-21T09:45:00.000Z",
  },
];

describe("工单详情工作台模型", () => {
  test("Given ticket status, When building header badges, Then only business and overall status are shown", () => {
    expect(buildTicketHeaderBadges(ticket)).toEqual([
      { label: "待准入审核", variant: "success" },
      { label: "工单 · 待处理", variant: "muted" },
    ]);
  });

  test("Given ticket and records, When building workbench model, Then sidebar fields and progress are readable", () => {
    const model = buildTicketWorkbenchModel(ticket, records);

    expect(model.metaItems).toEqual([
      { label: "工单编号", value: "F00-838" },
      { label: "商户名称", value: "星河烤肉·人民广场店" },
      { label: "商品名称", value: "双人套餐（牛买双拼）" },
      { label: "当前节点", value: "待准入审核" },
    ]);
    expect(model.progressSteps[0]).toEqual({ index: 1, label: "待完善信息", state: "done" });
    expect(model.progressSteps[1]).toEqual({ index: 2, label: "待准入审核", state: "active" });
    expect(model.progressSteps.map((step) => step.label)).toEqual([
      "待完善信息",
      "待准入审核",
      "待信息优化确认",
      "待货架上线确认",
      "待佣金设置",
      "待商品上线",
      "商品上线",
    ]);
    expect(model.currentFlow).toBe("access_review");
    expect(model.activityItems[0]?.title).toBe("Rebuild");
  });

  test("Given current payload overrides source payload, When building workbench model, Then meta uses latest values", () => {
    const model = buildTicketWorkbenchModel(
      {
      ...ticket,
      businessStatus: "info_optimization_pending",
      payload: {
          goodsNameInput: "双人套餐｜AI优化版",
        },
      },
      records,
    );

    expect(model.metaItems.find((item) => item.label === "商品名称")?.value).toBe("双人套餐｜AI优化版");
  });

  test("Given approval and action records, When deriving ticket flow, Then it follows the lightweight workflow", () => {
    expect(deriveTicketFlow({
      ...ticket,
      status: "returned",
      businessStatus: "info_completion_pending",
      payload: {},
    }, [])).toBe("info_completion");
    expect(deriveTicketFlow({ ...ticket, businessStatus: "access_review_pending", payload: {} }, [])).toBe("access_review");

    const approvedTicket = {
      ...ticket,
      payload: { goodsNameInput: "双人套餐（牛买双拼）" },
    };

    expect(deriveTicketFlow({ ...approvedTicket, businessStatus: "info_optimization_pending" }, records)).toBe("info_optimization");
    expect(deriveTicketFlow({ ...approvedTicket, businessStatus: "shelf_confirm_pending" }, records)).toBe("shelf_confirm");
    expect(deriveTicketFlow({ ...approvedTicket, businessStatus: "commission_setup_pending" }, records)).toBe("commission_setup");
    expect(deriveTicketFlow({ ...approvedTicket, businessStatus: "product_online_pending" }, records)).toBe("product_online_pending");
    expect(deriveTicketFlow({ ...approvedTicket, businessStatus: "online" }, records)).toBe("product_online");
  });

  test("Given info optimization flow, When building action buttons, Then only confirmation stays in sidebar", () => {
    const model = buildTicketWorkbenchModel(
      {
        ...ticket,
        businessStatus: "info_optimization_pending",
        payload: { packages: { viewList: [{ groupName: "原始组" }] } },
      },
      records,
    );

    expect(model.actionButtons.map((button) => button.label)).toEqual(["确认采用优化"]);
  });

  test("Given draft creation failed, When building action buttons, Then retry stays in sidebar", () => {
    const model = buildTicketWorkbenchModel(
      {
        ...ticket,
        businessStatus: "info_optimization_pending",
        payload: { packages: { viewList: [{ groupName: "优化组" }] } },
      },
      [
        {
          id: 2,
          ticketId: 38,
          action: "lin_ke_draft_failed",
          origin: {},
          current: {},
          operator: {},
          remark: "林客草稿创建失败",
          createdAt: "2026-06-21T10:00:00.000Z",
        },
        ...records,
      ],
    );

    expect(model.actionButtons.map((button) => button.label)).toEqual(["重试创建草稿"]);
  });

  test("Given rejected ticket needs completion, When building workbench model, Then it shows returned status and Rebuild action", () => {
    const model = buildTicketWorkbenchModel({
      ...ticket,
      status: "returned",
      businessStatus: "info_completion_pending",
    }, []);

    expect(buildTicketHeaderBadges({
      ...ticket,
      status: "returned",
      businessStatus: "info_completion_pending",
    })).toEqual([
      { label: "待完善信息", variant: "success" },
      { label: "工单 · 已驳回", variant: "muted" },
    ]);
    expect(model.metaItems.find((item) => item.label === "当前节点")?.value).toBe("待完善信息");
    expect(model.progressSteps[0]).toEqual({ index: 1, label: "待完善信息", state: "active" });
    expect(model.actionButtons[0]?.label).toBe("跳转 Rebuild 审核");
  });
});
