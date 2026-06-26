import { createLinKeDraftWorker } from "./draft-worker.ts";
import { conciseError } from "./utils.ts";

const worker = createLinKeDraftWorker();

worker.on("completed", (job) => {
  console.log(`[Lin-Ke] 草稿任务完成: job=${job.id}`);
});

worker.on("failed", (job, error) => {
  console.warn(`[Lin-Ke] 草稿任务失败: job=${job?.id ?? "<unknown>"} error=${conciseError(error)}`);
});

console.log("[Lin-Ke] 草稿任务 worker 已启动");

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
