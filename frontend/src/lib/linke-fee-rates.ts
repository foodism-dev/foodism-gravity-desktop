import type { LinKeFeeRates } from "./api.ts";

export interface CommissionTrafficChild {
  source: string;
  label: string;
  max?: number;
}

export interface CommissionTrafficRow {
  group: string;
  source: string;
  label: string;
  closedMax: number;
  singleSettingEnabled: boolean;
  children: CommissionTrafficChild[];
}

export interface CommissionRateValues {
  values: Record<string, string>;
  singleSettings: Record<string, boolean>;
}

export const COMMISSION_TRAFFIC_ROWS: CommissionTrafficRow[] = [
  {
    group: "常规成交",
    source: "1000",
    label: "视频",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "1001", label: "商家视频" },
      { source: "1002", label: "达人视频" },
      { source: "1003", label: "职人视频", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "2000",
    label: "直播",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "2001", label: "商家直播" },
      { source: "2002", label: "达人直播" },
      { source: "2003", label: "职人直播", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "3000",
    label: "线下扫码",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "3001", label: "直接下单" },
      { source: "3002", label: "职人码", max: 20 },
    ],
  },
  {
    group: "常规成交",
    source: "4000",
    label: "搜索/商城",
    closedMax: 80,
    singleSettingEnabled: false,
    children: [],
  },
  {
    group: "常规成交",
    source: "5000",
    label: "获客卡",
    closedMax: 80,
    singleSettingEnabled: true,
    children: [
      { source: "5001", label: "门店卡/到店卡" },
      { source: "5002", label: "商品卡" },
    ],
  },
  {
    group: "增量宝",
    source: "7000",
    label: "内容成交",
    closedMax: 20,
    singleSettingEnabled: true,
    children: [
      { source: "7001", label: "商家内容" },
      { source: "7002", label: "达人内容" },
      { source: "7003", label: "职人内容", max: 20 },
    ],
  },
  {
    group: "增量宝",
    source: "7100",
    label: "非内容成交",
    closedMax: 80,
    singleSettingEnabled: false,
    children: [],
  },
];

export const COMMISSION_CHILD_OPEN_MAX = 80;

export function getCommissionChildMax(child: CommissionTrafficChild): number {
  return child.max ?? COMMISSION_CHILD_OPEN_MAX;
}

export function sanitizeCommissionRateInput(value: string): string {
  const normalized = value.replace(/[^\d.]/g, "");
  const [integer = "", ...decimalParts] = normalized.split(".");
  if (decimalParts.length === 0) return integer;
  return `${integer}.${decimalParts.join("").slice(0, 2)}`;
}

export function formatCommissionRateInput(value: number): string {
  return value.toFixed(2);
}

export function validateLinkeCommission(values: CommissionRateValues): string {
  for (const field of activeCommissionTrafficFields(values)) {
    const value = values.values[field.source]?.trim();
    const numberValue = Number(value);
    if (!value || !Number.isFinite(numberValue)) return `请填写${field.label}费用比例`;
    if (numberValue < 0) return `${field.label}费用比例不能小于 0`;
    if (numberValue > field.max) return `${field.label}费用比例不能超过 ${field.max.toFixed(2)}%`;
  }
  return "";
}

export function normalizeLinkeCommission(values: CommissionRateValues): LinKeFeeRates {
  return {
    values: Object.fromEntries(
      activeCommissionTrafficFields(values).map((field) => {
        const numberValue = Number(values.values[field.source]);
        return [field.source, Number(formatCommissionRateInput(Number.isFinite(numberValue) ? numberValue : 0))];
      }),
    ),
    singleSettings: Object.fromEntries(
      COMMISSION_TRAFFIC_ROWS
        .filter((row) => row.singleSettingEnabled)
        .map((row) => [row.source, values.singleSettings[row.source] === true]),
    ),
  };
}

export function applyDefaultCommissionRate(values: CommissionRateValues, rawValue: string): CommissionRateValues {
  const parsed = Number(rawValue);
  if (!rawValue.trim() || !Number.isFinite(parsed)) return values;
  const nextValues = { ...values.values };
  for (const row of COMMISSION_TRAFFIC_ROWS) {
    const singleEnabled = row.singleSettingEnabled && values.singleSettings[row.source] === true;
    if (!singleEnabled) {
      nextValues[row.source] = rawValue;
    }
  }
  return { ...values, values: nextValues };
}

export function allCommissionTrafficSources(): Array<{ source: string; label: string; max: number }> {
  return COMMISSION_TRAFFIC_ROWS.flatMap((row) => [
    { source: row.source, label: row.label, max: row.closedMax },
    ...row.children.map((child) => ({ source: child.source, label: child.label, max: getCommissionChildMax(child) })),
  ]);
}

export function activeCommissionTrafficFields(values: CommissionRateValues): Array<{ source: string; label: string; max: number }> {
  return COMMISSION_TRAFFIC_ROWS.flatMap((row) => {
    if (row.singleSettingEnabled && values.singleSettings[row.source] === true) {
      return row.children.map((child) => ({
        source: child.source,
        label: child.label,
        max: getCommissionChildMax(child),
      }));
    }
    return [{ source: row.source, label: row.label, max: row.closedMax }];
  });
}

export function getCommissionInputError(value: string, max: number): string {
  if (!value.trim()) return "";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "请输入数字";
  if (numberValue < 0) return "不能小于0.00%";
  if (numberValue > max) return `请输入0.00% ~ ${max.toFixed(2)}%间的数字`;
  return "";
}
