import { clearSession, getStoredToken, removeHandoffFromUrl } from "./auth.ts";
import { getApiBaseUrl, getSsoLoginUrl } from "./config.ts";
import {
  formatPayloadValue,
  getPayloadValue,
  type TicketFieldMetadataMap,
  type TicketFieldOptionsMap,
} from "./field-display.ts";

export interface TicketRecord {
  id: number;
  supplyGoodsId: string;
  status: TicketStatus;
  businessStatus: TicketBusinessStatus;
  payload: Record<string, unknown>;
  sourcePayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus =
  | "returned"
  | "todo"
  | "processing"
  | "done";

export type TicketBusinessStatus =
  | "info_completion_pending"
  | "access_review_pending"
  | "info_optimization_pending"
  | "shelf_confirm_pending"
  | "commission_setup_pending"
  | "product_online_pending"
  | "online";

export interface TicketActionRecord {
  id: number;
  ticketId: number;
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator: Record<string, unknown>;
  remark: string | null;
  createdAt: string;
}

export interface TicketInfoOptimizationResponse {
  originPackages: Record<string, unknown>;
  optimizedPackages: Record<string, unknown>;
}

export interface CreateTicketActionRecordInput {
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  remark?: string | null;
}

export interface TicketMetadata {
  fieldOptions: TicketFieldOptionsMap;
  fieldMetadata: TicketFieldMetadataMap;
}

export type RebuildReferenceEntity = "SupplyCompany" | "SupplyHost";

export interface RebuildReferenceDetail {
  entity: RebuildReferenceEntity;
  id: string;
  payload: Record<string, unknown>;
}

export interface RebuildReferenceMetadata {
  entity: RebuildReferenceEntity;
  fieldMetadata: TicketFieldMetadataMap;
  fieldOptions: TicketFieldOptionsMap;
}

export interface TicketListQuery {
  status?: TicketStatus;
  businessStatus?: TicketBusinessStatus;
  q?: string;
  pageNo?: number;
  pageSize?: number;
}

export interface TicketListResult {
  tickets: TicketRecord[];
  total: number;
  pageNo: number;
  pageSize: number;
}

interface TicketApiRecord {
  id: number;
  supply_goods_id: string;
  status?: TicketStatus;
  business_status?: TicketBusinessStatus;
  payload: Record<string, unknown>;
  source_payload?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface TicketActionRecordApiRecord {
  id: number;
  ticket_id: number;
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator: Record<string, unknown>;
  remark: string | null;
  created_at: string;
}

interface TicketFieldOptionApiRecord {
  value: string;
  label: string;
  sort_order: number | null;
  is_default: boolean;
}

type TicketFieldOptionsApiMap = Record<string, TicketFieldOptionApiRecord[]>;

interface TicketFieldMetadataApiRecord {
  label: string;
  field_type: string;
}

type TicketFieldMetadataApiMap = Record<string, TicketFieldMetadataApiRecord>;

interface TicketListResponse {
  tickets: TicketApiRecord[];
  total: number;
  pageNo: number;
  pageSize: number;
}

const DEFAULT_TICKET_PAGE_SIZE = 100;

interface TicketDetailResponse {
  ticket: TicketApiRecord;
}

interface TicketActionRecordListResponse {
  records: TicketActionRecordApiRecord[];
}

interface TicketActionRecordCreateResponse {
  ticket: TicketApiRecord;
  record: TicketActionRecordApiRecord;
}

interface TicketInfoOptimizationConfirmResponse {
  ticket: TicketApiRecord;
  record: TicketActionRecordApiRecord;
  jobId?: string;
  skippedLinKeExternal?: boolean;
}

export interface LinKeDraftJobStatus {
  jobId: string;
  state: string;
  failedReason: string;
  returnValue: Record<string, unknown> | null;
}

export interface LinKeFeeRates {
  values: Record<string, number>;
  singleSettings: Record<string, boolean>;
}

export type LinKeJobStatus = LinKeDraftJobStatus;

interface TicketJobActionResponse {
  ticket: TicketApiRecord;
  record: TicketActionRecordApiRecord;
  jobId?: string;
  skippedLinKeExternal?: boolean;
}

interface TicketMetadataResponse {
  field_options?: TicketFieldOptionsApiMap;
  field_metadata?: TicketFieldMetadataApiMap;
}

interface RebuildReferenceDetailResponse {
  entity: RebuildReferenceEntity;
  id: string;
  payload: Record<string, unknown>;
}

interface RebuildReferenceMetadataResponse {
  entity: RebuildReferenceEntity;
  field_metadata?: TicketFieldMetadataApiMap;
  field_options?: TicketFieldOptionsApiMap;
}

interface ApiErrorResponse {
  message?: string;
}

interface ElectronAuthApi {
  startSsoLogin?: () => Promise<unknown>;
}

interface ElectronWebviewBridge {
  startSsoLogin?: () => void;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return body.message || `请求失败：${response.status}`;
  } catch {
    return `请求失败：${response.status}`;
  }
}

function buildSsoLoginRedirectUrl(returnTo: string): string {
  const url = new URL(getSsoLoginUrl());
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function getCurrentReturnToUrl(): string | null {
  if (typeof window === "undefined") return null;
  return removeHandoffFromUrl(window.location.href);
}

function isElectronEmbeddedPage(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return url.searchParams.get("embedded") === "electron";
}

function notifyParentToStartSsoLogin(): boolean {
  if (typeof window === "undefined" || !isElectronEmbeddedPage()) return false;
  const webviewBridge = (window as unknown as { promaElectronWebview?: ElectronWebviewBridge }).promaElectronWebview;
  if (webviewBridge?.startSsoLogin) {
    webviewBridge.startSsoLogin();
    return true;
  }
  const parent = window.parent as Window | undefined;
  if (!parent || parent === window) return false;
  parent.postMessage({ type: "proma:start-sso-login" }, "*");
  return true;
}

function redirectToSsoLogin(): void {
  const returnTo = getCurrentReturnToUrl();
  if (!returnTo) return;
  window.location.assign(buildSsoLoginRedirectUrl(returnTo));
}

function getElectronAuthApi(): ElectronAuthApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: ElectronAuthApi }).electronAPI;
  return api?.startSsoLogin ? api : null;
}

