import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "./db/client.ts";
import { rebuildSupplyGoods, tickets } from "./db/schema.ts";
import { replacePayloadAssetUrls, type RebuildAssetMap } from "./rebuild/assets.ts";
import type { RebuildFieldMetadata, RebuildFieldOptionMetadata } from "./rebuild/fields.ts";

export interface TicketQuery {
  approvalState?: string;
  q?: string;
  pageNo: number;
  pageSize: number;
}

export interface TicketWithSupplyGoods {
  id: number;
  supplyGoodsId: string;
  approvalState: string;
  payload: Record<string, unknown>;
  assets?: RebuildAssetMap;
  createdAt: Date;
  updatedAt: Date;
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
}

export interface TicketApiRecord {
  id: number;
  supply_goods_id: string;
  approval_state: string;
  payload: Record<string, unknown>;
  assets: RebuildAssetMap;
  created_at: string;
  updated_at: string;
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
  approvalState?: string;
  q?: string;
  pageNo?: string;
  pageSize?: string;
}): TicketQuery {
  const pageSize = Math.min(parsePositiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return {
    approvalState: input.approvalState?.trim() || undefined,
    q: input.q?.trim() || undefined,
    pageNo: parsePositiveInteger(input.pageNo, DEFAULT_PAGE_NO),
    pageSize,
  };
}

export function serializeTicket(ticket: TicketWithSupplyGoods): TicketApiRecord {
  const assets = ticket.assets ?? {};
  return {
    id: ticket.id,
    supply_goods_id: ticket.supplyGoodsId,
    approval_state: ticket.approvalState,
    payload: replacePayloadAssetUrls(ticket.payload, assets),
    assets,
    created_at: ticket.createdAt.toISOString(),
    updated_at: ticket.updatedAt.toISOString(),
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
  if (query.approvalState) {
    conditions.push(eq(tickets.approvalState, query.approvalState));
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
          approvalState: tickets.approvalState,
          payload: rebuildSupplyGoods.payload,
          assets: rebuildSupplyGoods.assets,
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
        tickets: rows,
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
          approvalState: tickets.approvalState,
          payload: rebuildSupplyGoods.payload,
          assets: rebuildSupplyGoods.assets,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .innerJoin(rebuildSupplyGoods, eq(tickets.supplyGoodsId, rebuildSupplyGoods.supplyGoodsId))
        .where(eq(tickets.supplyGoodsId, supplyGoodsId))
        .limit(1);

      return rows[0] ?? null;
    },
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
