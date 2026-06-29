import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  buildEmptyProductOperationRatingScores,
  buildProductOperationRating,
  PRODUCT_OPERATION_RATING_FIELDS,
  type ProductOperationMerchantScoreKey,
  type ProductOperationProductScoreKey,
  type ProductOperationRatingResult,
  type ProductOperationRatingScores,
} from "@/lib/product-operation-rating.ts";
import { cn } from "@/lib/utils.ts";

interface ProductOperationRatingPanelProps {
  value: ProductOperationRatingResult | null;
  isSubmitting: boolean;
  isEditable: boolean;
  onSave: (rating: ProductOperationRatingResult) => void;
}

interface RatingScoreFieldProps {
  field: {
    key: ProductOperationMerchantScoreKey | ProductOperationProductScoreKey;
    label: string;
    maxScore: number;
    hint: string;
  };
  value: number;
  isEditable: boolean;
  onChange: (value: number) => void;
}

export function ProductOperationRatingPanel({ value, isSubmitting, isEditable, onSave }: ProductOperationRatingPanelProps) {
  const [scores, setScores] = useState<ProductOperationRatingScores>(() => buildInitialScores(value));
  const preview = useMemo(() => buildProductOperationRating(scores, value?.savedAt), [scores, value?.savedAt]);

  useEffect(() => {
    setScores(buildInitialScores(value));
  }, [value]);

  function updateMerchantScore(key: ProductOperationMerchantScoreKey, score: number) {
    setScores((current) => ({
      ...current,
      merchantScores: {
        ...current.merchantScores,
        [key]: score,
      },
    }));
  }

  function updateProductScore(key: ProductOperationProductScoreKey, score: number) {
    setScores((current) => ({
      ...current,
      productScores: {
        ...current.productScores,
        [key]: score,
      },
    }));
  }

  return (
    <Card className="border-0 bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="text-base">商品运营评级</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              {isEditable ? "填写商户评分与商品评分后，系统自动汇总总分和评级。" : "当前节点仅查看商品运营评级。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RatingSummary label="总分" value={`${preview.totalScore.toFixed(1)} / 11`} />
            <Badge variant="success" className={cn("rounded-full px-3 py-1 text-sm", preview.rating === "S" && "bg-amber-100 text-amber-800")}>
              {preview.rating}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <RatingGroup title="商户评分" maxScore="4.5">
            {PRODUCT_OPERATION_RATING_FIELDS.merchant.map((field) => (
              <RatingScoreField
                key={field.key}
                field={field}
                value={scores.merchantScores[field.key]}
                isEditable={isEditable}
                onChange={(score) => updateMerchantScore(field.key, score)}
              />
            ))}
          </RatingGroup>
          <RatingGroup title="商品评分" maxScore="6.5">
            {PRODUCT_OPERATION_RATING_FIELDS.product.map((field) => (
              <RatingScoreField
                key={field.key}
                field={field}
                value={scores.productScores[field.key]}
                isEditable={isEditable}
                onChange={(score) => updateProductScore(field.key, score)}
              />
            ))}
          </RatingGroup>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
          <div className="text-xs leading-5 text-slate-500">
            {value?.savedAt ? `上次保存：${formatSavedTime(value.savedAt)}` : "尚未保存评级结果"}
          </div>
          {isEditable ? (
            <Button
              type="button"
              onClick={() => onSave(buildProductOperationRating(scores))}
              disabled={!isEditable || isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? "保存中" : "保存评级结果"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function buildInitialScores(value: ProductOperationRatingResult | null): ProductOperationRatingScores {
  if (!value) return buildEmptyProductOperationRatingScores();
  return {
    merchantScores: { ...value.merchantScores },
    productScores: { ...value.productScores },
  };
}

function RatingSummary({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-semibold text-slate-950">{value}</span>
    </span>
  );
}

function RatingGroup({ title, maxScore, children }: { title: string; maxScore: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <span className="text-xs font-medium text-slate-500">满分 {maxScore}</span>
      </div>
      <div className="space-y-2.5">
        {children}
      </div>
    </section>
  );
}

function RatingScoreField({ field, value, isEditable, onChange }: RatingScoreFieldProps) {
  return (
    <label className="grid gap-2 rounded-md bg-white p-2.5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-slate-900">{field.label}</span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {field.maxScore}分
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_96px] sm:items-center">
        <span className="text-xs leading-5 text-slate-500">{field.hint}</span>
        <Input
          type="number"
          min={0}
          max={field.maxScore}
          step={0.1}
          value={value}
          disabled={!isEditable}
          onChange={(event) => onChange(readScoreInput(event.target.value, field.maxScore))}
          className="h-8 bg-slate-50 text-right font-semibold"
        />
      </div>
    </label>
  );
}

function readScoreInput(value: string, maxScore: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(Math.max(numberValue, 0), maxScore);
}

function formatSavedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
