import {
  ArrowLeft,
  ClipboardCheck,
  ExternalLink,
  FileText,
  ImageIcon,
  LinkIcon,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import type { AuthState } from "@/App.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getTicket, type TicketRecord } from "@/lib/api.ts";
import { getPayloadDisplayText, getPayloadMediaItems, type FieldDisplayContext } from "@/lib/field-display.ts";
import { cn } from "@/lib/utils.ts";

interface TicketDetailPageProps {
  authState: AuthState;
  ticketId: string;
}

interface DetailField {
  label: string;
  fields: string[];
  empty?: string;
  kind?: "text" | "link" | "long";
}

interface MediaField {
  label: string;
  fields: string[];
}

interface DetailSection {
  title: string;
  description?: string;
  fields: DetailField[];
}

const BASIC_SECTIONS: DetailSection[] = [
  {
    title: "提报基础信息",
    fields: [
      { label: "商品名称", fields: ["goodsName", "goodsNameInput"], kind: "long" },
      { label: "提报商户", fields: ["hostNameInput", "rbhost.hostName", "rbhost"] },
      { label: "提报公司", fields: ["companyName", "company.companyName", "company"] },
      { label: "不参与活动门店", fields: ["excludeHost"], empty: "无" },
      { label: "是否使用TP权益", fields: ["isTpGoods"], empty: "否" },
      { label: "商户绑定TP包", fields: ["hostTpRightsBind.curTpRightsOrderNo"], empty: "无" },
      { label: "使用CPS类型", fields: ["supplyTpChannel.text", "supplyTpChannel"] },
      { label: "商品ID", fields: ["goodsId"] },
      { label: "预览链接", fields: ["previewUrl"], kind: "link" },
      { label: "入库商品", fields: ["targetGoods", "goodsNameInput"], kind: "link" },
    ],
  },
  {
    title: "类目与渠道",
    fields: [
      { label: "套餐类型", fields: ["mealType.text", "mealType"] },
      { label: "签约城市", fields: ["signCity", "bdCity"] },
      { label: "商品类目", fields: ["classification"], kind: "long" },
      { label: "商品计划上线渠道", fields: ["showChannel.text", "onlineChannel", "showChannel"] },
    ],
  },
];

const PACKAGE_SECTIONS: DetailSection[] = [
  {
    title: "套餐内容",
    description: "价格、套餐说明、购买须知与商品特色。",
    fields: [
      { label: "套餐组名", fields: ["goodsNameInput", "goodsName"] },
      { label: "原价", fields: ["originPrice"] },
      { label: "售价", fields: ["price"] },
      { label: "结算价", fields: ["supplyPrice"] },
      { label: "折扣", fields: ["discount"] },
      { label: "套餐内容", fields: ["packages", "details"], kind: "long" },
      { label: "购买须知", fields: ["presentingRemindWords", "guideline", "reservationRule"], kind: "long" },
      { label: "商品特色", fields: ["goodsFeatures", "salePoint", "hotReason"], kind: "long" },
    ],
  },
  {
    title: "规则与限制",
    fields: [
      { label: "限购", fields: ["singleUserPurchaseLimit", "limitation"], empty: "否" },
      { label: "投放渠道", fields: ["onlineChannel", "showChannel.text", "showChannel", "channelLimit"], empty: "不限制" },
      { label: "是否可以外带餐食", fields: ["isOutMeal"], empty: "否" },
      { label: "是否可以打包", fields: ["isUseBox"], empty: "否" },
      { label: "是否可以使用包间", fields: ["isCoupoun"], empty: "否" },
      { label: "是否可以享受店内其他优惠", fields: ["presentingRemindConfirm"], empty: "否" },
      { label: "建议使用人数", fields: ["eatPersonNum"], empty: "1" },
      { label: "最多使用人数", fields: ["maxEatPersonNum"], empty: "1" },
      { label: "是否包含保险", fields: ["isInsurance"], empty: "否" },
      { label: "节假日是否额外收费", fields: ["isFeeExceptHoliday"], empty: "否" },
      { label: "是否需要取票", fields: ["isGetTicket"], empty: "否" },
      { label: "适用人群", fields: ["acceptGroup.text", "acceptGroup"], empty: "通用人群" },
      { label: "是否限制性别", fields: ["isLimitSexNew.text", "isLimitSex"], empty: "不限制" },
      { label: "是否限制长短发", fields: ["isLimitHairNew.text", "isLimitHair"], empty: "不限制" },
      { label: "商家原会员是否限制体验", fields: ["isLimitExperience"], empty: "否" },
    ],
  },
  {
    title: "售卖与预约",
    fields: [
      { label: "适用门店数量", fields: ["hostNum"], empty: "1" },
      { label: "售卖开始时间", fields: ["saleBegin"] },
      { label: "售卖结束时间", fields: ["saleUntil"] },
      { label: "核销有效截止日期", fields: ["validUntil"] },
      { label: "签约份数", fields: ["signAmount"] },
      { label: "免结算份数", fields: ["freeSettleAmount"] },
      { label: "免结算金额", fields: ["freeSettleNote"] },
      { label: "免结算抽佣比例", fields: ["freeSettleRatio"] },
      { label: "预约规则", fields: ["reservationRule.text", "reservationRule"] },
      { label: "提前预约时间", fields: ["advanceBookDate"] },
      { label: "单位", fields: ["timeUnit.text", "timeUnit"] },
      { label: "使用时间", fields: ["useDate.text", "useStartTime", "useEndTime"] },
    ],
  },
];

const OPERATION_SECTIONS: DetailSection[] = [
  {
    title: "商户与销售信息",
    fields: [
      { label: "大区评级", fields: ["selfRatingNew.text", "selfRating", "acnLevel"] },
      { label: "是否规划爆品", fields: ["isHotPlanned"], empty: "否" },
      { label: "签约BD", fields: ["bdUser.fullName", "bdUser"] },
      { label: "签约BD小组", fields: ["bdGroup"] },
      { label: "签约BD城市", fields: ["bdCity"] },
      { label: "签约BD小区", fields: ["bdSubRegion"] },
      { label: "签约BD大区", fields: ["bdRegion"] },
      { label: "商户PoiID匹配成功", fields: ["isHostPOIIDMatch"], empty: "否" },
      { label: "OA审批类型", fields: ["OAApprovalType"], empty: "无" },
      { label: "OA审批编号", fields: ["OAApprovalNo"], empty: "无" },
    ],
  },
];

const MEDIA_FIELDS: MediaField[] = [
  { label: "商品主图", fields: ["mainPic"] },
  { label: "商品轮播图", fields: ["rbimages"] },
  { label: "套餐详情页配图", fields: ["detailImages"] },
  { label: "商户近30天经营流水", fields: ["regionRatingCertificate"] },
  { label: "套餐合同", fields: ["packageContract"] },
  { label: "营业执照", fields: ["businessLicensePicture"] },
  { label: "食品经营许可证", fields: ["foodLicense"] },
];

export function TicketDetailPage({ authState, ticketId }: TicketDetailPageProps) {
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void refreshTicket(ticketId);
  }, [ticketId]);

  async function refreshTicket(nextTicketId = ticketId) {
    setIsLoading(true);
    setErrorMessage("");
    try {
      setTicket(await getTicket(nextTicketId));
    } catch (error) {
      setTicket(null);
      setErrorMessage(error instanceof Error ? error.message : "加载工单详情失败");
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!ticket) {
    return <MissingTicket errorMessage={errorMessage} />;
  }

  return <LoadedTicketDetail ticket={ticket} authState={authState} onRefresh={() => void refreshTicket()} />;
}

