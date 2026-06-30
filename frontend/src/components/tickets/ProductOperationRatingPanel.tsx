import { CircleHelp, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  buildEmptyProductOperationRatingScores,
  buildProductOperationRating,
  PRODUCT_OPERATION_RATING_FIELDS,
  PRODUCT_OPERATION_RATING_GRADE_RULES,
  type ProductOperationMerchantScoreKey,
  type ProductOperationProductScoreKey,
  type ProductOperationRatingResult,
  type ProductOperationRatingScores,
} from "@/lib/product-operation-rating.ts";

interface ProductOperationRatingPanelProps {
  value: ProductOperationRatingResult | null;
  salesSelfRating: string;
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
    details: readonly string[];
  };
  value: number;
  isEditable: boolean;
  onChange: (value: number) => void;
}

export function ProductOperationRatingPanel({ value, salesSelfRating, isSubmitting, isEditable, onSave }: ProductOperationRatingPanelProps) {
  const [scores, setScores] = useState<ProductOperationRatingScores>(() => buildInitialScores(value));
  const [hasEditedScores, setHasEditedScores] = useState(false);
  const preview = useMemo(() => buildProductOperationRating(scores, value?.savedAt), [scores, value?.savedAt]);
  const displayRating = value || hasEditedScores ? preview.rating : "未评分";
  const displayRatingTone = displayRating === "未评分" ? "violet" : preview.rating === "S" ? "amber" : "emerald";

  useEffect(() => {
    setScores(buildInitialScores(value));
    setHasEditedScores(false);
  }, [value]);

  function updateMerchantScore(key: ProductOperationMerchantScoreKey, score: number) {
    setHasEditedScores(true);
    setScores((current) => ({
      ...current,
      merchantScores: {
        ...current.merchantScores,
        [key]: score,
      },
    }));
  }

  function updateProductScore(key: ProductOperationProductScoreKey, score: number) {
    setHasEditedScores(true);
    setScores((current) => ({
      ...current,
      productScores: {
        ...current.productScores,
        [key]: score,
      },
    }));
  }

  return (
    <Card className="flex h-full max-h-full flex-col border-0 bg-white shadow-sm">
      <CardHeader className="shrink-0 pb-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="text-base">商品运营评级</CardTitle>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              {isEditable ? "填写商户评分与商品评分后，系统自动汇总总分和评级。" : "当前节点仅查看商品运营评级。"}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid shrink-0 gap-2 sm:grid-cols-2">
          <RatingMetricCard label="销售自评" value={salesSelfRating || "未保存"} helper="销售提报时选择" />
          <RatingMetricCard label="建议总分" value="待配置" helper="模型建议暂未接入" />
          <RatingMetricCard label="确认总分" value={preview.totalScore.toFixed(1)} helper="当前表单汇总" emphasis />
          <RatingMetricCard
            label="最终评级"
            value={displayRating}
            helper="按总分自动计算"
            tone={displayRatingTone}
            showGradeRules
          />
        </div>

        <div className="ticket-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="grid gap-3">
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

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 md:flex-row md:items-center md:justify-between">
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

function RatingMetricCard({
  label,
  value,
  helper,
  emphasis = false,
  tone = "violet",
  showGradeRules = false,
}: {
  label: string;
  value: string;
  helper: string;
  emphasis?: boolean;
  tone?: "amber" | "emerald" | "violet";
  showGradeRules?: boolean;
}) {
  const valueColor = tone === "amber" ? "text-amber-500" : tone === "emerald" ? "text-emerald-600" : "text-violet-600";
  return (
    <div className="rounded-md bg-white px-2.5 py-2 text-center shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-500">
        <span>{label}</span>
        {showGradeRules ? <RuleHelpButton ariaLabel="查看评级规则"><RatingGradeRules /></RuleHelpButton> : null}
      </div>
      <div className={`mt-1 text-xl font-semibold tracking-normal ${emphasis ? "text-emerald-600" : valueColor}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] leading-4 text-slate-400">{helper}</div>
    </div>
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
    <div className="grid gap-2 rounded-md bg-white p-2.5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-slate-900">{field.label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {field.maxScore}分
          </span>
          <RuleHelpButton ariaLabel={`查看评分规则：${field.label}`}>
            <RatingRuleTooltip details={field.details} />
          </RuleHelpButton>
        </div>
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
    </div>
  );
}

function RuleHelpButton({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) {
  return (
    <span className="group/rating-rule relative inline-flex">
      <span
        tabIndex={0}
        role="button"
        aria-label={ariaLabel}
        className="rounded-full p-1 text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus:bg-slate-100 focus:text-slate-700"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </span>
      {children}
    </span>
  );
}

function RatingRuleTooltip({ details }: { details: readonly string[] }) {
  return (
    <div className="absolute right-0 top-7 z-30 hidden w-72 rounded-md bg-white px-3 py-2.5 text-left shadow-lg ring-1 ring-slate-200 group-hover/rating-rule:block group-focus-within/rating-rule:block">
      <div className="mb-1.5 text-xs font-semibold text-slate-900">评分规则</div>
      <ul className="space-y-1 text-xs leading-5 text-slate-600">
        {details.map((detail) => (
          <li key={detail} className="flex gap-1.5">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
            <span>{detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RatingGradeRules() {
  return (
    <div className="absolute right-0 top-7 z-30 hidden w-72 rounded-md bg-white px-3 py-2.5 text-left shadow-lg ring-1 ring-slate-200 group-hover/rating-rule:block group-focus-within/rating-rule:block">
      <div className="mb-1 text-[10px] font-semibold text-slate-500">评级规则</div>
      <div className="grid grid-cols-5 gap-1">
        {PRODUCT_OPERATION_RATING_GRADE_RULES.map((rule) => (
          <div key={rule.label} className="rounded bg-white px-1 py-1 text-center ring-1 ring-slate-100">
            <div className="text-[11px] font-semibold text-slate-900">{rule.label}</div>
            <div className="mt-0.5 text-[9px] leading-3 text-slate-500">{rule.description}</div>
          </div>
        ))}
      </div>
    </div>
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
