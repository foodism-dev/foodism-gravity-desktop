import { getStoredToken } from "./auth.ts";
import {
  formatPayloadValue,
  getPayloadValue,
  type TicketFieldMetadataMap,
  type TicketFieldOptionsMap,
} from "./field-display.ts";

export interface TicketRecord {
  id: number;
  supplyGoodsId: string;
  approvalState: string;
  payload: Record<string, unknown>;
  fieldOptions: TicketFieldOptionsMap;
  fieldMetadata: TicketFieldMetadataMap;
  createdAt: string;
  updatedAt: string;
}

export interface TicketListQuery {
  approvalState?: string;
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
  approval_state: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8787";
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

function normalizeTicket(
  record: TicketApiRecord,
  fieldOptions?: TicketFieldOptionsApiMap,
  fieldMetadata?: TicketFieldMetadataApiMap,
): TicketRecord {
  return {
    id: record.id,
    supplyGoodsId: record.supply_goods_id,
    approvalState: record.approval_state,
    payload: record.payload,
    fieldOptions: normalizeFieldOptions(fieldOptions),
    fieldMetadata: normalizeFieldMetadata(fieldMetadata),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export async function listTickets(query: TicketListQuery = {}): Promise<TicketListResult> {
  const params = new URLSearchParams();
  if (query.approvalState) params.set("approvalState", query.approvalState);
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
  return normalizeTicket(response.ticket, response.field_options, response.field_metadata);
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
