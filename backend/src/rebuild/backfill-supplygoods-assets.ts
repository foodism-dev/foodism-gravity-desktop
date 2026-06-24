import { runDefaultSupplyGoodsAssetsBackfill } from "./assets-backfill.ts";

const DEFAULT_LIMIT = 50;

function readLimit(argv: string[]): number {
  const index = argv.findIndex((arg) => arg === "--limit");
  const rawValue = index >= 0 ? argv[index + 1] : undefined;
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

function readForce(argv: string[]): boolean {
  return argv.includes("--force");
}

function readSupplyGoodsIds(argv: string[]): string[] {
  const ids: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--supply-goods-id") {
      continue;
    }
    const rawValue = argv[index + 1];
    if (!rawValue) {
      continue;
    }
    for (const id of rawValue.split(",")) {
      const trimmed = id.trim();
      if (trimmed) {
        ids.push(trimmed);
      }
    }
  }
  return [...new Set(ids)];
}

try {
  const argv = Bun.argv.slice(2);
  const limit = readLimit(argv);
  const force = readForce(argv);
  const supplyGoodsIds = readSupplyGoodsIds(argv);
  console.log(
    `[REBUILD] 开始补偿 SupplyGoods 资产: limit=${limit}, force=${force ? "是" : "否"}, supplyGoodsIds=${supplyGoodsIds.length}`,
  );
  const result = await runDefaultSupplyGoodsAssetsBackfill({ limit, force, supplyGoodsIds });
  console.log(`[REBUILD] SupplyGoods 资产补偿完成: ${JSON.stringify(result)}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[REBUILD] SupplyGoods 资产补偿失败: ${message}`);
  process.exit(1);
}
