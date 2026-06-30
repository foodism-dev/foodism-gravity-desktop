export const PRODUCT_OPERATION_RATING_ACTION = "product_operation_rating_saved";

export const PRODUCT_OPERATION_RATING_PAYLOAD_KEY = "productOperationRating";

export const PRODUCT_OPERATION_RATING_FIELDS = {
  merchant: [
    {
      key: "monthlyRevenue",
      label: "近期月度流水",
      maxScore: 0.5,
      hint: "≥2万 0.3，≥5万 0.5",
      details: [
        "≥2万：0.3分",
        "≥5万：0.5分",
        "低于2万：0分",
      ],
    },
    {
      key: "platformRating",
      label: "平台评分/新店标签",
      maxScore: 0.5,
      hint: "4分以上或各平台新店标签",
      details: [
        "评分4分以上：0.5分",
        "各平台新店标签：0.5分",
        "两项满足其一即可得分，不重复加分",
      ],
    },
    {
      key: "chainOrRanking",
      label: "抖音连锁/榜单",
      maxScore: 1,
      hint: "榜单/心选/金银牌与连锁门店综合",
      details: [
        "榜单或心选前10、金银牌级：0.5分",
        "同城3家或跨城5家以上连锁，且任一平台有商品在线：0.5分",
      ],
    },
    {
      key: "location",
      label: "商圈位置",
      maxScore: 1,
      hint: "热门商圈、大商场、街区、社区位置",
      details: [
        "热门商圈大商场：1分",
        "商场内：0.5分",
        "热门街区（商场外）：0.3分",
        "社区、街道、住宅：0.2分",
      ],
    },
    {
      key: "storeQuality",
      label: "优质门店",
      maxScore: 1.5,
      hint: "规模、当地推荐、装修环境、品牌知名度",
      details: [
        "规模15桌以下：0.5分",
        "规模15桌以上：1分，额外加桌不计入",
        "当地人推荐、特色装修环境、品牌知名度等加分项：0.5分",
      ],
    },
  ],
  product: [
    {
      key: "price",
      label: "售价",
      maxScore: 1,
      hint: "客单 59.9-299 或按品类匹配度",
      details: [
        "客单价59.9-299：1分",
        "低客单或质价比套餐，按客单匹配度酌情打分",
      ],
    },
    {
      key: "discount",
      label: "折扣力度",
      maxScore: 0.5,
      hint: "套餐≤4折，代金券≤7折",
      details: [
        "套餐≤4折：0.5分，>4折：0分",
        "代金券≤7折：0.5分，>7折：0分",
        "自助、非餐品类按实际内容酌情打分",
      ],
    },
    {
      key: "packageMatch",
      label: "套餐搭配",
      maxScore: 3,
      hint: "荤素比例、菜品质量、招牌菜、类别丰富度",
      details: [
        "套餐性价比，补充细节（荤素比例、风格一致）：0.5分",
        "内容细则（菜品质量高、菜品丰富、含招牌菜）：2分",
        "组品细则类别丰富度：0.5分",
        "套餐内容质量拉满时，可不参考搭配及组别丰富度",
      ],
    },
    {
      key: "settlement",
      label: "是否收费",
      maxScore: 0.5,
      hint: "免结算/TP 金额≥3000",
      details: [
        "免结算或TP金额≥3000：0.5分",
        "不满足金额或收费条件：0分",
      ],
    },
    {
      key: "valueForMoney",
      label: "性价比",
      maxScore: 1,
      hint: "售价、套餐内容、商户环境、地理位置综合",
      details: [
        "售价与套餐内容：0.5分",
        "商户环境：0.2分",
        "地理位置：0.3分",
        "根据以上维度综合评估性价比",
      ],
    },
    {
      key: "seasonalFeature",
      label: "应季/特色",
      maxScore: 0.5,
      hint: "潮品、应季或特色品类",
      details: [
        "潮品、应季或特色团购品类：0.5分",
        "无明显应季或特色：0分",
      ],
    },
  ],
} as const;

export const PRODUCT_OPERATION_RATING_GRADE_RULES = [
  { label: "C-", description: "总分 < 6" },
  { label: "C", description: "6 ≤ 总分 < 7" },
  { label: "B", description: "7 ≤ 总分 < 8" },
  { label: "A", description: "8 ≤ 总分 < 8.6" },
  { label: "S", description: "总分 ≥ 8.6" },
] as const;

