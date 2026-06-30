import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageIcon,
  LinkIcon,
  Maximize2,
  Pencil,
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
import { ProductOperationRatingPanel } from "@/components/tickets/ProductOperationRatingPanel.tsx";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import {
  createTicketActionRecord,
  confirmLinKeFeeSetup,
  confirmTicketInfoOptimization,
  getLinKeFeeSetupJobStatus,
  getLinKeDraftJobStatus,
  getRebuildReferenceDetail,
  getRebuildReferenceMetadata,
  getTicket,
  getTicketActionRecords,
  retryLinKeDraftJob,
  retryLinKeProductTracking,
  startLinKeFeeSetupJob,
  type RebuildReferenceDetail,
  type RebuildReferenceEntity,
  type RebuildReferenceMetadata,
  type TicketActionRecord,
  type TicketMetadata,
  type TicketRecord,
} from "@/lib/api.ts";
import { getPayloadDisplayText, type FieldDisplayContext } from "@/lib/field-display.ts";
import {
  isElectronEmbedded,
  openBrowserTabInElectron,
  openRebuildApprovalInElectron,
  shouldRefreshTicketFromMessage,
} from "@/lib/electron-bridge.ts";
import {
  COMMISSION_CHILD_OPEN_MAX,
  COMMISSION_TRAFFIC_ROWS,
  allCommissionTrafficSources,
  applyDefaultCommissionRate,
  formatCommissionRateInput,
  getCommissionInputError,
  normalizeLinkeCommission,
  sanitizeCommissionRateInput,
  validateLinkeCommission,
  activeCommissionTrafficFields,
  type CommissionRateValues,
} from "@/lib/linke-fee-rates.ts";
import { buildMediaPreviewItems, type MediaPreviewItem, type MediaPreviewKind } from "@/lib/media-preview.ts";
import {
  haveSameVisiblePackageNames,
  requestTicketInfoOptimization,
  type TicketInfoOptimizationResult,
} from "@/lib/ticket-info-optimization.ts";
import {
  PRODUCT_OPERATION_RATING_ACTION,
  PRODUCT_OPERATION_RATING_PAYLOAD_KEY,
  readProductOperationRating,
  type ProductOperationRatingResult,
} from "@/lib/product-operation-rating.ts";
import {
  buildTicketHeaderBadges,
  buildTicketWorkbenchModel,
  isProductOperationRatingEditable,
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
  isLinKeTestSkipVisible: boolean;
  skipLinKeExternal: boolean;
}

interface DetailField {
  label: string;
  fields: string[];
  empty?: string;
  kind?: "text" | "link" | "long" | "reference";
  referenceEntity?: RebuildReferenceEntity;
}

interface MediaField {
  label: string;
  fields: string[];
  kindHint?: MediaPreviewKind;
}

interface DetailSection {
  title: string;
  fields: DetailField[];
}

interface ReportReferenceField {
  label: string;
  fields: string[];
  kindHint?: MediaPreviewKind;
}

const LIN_KE_FEE_SETUP_SAVE_VERSION = "product_commission_save_v3";

const BASIC_SECTIONS: DetailSection[] = [
  {
    title: "商品基础信息",
    fields: [
      { label: "商品名称", fields: ["goodsName", "goodsNameInput"], kind: "long" },
      { label: "提报商户", fields: ["rbhost", "rbhost.hostName", "hostNameInput"], kind: "reference", referenceEntity: "SupplyHost" },
      { label: "提报公司", fields: ["company", "company.companyName", "companyName"], kind: "reference", referenceEntity: "SupplyCompany" },
      { label: "商品ID", fields: ["goodsId"] },
      { label: "套餐类型", fields: ["mealType.text", "mealType"] },
      { label: "签约城市", fields: ["signCity", "bdCity"] },
      { label: "商品类目", fields: ["classification"] },
    ],
  },
];

const PACKAGE_SECTIONS: DetailSection[] = [
  {
    title: "套餐与价格",
    fields: [
      { label: "适用门店数量", fields: ["hostNum"], empty: "1" },
      { label: "建议使用人数", fields: ["eatPersonNum"], empty: "1" },
      { label: "套餐限购", fields: ["singleUserPurchaseLimit", "limitation"], empty: "不限购" },
      { label: "套餐内容", fields: ["packages", "details"], kind: "long" },
      { label: "售价", fields: ["price"] },
      { label: "原价", fields: ["originPrice"] },
      { label: "扣点", fields: ["commissionRate", "commissionRates", "deductionRate", "takeRate"] },
      { label: "折扣", fields: ["discount"] },
      { label: "购买须知", fields: ["presentingRemindWords", "guideline", "reservationRule"], kind: "long" },
      { label: "商品特色", fields: ["goodsFeatures", "salePoint", "hotReason"], kind: "long" },
    ],
  },
  {
    title: "规则与时间",
    fields: [
      { label: "是否可以外带餐食", fields: ["isOutMeal"], empty: "否" },
      { label: "是否可以使用包间", fields: ["isCoupoun"], empty: "否" },
      { label: "是否额外收费", fields: ["isFeeExceptHoliday", "isExtraCharge", "extraCharge"], empty: "否" },
      { label: "售卖开始时间", fields: ["saleBegin"] },
      { label: "售卖结束时间", fields: ["saleUntil"] },
      { label: "核销有效截止日期/核销使用天数", fields: ["validUntil", "validDays", "validDay", "useDays", "useDay"] },
      { label: "预约规则", fields: ["reservationRule.text", "reservationRule"] },
      { label: "营业时间", fields: ["businessHours", "openingHours", "useDate.text", "useDate", "useStartTime", "useEndTime"] },
    ],
  },
  {
    title: "结算与签约",
    fields: [
      { label: "签约份数", fields: ["signAmount"] },
      { label: "免结算份数", fields: ["freeSettleAmount"] },
      { label: "免结算金额", fields: ["freeSettleNote", "freeSettleMoney", "freeSettlePrice"] },
      { label: "免结算抽佣比例", fields: ["freeSettleRatio"] },
    ],
  },
];

const OPERATION_SECTIONS: DetailSection[] = [
  {
    title: "商户经营与审批",
    fields: [
      { label: "大区评级", fields: ["selfRatingNew.text", "selfRating", "acnLevel"] },
      { label: "签约BD", fields: ["bdUser.fullName", "bdUser"] },
      { label: "签约BD小组", fields: ["bdGroup"] },
      { label: "签约BD城市", fields: ["bdCity"] },
      { label: "签约BD小区", fields: ["bdSubRegion"] },
      { label: "签约BD大区", fields: ["bdRegion"] },
      { label: "OA审批类型", fields: ["OAApprovalType"], empty: "无" },
      { label: "OA审批编号", fields: ["OAApprovalNo"], empty: "未提供 OA 审批编号" },
    ],
  },
];

const MEDIA_FIELDS: MediaField[] = [
  { label: "商品主图", fields: ["mainPic"] },
  { label: "商品轮播图", fields: ["rbimages"] },
  { label: "套餐详情页配图", fields: ["detailImages"] },
  { label: "商户近30天经营流水", fields: ["regionRatingCertificate"] },
  { label: "城市品审截图", fields: ["cityQualityReviewScreenshot", "cityReviewScreenshot", "cityAuditScreenshot"] },
  { label: "套餐合同", fields: ["packageContract"], kindHint: "pdf" },
];

const SUPPLY_COMPANY_REPORT_FIELDS: ReportReferenceField[] = [
  { label: "公司名称", fields: ["companyName", "name", "text"] },
  { label: "公司ID", fields: ["SupplyCompanyId", "supplyCompanyId", "id", "value"] },
  { label: "公司所在城市", fields: ["city", "bdCity", "companyCity"] },
  { label: "公司是否重复提报", fields: ["isRepeatSubmit", "isDuplicateSubmit", "isRepeated"] },
  { label: "公司详细地址", fields: ["address", "companyAddress"] },
  { label: "公司审核状态", fields: ["auditStatus"] },
  { label: "来客账户ID", fields: ["guestId"] },
  { label: "公司合同", fields: ["coontractFile", "publicityContract", "companyContract"], kindHint: "pdf" },
  { label: "公司资质", fields: ["qualification", "businessLicensePicture", "businessLicense", "foodLicense"] },
  { label: "收款委托授权书", fields: ["authLetter", "authorizationLetter", "collectionAuthorizationLetter", "receiptAuthorizationLetter"], kindHint: "image" },
  { label: "法人名称", fields: ["legalPerson", "legalPersonName"] },
  { label: "法人手机号", fields: ["legalPersonMobile", "legalPersonPhone"] },
  { label: "公司联系人手机号", fields: ["contactMobile", "contactPhone", "telephone"] },
];

