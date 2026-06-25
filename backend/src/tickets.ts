import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "./db/client.ts";
import { rebuildSupplyGoods, ticketActionRecords, tickets } from "./db/schema.ts";
import type { RebuildFieldMetadata, RebuildFieldOptionMetadata } from "./rebuild/fields.ts";
import {
  getNextTicketFlowStateByAction,
  getTicketStatusByBusinessStatus,
  normalizeTicketBusinessStatus,
  normalizeTicketStatus,
  type TicketBusinessStatus,
  type TicketStatus,
} from "./ticket-status.ts";

export interface TicketQuery {
  status?: TicketStatus;
  businessStatus?: TicketBusinessStatus;
  q?: string;
  pageNo: number;
  pageSize: number;
}

export interface TicketWithSupplyGoods {
  id: number;
  supplyGoodsId: string;
  status: TicketStatus;
  businessStatus: TicketBusinessStatus;
  payload: Record<string, unknown>;
  sourcePayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketActionRecord {
  id: number;
  ticketId: number;
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator: Record<string, unknown>;
  remark: string | null;
  createdAt: Date;
}

export interface CreateTicketActionRecordInput {
  supplyGoodsId: string;
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator: Record<string, unknown>;
  remark: string | null;
}

export interface CreateTicketActionRecordResult {
  ticket: TicketWithSupplyGoods;
  record: TicketActionRecord;
}

export interface TicketListResult {
  tickets: TicketWithSupplyGoods[];
  total: number;
  pageNo: number;
  pageSize: number;
}

export interface TicketRepository {
  listTickets: (query: TicketQuery) => Promise<TicketListResult>;
  getTicket: (supplyGoodsId: string) => Promise<TicketWithSupplyGoods | null>;
  listActionRecords: (supplyGoodsId: string) => Promise<TicketActionRecord[]>;
  createActionRecord: (input: CreateTicketActionRecordInput) => Promise<CreateTicketActionRecordResult | null>;
}

export interface TicketApiRecord {
  id: number;
  supply_goods_id: string;
  status: TicketStatus;
  business_status: TicketBusinessStatus;
  payload: Record<string, unknown>;
  source_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TicketActionRecordApiRecord {
  id: number;
  ticket_id: number;
  action: string;
  origin: Record<string, unknown>;
  current: Record<string, unknown>;
  operator: Record<string, unknown>;
  remark: string | null;
  created_at: string;
}

export interface TicketFieldOptionApiRecord {
  value: string;
  label: string;
  sort_order: number | null;
  is_default: boolean;
}

export type TicketFieldOptionsApiMap = Record<string, TicketFieldOptionApiRecord[]>;

export interface TicketFieldMetadataApiRecord {
  label: string;
  field_type: string;
}

export type TicketFieldMetadataApiMap = Record<string, TicketFieldMetadataApiRecord>;

export interface TicketListApiResponse {
  tickets: TicketApiRecord[];
  total: number;
  pageNo: number;
  pageSize: number;
}

export interface TicketDetailApiResponse {
  ticket: TicketApiRecord;
}

export interface TicketActionRecordListApiResponse {
  records: TicketActionRecordApiRecord[];
}

export interface TicketActionRecordCreateApiResponse {
  ticket: TicketApiRecord;
  record: TicketActionRecordApiRecord;
}

export interface TicketMetadataApiResponse {
  field_options: TicketFieldOptionsApiMap;
  field_metadata: TicketFieldMetadataApiMap;
}

const DEFAULT_PAGE_NO = 1;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

let defaultTicketRepository: TicketRepository | null | undefined;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseTicketQuery(input: {
  status?: string;
  businessStatus?: string;
  q?: string;
  pageNo?: string;
  pageSize?: string;
}): TicketQuery {
  const pageSize = Math.min(parsePositiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return {
    status: input.status ? normalizeTicketStatus(input.status) : undefined,
    businessStatus: input.businessStatus ? normalizeTicketBusinessStatus(input.businessStatus) : undefined,
    q: input.q?.trim() || undefined,
    pageNo: parsePositiveInteger(input.pageNo, DEFAULT_PAGE_NO),
    pageSize,
  };
}

export function serializeTicket(ticket: TicketWithSupplyGoods): TicketApiRecord {
  const sourcePayload = ticket.sourcePayload ?? ticket.payload;
  return {
    id: ticket.id,
    supply_goods_id: ticket.supplyGoodsId,
    status: ticket.status,
    business_status: ticket.businessStatus,
    payload: ticket.payload,
    source_payload: sourcePayload,
    created_at: ticket.createdAt.toISOString(),
    updated_at: ticket.updatedAt.toISOString(),
  };
}

export function serializeTicketActionRecord(record: TicketActionRecord): TicketActionRecordApiRecord {
  return {
    id: record.id,
    ticket_id: record.ticketId,
    action: record.action,
    origin: record.origin,
    current: record.current,
    operator: record.operator,
    remark: record.remark,
    created_at: record.createdAt.toISOString(),
  };
}

export function serializeFieldOption(option: RebuildFieldOptionMetadata): TicketFieldOptionApiRecord {
  return {
    value: option.optionValue,
    label: option.optionLabel,
    sort_order: option.sortOrder,
    is_default: option.isDefault,
  };
}

export function serializeFieldMetadata(fields: RebuildFieldMetadata[]): TicketFieldMetadataApiMap {
  return Object.fromEntries(
    fields.map((field) => [
      field.fieldName,
      {
        label: field.label,
        field_type: field.fieldType,
      },
    ]),
  );
}

export function serializeTicketList(result: TicketListResult): TicketListApiResponse {
  return {
    tickets: result.tickets.map(serializeTicket),
    total: result.total,
    pageNo: result.pageNo,
    pageSize: result.pageSize,
  };
}

function buildTicketWhere(query: TicketQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.status) {
    conditions.push(eq(tickets.status, query.status));
  }
  if (query.businessStatus) {
    conditions.push(eq(tickets.businessStatus, query.businessStatus));
  }
  if (query.q) {
    const keyword = `%${query.q}%`;
    conditions.push(
      or(
        ilike(tickets.supplyGoodsId, keyword),
        sql`${rebuildSupplyGoods.payload}::text ILIKE ${keyword}`,
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function createDrizzleTicketRepository(db: ServerDatabase): TicketRepository {
  return {
    async listTickets(query: TicketQuery): Promise<TicketListResult> {
      const where = buildTicketWhere(query);
      const offset = (query.pageNo - 1) * query.pageSize;
      const rowsQuery = db
        .select({
          id: tickets.id,
          supplyGoodsId: tickets.supplyGoodsId,
          status: tickets.status,
          businessStatus: tickets.businessStatus,
          payload: tickets.payload,
          sourcePayload: rebuildSupplyGoods.payload,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .innerJoin(rebuildSupplyGoods, eq(tickets.supplyGoodsId, rebuildSupplyGoods.supplyGoodsId))
        .orderBy(desc(tickets.updatedAt))
        .limit(query.pageSize)
        .offset(offset);
      const rows = where ? await rowsQuery.where(where) : await rowsQuery;

      const totalQuery = db
        .select({ value: count() })
        .from(tickets)
        .innerJoin(rebuildSupplyGoods, eq(tickets.supplyGoodsId, rebuildSupplyGoods.supplyGoodsId));
      const totalRows = where ? await totalQuery.where(where) : await totalQuery;

      return {
        tickets: rows.map(normalizeTicketRowStatus),
        total: Number(totalRows[0]?.value ?? 0),
        pageNo: query.pageNo,
        pageSize: query.pageSize,
      };
    },

    async getTicket(supplyGoodsId: string): Promise<TicketWithSupplyGoods | null> {
      const rows = await db
        .select({
          id: tickets.id,
          supplyGoodsId: tickets.supplyGoodsId,
          status: tickets.status,
          businessStatus: tickets.businessStatus,
          payload: tickets.payload,
          sourcePayload: rebuildSupplyGoods.payload,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .innerJoin(rebuildSupplyGoods, eq(tickets.supplyGoodsId, rebuildSupplyGoods.supplyGoodsId))
        .where(eq(tickets.supplyGoodsId, supplyGoodsId))
        .limit(1);

      return rows[0] ? normalizeTicketRowStatus(rows[0]) : null;
    },

    async listActionRecords(supplyGoodsId: string): Promise<TicketActionRecord[]> {
      const ticketRows = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.supplyGoodsId, supplyGoodsId))
        .limit(1);

      const ticketId = ticketRows[0]?.id;
      if (!ticketId) return [];

      const rows = await db
        .select({
          id: ticketActionRecords.id,
          ticketId: ticketActionRecords.ticketId,
          action: ticketActionRecords.action,
          origin: ticketActionRecords.origin,
          current: ticketActionRecords.current,
          operator: ticketActionRecords.operator,
          remark: ticketActionRecords.remark,
          createdAt: ticketActionRecords.createdAt,
        })
        .from(ticketActionRecords)
        .where(eq(ticketActionRecords.ticketId, ticketId))
        .orderBy(desc(ticketActionRecords.createdAt));

      return rows;
    },

    async createActionRecord(input: CreateTicketActionRecordInput): Promise<CreateTicketActionRecordResult | null> {
      const existingTicket = await this.getTicket(input.supplyGoodsId);
      if (!existingTicket) return null;

      const nextPayload = {
        ...existingTicket.payload,
        ...input.current,
      };
      const nextState = getNextTicketFlowStateByAction(input.action, {
        status: normalizeTicketStatus(existingTicket.status),
        businessStatus: normalizeTicketBusinessStatus(existingTicket.businessStatus),
      });

      await db
        .update(tickets)
        .set({
          payload: nextPayload,
          status: nextState.status,
          businessStatus: nextState.businessStatus,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, existingTicket.id));

      const insertedRows = await db
        .insert(ticketActionRecords)
        .values({
          ticketId: existingTicket.id,
          action: input.action,
          origin: input.origin,
          current: input.current,
          operator: input.operator,
          remark: input.remark,
        })
        .returning({
          id: ticketActionRecords.id,
          ticketId: ticketActionRecords.ticketId,
          action: ticketActionRecords.action,
          origin: ticketActionRecords.origin,
          current: ticketActionRecords.current,
          operator: ticketActionRecords.operator,
          remark: ticketActionRecords.remark,
          createdAt: ticketActionRecords.createdAt,
        });

      const updatedTicket = await this.getTicket(input.supplyGoodsId);
      const record = insertedRows[0];
      if (!updatedTicket || !record) return null;

      return {
        ticket: updatedTicket,
        record,
      };
    },
  };
}

function normalizeTicketRowStatus(
  ticket: Omit<TicketWithSupplyGoods, "status" | "businessStatus"> & {
    status: string;
    businessStatus: string;
  },
): TicketWithSupplyGoods {
  const businessStatus = normalizeTicketBusinessStatus(ticket.businessStatus);
  return {
    ...ticket,
    status: getTicketStatusByBusinessStatus(businessStatus),
    businessStatus,
  };
}

export function getDefaultTicketRepository(): TicketRepository | null {
  if (defaultTicketRepository !== undefined) {
    return defaultTicketRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，工单查询接口不可用");
    defaultTicketRepository = null;
    return defaultTicketRepository;
  }

  defaultTicketRepository = createDrizzleTicketRepository(createDatabase(databaseUrl));
  return defaultTicketRepository;
}