function startElectronSsoLogin(): boolean {
  const api = getElectronAuthApi();
  if (!api?.startSsoLogin) return false;
  api.startSsoLogin().catch((error) => {
    console.error("[认证] 自动打开 SSO 登录页失败:", error);
  });
  return true;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await parseApiError(response);
    if (response.status === 401) {
      clearSession();
      if (!startElectronSsoLogin()) {
        if (!notifyParentToStartSsoLogin()) {
          redirectToSsoLogin();
        }
      }
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

function normalizeFieldOptions(options: TicketFieldOptionsApiMap | undefined): TicketFieldOptionsMap {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).map(([fieldName, fieldOptions]) => [
      fieldName,
      fieldOptions.map((option) => ({
        value: option.value,
        label: option.label,
        sortOrder: option.sort_order,
        isDefault: option.is_default,
      })),
    ]),
  );
}

function normalizeFieldMetadata(metadata: TicketFieldMetadataApiMap | undefined): TicketFieldMetadataMap {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).map(([fieldName, field]) => [
      fieldName,
      {
        label: field.label,
        fieldType: field.field_type,
      },
    ]),
  );
}

function normalizeTicket(record: TicketApiRecord): TicketRecord {
  return {
    id: record.id,
    supplyGoodsId: record.supply_goods_id,
    status: record.status ?? "todo",
    businessStatus: record.business_status ?? "access_review_pending",
    payload: record.payload,
    sourcePayload: record.source_payload ?? record.payload,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function normalizeTicketActionRecord(record: TicketActionRecordApiRecord): TicketActionRecord {
  return {
    id: record.id,
    ticketId: record.ticket_id,
    action: record.action,
    origin: record.origin,
    current: record.current,
    operator: record.operator,
    remark: record.remark,
    createdAt: record.created_at,
  };
}

function normalizeTicketMetadata(response: TicketMetadataResponse): TicketMetadata {
  return {
    fieldOptions: normalizeFieldOptions(response.field_options),
    fieldMetadata: normalizeFieldMetadata(response.field_metadata),
  };
}

function normalizeRebuildReferenceDetail(response: RebuildReferenceDetailResponse): RebuildReferenceDetail {
  return {
    entity: response.entity,
    id: response.id,
    payload: response.payload,
  };
}

function normalizeRebuildReferenceMetadata(response: RebuildReferenceMetadataResponse): RebuildReferenceMetadata {
  return {
    entity: response.entity,
    fieldMetadata: normalizeFieldMetadata(response.field_metadata),
    fieldOptions: normalizeFieldOptions(response.field_options),
  };
}

export async function listTickets(query: TicketListQuery = {}): Promise<TicketListResult> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.businessStatus) params.set("businessStatus", query.businessStatus);
  if (query.q) params.set("q", query.q);
  if (query.pageNo) params.set("pageNo", String(query.pageNo));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));

  const search = params.toString();
  const response = await apiFetch<TicketListResponse>(`/api/tickets${search ? `?${search}` : ""}`);
  return {
    tickets: response.tickets.map((ticket) => normalizeTicket(ticket)),
    total: response.total,
    pageNo: response.pageNo,
    pageSize: response.pageSize,
  };
}