const SUPPLY_HOST_REPORT_FIELDS: ReportReferenceField[] = [
  { label: "主商户名称", fields: ["hostName", "name", "text"] },
  { label: "来客门店ID", fields: ["guestId"] },
  { label: "商户ID", fields: ["SupplyHostId", "supplyHostId", "hostId", "id", "value"] },
  { label: "高德ID", fields: ["gaodeId", "amapId"] },
  { label: "商户审核状态", fields: ["approvalState", "approvalState.text"] },
  { label: "是否为重复提报商户", fields: ["isRepeatSubmit", "isDuplicateSubmit", "isRepeated"] },
  { label: "城市", fields: ["city", "bdCity"] },
  { label: "区域商圈", fields: ["district", "businessArea", "regionBusinessArea"] },
  { label: "地址", fields: ["address"] },
  { label: "联系电话", fields: ["telephone", "phone"] },
  { label: "商户营业时间", fields: ["businessHours", "openingHours"] },
  { label: "商户桌数", fields: ["tableCount", "tables"] },
  { label: "商户头图", fields: ["hostPic", "headPic", "mainPic"], kindHint: "image" },
  { label: "商家营业执照", fields: ["businessLicensePicture", "businessLicense"], kindHint: "image" },
  { label: "行业许可证类型", fields: ["certificationType", "certification"] },
  { label: "行业许可证", fields: ["certification"], kindHint: "image" },
];