function LoadedTicketDetail({
  ticket,
  authState,
  onRefresh,
}: {
  ticket: TicketRecord;
  authState: AuthState;
  onRefresh: () => void;
}) {
  const payload = ticket.payload;
  const title = displayPayloadText(ticket, "goodsName", "goodsNameInput") || "未命名商品";
  const merchant = displayPayloadText(ticket, "hostNameInput", "rbhost.hostName", "rbhost") || "未提供商户";
  const updatedAt = useMemo(() => formatDateTime(ticket.updatedAt), [ticket.updatedAt]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-14 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
              <Link to="/tickets">
                <ArrowLeft className="h-4 w-4" />
                返回列表
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="max-w-4xl truncate text-xl font-semibold text-slate-950">{title}</h1>
              <Badge variant="default">{ticket.approvalState}</Badge>
              <Badge variant={authState.token ? "success" : "muted"}>
                {authState.token ? "已桥接登录态" : "本地接口"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {merchant} · {ticket.supplyGoodsId} · 更新 {updatedAt}
            </p>
          </div>
          <Button variant="outline" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        <SummaryStrip ticket={ticket} />
        <DetailSections sections={BASIC_SECTIONS} payload={payload} displayContext={ticket} />
        <MediaSection payload={payload} />
        <DetailSections sections={PACKAGE_SECTIONS} payload={payload} displayContext={ticket} />
        <DetailSections sections={OPERATION_SECTIONS} payload={payload} displayContext={ticket} />
        <RawPayload payload={payload} />
      </div>
    </div>
  );
}

function displayPayloadText(ticket: TicketRecord, ...fields: string[]): string {
  return getPayloadDisplayText(ticket.payload, fields, {
    fieldMetadata: ticket.fieldMetadata,
    fieldOptions: ticket.fieldOptions,
  });
}

function SummaryStrip({ ticket }: { ticket: TicketRecord }) {
  const items = [
    { label: "审核状态", value: ticket.approvalState, icon: ClipboardCheck },
    { label: "售价", value: displayPayloadText(ticket, "price") || "未提供" },
    { label: "结算价", value: displayPayloadText(ticket, "supplyPrice") || "未提供" },
    { label: "签约城市", value: displayPayloadText(ticket, "signCity", "bdCity") || "未提供" },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-2 truncate text-base font-semibold text-slate-950">{item.value}</div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function DetailSections({
  sections,
  payload,
  displayContext,
}: {
  sections: DetailSection[];
  payload: Record<string, unknown>;
  displayContext: FieldDisplayContext;
}) {
  return (
    <>
      {sections.map((section) => (
        <Card key={section.title} className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{section.title}</CardTitle>
            {section.description ? <p className="text-sm text-slate-500">{section.description}</p> : null}
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-12 gap-y-4 md:grid-cols-2">
              {section.fields.map((field) => (
                <DetailFieldView
                  key={`${section.title}-${field.label}`}
                  field={field}
                  payload={payload}
                  displayContext={displayContext}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function DetailFieldView({
  field,
  payload,
  displayContext,
}: {
  field: DetailField;
  payload: Record<string, unknown>;
  displayContext: FieldDisplayContext;
}) {
  const value = getPayloadDisplayText(payload, field.fields, displayContext) || field.empty || "未提供";
  const isLong = field.kind === "long" || value.length > 60;

  return (
    <div className={cn("grid gap-2 text-sm", isLong && "md:col-span-2")}>
      <div className="text-xs font-medium text-slate-500">{field.label}</div>
      {field.kind === "link" && value !== "未提供" && looksLikeUrl(value) ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <span className="truncate">{value}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : isLong ? (
        <div className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 leading-6 text-slate-800">{value}</div>
      ) : (
        <div className="min-w-0 truncate font-medium text-slate-900">{value}</div>
      )}
    </div>
  );
}

function MediaSection({ payload }: { payload: Record<string, unknown> }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">图片与附件</CardTitle>
        <p className="text-sm text-slate-500">主图、轮播图、详情页配图、经营流水与合同等素材。</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {MEDIA_FIELDS.map((field) => (
          <MediaFieldView key={field.label} field={field} payload={payload} />
        ))}
      </CardContent>
    </Card>
  );
}

function MediaFieldView({ field, payload }: { field: MediaField; payload: Record<string, unknown> }) {
  const items = getPayloadMediaItems(payload, ...field.fields);
  if (items.length === 0) {
    return (
      <div className="grid gap-3 md:grid-cols-[128px_1fr]">
        <div className="text-sm font-medium text-slate-500">{field.label}</div>
        <div className="text-sm text-slate-400">未上传</div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-[128px_1fr]">
      <div className="text-sm font-medium text-slate-500">{field.label}</div>
      <div className="flex flex-wrap gap-3">
        {items.map((item, index) => (
          <MediaItem key={`${field.label}-${index}-${item}`} value={item} />
        ))}
      </div>
    </div>
  );
}

function MediaItem({ value }: { value: string }) {
  if (isImageUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="group block">
        <img
          src={value}
          alt={getFileName(value)}
          className="h-24 w-24 rounded-md object-cover shadow-sm ring-1 ring-slate-200 transition group-hover:shadow-md"
        />
      </a>
    );
  }

  const isImagePathValue = isImagePath(value);
  const isPdf = value.toLowerCase().endsWith(".pdf");
  return (
    <div className="flex max-w-[320px] items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
      {isPdf ? <FileText className="h-5 w-5 shrink-0 text-red-500" /> : isImagePathValue ? (
        <ImageIcon className="h-5 w-5 shrink-0 text-blue-500" />
      ) : (
        <LinkIcon className="h-5 w-5 shrink-0 text-slate-400" />
      )}
      <span className="min-w-0 truncate">{getFileName(value)}</span>
    </div>
  );
}

function RawPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <details className="rounded-lg bg-white shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700">查看原始 Payload</summary>
      <pre className="max-h-[420px] overflow-auto border-t border-slate-100 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

function MissingTicket({ errorMessage }: { errorMessage: string }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/tickets">
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </Link>
      </Button>
      <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
        {errorMessage || "工单不存在"}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isImageUrl(value: string) {
  return looksLikeUrl(value) && isImagePath(value);
}

function isImagePath(value: string) {
  return /\.(png|jpe?g|gif|webp|avif)(?:\?.*)?$/i.test(value);
}

function getFileName(value: string) {
  try {
    return decodeURIComponent(value.split("/").pop() || value);
  } catch {
    return value.split("/").pop() || value;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