export async function listAllTickets(query: Omit<TicketListQuery, "pageNo"> = {}): Promise<TicketListResult> {
  const pageSize = query.pageSize ?? DEFAULT_TICKET_PAGE_SIZE;
  const tickets: TicketRecord[] = [];
  let pageNo = 1;
  let total = 0;

  while (true) {
    const result = await listTickets({
      ...query,
      pageNo,
      pageSize,
    });
    total = result.total;
    tickets.push(...result.tickets);

    if (tickets.length >= total || result.tickets.length === 0) {
      return {
        tickets,
        total,
        pageNo: 1,
        pageSize,
      };
    }

    pageNo += 1;
  }
}

export async function getTicket(supplyGoodsId: string): Promise<TicketRecord> {
  const response = await apiFetch<TicketDetailResponse>(`/api/tickets/${encodeURIComponent(supplyGoodsId)}`);
  return normalizeTicket(response.ticket);
}

export async function getTicketActionRecords(supplyGoodsId: string): Promise<TicketActionRecord[]> {
  const response = await apiFetch<TicketActionRecordListResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/action-records`,
  );
  return response.records.map((record) => normalizeTicketActionRecord(record));
}

export async function getRebuildReferenceDetail(
  entity: RebuildReferenceEntity,
  id: string,
): Promise<RebuildReferenceDetail> {
  return normalizeRebuildReferenceDetail(await apiFetch<RebuildReferenceDetailResponse>(
    `/api/rebuild/references/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
  ));
}

export async function getRebuildReferenceMetadata(entity: RebuildReferenceEntity): Promise<RebuildReferenceMetadata> {
  return normalizeRebuildReferenceMetadata(await apiFetch<RebuildReferenceMetadataResponse>(
    `/api/rebuild/references/${encodeURIComponent(entity)}/metadata`,
  ));
}

export async function createTicketActionRecord(
  supplyGoodsId: string,
  input: CreateTicketActionRecordInput,
): Promise<{ ticket: TicketRecord; record: TicketActionRecord }> {
  const response = await apiFetch<TicketActionRecordCreateResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/action-records`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
  };
}

export async function generateTicketInfoOptimization(supplyGoodsId: string): Promise<TicketInfoOptimizationResponse> {
  return await apiFetch<TicketInfoOptimizationResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/info-optimization/generate`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function confirmTicketInfoOptimization(
  supplyGoodsId: string,
  optimizedPackages: Record<string, unknown>,
  options: { skipLinKeExternal?: boolean } = {},
): Promise<{ ticket: TicketRecord; record: TicketActionRecord; jobId?: string; skippedLinKeExternal?: boolean }> {
  const response = await apiFetch<TicketInfoOptimizationConfirmResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/info-optimization/confirm`,
    {
      method: "POST",
      body: JSON.stringify({
        optimizedPackages,
        ...(options.skipLinKeExternal ? { skipLinKeExternal: true } : {}),
      }),
    },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
    jobId: response.jobId,
    skippedLinKeExternal: response.skippedLinKeExternal,
  };
}

export async function retryLinKeDraftJob(
  supplyGoodsId: string,
  options: { skipLinKeExternal?: boolean } = {},
): Promise<{ ticket: TicketRecord; record: TicketActionRecord; jobId?: string; skippedLinKeExternal?: boolean }> {
  const response = await apiFetch<TicketJobActionResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-draft/retry`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(options.skipLinKeExternal ? { skipLinKeExternal: true } : {}),
      }),
    },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
    jobId: response.jobId,
    skippedLinKeExternal: response.skippedLinKeExternal,
  };
}