export function TicketDetailPage({ ticketId, isLinKeTestSkipVisible, skipLinKeExternal }: TicketDetailPageProps) {
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
      skipLinKeExternal={isLinKeTestSkipVisible && skipLinKeExternal}
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
  skipLinKeExternal,
}: {
  ticket: TicketRecord;
  metadata: TicketMetadata;
  onRefresh: () => void;
  onTicketUpdated: (ticket: TicketRecord) => void;
  records: TicketActionRecord[];
  setRecords: Dispatch<SetStateAction<TicketActionRecord[]>>;
  isLoadingRecords: boolean;
  recordErrorMessage: string;
  skipLinKeExternal: boolean;
}) {
  const sourcePayload = ticket.sourcePayload;
  const currentPayload = useMemo(
    () => buildCurrentDisplayPayload(sourcePayload, ticket.payload),
    [sourcePayload, ticket.payload],
  );
  const title = displayPayloadText(currentPayload, metadata, "goodsName", "goodsNameInput") || "未命名商品";
  const merchant = displayPayloadText(currentPayload, metadata, "hostNameInput", "rbhost.hostName", "rbhost") || "未提供商户";
  const headerBadges = useMemo(() => buildTicketHeaderBadges(ticket), [ticket]);
  const salesSelfRating = displayPayloadText(currentPayload, metadata, "selfRatingNew.text", "selfRating", "acnLevel");
  const productOperationRating = useMemo(
    () => readProductOperationRating(readRecordValue(ticket.payload, PRODUCT_OPERATION_RATING_PAYLOAD_KEY)),
    [ticket.payload],
  );
  const originalOptimizationPackages = useMemo(() => {
    const sourcePackages = readPackagesFromPayload(sourcePayload);
    return hasPackageContent(sourcePackages) ? sourcePackages : readPackagesFromPayload(ticket.payload);
  }, [sourcePayload, ticket.payload]);
  const [optimizationResult, setOptimizationResult] = useState<TicketInfoOptimizationResult | null>(null);
  const [editedOptimizedPackages, setEditedOptimizedPackages] = useState<Record<string, unknown> | null>(null);
  const [isOptimizationEditable, setIsOptimizationEditable] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationErrorMessage, setOptimizationErrorMessage] = useState("");
  const [draftJobId, setDraftJobId] = useState("");
  const [isDraftJobPolling, setIsDraftJobPolling] = useState(false);
  const [linkeGoodsId, setLinkeGoodsId] = useState("");
  const [linkeCommission, setLinkeCommission] = useState<CommissionRateValues>(() => buildInitialLinkeCommission(ticket.payload));
  const [feeSetupJobId, setFeeSetupJobId] = useState("");
  const [isFeeSetupJobPolling, setIsFeeSetupJobPolling] = useState(false);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [isRatingComparisonOpen, setIsRatingComparisonOpen] = useState(false);
  const [isActionSidebarCollapsed, setIsActionSidebarCollapsed] = useState(false);
  const canConfirmOptimization = Boolean(editedOptimizedPackages && hasPackageContent(editedOptimizedPackages));
  const isLinKeFeeSetupCurrent = useMemo(
    () => isCurrentLinKeFeeSetup(ticket.payload, linkeCommission),
    [ticket.payload, linkeCommission],
  );
  const canOpenFeeSettingUrl = isLinKeFeeSetupCurrent;
  const workbenchModel = useMemo(
    () => buildTicketWorkbenchModel(ticket, records, { isLinKeFeeSetupCurrent, skipLinKeExternal }),
    [ticket, records, isLinKeFeeSetupCurrent, skipLinKeExternal],
  );
  const canOpenRatingComparison = workbenchModel.currentFlow === "access_review";
  const shouldShowRatingComparison = isRatingComparisonOpen && canOpenRatingComparison;

  useEffect(() => {
    setOptimizationResult(null);
    setEditedOptimizedPackages(null);
    setIsOptimizationEditable(false);
    setOptimizationErrorMessage("");
    setDraftJobId("");
    setIsDraftJobPolling(false);
    setLinkeCommission(buildInitialLinkeCommission(ticket.payload));
    setFeeSetupJobId("");
    setIsFeeSetupJobPolling(false);
    setIsRatingComparisonOpen(false);
    setIsActionSidebarCollapsed(false);
  }, [ticket.supplyGoodsId, workbenchModel.currentFlow]);

  useEffect(() => {
    if (!draftJobId) return;
    let isCancelled = false;
    let timeoutId: number | undefined;

    async function pollDraftJob() {
      setIsDraftJobPolling(true);
      try {
        const status = await getLinKeDraftJobStatus(ticket.supplyGoodsId, draftJobId);
        if (isCancelled) return;
        if (status.state === "completed") {
          setDraftJobId("");
          setIsDraftJobPolling(false);
          await refreshTicketAndRecords();
          return;
        }
        if (status.state === "failed") {
          setDraftJobId("");
          setIsDraftJobPolling(false);
          setActionErrorMessage(status.failedReason || "林客草稿创建失败");
          await refreshTicketAndRecords();
          return;
        }
        timeoutId = window.setTimeout(() => void pollDraftJob(), 2000);
      } catch (error) {
        if (isCancelled) return;
        setDraftJobId("");
        setIsDraftJobPolling(false);
        setActionErrorMessage(error instanceof Error ? error.message : "林客草稿任务查询失败");
      }
    }

    void pollDraftJob();
    return () => {
      isCancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [draftJobId, ticket.supplyGoodsId]);

  useEffect(() => {
    if (!feeSetupJobId) return;
    let isCancelled = false;
    let timeoutId: number | undefined;

    async function pollFeeSetupJob() {
      setIsFeeSetupJobPolling(true);
      try {
        const status = await getLinKeFeeSetupJobStatus(ticket.supplyGoodsId, feeSetupJobId);
        if (isCancelled) return;
        if (status.state === "completed") {
          setFeeSetupJobId("");
          setIsFeeSetupJobPolling(false);
          await refreshTicketAndRecords();
          return;
        }
        if (status.state === "failed") {
          setFeeSetupJobId("");
          setIsFeeSetupJobPolling(false);
          setActionErrorMessage(status.failedReason || "林客费用设置失败");
          await refreshTicketAndRecords();
          return;
        }
        timeoutId = window.setTimeout(() => void pollFeeSetupJob(), 2000);
      } catch (error) {
        if (isCancelled) return;
        setFeeSetupJobId("");
        setIsFeeSetupJobPolling(false);
        setActionErrorMessage(error instanceof Error ? error.message : "林客费用设置任务查询失败");
      }
    }

    void pollFeeSetupJob();
    return () => {
      isCancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [feeSetupJobId, ticket.supplyGoodsId]);

  useEffect(() => {
    setLinkeCommission(buildInitialLinkeCommission(ticket.payload));
  }, [ticket.supplyGoodsId, ticket.payload]);

  useEffect(() => {
    setLinkeGoodsId(readPayloadText(ticket.payload, "linkeGoodsId"));
    const queuedJobId = readPayloadText(ticket.payload, "linkeFeeSetupJobId");
    if (readPayloadText(ticket.payload, "linkeFeeSetupState") === "queued" && queuedJobId) {
      setFeeSetupJobId(queuedJobId);
    }
  }, [ticket.supplyGoodsId, ticket.payload]);

  async function runInfoOptimization(generation: number) {
    setIsOptimizing(true);
    setOptimizationErrorMessage("");
    setIsOptimizationEditable(false);
    setOptimizationResult(null);
    setEditedOptimizedPackages(null);
    try {
      const result = await requestTicketInfoOptimization(ticket, generation);
      setOptimizationResult(result);
      setEditedOptimizedPackages(result.optimizedPackages);
    } catch (error) {
      setOptimizationErrorMessage(error instanceof Error ? error.message : "信息优化生成失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  function enableManualOptimizationEdit() {
    const basePackages = editedOptimizedPackages ?? optimizationResult?.optimizedPackages ?? originalOptimizationPackages;
    if (!hasPackageContent(basePackages)) {
      setOptimizationErrorMessage("未提供套餐内容，无法人工修改");
      return;
    }
    setOptimizationErrorMessage("");
    setEditedOptimizedPackages(cloneRecord(basePackages));
    setIsOptimizationEditable(true);
  }

  async function refreshTicketAndRecords() {
    const [nextTicket, nextRecords] = await Promise.all([
      getTicket(ticket.supplyGoodsId),
      getTicketActionRecords(ticket.supplyGoodsId),
    ]);
    onTicketUpdated(nextTicket);
    setRecords(nextRecords);
  }

  useEffect(() => {
    function handleRefreshMessage(event: MessageEvent<unknown>) {
      if (!shouldRefreshTicketFromMessage(event.data, ticket.supplyGoodsId)) return;
      void refreshTicketAndRecords();
    }

    window.addEventListener("message", handleRefreshMessage);
    return () => window.removeEventListener("message", handleRefreshMessage);
  }, [ticket.supplyGoodsId]);

  async function confirmInfoOptimization() {
    if (!editedOptimizedPackages || !hasPackageContent(editedOptimizedPackages)) return;
    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await confirmTicketInfoOptimization(ticket.supplyGoodsId, editedOptimizedPackages, {
        skipLinKeExternal,
      });
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
      if (result.jobId) {
        setDraftJobId(result.jobId);
      } else {
        await refreshTicketAndRecords();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "确认信息优化失败";
      await refreshTicketAndRecords().catch(() => {});
      setActionErrorMessage(message);
    } finally {
      setIsActionSubmitting(false);
    }
  }

  async function retryDraftCreation() {
    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await retryLinKeDraftJob(ticket.supplyGoodsId, { skipLinKeExternal });
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
      if (result.jobId) {
        setDraftJobId(result.jobId);
      } else {
        await refreshTicketAndRecords();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "重试创建林客草稿失败";
      await refreshTicketAndRecords().catch(() => {});
      setActionErrorMessage(message);
    } finally {
      setIsActionSubmitting(false);
    }
  }

  async function confirmShelfOnline() {
    const goodsId = linkeGoodsId.trim();
    if (!goodsId) {
      setActionErrorMessage("请先填写林客商品ID");
      return;
    }
    await submitTicketAction({
      action: "shelf_online_confirmed",
      origin: {
        linkeGoodsId: readRecordValue(ticket.payload, "linkeGoodsId"),
      },
      current: {
        linkeGoodsId: goodsId,
      },
      remark: "确认已上架并录入林客商品ID",
    });
  }

  async function syncLinKeFeeSetup() {
    const validationMessage = validateLinkeCommission(linkeCommission);
    if (validationMessage) {
      setActionErrorMessage(validationMessage);
      return;
    }
    const goodsId = linkeGoodsId.trim() || readPayloadText(ticket.payload, "linkeGoodsId");
    if (!goodsId) {
      setActionErrorMessage("请先填写林客商品ID");
      return;
    }
    const merchantId = resolveLinKeMerchantId(ticket.payload, ticket.sourcePayload);
    if (!merchantId) {
      setActionErrorMessage("未找到林客商户ID，请检查套餐中的 company.guestId");
      return;
    }
    const normalizedRates = normalizeLinkeCommission(linkeCommission);
    const activeSources = activeCommissionTrafficFields(linkeCommission).map((field) => field.source).sort();
    const submittedSources = Object.keys(normalizedRates.values).sort();
    if (activeSources.join("/") !== submittedSources.join("/")) {
      setActionErrorMessage("费用比例表格状态与提交内容不一致，请刷新页面后重试");
      return;
    }

    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await startLinKeFeeSetupJob(ticket.supplyGoodsId, {
        merchantId,
        linkeGoodsId: goodsId,
        rates: normalizedRates,
        skipLinKeExternal,
      });
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
      if (result.jobId) {
        setFeeSetupJobId(result.jobId);
      } else {
        await refreshTicketAndRecords();
      }
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : "同步林客费用设置失败");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  async function confirmFeeSetupSync() {
    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await confirmLinKeFeeSetup(ticket.supplyGoodsId, { skipLinKeExternal });
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : "确认林客费用同步失败");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  async function retryProductTrackingAction() {
    setIsActionSubmitting(true);
    setActionErrorMessage("");
    try {
      const result = await retryLinKeProductTracking(ticket.supplyGoodsId);
      onTicketUpdated(result.ticket);
      setRecords((currentRecords) => [result.record, ...currentRecords]);
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : "重试商品状态追踪失败");
    } finally {
      setIsActionSubmitting(false);
    }
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
      remark: "人工确认商品上线完成",
    });
  }

  async function saveProductOperationRating(rating: ProductOperationRatingResult) {
    await submitTicketAction({
      action: PRODUCT_OPERATION_RATING_ACTION,
      origin: {
        [PRODUCT_OPERATION_RATING_PAYLOAD_KEY]: readRecordValue(ticket.payload, PRODUCT_OPERATION_RATING_PAYLOAD_KEY),
      },
      current: {
        [PRODUCT_OPERATION_RATING_PAYLOAD_KEY]: rating,
      },
      remark: `保存商品运营评级：${rating.rating}（${rating.totalScore.toFixed(1)}分）`,
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
        setLinkeGoodsId("");
      }
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  function openRatingComparison() {
    setIsRatingComparisonOpen(true);
    setIsActionSidebarCollapsed(true);
  }

  function closeRatingComparisonAndExpandActionSidebar() {
    setIsRatingComparisonOpen(false);
    setIsActionSidebarCollapsed(false);
  }

  const ratingPanel = (
    <ProductOperationRatingPanel
      value={productOperationRating}
      salesSelfRating={salesSelfRating}
      isSubmitting={isActionSubmitting}
      isEditable={isProductOperationRatingEditable(workbenchModel.currentFlow)}
      onSave={(rating) => void saveProductOperationRating(rating)}
    />
  );

  return (
    <div className="ticket-scrollbar min-h-screen bg-slate-100">
      <div
        className={cn(
          "grid gap-4 px-0 pb-4 pt-0 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-5",
          shouldShowRatingComparison && "pb-0",
          shouldShowRatingComparison && isActionSidebarCollapsed && "lg:grid-cols-[minmax(0,1fr)_56px] xl:grid-cols-[minmax(0,1fr)_56px]",
        )}
      >
        <div className={cn(
          "min-w-0 rounded-md bg-slate-100 px-5 py-6 lg:px-6 xl:px-8 xl:py-7",
          shouldShowRatingComparison && "pb-0 xl:pb-0",
        )}>
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

          <div
            className={cn(
              "space-y-5",
              shouldShowRatingComparison && "lg:grid lg:h-[calc(100vh-156px)] lg:min-h-[560px] lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-stretch lg:gap-5 lg:space-y-0",
            )}
          >
            <div className={cn(shouldShowRatingComparison && "ticket-scrollbar h-full min-h-0 overflow-y-auto lg:pr-2")}>
              <TicketInfoFrame
                payload={currentPayload}
                ticket={ticket}
                metadata={metadata}
              />
            </div>
            {shouldShowRatingComparison ? (
              <div className="h-full min-h-0 overflow-hidden lg:pl-1">
                {ratingPanel}
              </div>
            ) : canOpenRatingComparison ? null : ratingPanel}
            {workbenchModel.currentFlow === "info_optimization" ? (
              <InfoOptimizationDiff
                result={optimizationResult}
                originPackages={optimizationResult?.originPackages ?? originalOptimizationPackages}
                editedPackages={editedOptimizedPackages}
                isEditable={isOptimizationEditable}
                onEditedPackagesChange={setEditedOptimizedPackages}
                onRunOptimization={() => void runInfoOptimization((optimizationResult?.generation ?? 0) + 1)}
                onEnableManualEdit={enableManualOptimizationEdit}
                isLoading={isOptimizing}
                errorMessage={optimizationErrorMessage}
              />
            ) : null}
            {workbenchModel.currentFlow === "commission_setup" ? (
              <CommissionSetupPanel
                values={linkeCommission}
                feeSettingUrl={readPayloadText(ticket.payload, "linkeFeeSettingUrl")}
                canOpenFeeSettingUrl={canOpenFeeSettingUrl}
                onChange={(source, value) =>
                  setLinkeCommission((current) => ({
                    ...current,
                    values: { ...current.values, [source]: value },
                  }))}
                onSingleSettingChange={(source, enabled) =>
                  setLinkeCommission((current) => ({
                    ...current,
                    singleSettings: { ...current.singleSettings, [source]: enabled },
                  }))}
                onDefaultChange={(value) => setLinkeCommission((current) => applyDefaultCommissionRate(current, value))}
              />
            ) : null}
          </div>
        </div>
        <TicketActionSidebar
          model={workbenchModel}
          ticket={ticket}
          isLoadingRecords={isLoadingRecords}
          recordErrorMessage={actionErrorMessage || recordErrorMessage}
          isOptimizing={isOptimizing}
          isActionSubmitting={isActionSubmitting || isDraftJobPolling || isFeeSetupJobPolling}
          isDraftJobPolling={isDraftJobPolling}
          isFeeSetupJobPolling={isFeeSetupJobPolling}
          skipLinKeExternal={skipLinKeExternal}
          canConfirmOptimization={canConfirmOptimization}
          canRetryDraftCreation={hasPackageContent(readPackagesFromPayload(ticket.payload))}
          linkeGoodsId={linkeGoodsId}
          linkeDraftUrl={readPayloadText(ticket.payload, "linkeDraftUrl")}
          feeSettingUrl={readPayloadText(ticket.payload, "linkeFeeSettingUrl")}
          canOpenFeeSettingUrl={canOpenFeeSettingUrl}
          onLinkeGoodsIdChange={setLinkeGoodsId}
          onConfirmOptimization={() => void confirmInfoOptimization()}
          onRetryDraftCreation={() => void retryDraftCreation()}
          onConfirmShelfOnline={() => void confirmShelfOnline()}
          onSyncLinKeFeeSetup={() => void syncLinKeFeeSetup()}
          onConfirmFeeSetupSync={() => void confirmFeeSetupSync()}
          onRetryProductTracking={() => void retryProductTrackingAction()}
          onConfirmProductOnline={() => void confirmProductOnline()}
          isCollapsed={shouldShowRatingComparison && isActionSidebarCollapsed}
          onExpand={closeRatingComparisonAndExpandActionSidebar}
          onOpenRatingComparison={openRatingComparison}
        />
      </div>
    </div>
  );
}

function readRecordValue(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : null;
}

function readPackagesFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return displayPackagesValue(readRecordValue(payload, "packages"));
}

function displayPackagesValue(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function hasPackageContent(packages: Record<string, unknown>): boolean {
  return readPackageGroups(packages).length > 0;
}

function readPayloadText(payload: Record<string, unknown>, ...fields: string[]): string {
  for (const field of fields) {
    const value = readPayloadPath(payload, field);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function extractRebuildReferenceIdFromPayload(
  payload: Record<string, unknown>,
  fields: string[],
  entity: RebuildReferenceEntity,
): string {
  for (const field of fields) {
    const referenceId = extractRebuildReferenceId(readPayloadPath(payload, field), entity);
    if (referenceId) return referenceId;
  }
  return "";
}

function extractRebuildReferenceId(value: unknown, entity: RebuildReferenceEntity): string {
  if (!isRecord(value)) return "";
  if (value.entity !== undefined && value.entity !== entity) return "";
  const candidates = entity === "SupplyCompany"
    ? [value.id, value.SupplyCompanyId, value.supplyCompanyId, value.value]
    : [value.id, value.SupplyHostId, value.supplyHostId, value.hostId, value.value];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return "";
}

function resolveLinKeMerchantId(
  payload: Record<string, unknown>,
  sourcePayload: Record<string, unknown> = {},
): string {
  return readMerchantIdFromPayload(payload) || readMerchantIdFromPayload(sourcePayload);
}

function readMerchantIdFromPayload(payload: Record<string, unknown>): string {
  return readPayloadText(payload, "company.guestId")
    || readPayloadText(payload, "package.company.guestId")
    || readPayloadText(payload, "packages.company.guestId")
    || readPayloadText(displayPackagesValue(readRecordValue(payload, "package")), "company.guestId")
    || readPayloadText(displayPackagesValue(readRecordValue(payload, "packages")), "company.guestId");
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

function buildReferenceDisplayContext(
  fallbackContext: FieldDisplayContext,
  metadata: RebuildReferenceMetadata | null,
): FieldDisplayContext {
  if (!metadata) return fallbackContext;
  return {
    fieldMetadata: {
      ...fallbackContext.fieldMetadata,
      ...metadata.fieldMetadata,
    },
    fieldOptions: {
      ...fallbackContext.fieldOptions,
      ...metadata.fieldOptions,
    },
  };
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

function TicketInfoFrame({
  payload,
  ticket,
  metadata,
}: {
  payload: Record<string, unknown>;
  ticket: TicketRecord;
  metadata: TicketMetadata;
}) {
  return (
    <Card className="border-0 bg-white shadow-sm">
      <CardContent className="space-y-5 pt-4">
        {BASIC_SECTIONS.map((section) => (
          <DetailSectionGroup
            key={section.title}
            section={section}
            payload={payload}
            displayContext={metadata}
          />
        ))}
        <MediaFieldsGroup ticket={ticket} metadata={metadata} />
        {[...PACKAGE_SECTIONS, ...OPERATION_SECTIONS].map((section) => (
          <DetailSectionGroup
            key={section.title}
            section={section}
            payload={payload}
            displayContext={metadata}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function DetailSectionGroup({
  section,
  payload,
  displayContext,
}: {
  section: DetailSection;
  payload: Record<string, unknown>;
  displayContext: FieldDisplayContext;
}) {
  return (
    <section className="space-y-3 border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-[12px] font-semibold text-slate-950">{section.title}</h2>
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {section.fields.map((field) => (
          <DetailFieldView
            key={`${section.title}-${field.label}`}
            field={field}
            payload={payload}
            displayContext={displayContext}
          />
        ))}
      </div>
    </section>
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
  const referenceId = field.kind === "reference" && field.referenceEntity
    ? extractRebuildReferenceIdFromPayload(payload, field.fields, field.referenceEntity)
    : "";

  return (
    <div className={cn("grid gap-1.5 text-[12px]", isLong && "sm:col-span-2 lg:col-span-3 2xl:col-span-4")}>
      <div className="text-[10px] font-medium text-slate-400">{field.label}</div>
      {field.kind === "reference" && field.referenceEntity && referenceId ? (
        <ReportReferenceDetailDialog
          entity={field.referenceEntity}
          referenceId={referenceId}
          title={field.label}
          triggerLabel={value}
          displayContext={displayContext}
        />
      ) : field.kind === "link" && value !== "未提供" && looksLikeUrl(value) ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <span className="truncate">{value}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : (
        <div className={cn("min-w-0", isLong ? "whitespace-pre-wrap leading-5 text-slate-900" : "truncate text-slate-900")}>{value}</div>
      )}
    </div>
  );
}

function ReportReferenceDetailDialog({
  entity,
  referenceId,
  title,
  triggerLabel,
  displayContext,
}: {
  entity: RebuildReferenceEntity;
  referenceId: string;
  title: string;
  triggerLabel: string;
  displayContext: FieldDisplayContext;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [detail, setDetail] = useState<RebuildReferenceDetail | null>(null);
  const [metadata, setMetadata] = useState<RebuildReferenceMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const fields = entity === "SupplyCompany" ? SUPPLY_COMPANY_REPORT_FIELDS : SUPPLY_HOST_REPORT_FIELDS;
  const detailDisplayContext = buildReferenceDisplayContext(displayContext, metadata);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    setIsLoading(true);
    setErrorMessage("");
    Promise.all([
      getRebuildReferenceDetail(entity, referenceId),
      getRebuildReferenceMetadata(entity),
    ])
      .then(([nextDetail, nextMetadata]) => {
        if (!isCancelled) {
          setDetail(nextDetail);
          setMetadata(nextMetadata);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setDetail(null);
          setMetadata(null);
          setErrorMessage(error instanceof Error ? error.message : "查询详情失败");
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [entity, isOpen, referenceId]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 text-left text-[12px] font-medium text-blue-600 hover:text-blue-700"
        >
          <span className="truncate">{triggerLabel}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,860px)] p-5">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>{referenceId}</DialogDescription>
        </DialogHeader>
        <div className="ticket-scrollbar mt-4 max-h-[68vh] overflow-auto pr-1">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : errorMessage ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</div>
          ) : detail ? (
            <div className="divide-y divide-slate-100">
              {fields.map((field) => (
                <ReportReferenceFieldView
                  key={field.label}
                  field={field}
                  payload={detail.payload}
                  displayContext={detailDisplayContext}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">暂无详情</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportReferenceFieldView({
  field,
  payload,
  displayContext,
}: {
  field: ReportReferenceField;
  payload: Record<string, unknown>;
  displayContext: FieldDisplayContext;
}) {
  const label = resolveReportReferenceFieldLabel(field, displayContext);
  const mediaItems = buildMediaPreviewItems({
    payload,
    assets: {},
    fields: field.fields,
    fieldMetadata: displayContext.fieldMetadata,
    kindHint: field.kindHint,
  });
  const text = getPayloadDisplayText(payload, field.fields, displayContext) || "未提供";
  const isLong = text.length > 44;

  return (
    <div className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
      <div className="text-[11px] font-medium leading-5 text-slate-400">{label}</div>
      {mediaItems.some((item) => item.canPreview) ? (
        <div className="flex min-w-0 flex-wrap gap-3">
          {mediaItems.map((item) => (
            <ReportReferencePreviewItem key={`${field.label}-${item.url}`} item={item} />
          ))}
        </div>
      ) : (
        <div className={cn("min-w-0 text-[13px] text-slate-900", isLong ? "whitespace-pre-wrap leading-5" : "truncate")}>{text}</div>
      )}
    </div>
  );
}

function ReportReferencePreviewItem({ item }: { item: MediaPreviewItem }) {
  if (!item.canPreview) return null;
  if (item.kind === "image") {
    return <ImagePreviewItem item={item} />;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center text-[13px] font-medium text-blue-600 hover:text-blue-700"
        >
          预览
        </button>
      </DialogTrigger>
      <FilePreviewDialog item={item} />
    </Dialog>
  );
}

function resolveReportReferenceFieldLabel(field: ReportReferenceField, displayContext: FieldDisplayContext): string {
  for (const fieldName of field.fields) {
    const label = displayContext.fieldMetadata[normalizeDisplayFieldName(fieldName)]?.label;
    if (label) return label;
  }
  return field.label;
}

function normalizeDisplayFieldName(fieldName: string): string {
  return fieldName.endsWith(".text") ? fieldName.slice(0, -5) : fieldName;
}

function MediaFieldsGroup({ ticket, metadata }: { ticket: TicketRecord; metadata: TicketMetadata }) {
  return (
    <section className="space-y-3 border-t border-slate-100 pt-5">
      <h2 className="text-[12px] font-semibold text-slate-950">图片与附件</h2>
      <div className="space-y-3">
        {MEDIA_FIELDS.map((field) => (
          <MediaFieldView key={field.label} field={field} ticket={ticket} metadata={metadata} />
        ))}
      </div>
    </section>
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
      <div className="grid gap-2 md:grid-cols-[96px_1fr]">
        <div className="text-[10px] font-medium text-slate-400">{field.label}</div>
        <div className="text-[12px] text-slate-400">未上传</div>
      </div>
    );
  }

  return (
    <div className="grid gap-2 md:grid-cols-[96px_1fr]">
      <div className="text-[10px] font-medium text-slate-400">{field.label}</div>
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
            "flex h-10 w-[min(220px,calc(100vw-48px))] items-center gap-1.5 rounded-md bg-slate-50 px-2 text-left text-[11px] text-slate-700 shadow-sm ring-1 ring-slate-200 transition",
            item.canPreview ? "hover:bg-white hover:shadow-md" : "cursor-not-allowed opacity-70",
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white shadow-sm">
            {item.kind === "pdf" ? (
              <FileText className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <LinkIcon className="h-3.5 w-3.5 text-slate-500" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-900">{item.fileName}</span>
            <span className="mt-0.5 block text-[9px] text-slate-500">
              {item.canPreview ? "点击预览文件" : "等待 R2 镜像后预览"}
            </span>
          </span>
          {item.canPreview ? <Maximize2 className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
        </button>
      </DialogTrigger>
      {item.canPreview ? <FilePreviewDialog item={item} /> : null}
    </Dialog>
  );
}

function InfoOptimizationDiff({
  result,
  originPackages,
  editedPackages,
  isEditable,
  onEditedPackagesChange,
  onRunOptimization,
  onEnableManualEdit,
  isLoading,
  errorMessage,
}: {
  result: TicketInfoOptimizationResult | null;
  originPackages: Record<string, unknown>;
  editedPackages: Record<string, unknown> | null;
  isEditable: boolean;
  onEditedPackagesChange: (packages: Record<string, unknown>) => void;
  onRunOptimization: () => void;
  onEnableManualEdit: () => void;
  isLoading: boolean;
  errorMessage: string;
}) {
  function updateGroupName(groupIndex: number, value: string) {
    if (!editedPackages) return;
    onEditedPackagesChange(updatePackageGroupName(editedPackages, groupIndex, value));
  }

  function updateItemTitle(groupIndex: number, itemIndex: number, value: string) {
    if (!editedPackages) return;
    onEditedPackagesChange(updatePackageItemTitle(editedPackages, groupIndex, itemIndex, value));
  }

  const isUnchangedOptimization = Boolean(
    result && editedPackages && haveSameVisiblePackageNames(originPackages, editedPackages),
  );

  return (
    <Card className="border-0 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              信息优化对比
            </CardTitle>
            <p className="mt-2 text-sm text-slate-500">仅优化套餐组名和菜品名称，确认后会创建林客上品草稿。</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onRunOptimization} disabled={isLoading} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Sparkles className="h-4 w-4" />
              {isLoading ? "优化中" : "AI优化"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onEnableManualEdit} disabled={isLoading} className="bg-white">
              <Pencil className="h-4 w-4" />
              人工修改
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</div>
        ) : null}
        {isUnchangedOptimization ? (
          <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 ring-1 ring-emerald-100">
            AI已执行，本次未产生可见改动，可重试或人工修改。
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <PackagePreviewPanel title="原始" packages={originPackages} tone="origin" />
          {isLoading ? (
            <PackageEmptyPanel title="优化后" message="正在生成优化结果..." />
          ) : isEditable && editedPackages ? (
            <PackageEditPanel
              title="优化后"
              packages={editedPackages}
              onGroupNameChange={updateGroupName}
              onItemTitleChange={updateItemTitle}
            />
          ) : editedPackages ? (
            <PackagePreviewPanel title="优化后" packages={editedPackages} tone="current" />
          ) : result ? (
            <PackagePreviewPanel title="优化后" packages={result.optimizedPackages} tone="current" />
          ) : (
            <PackageEmptyPanel title="优化后" message="暂无优化结果" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PackageEmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-100">
      <div className="text-xs font-medium text-emerald-700">{title}</div>
      <div className="mt-3 rounded-md bg-white px-3 py-8 text-center text-sm text-slate-500 ring-1 ring-emerald-100">
        {message}
      </div>
    </div>
  );
}

function PackagePreviewPanel({
  title,
  packages,
  tone,
}: {
  title: string;
  packages: Record<string, unknown>;
  tone: "origin" | "current";
}) {
  const groups = readPackageGroups(packages);
  return (
    <div className={cn(
      "rounded-md p-4 ring-1",
      tone === "origin" ? "bg-slate-50 ring-slate-100" : "bg-emerald-50 ring-emerald-100",
    )}>
      <div className={cn("text-xs font-medium", tone === "origin" ? "text-slate-500" : "text-emerald-700")}>{title}</div>
      <div className="mt-3 space-y-3">
        {groups.length > 0 ? groups.map((group, groupIndex) => (
          <div key={`${groupIndex}-${readText(group.groupName)}`} className="rounded-md bg-white p-3 ring-1 ring-slate-100">
            <div className="text-sm font-semibold leading-6 text-slate-950">{readText(group.groupName) || "未命名套餐组"}</div>
            <div className="mt-2 space-y-1">
              {readPackageItems(group).map((item, itemIndex) => (
                <div key={`${itemIndex}-${readText(item.title)}`} className="text-xs leading-5 text-slate-600">
                  {readText(item.title) || "未命名菜品"}
                </div>
              ))}
            </div>
          </div>
        )) : (
          <div className="rounded-md bg-white px-3 py-4 text-sm text-slate-500 ring-1 ring-slate-100">未提供套餐内容</div>
        )}
      </div>
    </div>
  );
}

function PackageEditPanel({
  title,
  packages,
  onGroupNameChange,
  onItemTitleChange,
}: {
  title: string;
  packages: Record<string, unknown>;
  onGroupNameChange: (groupIndex: number, value: string) => void;
  onItemTitleChange: (groupIndex: number, itemIndex: number, value: string) => void;
}) {
  const groups = readPackageGroups(packages);
  return (
    <div className="rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-100">
      <div className="text-xs font-medium text-emerald-700">{title}</div>
      <div className="mt-3 space-y-3">
        {groups.length > 0 ? groups.map((group, groupIndex) => (
          <div key={groupIndex} className="rounded-md bg-white p-3 ring-1 ring-emerald-100">
            <Input
              value={readText(group.groupName)}
              onChange={(event) => onGroupNameChange(groupIndex, event.target.value)}
              className="h-9 bg-white text-sm font-semibold"
            />
            <div className="mt-2 space-y-2">
              {readPackageItems(group).map((item, itemIndex) => (
                <Input
                  key={itemIndex}
                  value={readText(item.title)}
                  onChange={(event) => onItemTitleChange(groupIndex, itemIndex, event.target.value)}
                  className="h-8 bg-slate-50 text-xs"
                />
              ))}
            </div>
          </div>
        )) : (
          <div className="rounded-md bg-white px-3 py-4 text-sm text-slate-500 ring-1 ring-emerald-100">未提供套餐内容</div>
        )}
      </div>
    </div>
  );
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function updatePackageGroupName(packages: Record<string, unknown>, groupIndex: number, value: string): Record<string, unknown> {
  const next = cloneRecord(packages);
  const groups = readPackageGroups(next);
  const group = groups[groupIndex];
  if (group) group.groupName = value;
  return next;
}

function updatePackageItemTitle(
  packages: Record<string, unknown>,
  groupIndex: number,
  itemIndex: number,
  value: string,
): Record<string, unknown> {
  const next = cloneRecord(packages);
  const group = readPackageGroups(next)[groupIndex];
  const item = group ? readPackageItems(group)[itemIndex] : null;
  if (item) item.title = value;
  return next;
}

function readPackageGroups(packages: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(packages.viewList)
    ? packages.viewList.filter(isDisplayRecord)
    : [];
}

function readPackageItems(group: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(group.list)
    ? group.list.filter(isDisplayRecord)
    : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function isDisplayRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function CommissionSetupPanel({
  values,
  feeSettingUrl,
  canOpenFeeSettingUrl,
  onChange,
  onSingleSettingChange,
  onDefaultChange,
}: {
  values: CommissionRateValues;
  feeSettingUrl: string;
  canOpenFeeSettingUrl: boolean;
  onChange: (source: string, value: string) => void;
  onSingleSettingChange: (source: string, enabled: boolean) => void;
  onDefaultChange: (value: string) => void;
}) {
  const [defaultValue, setDefaultValue] = useState("");

  function handleDefaultValueChange(value: string) {
    const sanitized = sanitizeCommissionRateInput(value);
    setDefaultValue(sanitized);
    if (sanitized.trim()) {
      onDefaultChange(sanitized);
    }
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">费用比例填写</CardTitle>
            <p className="mt-2 text-sm text-slate-500">填写后点击右侧「确认同步」，系统会同步到林客费用设置。</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="bg-blue-50 text-blue-700 hover:bg-blue-100"
            disabled={!canOpenFeeSettingUrl}
            onClick={() => openLinKeDraftUrl(feeSettingUrl)}
          >
            <ExternalLink className="h-4 w-4" />
            打开林客核对
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-600">默认设置为</span>
          <CommissionRateInput
            value={defaultValue}
            max={80}
            onChange={handleDefaultValueChange}
            className="w-[190px]"
          />
        </div>
        <div className="overflow-hidden rounded-md ring-1 ring-slate-200">
          <Table className="min-w-[820px]">
            <TableHeader className="bg-slate-50">
              <TableRow className="hover:bg-slate-50">
                <TableHead className="w-[280px] text-sm text-slate-900">费用渠道</TableHead>
                <TableHead className="w-[190px] text-sm text-slate-900">是否单独设置费用</TableHead>
                <TableHead className="text-sm text-slate-900">费用比例</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMMISSION_TRAFFIC_ROWS.map((row, index) => {
                const isFirstInGroup = index === 0 || COMMISSION_TRAFFIC_ROWS[index - 1]?.group !== row.group;
                const groupRowSpan = COMMISSION_TRAFFIC_ROWS.filter((item) => item.group === row.group).length;
                const singleEnabled = row.singleSettingEnabled && values.singleSettings[row.source] === true;
                return (
                  <TableRow key={row.source} className="hover:bg-white">
                    {isFirstInGroup ? (
                      <TableCell rowSpan={groupRowSpan} className="w-28 border-r bg-white text-sm font-medium text-slate-900">
                        {row.group}
                      </TableCell>
                    ) : null}
                    <TableCell className="w-40 border-r text-sm font-semibold text-slate-900">
                      {row.label}
                      <span className="ml-1 text-red-500">*</span>
                    </TableCell>
                    <TableCell className="w-[190px] border-r">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        role="switch"
                        aria-checked={singleEnabled}
                        disabled={!row.singleSettingEnabled}
                        className={cn(
                          "h-7 rounded-full px-3 text-xs",
                          singleEnabled
                            ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                          !row.singleSettingEnabled && "cursor-not-allowed opacity-50",
                        )}
                        onClick={() => {
                          if (row.singleSettingEnabled) onSingleSettingChange(row.source, !singleEnabled);
                        }}
                      >
                        {singleEnabled ? "是" : "否"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {singleEnabled ? (
                        <div className="flex flex-wrap gap-3">
                          {row.children.map((child) => (
                            <CommissionRateInput
                              key={child.source}
                              label={child.label}
                              value={values.values[child.source] ?? "0.00"}
                              max={COMMISSION_CHILD_OPEN_MAX}
                              onChange={(value) => onChange(child.source, value)}
                            />
                          ))}
                        </div>
                      ) : (
                        <CommissionRateInput
                          value={values.values[row.source] ?? "0.00"}
                          max={row.closedMax}
                          onChange={(value) => onChange(row.source, value)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="rounded-md bg-blue-50 px-4 py-3 text-sm font-medium leading-6 text-blue-700 ring-1 ring-blue-100">
          同步成功后，上方链接会启用。请进入林客确认费用比例已正确落库，确认无误后点击右侧「确认核对无误」，工单进入「自动追踪中」。
        </div>
      </CardContent>
    </Card>
  );
}

function CommissionRateInput({
  value,
  max,
  label,
  className,
  onChange,
}: {
  value: string;
  max: number;
  label?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const error = getCommissionInputError(value, max);
  return (
    <div className={cn("min-w-[190px]", className)}>
      <div className="relative">
        {label ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex min-w-[88px] items-center border-r border-slate-100 px-3 text-sm font-medium text-slate-500">
            {label}
          </span>
        ) : null}
        <Input
          value={value}
          inputMode="decimal"
          placeholder="请输入"
          onChange={(event) => onChange(sanitizeCommissionRateInput(event.target.value))}
          className={cn(
            "h-11 bg-white pr-10 text-base font-semibold",
            label && "pl-[104px]",
            error && "border-red-300 text-red-600 focus-visible:ring-red-200",
          )}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base font-semibold text-slate-500">%</span>
      </div>
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

function buildInitialLinkeCommission(payload: Record<string, unknown>): CommissionRateValues {
  const storedRates = readStoredLinkeCommissionSource(payload);
  return {
    values: Object.fromEntries(
      allCommissionTrafficSources().map((field) => [
        field.source,
        formatCommissionRateInput(readStoredCommissionRate(storedRates, field.source) ?? 0),
      ]),
    ),
    singleSettings: Object.fromEntries(
      COMMISSION_TRAFFIC_ROWS
        .filter((row) => row.singleSettingEnabled)
        .map((row) => [row.source, readStoredSingleSetting(storedRates, row.source)]),
    ),
  };
}

function isCurrentLinKeFeeSetup(payload: Record<string, unknown>, values: CommissionRateValues): boolean {
  const feeSetupState = readPayloadText(payload, "linkeFeeSetupState");
  const feeSettingUrl = readPayloadText(payload, "linkeFeeSettingUrl");
  const saveSubmitted = readRecordValue(payload, "linkeFeeSetupSaveSubmitted") === true;
  const saveVersion = readPayloadText(payload, "linkeFeeSetupSaveVersion");
  return feeSetupState === "completed"
    && looksLikeUrl(feeSettingUrl)
    && saveSubmitted
    && saveVersion === LIN_KE_FEE_SETUP_SAVE_VERSION
    && valuesMatchStoredLinkeCommission(payload, values);
}

function readStoredLinkeCommissionSource(payload: Record<string, unknown>): unknown {
  return readRecordValue(payload, "linkeFeeRates")
    ?? readRecordValue(payload, "linkeCommission")
    ?? readRecordValue(payload, "commissionRates");
}

function valuesMatchStoredLinkeCommission(payload: Record<string, unknown>, values: CommissionRateValues): boolean {
  const storedRates = readStoredLinkeCommissionSource(payload);
  for (const field of activeCommissionTrafficFields(values)) {
    const storedRate = readStoredCommissionRate(storedRates, field.source);
    const currentRate = Number(values.values[field.source]);
    if (storedRate === undefined || !Number.isFinite(currentRate)) return false;
    if (formatCommissionRateInput(storedRate) !== formatCommissionRateInput(currentRate)) return false;
  }
  for (const row of COMMISSION_TRAFFIC_ROWS) {
    if (!row.singleSettingEnabled) continue;
    if (readStoredSingleSetting(storedRates, row.source) !== values.singleSettings[row.source]) return false;
  }
  return true;
}

function readStoredCommissionRate(value: unknown, source: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const sourceValues = isRecord(value.values) ? value.values : value;
  const rate = sourceValues[source];
  if (typeof rate === "number" && Number.isFinite(rate)) return rate;
  if (typeof rate === "string" && rate.trim()) {
    const parsed = Number(rate.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readStoredSingleSetting(value: unknown, source: string): boolean {
  if (!isRecord(value) || !isRecord(value.singleSettings)) return false;
  return value.singleSettings[source] === true;
}

function TicketActionSidebar({
  model,
  ticket,
  isLoadingRecords,
  recordErrorMessage,
  isOptimizing,
  isActionSubmitting,
  isDraftJobPolling,
  isFeeSetupJobPolling,
  skipLinKeExternal,
  canConfirmOptimization,
  canRetryDraftCreation,
  linkeGoodsId,
  linkeDraftUrl,
  feeSettingUrl,
  canOpenFeeSettingUrl,
  onLinkeGoodsIdChange,
  onConfirmOptimization,
  onRetryDraftCreation,
  onConfirmShelfOnline,
  onSyncLinKeFeeSetup,
  onConfirmFeeSetupSync,
  onRetryProductTracking,
  onConfirmProductOnline,
  isCollapsed,
  onExpand,
  onOpenRatingComparison,
}: {
  model: TicketWorkbenchModel;
  ticket: TicketRecord;
  isLoadingRecords: boolean;
  recordErrorMessage: string;
  isOptimizing: boolean;
  isActionSubmitting: boolean;
  isDraftJobPolling: boolean;
  isFeeSetupJobPolling: boolean;
  skipLinKeExternal: boolean;
  canConfirmOptimization: boolean;
  canRetryDraftCreation: boolean;
  linkeGoodsId: string;
  linkeDraftUrl: string;
  feeSettingUrl: string;
  canOpenFeeSettingUrl: boolean;
  onLinkeGoodsIdChange: (value: string) => void;
  onConfirmOptimization: () => void;
  onRetryDraftCreation: () => void;
  onConfirmShelfOnline: () => void;
  onSyncLinKeFeeSetup: () => void;
  onConfirmFeeSetupSync: () => void;
  onRetryProductTracking: () => void;
  onConfirmProductOnline: () => void;
  isCollapsed: boolean;
  onExpand: () => void;
  onOpenRatingComparison: () => void;
}) {
  const isBusy = isOptimizing || isActionSubmitting;
  const isProductTrackingFlow = model.currentFlow === "product_online_pending";
  const visibleActionButtons = isProductTrackingFlow
    ? model.actionButtons.filter((actionButton) => actionButton.label !== "自动追踪中")
    : model.actionButtons;

  if (isCollapsed) {
    return (
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <button
          type="button"
          className="flex min-h-[180px] w-14 flex-col items-center justify-start gap-3 rounded-md bg-white px-2 py-4 text-slate-500 shadow-sm ring-1 ring-slate-100 hover:bg-slate-50 hover:text-slate-800"
          title="展开工单操作"
          onClick={onExpand}
        >
          <Maximize2 className="h-4 w-4" />
          <span className="[writing-mode:vertical-rl] text-xs font-semibold tracking-normal">工单操作</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <div className="space-y-0 rounded-md bg-white p-4 shadow-sm">
      <SidebarSection title="工单属性">
        <div className="space-y-2">
          {model.metaItems.map((item) => (
            <div key={item.label} className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 text-xs">
              <span className="text-slate-400">{item.label}</span>
              <span className="min-w-0 truncate text-left font-medium text-slate-800">{item.value}</span>
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
                    {item.operatorText ? (
                      <span className="mt-0.5 block text-slate-400">操作人：{item.operatorText}</span>
                    ) : null}
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

      <SidebarSection title={model.operationSectionTitle}>
        <div className="space-y-2">
          {skipLinKeExternal ? (
            <div className="rounded-md bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-700 ring-1 ring-amber-100">
              测试模式：跳过林客外部操作
            </div>
          ) : null}
          {isDraftJobPolling ? (
            <div className="rounded-md bg-emerald-50 p-3 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-100">
              林客草稿创建中，请稍候...
            </div>
          ) : null}
          {isFeeSetupJobPolling ? (
            <div className="rounded-md bg-emerald-50 p-3 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-100">
              林客费用设置同步中，请稍候...
            </div>
          ) : null}
          {model.currentFlow === "shelf_confirm" ? (
            <>
              {looksLikeUrl(linkeDraftUrl) ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full bg-blue-50 text-blue-700 hover:bg-blue-100"
                  onClick={() => openLinKeDraftUrl(linkeDraftUrl)}
                >
                  <ExternalLink className="h-4 w-4" />
                  查看林客草稿
                </Button>
              ) : null}
              <Input
                value={linkeGoodsId}
                onChange={(event) => onLinkeGoodsIdChange(event.target.value)}
                placeholder="填写林客商品ID"
                className="h-10 bg-white"
              />
            </>
          ) : null}
          {model.currentFlow === "commission_setup" && looksLikeUrl(feeSettingUrl) ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full bg-blue-50 text-blue-700 hover:bg-blue-100"
              disabled={!canOpenFeeSettingUrl}
              onClick={() => openLinKeDraftUrl(feeSettingUrl)}
            >
              <ExternalLink className="h-4 w-4" />
              打开林客核对
            </Button>
          ) : null}
          {isProductTrackingFlow ? (
            <ProductTrackingPanel ticket={ticket} />
          ) : null}
          {model.currentFlow === "access_review" ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full bg-white text-slate-700 hover:bg-slate-50"
              onClick={onOpenRatingComparison}
            >
              <Sparkles className="h-4 w-4" />
              商品评级
            </Button>
          ) : null}
          {visibleActionButtons.map((actionButton) => (
            <SidebarActionButton
              key={actionButton.label}
              actionButton={actionButton}
              ticket={ticket}
              disabled={isActionDisabled(actionButton.label, {
                canConfirmOptimization,
                canRetryDraftCreation,
                isBusy,
                linkeGoodsId,
              })}
              onClick={getActionButtonHandler(actionButton.label, {
                onConfirmOptimization,
                onRetryDraftCreation,
                onConfirmShelfOnline,
                onSyncLinKeFeeSetup,
                onConfirmFeeSetupSync,
                onRetryProductTracking,
                onConfirmProductOnline,
              })}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-400">{getActionHint(model.currentFlow)}</p>
      </SidebarSection>
      </div>
    </aside>
  );
}

const MAX_PRODUCT_TRACKING_CHECKS = 72;

function ProductTrackingPanel({ ticket }: { ticket: TicketRecord }) {
  const trackingState = readPayloadText(ticket.payload, "linkeProductTrackingState");
  const feeStatus = readPayloadText(ticket.payload, "linkeFeeStatus") || "待检查";
  const productStatus = readPayloadText(ticket.payload, "linkeProductStatus") || "待检查";
  const lastCheckCount = readPayloadNumber(ticket.payload, "linkeProductTrackingLastCheckCount") ?? 0;
  const nextCheckCount = readPayloadNumber(ticket.payload, "linkeProductTrackingNextCheckCount") ?? (lastCheckCount > 0 ? lastCheckCount + 1 : 1);
  const isStopped = trackingState === "completed" || trackingState === "failed";

  return (
    <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">当前状态</span>
        <Badge variant="muted" className={cn(
          "shrink-0",
          trackingState === "failed" && "bg-red-50 text-red-600",
          trackingState === "completed" && "bg-emerald-50 text-emerald-700",
        )}>
          {formatProductTrackingState(trackingState)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TrackingStatusCell label="费用状态" value={feeStatus} />
        <TrackingStatusCell label="商品状态" value={productStatus} />
      </div>
      <TrackingMetric
        label="检查次数"
        value={formatTrackingCheckCount({ lastCheckCount, nextCheckCount, isStopped })}
      />
    </div>
  );
}

function TrackingStatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-2.5 py-2 ring-1 ring-slate-100">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-1 truncate font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function TrackingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

function readPayloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = readRecordValue(payload, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatProductTrackingState(value: string): string {
  if (value === "queued") return "等待检查";
  if (value === "waiting") return "自动追踪中";
  if (value === "skipped") return "已跳过";
  if (value === "failed") return "追踪失败";
  if (value === "completed") return "已完成";
  return "自动追踪中";
}

function formatTrackingCheckCount(input: {
  lastCheckCount: number;
  nextCheckCount: number;
  isStopped: boolean;
}): string {
  if (input.isStopped && input.lastCheckCount > 0) {
    return `${input.lastCheckCount} / ${MAX_PRODUCT_TRACKING_CHECKS}`;
  }
  return `${Math.max(input.nextCheckCount, 1)} / ${MAX_PRODUCT_TRACKING_CHECKS}`;
}

function isActionDisabled(
  label: string,
  state: { canConfirmOptimization: boolean; canRetryDraftCreation: boolean; isBusy: boolean; linkeGoodsId: string },
): boolean {
  if (state.isBusy) return true;
  if (label === "确认采用优化") return !state.canConfirmOptimization;
  if (label === "重试创建草稿") return !state.canRetryDraftCreation;
  if (label === "确认已上架") return state.linkeGoodsId.trim().length === 0;
  if (label === "确认同步") return state.linkeGoodsId.trim().length === 0;
  if (label === "同步中") return true;
  if (label === "自动追踪中") return true;
  if (label === "查看上线任务") return true;
  return false;
}

function getActionButtonHandler(
  label: string,
  handlers: {
    onConfirmOptimization: () => void;
    onRetryDraftCreation: () => void;
    onConfirmShelfOnline: () => void;
    onSyncLinKeFeeSetup: () => void;
    onConfirmFeeSetupSync: () => void;
    onRetryProductTracking: () => void;
    onConfirmProductOnline: () => void;
  },
): (() => void) | undefined {
  if (label === "确认采用优化") return handlers.onConfirmOptimization;
  if (label === "重试创建草稿") return handlers.onRetryDraftCreation;
  if (label === "确认已上架") return handlers.onConfirmShelfOnline;
  if (label === "确认同步") return handlers.onSyncLinKeFeeSetup;
  if (label === "确认核对无误") return handlers.onConfirmFeeSetupSync;
  if (label === "重试追踪") return handlers.onRetryProductTracking;
  if (label === "人工确认上线") return handlers.onConfirmProductOnline;
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
        onClick={() => openRebuildApproval(ticket.supplyGoodsId, getTicketProductName(ticket))}
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
  if (flow === "info_completion") return "资料被驳回，请回到 Rebuild 完善信息后重新审核。";
  if (flow === "access_review") return "准入未完成时，请先回到 Rebuild 完成审核。";
  if (flow === "info_optimization") return "确认后会先创建林客草稿，草稿成功才进入货架上线确认。";
  if (flow === "shelf_confirm") return "需要填写林客商品ID，确认后进入费用设置。";
  if (flow === "commission_setup") return "先在左侧填写费用比例，再同步到林客费用设置。";
  if (flow === "product_online_pending") return "系统每小时自动追踪林客费用状态和商品状态。";
  return "商品已进入上线任务，后续可查看执行结果。";
}

function buildSupplyGoodsApprovalUrl(supplyGoodsId: string): string {
  return `${SUPPLY_GOODS_APPROVAL_BASE_URL}/${encodeURIComponent(supplyGoodsId)}`;
}

function getTicketProductName(ticket: TicketRecord): string {
  return readPayloadText(buildCurrentDisplayPayload(ticket.sourcePayload, ticket.payload), "goodsName", "goodsNameInput")
    || "未命名商品";
}

function openRebuildApproval(supplyGoodsId: string, productName: string) {
  if (isElectronEmbedded() && openRebuildApprovalInElectron(supplyGoodsId, productName)) {
    return;
  }
  window.open(buildSupplyGoodsApprovalUrl(supplyGoodsId), "_blank", "noopener,noreferrer");
}

function openLinKeDraftUrl(url: string) {
  if (!looksLikeUrl(url)) return;
  if (isElectronEmbedded() && openBrowserTabInElectron(url)) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 py-5 first:pt-0 last:border-b-0 last:pb-0">
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
        <div className="ticket-scrollbar mt-4 max-h-[72vh] overflow-auto rounded-md bg-slate-950/5 p-2">
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
      <div className="ticket-scrollbar h-[68vh] overflow-auto bg-slate-200 p-4">
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
