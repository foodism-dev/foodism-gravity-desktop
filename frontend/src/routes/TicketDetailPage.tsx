import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageIcon,
  LinkIcon,
  Maximize2,
  RotateCcw,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
import { Input } from "@/components/ui/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  createTicketActionRecord,
  getTicket,
  getTicketActionRecords,
  type TicketActionRecord,
  type TicketMetadata,
  type TicketRecord,
} from "@/lib/api.ts";
import { getPayloadDisplayText, type FieldDisplayContext } from "@/lib/field-display.ts";
import { isElectronEmbedded, openRebuildApprovalInElectron } from "@/lib/electron-bridge.ts";
import { buildMediaPreviewItems, type MediaPreviewItem, type MediaPreviewKind } from "@/lib/media-preview.ts";
import {
  requestTicketInfoOptimization,
  type TicketInfoOptimizationResult,
} from "@/lib/ticket-info-optimization.ts";
import {
  buildTicketHeaderBadges,
  buildTicketWorkbenchModel,
  type TicketWorkbenchModel,
  type WorkbenchActionButton,
} from "@/lib/ticket-detail-workbench.ts";
import { cn } from "@/lib/utils.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const PDF_PREVIEW_OPTIONS = {
  disableAutoFetch: true,
  disableRange: true,
  disableStream: true,
};

const PDF_PREVIEW_CACHE_BUST = "20260624-cors";
const SUPPLY_GOODS_APPROVAL_BASE_URL = "https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods";

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

interface CommissionRateField {
  label: string;
  max: number;
}

type CommissionRateValues = Record<string, string>;

const COMMISSION_RATE_FIELDS: CommissionRateField[] = [
  { label: "线上经营", max: 80 },
  { label: "职人账号", max: 20 },
  { label: "增量宝", max: 80 },
  { label: "获客卡", max: 80 },
  { label: "线下扫码", max: 80 },
];

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

export function TicketDetailPage({ ticketId }: TicketDetailPageProps) {
  const metadataState = useAtomValue(ticketMetadataStateAtom);
  const ensureTicketMetadata = useSetAtom(ensureTicketMetadataAtom);
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [records, setRecords] = useState<TicketActionRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [recordErrorMessage, setRecordErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void refreshTicket(ticketId);
  }, [ticketId]);

  useEffect(() => {
    void ensureTicketMetadata();
  }, [ensureTicketMetadata]);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingRecords(true);
    setRecordErrorMessage("");
    getTicketActionRecords(ticketId)
      .then((nextRecords) => {
        if (isMounted) setRecords(nextRecords);
      })
      .catch((error) => {
        if (isMounted) setRecordErrorMessage(error instanceof Error ? error.message : "加载变更记录失败");
      })
      .finally(() => {
        if (isMounted) setIsLoadingRecords(false);
      });

    return () => {
      isMounted = false;
    };
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
      onRefresh={() => void refreshTicket()}
      onTicketUpdated={setTicket}
      records={records}
      setRecords={setRecords}
      isLoadingRecords={isLoadingRecords}
      recordErrorMessage={recordErrorMessage}
    />
  );
}

