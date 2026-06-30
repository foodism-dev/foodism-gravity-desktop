import type { ImportFromSupplyGoodsResult } from "../service/rebuild/import-from-supplygoods.ts";
import type { JsonRecord } from "../service/lin-ke/utils.ts";

export const GRAVITY_JOBS_QUEUE_NAME = "gravity-jobs";
export const REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME = "rebuild:import-from-supplygoods";
export const REBUILD_SUPPLIER_SYNC_JOB_NAME = "rebuild:supplier:sync";
export const LIN_KE_DRAFT_JOB_NAME = "lin-ke:draft:create";

export interface ImportFromSupplyGoodsJobData {
  pageNo?: number;
  pageSize?: number;
  pages?: number;
}

export interface CreateLinKeDraftJobData {
  supplyGoodsId: string;
}

export interface RebuildSupplierSyncJobData {
  entityName: "SupplyCompany" | "SupplyHost";
  recordId: string;
  source: "supply_goods_callback";
  supplyGoodsId: string;
}

export interface GravityJobDataMap {
  [REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME]: ImportFromSupplyGoodsJobData;
  [REBUILD_SUPPLIER_SYNC_JOB_NAME]: RebuildSupplierSyncJobData;
  [LIN_KE_DRAFT_JOB_NAME]: CreateLinKeDraftJobData;
}

export interface GravityJobResultMap {
  [REBUILD_IMPORT_FROM_SUPPLY_GOODS_JOB_NAME]: ImportFromSupplyGoodsResult;
  [REBUILD_SUPPLIER_SYNC_JOB_NAME]: JsonRecord;
  [LIN_KE_DRAFT_JOB_NAME]: JsonRecord;
}

export type GravityJobName = keyof GravityJobDataMap;
export type GravityJobData = GravityJobDataMap[GravityJobName];
export type GravityJobResult = GravityJobResultMap[GravityJobName];
