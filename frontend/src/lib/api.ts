import { getStoredToken } from "./auth.ts";
import { getApiBaseUrl } from "./config.ts";
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
  | "todo"
  | "processing"
  | "done";

export type TicketBusinessStatus =
  | "access_review_pending"
  | "info_optimization_pending"
  | "shelf_confirm_pending"
  | "commission_setup_pending"
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

export interface CreateTicketActionRecordInput {
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator?: Record<string, unknown>;
  remark?: string | null;
}

export interface TicketMetadata {
  fieldOptions: TicketFieldOptionsMap;
  fieldMetadata: TicketFieldMetadataMap;
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

interface TicketMetadataResponse {
  field_options?: TicketFieldOptionsApiMap;
  field_metadata?: TicketFieldMetadataApiMap;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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
    throw new ApiError(`请求失败：${response.status}`, response.status);
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