function LoadedTicketDetail({
  ticket,
  metadata,
  onRefresh,
  onTicketUpdated,
  records,
  setRecords,
  isLoadingRecords,
  recordErrorMessage,
}: {
  ticket: TicketRecord;
  metadata: TicketMetadata;
  onRefresh: () => void;
  onTicketUpdated: (ticket: TicketRecord) => void;
  records: TicketActionRecord[];
  setRecords: Dispatch<SetStateAction<TicketActionRecord[]>>;
  isLoadingRecords: boolean;
  recordErrorMessage: string;
}) {
  const sourcePayload = ticket.sourcePayload;
  const currentPayload = useMemo(
    () => buildCurrentDisplayPayload(sourcePayload, ticket.payload),
    [sourcePayload, ticket.payload],
  );
  const title = displayPayloadText(currentPayload, metadata, "goodsName", "goodsNameInput") || "未命名商品";
  const merchant = displayPayloadText(currentPayload, metadata, "hostNameInput", "rbhost.hostName", "rbhost") || "未提供商户";
  const workbenchModel = useMemo(() => buildTicketWorkbenchModel(ticket, records), [ticket, records]);
  const headerBadges = useMemo(() => buildTicketHeaderBadges(ticket), [ticket]);
  const [optimizationResult, setOptimizationResult] = useState<TicketInfoOptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationErrorMessage, setOptimizationErrorMessage] = useState("");
  const [shelfGoodsUrl, setShelfGoodsUrl] = useState("");
  const [linkeCommission, setLinkeCommission] = useState<CommissionRateValues>(() => buildInitialLinkeCommission(ticket.payload));
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState("");

  useEffect(() => {
    if (workbenchModel.currentFlow !== "info_optimization") {
      setOptimizationResult(null);
      setOptimizationErrorMessage("");
      return;
    }
    void runInfoOptimization(1);
  }, [ticket.supplyGoodsId, workbenchModel.currentFlow]);

  useEffect(() => {
    setLinkeCommission(buildInitialLinkeCommission(ticket.payload));
  }, [ticket.supplyGoodsId, ticket.payload]);

  async function runInfoOptimization(generation: number) {
    setIsOptimizing(true);
    setOptimizationErrorMessage("");
    try {
      setOptimizationResult(await requestTicketInfoOptimization(ticket, generation));
    } catch (error) {
      setOptimizationErrorMessage(error instanceof Error ? error.message : "信息优化生成失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  async function confirmInfoOptimization() {
    if (!optimizationResult) return;
    await submitTicketAction({
      action: "info_optimized",
      origin: optimizationResult.origin,
      current: optimizationResult.current,
      remark: "确认采用信息优化结果",
    });
    setOptimizationResult(null);
  }

  async function confirmShelfOnline() {
    const url = shelfGoodsUrl.trim();
    if (!url) {
      setActionErrorMessage("请先填写商品链接");
      return;
    }
    await submitTicketAction({
      action: "shelf_online_confirmed",
      origin: {
        onlineGoodsUrl: readRecordValue(ticket.payload, "onlineGoodsUrl"),
      },
      current: {
        onlineGoodsUrl: url,
      },
      remark: "确认货架上线并录入商品链接",
    });
  }

  async function confirmCommission() {
    const validationMessage = validateLinkeCommission(linkeCommission);
    if (validationMessage) {
      setActionErrorMessage(validationMessage);
      return;
    }

    const confirmedAt = new Date().toISOString();
    const normalizedLinkeCommission = normalizeLinkeCommission(linkeCommission);
    await submitTicketAction({
      action: "commission_configured",
      origin: {
        linkeCommission: readRecordValue(ticket.payload, "linkeCommission"),
        commissionConfigured: readRecordValue(ticket.payload, "commissionConfigured"),
        commissionConfiguredAt: readRecordValue(ticket.payload, "commissionConfiguredAt"),
      },
      current: {
        linkeCommission: normalizedLinkeCommission,
        commissionConfigured: true,
        commissionConfiguredAt: confirmedAt,
      },
      remark: "确认佣金设置完成",
    });
  }

  async function manualModifyCommission() {
    await submitTicketAction({
      action: "commission_manual_revision",
      origin: {},
      current: {},
      remark: "进入佣金字段人工修改",
    });
  }

  async function confirmProductOnline() {
    const confirmedAt = new Date().toISOString();
    await submitTicketAction({
      action: "product_online_confirmed",
      origin: {
        productOnlineConfirmed: readRecordValue(ticket.payload, "productOnlineConfirmed"),
        productOnlineConfirmedAt: readRecordValue(ticket.payload, "productOnlineConfirmedAt"),
      },
      current: {
        productOnlineConfirmed: true,
        productOnlineConfirmedAt: confirmedAt,
      },
      remark: "确认商品上线完成",
    });
  }

  async function returnToManualRevision() {
    await submitTicketAction({
      action: "return_to_manual_revision",
      origin: {},
      current: {},
      remark: "返回人工修改信息优化内容",
    });
  }

  async function submitTicketAction(input: Parameters<typeof createTicketActionRecord>[1]) {
    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await createTicketActionRecord(ticket.supplyGoodsId, input);
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
      if (input.action === "shelf_online_confirmed") {
        setShelfGoodsUrl("");
      }
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto grid max-w-[1480px] gap-6 px-5 py-6 xl:grid-cols-[minmax(0,980px)_280px]">
        <div className="min-w-0 rounded-md bg-slate-100 px-8 py-7">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Button variant="ghost" size="sm" asChild className="-ml-2 h-7 px-2 text-xs text-slate-500">
                  <Link to="/tickets">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    我的工单
                  </Link>
                </Button>
                <span>/</span>
                <span>{ticket.supplyGoodsId}</span>
                {headerBadges.map((badge) => (
                  <Badge key={badge.label} variant={badge.variant} className="rounded-full">
                    {badge.label}
                  </Badge>
                ))}
              </div>
              <h1 className="truncate text-2xl font-semibold tracking-normal text-slate-950">{merchant} · {title}</h1>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} className="bg-white">
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>

          <div className="space-y-5">
            <DetailSections sections={BASIC_SECTIONS} payload={currentPayload} displayContext={metadata} />
            <MediaSection ticket={ticket} metadata={metadata} />
            {workbenchModel.currentFlow === "info_optimization" ? (
              <InfoOptimizationDiff
                result={optimizationResult}
                isLoading={isOptimizing}
                errorMessage={optimizationErrorMessage}
              />
            ) : null}
            {workbenchModel.currentFlow === "commission_setup" ? (
              <CommissionSetupPanel
                values={linkeCommission}
                onlineGoodsUrl={readPayloadText(ticket.payload, "onlineGoodsUrl", "shelfGoodsUrl")}
                onChange={(label, value) => setLinkeCommission((current) => ({ ...current, [label]: value }))}
              />
            ) : null}
            <DetailSections sections={PACKAGE_SECTIONS} payload={currentPayload} displayContext={metadata} />
            <DetailSections sections={OPERATION_SECTIONS} payload={currentPayload} displayContext={metadata} />
            <RawPayload title="Rebuild 原始 Payload" payload={sourcePayload} />
          </div>
        </div>
        <TicketActionSidebar
          model={workbenchModel}
          ticket={ticket}
          isLoadingRecords={isLoadingRecords}
          recordErrorMessage={actionErrorMessage || recordErrorMessage}
          isOptimizing={isOptimizing}
          isActionSubmitting={isActionSubmitting}
          canConfirmOptimization={Boolean(optimizationResult)}
          shelfGoodsUrl={shelfGoodsUrl}
          onShelfGoodsUrlChange={setShelfGoodsUrl}
          onRegenerateOptimization={() => void runInfoOptimization((optimizationResult?.generation ?? 0) + 1)}
          onConfirmOptimization={() => void confirmInfoOptimization()}
          onConfirmShelfOnline={() => void confirmShelfOnline()}
          onConfirmCommission={() => void confirmCommission()}
          onConfirmProductOnline={() => void confirmProductOnline()}
          onManualModifyCommission={() => void manualModifyCommission()}
          onReturnToManualRevision={() => void returnToManualRevision()}
        />
      </div>
    </div>
  );
}

