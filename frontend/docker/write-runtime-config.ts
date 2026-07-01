interface RuntimeConfig {
  VITE_API_BASE_URL: string;
  VITE_SSO_LOGIN_URL?: string;
  VITE_LIN_KE_TEST_SKIP_ENABLED: string;
}

function readEnv(name: string): string {
  return Bun.env[name]?.trim() ?? "";
}

const config: RuntimeConfig = {
  VITE_API_BASE_URL: readEnv("VITE_API_BASE_URL"),
  VITE_LIN_KE_TEST_SKIP_ENABLED: readEnv("VITE_LIN_KE_TEST_SKIP_ENABLED") || "false",
};

const ssoLoginUrl = readEnv("VITE_SSO_LOGIN_URL");
if (ssoLoginUrl) {
  config.VITE_SSO_LOGIN_URL = ssoLoginUrl;
}

if (!config.VITE_API_BASE_URL) {
  throw new Error("VITE_API_BASE_URL 未配置，前端容器无法启动");
}

await Bun.write(
  "/app/dist/config.js",
  `window.__PROMA_CONFIG__ = ${JSON.stringify(config)};\n`,
);

console.log("[前端] 运行时配置已写入");
