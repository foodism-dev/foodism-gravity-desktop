import { createServerApp, DEFAULT_WEB_SSO_REDIRECT_URI } from "./app.ts";
import { installConsoleTimestamp } from "./logger.ts";
import { warmRebuildLoginSession } from "./rebuild/login-session.ts";

installConsoleTimestamp();

const DEFAULT_PORT = 8787;

interface ListenConfig {
  hostname: string;
  port: number;
}

function parsePort(portValue: string | undefined, fallback: number): number {
  if (!portValue) {
    return fallback;
  }

  const port = Number.parseInt(portValue, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.warn(`端口配置无效，使用默认端口 ${fallback}`);
    return fallback;
  }

  return port;
}

function getPort() {
  return parsePort(Bun.env.PORT, DEFAULT_PORT);
}

function getCallbackListenConfig(apiPort: number): ListenConfig | null {
  const redirectUri = Bun.env.GRAVITY_WEB_REDIRECT_URI?.trim()
    || Bun.env.GRAVITY_PC_REDIRECT_URI?.trim()
    || DEFAULT_WEB_SSO_REDIRECT_URI;
  const url = new URL(redirectUri);
  if (url.protocol !== "http:") {
    console.warn(`[认证] Web SSO 回调地址不是 http 协议，跳过本机回调监听: ${redirectUri}`);
    return null;
  }

  const port = parsePort(url.port, 80);
  if (port === apiPort) {
    return null;
  }
  return {
    hostname: url.hostname,
    port,
  };
}

const port = getPort();
const app = createServerApp();

Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: app.fetch,
});

console.log(`Proma Server 已启动：http://localhost:${port}`);

const callbackListenConfig = getCallbackListenConfig(port);
if (callbackListenConfig) {
  try {
    Bun.serve({
      hostname: callbackListenConfig.hostname,
      port: callbackListenConfig.port,
      fetch: app.fetch,
    });
    console.log(
      `[认证] Web SSO 回调监听已启动：http://${callbackListenConfig.hostname}:${callbackListenConfig.port}`,
    );
  } catch (error) {
    console.warn(`[认证] Web SSO 回调监听启动失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void warmRebuildLoginSession().then((warmed) => {
  if (warmed) {
    console.log("[REBUILD] 登录 Cookie 已预热");
  }
});