function readRecordValue(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : null;
}

function readPayloadText(payload: Record<string, unknown>, ...fields: string[]): string {
  for (const field of fields) {
    const value = readPayloadPath(payload, field);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readPayloadPath(payload: Record<string, unknown>, field: string): unknown {
  if (field in payload) return payload[field];
  return field.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, payload);
}

function displayPayloadText(payload: Record<string, unknown>, metadata: TicketMetadata, ...fields: string[]): string {
  return getPayloadDisplayText(payload, fields, {
    fieldMetadata: metadata.fieldMetadata,
    fieldOptions: metadata.fieldOptions,
  });
}

function buildCurrentDisplayPayload(
  sourcePayload: Record<string, unknown>,
  currentPayload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...sourcePayload,
    ...currentPayload,
  };
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
    assets: {},
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

function InfoOptimizationDiff({
  result,
  isLoading,
  errorMessage,
}: {
  result: TicketInfoOptimizationResult | null;
  isLoading: boolean;
  errorMessage: string;
}) {
  return (
    <Card className="border-0 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-violet-500" />
          信息优化对比
        </CardTitle>
        <p className="text-sm text-slate-500">当前 mock 只优化商品标题，后续可替换为真实优化接口。</p>
      </CardHeader>
      <CardContent>
        {errorMessage ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</div>
        ) : isLoading && !result ? (
          <div className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">正在生成优化结果...</div>
        ) : result ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <TitleDiffPanel title="原始标题" value={result.origin.goodsNameInput} tone="origin" />
            <TitleDiffPanel title={`优化标题 #${result.generation}`} value={result.current.goodsNameInput} tone="current" />
          </div>
        ) : (
          <div className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">等待生成优化结果</div>
        )}
      </CardContent>
    </Card>
  );
}

