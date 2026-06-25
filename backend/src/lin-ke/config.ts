import { fileURLToPath } from "node:url";

export const BACKEND_DIR = fileURLToPath(new URL("../../", import.meta.url));

export interface LinKeSettings {
  databaseUrl: string | null;
  openaiApiKey: string;
  openaiBaseUrl: string;
  optimizeModel: string;
  optimizeConcurrency: number;
  optimizeMaxBatchSize: number;
  optimizeRetries: number;
  lifePartnerBaseUrl: string;
  lifePartnerTimeout: number;
  rbImageBaseUrl: string;
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(Bun.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const parsed = Number.parseFloat(Bun.env[name]?.trim() ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getLinKeSettings(): LinKeSettings {
  return {
    databaseUrl: Bun.env.DATABASE_URL?.trim() || null,
    openaiApiKey: Bun.env.OPENAI_API_KEY?.trim() || "",
    openaiBaseUrl: Bun.env.OPENAI_BASE_URL?.trim() || "",
    optimizeModel: Bun.env.OPTIMIZE_MODEL?.trim() || "gpt-4o-mini",
    optimizeConcurrency: intEnv("OPTIMIZE_CONCURRENCY", 5),
    optimizeMaxBatchSize: intEnv("OPTIMIZE_MAX_BATCH_SIZE", 20),
    optimizeRetries: intEnv("OPTIMIZE_RETRIES", 3),
    lifePartnerBaseUrl: Bun.env.LIN_KE_BASE_URL?.trim() || "https://www.life-partner.cn",
    lifePartnerTimeout: floatEnv("LIN_KE_TIMEOUT", 60),
    rbImageBaseUrl: Bun.env.RB_IMAGE_BASE_URL?.trim() || "",
  };
}
