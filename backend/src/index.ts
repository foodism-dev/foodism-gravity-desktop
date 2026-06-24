import { createServerApp } from "./app.ts";

const DEFAULT_PORT = 8787;

function getPort() {
  const portValue = Bun.env.PORT;
  if (!portValue) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(portValue, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.warn(`PORT 配置无效，使用默认端口 ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }

  return port;
}

const port = getPort();
const app = createServerApp();

Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: app.fetch,
});

console.log(`Proma Server 已启动：http://localhost:${port}`);