function TitleDiffPanel({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "origin" | "current";
}) {
  return (
    <div className={cn(
      "rounded-md p-4 ring-1",
      tone === "origin" ? "bg-slate-50 ring-slate-100" : "bg-emerald-50 ring-emerald-100",
    )}>
      <div className={cn("text-xs font-medium", tone === "origin" ? "text-slate-500" : "text-emerald-700")}>{title}</div>
      <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-950">{value || "未提供"}</div>
    </div>
  );
}

function CommissionSetupPanel({
  values,
  onlineGoodsUrl,
  onChange,
}: {
  values: CommissionRateValues;
  onlineGoodsUrl: string;
  onChange: (label: string, value: string) => void;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">费用比例填写</CardTitle>
            <p className="mt-2 text-sm text-slate-500">填写后点击右侧「同步佣金设置」，同步到林客费用设置。</p>
          </div>
          <Button variant="outline" className="bg-blue-50 text-blue-700 hover:bg-blue-100" disabled={!looksLikeUrl(onlineGoodsUrl)} asChild={looksLikeUrl(onlineGoodsUrl)}>
            {looksLikeUrl(onlineGoodsUrl) ? (
              <a href={onlineGoodsUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                打开林客核对
              </a>
            ) : (
              <span className="inline-flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                打开林客核对
              </span>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {COMMISSION_RATE_FIELDS.map((field) => (
            <CommissionRateInput
              key={field.label}
              field={field}
              value={values[field.label] ?? ""}
              onChange={(value) => onChange(field.label, value)}
            />
          ))}
        </div>
        <div className="rounded-md bg-blue-50 px-4 py-3 text-sm font-medium leading-6 text-blue-700 ring-1 ring-blue-100">
          同步成功后，请通过上方链接进入林客确认费用比例已正确落库。确认无误后工单进入「自动追踪中」。
        </div>
      </CardContent>
    </Card>
  );
}

function CommissionRateInput({
  field,
  value,
  onChange,
}: {
  field: CommissionRateField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-md bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-900">
          <span className="mr-1 text-red-500">*</span>
          {field.label}
        </label>
        <span className="text-sm font-medium text-slate-400">上限 {field.max.toFixed(2)}%</span>
      </div>
      <div className="relative">
        <Input
          value={value}
          inputMode="decimal"
          placeholder="请输入"
          onChange={(event) => onChange(sanitizeCommissionRateInput(event.target.value))}
          className="h-12 bg-white pr-12 text-lg font-semibold"
        />
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-lg font-semibold text-slate-500">%</span>
      </div>
    </div>
  );
}

function buildInitialLinkeCommission(payload: Record<string, unknown>): CommissionRateValues {
  const storedRates = readRecordValue(payload, "linkeCommission") ?? readRecordValue(payload, "commissionRates");
  return Object.fromEntries(
    COMMISSION_RATE_FIELDS.map((field) => [
      field.label,
      formatCommissionRateInput(readStoredCommissionRate(storedRates, field.label) ?? 4),
    ]),
  );
}

function readStoredCommissionRate(value: unknown, label: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const rate = value[label];
  if (typeof rate === "number" && Number.isFinite(rate)) return rate;
  if (typeof rate === "string" && rate.trim()) {
    const parsed = Number(rate.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sanitizeCommissionRateInput(value: string): string {
  const normalized = value.replace(/[^\d.]/g, "");
  const [integer = "", ...decimalParts] = normalized.split(".");
  if (decimalParts.length === 0) return integer;
  return `${integer}.${decimalParts.join("").slice(0, 2)}`;
}

function formatCommissionRateInput(value: number): string {
  return value.toFixed(2);
}

function validateLinkeCommission(values: CommissionRateValues): string {
  for (const field of COMMISSION_RATE_FIELDS) {
    const value = values[field.label]?.trim();
    const numberValue = Number(value);
    if (!value || !Number.isFinite(numberValue)) return `请填写${field.label}费用比例`;
    if (numberValue < 0) return `${field.label}费用比例不能小于 0`;
    if (numberValue > field.max) return `${field.label}费用比例不能超过 ${field.max.toFixed(2)}%`;
  }
  return "";
}

function normalizeLinkeCommission(values: CommissionRateValues): Record<string, string> {
  return Object.fromEntries(
    COMMISSION_RATE_FIELDS.map((field) => {
      const numberValue = Number(values[field.label]);
      return [field.label, formatCommissionRateInput(Number.isFinite(numberValue) ? numberValue : 0)];
    }),
  );
}

function TicketActionSidebar({
  model,
  ticket,
  isLoadingRecords,
  recordErrorMessage,
  isOptimizing,
  isActionSubmitting,
  canConfirmOptimization,
  shelfGoodsUrl,
  onShelfGoodsUrlChange,
  onRegenerateOptimization,
  onConfirmOptimization,
  onConfirmShelfOnline,
  onConfirmCommission,
  onConfirmProductOnline,
  onManualModifyCommission,
  onReturnToManualRevision,
}: {
  model: TicketWorkbenchModel;
  ticket: TicketRecord;
  isLoadingRecords: boolean;
  recordErrorMessage: string;
  isOptimizing: boolean;
  isActionSubmitting: boolean;
  canConfirmOptimization: boolean;
  shelfGoodsUrl: string;
  onShelfGoodsUrlChange: (value: string) => void;
  onRegenerateOptimization: () => void;
  onConfirmOptimization: () => void;
  onConfirmShelfOnline: () => void;
  onConfirmCommission: () => void;
  onConfirmProductOnline: () => void;
  onManualModifyCommission: () => void;
  onReturnToManualRevision: () => void;
}) {
  const isBusy = isOptimizing || isActionSubmitting;
  return (
    <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
      <SidebarSection title="工单属性">
        <div className="space-y-2">
          {model.metaItems.map((item) => (
            <div key={item.label} className="grid grid-cols-[72px_1fr] gap-3 text-xs">
              <span className="text-slate-400">{item.label}</span>
              <span className="min-w-0 truncate text-right font-medium text-slate-800">{item.value}</span>
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title="流程进度">
        <div className="space-y-3">
          {model.progressSteps.map((step) => (
            <div key={step.label} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  step.state === "active" && "bg-emerald-500 text-white",
                  step.state === "done" && "bg-emerald-100 text-emerald-700",
                  step.state === "pending" && "bg-slate-100 text-slate-400",
                )}
              >
                {step.index}
              </span>
              <span className={cn("font-medium", step.state === "active" ? "text-emerald-700" : "text-slate-500")}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title="Agent 建议">
        <div className="rounded-md bg-violet-50 p-3 text-xs text-violet-900">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Bot className="h-4 w-4" />
            Agent 分析
            <Badge variant="muted" className="ml-auto bg-violet-100 text-violet-700">待确认</Badge>
          </div>
          <p className="leading-5">
            检测到 Rebuild 已完成资料同步。建议先核对证照、素材与价格字段，再进入准入确认。
          </p>
        </div>
      </SidebarSection>

      <SidebarSection title="执行日志">
        {recordErrorMessage ? (
          <div className="rounded-md bg-red-50 p-3 text-xs text-red-600">{recordErrorMessage}</div>
        ) : isLoadingRecords ? (
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">正在加载执行日志...</div>
        ) : (
          <div className="space-y-3">
            {model.activityItems.length > 0 ? (
              model.activityItems.map((item, index) => (
                <div key={`${item.title}-${index}`} className="flex gap-2 text-xs">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{item.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-slate-500">{item.description}</span>
                  </span>
                  <span className="shrink-0 text-slate-400">{item.time}</span>
                </div>
              ))
            ) : (
              <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">暂无执行日志</div>
            )}
          </div>
        )}
      </SidebarSection>

      <SidebarSection title="人工操作">
        <div className="space-y-2">
          {model.currentFlow === "shelf_confirm" ? (
            <Input
              value={shelfGoodsUrl}
              onChange={(event) => onShelfGoodsUrlChange(event.target.value)}
              placeholder="填写商品链接"
              className="h-10 bg-white"
            />
          ) : null}
          {model.actionButtons.map((actionButton) => (
            <SidebarActionButton
              key={actionButton.label}
              actionButton={actionButton}
              ticket={ticket}
              disabled={isActionDisabled(actionButton.label, {
                canConfirmOptimization,
                isBusy,
                shelfGoodsUrl,
              })}
              onClick={getActionButtonHandler(actionButton.label, {
                onRegenerateOptimization,
                onConfirmOptimization,
                onConfirmShelfOnline,
                onConfirmCommission,
                onConfirmProductOnline,
                onManualModifyCommission,
                onReturnToManualRevision,
              })}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">{getActionHint(model.currentFlow)}</p>
      </SidebarSection>
    </aside>
  );
}

function isActionDisabled(
  label: string,
  state: { canConfirmOptimization: boolean; isBusy: boolean; shelfGoodsUrl: string },
): boolean {
  if (state.isBusy) return true;
  if (label === "确认采用优化") return !state.canConfirmOptimization;
  if (label === "确认上线并填写商品链接") return state.shelfGoodsUrl.trim().length === 0;
  if (label === "查看上线任务") return true;
  return false;
}

function getActionButtonHandler(
  label: string,
  handlers: {
    onRegenerateOptimization: () => void;
    onConfirmOptimization: () => void;
    onConfirmShelfOnline: () => void;
    onConfirmCommission: () => void;
    onConfirmProductOnline: () => void;
    onManualModifyCommission: () => void;
    onReturnToManualRevision: () => void;
  },
): (() => void) | undefined {
  if (label === "重新生成") return handlers.onRegenerateOptimization;
  if (label === "确认采用优化") return handlers.onConfirmOptimization;
  if (label === "确认上线并填写商品链接") return handlers.onConfirmShelfOnline;
  if (label === "同步佣金设置") return handlers.onConfirmCommission;
  if (label === "确认商品上线") return handlers.onConfirmProductOnline;
  if (label === "手动修改") return handlers.onManualModifyCommission;
  if (label === "返回人工修改") return handlers.onReturnToManualRevision;
  return undefined;
}

function SidebarActionButton({
  actionButton,
  ticket,
  disabled,
  onClick,
}: {
  actionButton: WorkbenchActionButton;
  ticket: TicketRecord;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className = getActionButtonClassName(actionButton.tone);
  const icon = getActionButtonIcon(actionButton.tone);
  if (actionButton.label === "跳转 Rebuild 审核") {
    return (
      <Button
        type="button"
        className={className}
        onClick={() => openRebuildApproval(ticket.supplyGoodsId)}
      >
        {icon}
        {actionButton.label}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      className={className}
      variant={actionButton.tone === "primary" ? "default" : "ghost"}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {actionButton.label}
    </Button>
  );
}

function getActionButtonClassName(tone: WorkbenchActionButton["tone"]): string {
  if (tone === "primary") return "h-10 w-full bg-emerald-600 text-white hover:bg-emerald-700";
  if (tone === "danger") return "h-10 w-full border border-red-200 bg-red-50 text-red-600 hover:bg-red-100";
  if (tone === "ghost") return "h-9 w-full text-slate-500";
  return "h-10 w-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
}

function getActionButtonIcon(tone: WorkbenchActionButton["tone"]) {
  if (tone === "danger") return <RotateCcw className="h-4 w-4" />;
  if (tone === "ghost") return <Send className="h-4 w-4" />;
  return <CheckCircle2 className="h-4 w-4" />;
}

function getActionHint(flow: TicketWorkbenchModel["currentFlow"]): string {
  if (flow === "access_review") return "准入未完成时，请先回到 Rebuild 完成审核。";
  if (flow === "info_optimization") return "确认文案后会写入信息优化记录，并进入货架上线确认。";
  if (flow === "shelf_confirm") return "需要填写商品链接，确认后进入佣金设置。";
  if (flow === "commission_setup") return "先在左侧填写费用比例，再同步到林客费用设置。";
  if (flow === "product_online_pending") return "确认商品已经完成上线后，工单会进入已完成状态。";
  return "商品已进入上线任务，后续可查看执行结果。";
}

function buildSupplyGoodsApprovalUrl(supplyGoodsId: string): string {
  return `${SUPPLY_GOODS_APPROVAL_BASE_URL}/${encodeURIComponent(supplyGoodsId)}`;
}

function openRebuildApproval(supplyGoodsId: string) {
  if (isElectronEmbedded() && openRebuildApprovalInElectron(supplyGoodsId)) {
    return;
  }
  window.open(buildSupplyGoodsApprovalUrl(supplyGoodsId), "_blank", "noopener,noreferrer");
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 pb-5 last:border-b-0">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</h2>
      {children}
    </section>
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

function RawPayload({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  return (
    <details className="rounded-lg bg-white shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700">{title}</summary>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
