import {
  ArrowLeft,
  ClipboardCheck,
  ExternalLink,
  FileText,
  ImageIcon,
  LinkIcon,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import type { AuthState } from "@/App.tsx";
import { ensureTicketMetadataAtom, ticketMetadataStateAtom } from "@/atoms/ticket-metadata.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getTicket, type TicketMetadata, type TicketRecord } from "@/lib/api.ts";
import { getPayloadDisplayText, type FieldDisplayContext } from "@/lib/field-display.ts";
import { buildMediaPreviewItems, type MediaPreviewItem, type MediaPreviewKind } from "@/lib/media-preview.ts";
import { cn } from "@/lib/utils.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const PDF_PREVIEW_OPTIONS = {
  disableAutoFetch: true,
  disableRange: true,
  disableStream: true,
};

const PDF_PREVIEW_CACHE_BUST = "20260624-cors";

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
  kindHint?: MediaPreviewKind;
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
  { label: "套餐合同", fields: ["packageContract"], kindHint: "pdf" },
  { label: "营业执照", fields: ["businessLicensePicture"] },
  { label: "食品经营许可证", fields: ["foodLicense"] },
];

export function TicketDetailPage({ authState, ticketId }: TicketDetailPageProps) {
  const metadataState = useAtomValue(ticketMetadataStateAtom);
  const ensureTicketMetadata = useSetAtom(ensureTicketMetadataAtom);
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void refreshTicket(ticketId);
  }, [ticketId]);

  useEffect(() => {
    void ensureTicketMetadata();
  }, [ensureTicketMetadata]);

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

  if (isLoading || (metadataState.isLoading && !metadataState.data)) {
    return <DetailSkeleton />;
  }

  const metadata = metadataState.data;
  if (!ticket || !metadata) {
    return <MissingTicket errorMessage={errorMessage || metadataState.errorMessage} />;
  }

  return (
    <LoadedTicketDetail
      ticket={ticket}
      metadata={metadata}
      authState={authState}
      onRefresh={() => void refreshTicket()}
    />
  );
}

function LoadedTicketDetail({
  ticket,
  metadata,
  authState,
  onRefresh,
}: {
  ticket: TicketRecord;
  metadata: TicketMetadata;
  authState: AuthState;
  onRefresh: () => void;
}) {
  const payload = ticket.payload;
  const title = displayPayloadText(ticket, metadata, "goodsName", "goodsNameInput") || "未命名商品";
  const merchant = displayPayloadText(ticket, metadata, "hostNameInput", "rbhost.hostName", "rbhost") || "未提供商户";
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
        <SummaryStrip ticket={ticket} metadata={metadata} />
        <DetailSections sections={BASIC_SECTIONS} payload={payload} displayContext={metadata} />
        <MediaSection ticket={ticket} metadata={metadata} />
        <DetailSections sections={PACKAGE_SECTIONS} payload={payload} displayContext={metadata} />
        <DetailSections sections={OPERATION_SECTIONS} payload={payload} displayContext={metadata} />
        <RawPayload payload={payload} />
      </div>
    </div>
  );
}

function displayPayloadText(ticket: TicketRecord, metadata: TicketMetadata, ...fields: string[]): string {
  return getPayloadDisplayText(ticket.payload, fields, {
    fieldMetadata: metadata.fieldMetadata,
    fieldOptions: metadata.fieldOptions,
  });
}