export async function getLinKeDraftJobStatus(
  supplyGoodsId: string,
  jobId: string,
): Promise<LinKeDraftJobStatus> {
  return await apiFetch<LinKeDraftJobStatus>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-draft-jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function startLinKeFeeSetupJob(
  supplyGoodsId: string,
  input: { merchantId: string; linkeGoodsId: string; rates: LinKeFeeRates; skipLinKeExternal?: boolean },
): Promise<{ ticket: TicketRecord; record: TicketActionRecord; jobId?: string; skippedLinKeExternal?: boolean }> {
  const response = await apiFetch<TicketJobActionResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-fee-setup/jobs`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
    jobId: response.jobId,
    skippedLinKeExternal: response.skippedLinKeExternal,
  };
}

export async function getLinKeFeeSetupJobStatus(
  supplyGoodsId: string,
  jobId: string,
): Promise<LinKeJobStatus> {
  return await apiFetch<LinKeJobStatus>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-fee-setup/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function confirmLinKeFeeSetup(
  supplyGoodsId: string,
  options: { skipLinKeExternal?: boolean } = {},
): Promise<{ ticket: TicketRecord; record: TicketActionRecord; jobId?: string; skippedLinKeExternal?: boolean }> {
  const response = await apiFetch<TicketJobActionResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-fee-setup/confirm`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(options.skipLinKeExternal ? { skipLinKeExternal: true } : {}),
      }),
    },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
    jobId: response.jobId,
    skippedLinKeExternal: response.skippedLinKeExternal,
  };
}

export async function retryLinKeProductTracking(
  supplyGoodsId: string,
): Promise<{ ticket: TicketRecord; record: TicketActionRecord; jobId?: string }> {
  const response = await apiFetch<TicketJobActionResponse>(
    `/api/tickets/${encodeURIComponent(supplyGoodsId)}/lin-ke-product-tracking/retry`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return {
    ticket: normalizeTicket(response.ticket),
    record: normalizeTicketActionRecord(response.record),
    jobId: response.jobId,
  };
}

export async function getTicketMetadata(): Promise<TicketMetadata> {
  return normalizeTicketMetadata(await apiFetch<TicketMetadataResponse>("/api/tickets/metadata"));
}

export function getPayloadText(payload: Record<string, unknown>, ...fields: string[]): string {
  for (const field of fields) {
    const text = formatPayloadValue(getPayloadValue(payload, field), field, {
      fieldMetadata: {},
      fieldOptions: {},
    });
    if (text) return text;
  }
  return "";
}

export function getPayloadTextWithOptions(
  payload: Record<string, unknown>,
  fieldOptions: TicketFieldOptionsMap,
  ...fields: string[]
): string {
  for (const field of fields) {
    const text = formatPayloadValue(getPayloadValue(payload, field), field, {
      fieldMetadata: {},
      fieldOptions,
    });
    if (text) return text;
  }
  return "";
}

export function getPayloadList(payload: Record<string, unknown>, ...fields: string[]): string[] {
  for (const field of fields) {
    const value = getPayloadValue(payload, field);
    if (Array.isArray(value)) {
      return value
        .map((item) => formatPayloadValue(item, field, { fieldMetadata: {}, fieldOptions: {} }))
        .filter((item) => item.length > 0);
    }
    const text = formatPayloadValue(value, field, { fieldMetadata: {}, fieldOptions: {} });
    if (text) return [text];
  }
  return [];
}
