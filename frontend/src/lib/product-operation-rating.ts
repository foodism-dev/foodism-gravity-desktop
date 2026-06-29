export const PRODUCT_OPERATION_RATING_ACTION = "product_operation_rating_saved";

export const PRODUCT_OPERATION_RATING_PAYLOAD_KEY = "productOperationRating";

export const PRODUCT_OPERATION_RATING_FIELDS = {
  merchant: [
    {
      key: "monthlyRevenue",
      label: "近期月度流水",
      maxScore: 0.5,
      hint: "≥2万 0.3，≥5万 0.5",
    },
    {
      key: "platformRating",
      label: "平台评分/新店标签",
      maxScore: 0.5,
      hint: "4分以上或各平台新店标签",
    },
    {
      key: "chainOrRanking",
      label: "抖音连锁/榜单",
      maxScore: 1,
      hint: "榜单/心选/金银牌与连锁门店综合",
    },
    {
      key: "location",
      label: "商圈位置",
      maxScore: 1,
      hint: "热门商圈、大商场、街区、社区位置",
    },
    {
      key: "storeQuality",
      label: "优质门店",
      maxScore: 1.5,
      hint: "规模、当地推荐、装修环境、品牌知名度",
    },
  ],
  product: [
    {
      key: "price",
      label: "售价",
      maxScore: 1,
      hint: "客单 59.9-299 或按品类匹配度",
    },
    {
      key: "discount",
      label: "折扣力度",
      maxScore: 0.5,
      hint: "套餐≤4折，代金券≤7折",
    },
    {
      key: "packageMatch",
      label: "套餐搭配",
      maxScore: 3,
      hint: "荤素比例、菜品质量、招牌菜、类别丰富度",
    },
    {
      key: "settlement",
      label: "是否收费",
      maxScore: 0.5,
      hint: "免结算/TP 金额≥3000",
    },
    {
      key: "valueForMoney",
      label: "性价比",
      maxScore: 1,
      hint: "售价、套餐内容、商户环境、地理位置综合",
    },
    {
      key: "seasonalFeature",
      label: "应季/特色",
      maxScore: 0.5,
      hint: "潮品、应季或特色品类",
    },
  ],
} as const;

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