export type ProductOperationMerchantScoreKey = typeof PRODUCT_OPERATION_RATING_FIELDS.merchant[number]["key"];
export type ProductOperationProductScoreKey = typeof PRODUCT_OPERATION_RATING_FIELDS.product[number]["key"];
export type ProductOperationRatingGrade = "C-" | "C" | "B" | "A" | "S";

export interface ProductOperationMerchantScores extends Record<ProductOperationMerchantScoreKey, number> {}

export interface ProductOperationProductScores extends Record<ProductOperationProductScoreKey, number> {}

export interface ProductOperationRatingScores {
  merchantScores: ProductOperationMerchantScores;
  productScores: ProductOperationProductScores;
}

export interface ProductOperationRatingResult extends ProductOperationRatingScores {
  totalScore: number;
  rating: ProductOperationRatingGrade;
  savedAt: string;
}

export function buildEmptyProductOperationRatingScores(): ProductOperationRatingScores {
  return {
    merchantScores: {
      monthlyRevenue: 0,
      platformRating: 0,
      chainOrRanking: 0,
      location: 0,
      storeQuality: 0,
    },
    productScores: {
      price: 0,
      discount: 0,
      packageMatch: 0,
      settlement: 0,
      valueForMoney: 0,
      seasonalFeature: 0,
    },
  };
}

export function buildProductOperationRating(
  scores: ProductOperationRatingScores,
  savedAt = new Date().toISOString(),
): ProductOperationRatingResult {
  const merchantScores = normalizeMerchantScores(scores.merchantScores);
  const productScores = normalizeProductScores(scores.productScores);
  const totalScore = roundScore(
    merchantScores.monthlyRevenue +
    merchantScores.platformRating +
    merchantScores.chainOrRanking +
    merchantScores.location +
    merchantScores.storeQuality +
    productScores.price +
    productScores.discount +
    productScores.packageMatch +
    productScores.settlement +
    productScores.valueForMoney +
    productScores.seasonalFeature,
  );

  return {
    merchantScores,
    productScores,
    totalScore,
    rating: getProductOperationRating(totalScore),
    savedAt,
  };
}

export function getProductOperationRating(totalScore: number): ProductOperationRatingGrade {
  if (totalScore < 6) return "C-";
  if (totalScore < 7) return "C";
  if (totalScore < 8) return "B";
  if (totalScore < 8.6) return "A";
  return "S";
}

export function readProductOperationRating(value: unknown): ProductOperationRatingResult | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.merchantScores) || !isRecord(value.productScores)) return null;
  const savedAt = typeof value.savedAt === "string" && value.savedAt.trim()
    ? value.savedAt
    : new Date().toISOString();
  return buildProductOperationRating({
    merchantScores: {
      monthlyRevenue: readNumber(value.merchantScores.monthlyRevenue),
      platformRating: readNumber(value.merchantScores.platformRating),
      chainOrRanking: readNumber(value.merchantScores.chainOrRanking),
      location: readNumber(value.merchantScores.location),
      storeQuality: readNumber(value.merchantScores.storeQuality),
    },
    productScores: {
      price: readNumber(value.productScores.price),
      discount: readNumber(value.productScores.discount),
      packageMatch: readNumber(value.productScores.packageMatch),
      settlement: readNumber(value.productScores.settlement),
      valueForMoney: readNumber(value.productScores.valueForMoney),
      seasonalFeature: readNumber(value.productScores.seasonalFeature),
    },
  }, savedAt);
}

function normalizeMerchantScores(scores: ProductOperationMerchantScores): ProductOperationMerchantScores {
  return {
    monthlyRevenue: clampScore(scores.monthlyRevenue, 0.5),
    platformRating: clampScore(scores.platformRating, 0.5),
    chainOrRanking: clampScore(scores.chainOrRanking, 1),
    location: clampScore(scores.location, 1),
    storeQuality: clampScore(scores.storeQuality, 1.5),
  };
}

function normalizeProductScores(scores: ProductOperationProductScores): ProductOperationProductScores {
  return {
    price: clampScore(scores.price, 1),
    discount: clampScore(scores.discount, 0.5),
    packageMatch: clampScore(scores.packageMatch, 3),
    settlement: clampScore(scores.settlement, 0.5),
    valueForMoney: clampScore(scores.valueForMoney, 1),
    seasonalFeature: clampScore(scores.seasonalFeature, 0.5),
  };
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  return 0;
}

function clampScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundScore(Math.min(Math.max(value, 0), maxScore));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