function SummaryStrip({ ticket, metadata }: { ticket: TicketRecord; metadata: TicketMetadata }) {
  const items = [
    { label: "审核状态", value: ticket.approvalState, icon: ClipboardCheck },
    { label: "售价", value: displayPayloadText(ticket, metadata, "price") || "未提供" },
    { label: "结算价", value: displayPayloadText(ticket, metadata, "supplyPrice") || "未提供" },
    { label: "签约城市", value: displayPayloadText(ticket, metadata, "signCity", "bdCity") || "未提供" },
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

function MediaSection({ ticket, metadata }: { ticket: TicketRecord; metadata: TicketMetadata }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">图片与附件</CardTitle>
        <p className="text-sm text-slate-500">主图、轮播图、详情页配图、经营流水与合同等素材。</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {MEDIA_FIELDS.map((field) => (
          <MediaFieldView key={field.label} field={field} ticket={ticket} metadata={metadata} />
        ))}
      </CardContent>
    </Card>
  );
}

function MediaFieldView({
  field,
  ticket,
  metadata,
}: {
  field: MediaField;
  ticket: TicketRecord;
  metadata: TicketMetadata;
}) {
  const items = buildMediaPreviewItems({
    payload: ticket.payload,
    assets: ticket.assets,
    fields: field.fields,
    fieldMetadata: metadata.fieldMetadata,
    kindHint: field.kindHint,
  });
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
          <MediaItem key={`${field.label}-${index}-${item.source}-${item.url}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function MediaItem({ item }: { item: MediaPreviewItem }) {
  if (item.kind === "image") {
    return <ImagePreviewItem item={item} />;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={!item.canPreview}
          className={cn(
            "flex h-20 w-[min(320px,calc(100vw-48px))] items-center gap-3 rounded-md bg-slate-50 px-3 text-left text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition",
            item.canPreview ? "hover:bg-white hover:shadow-md" : "cursor-not-allowed opacity-70",
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white shadow-sm">
            {item.kind === "pdf" ? (
              <FileText className="h-5 w-5 text-red-500" />
            ) : (
              <LinkIcon className="h-5 w-5 text-slate-500" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-900">{item.fileName}</span>
            <span className="mt-1 block text-xs text-slate-500">
              {item.canPreview ? "点击预览文件" : "等待 R2 镜像后预览"}
            </span>
          </span>
          {item.canPreview ? <Maximize2 className="h-4 w-4 shrink-0 text-slate-400" /> : null}
        </button>
      </DialogTrigger>
      {item.canPreview ? <FilePreviewDialog item={item} /> : null}
    </Dialog>
  );
}

function ImagePreviewItem({ item }: { item: MediaPreviewItem }) {
  if (!item.canPreview) {
    return (
      <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md bg-slate-50 text-xs text-slate-400 shadow-sm ring-1 ring-slate-200">
        <ImageIcon className="h-5 w-5" />
        <span>待镜像</span>
      </div>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group relative block h-24 w-24 overflow-hidden rounded-md shadow-sm ring-1 ring-slate-200"
        >
          <img
            src={item.url}
            alt={item.fileName}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-slate-950/55 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
            预览
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,960px)] p-4">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate text-base">{item.fileName}</DialogTitle>
          <DialogDescription>图片预览</DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-[72vh] overflow-auto rounded-md bg-slate-950/5 p-2">
          <img
            src={item.url}
            alt={item.fileName}
            className="mx-auto max-h-[68vh] max-w-full rounded-md object-contain"
          />
        </div>
        <PreviewActions item={item} />
      </DialogContent>
    </Dialog>
  );
}

function FilePreviewDialog({ item }: { item: MediaPreviewItem }) {
  return (
    <DialogContent className="w-[min(94vw,1040px)] p-4">
      <DialogHeader className="pr-8">
        <DialogTitle className="truncate text-base">{item.fileName}</DialogTitle>
        <DialogDescription>{item.kind === "pdf" ? "PDF 文件预览" : "文件预览"}</DialogDescription>
      </DialogHeader>
      {item.kind === "pdf" ? <PdfPreview item={item} /> : <GenericFilePreview item={item} />}
      <PreviewActions item={item} />
    </DialogContent>
  );
}

function PdfPreview({ item }: { item: MediaPreviewItem }) {
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const pdfUrl = useMemo(() => buildPdfPreviewUrl(item.url), [item.url]);

  return (
    <div className="mt-4 overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 bg-white px-3 text-sm">
        <div className="font-medium text-slate-700">
          {pageCount > 0 ? `第 ${pageNumber} / ${pageCount} 页` : "PDF 加载中"}
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pageNumber >= pageCount}
              onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </div>
      <div className="h-[68vh] overflow-auto bg-slate-200 p-4">
        <Document
          file={pdfUrl}
          options={PDF_PREVIEW_OPTIONS}
          loading={<PdfLoading />}
          error={<PdfError />}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages);
            setPageNumber(1);
          }}
        >
          <Page
            pageNumber={pageNumber}
            width={840}
            loading={<PdfLoading />}
            className="mx-auto overflow-hidden rounded-md bg-white shadow-sm"
          />
        </Document>
      </div>
    </div>
  );
}

function buildPdfPreviewUrl(url: string): string {
  try {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("pdf_preview", PDF_PREVIEW_CACHE_BUST);
    return nextUrl.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}pdf_preview=${PDF_PREVIEW_CACHE_BUST}`;
  }
}

function PdfLoading() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-500">
      正在加载 PDF...
    </div>
  );
}

function PdfError() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-slate-600">
      <FileText className="h-10 w-10 text-red-500" />
      <div className="font-medium text-slate-900">PDF 加载失败</div>
      <div className="text-slate-500">可以尝试用下方按钮在新窗口打开。</div>
    </div>
  );
}

function GenericFilePreview({ item }: { item: MediaPreviewItem }) {
  return (
    <div className="mt-4 h-[72vh] overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200">
      <iframe src={item.url} title={item.fileName} className="h-full w-full bg-white" />
    </div>
  );
}

function PreviewActions({ item }: { item: MediaPreviewItem }) {
  return (
    <div className="mt-3 flex justify-end">
      <Button variant="outline" size="sm" asChild>
        <a href={item.url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" />
          新窗口打开
        </a>
      </Button>
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
