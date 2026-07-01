function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

interface PromaRuntimeConfig {
  VITE_API_BASE_URL?: string;
  VITE_SSO_LOGIN_URL?: string;
  VITE_LIN_KE_TEST_SKIP_ENABLED?: string;
}

declare global {
  interface Window {
    __PROMA_CONFIG__?: PromaRuntimeConfig;
  }
}

function readRuntimeConfig(name: keyof PromaRuntimeConfig): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = window.__PROMA_CONFIG__?.[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function getApiBaseUrl() {
  const configuredUrl = readRuntimeConfig("VITE_API_BASE_URL") ?? import.meta.env.VITE_API_BASE_URL;
  if (!configuredUrl?.trim()) {
    throw new Error("缺少 VITE_API_BASE_URL 配置，无法请求 Gravity API");
  }
  return normalizeBaseUrl(configuredUrl);
}

export function getSsoLoginUrl() {
  const configuredUrl = readRuntimeConfig("VITE_SSO_LOGIN_URL") ?? import.meta.env.VITE_SSO_LOGIN_URL;
  if (configuredUrl?.trim()) {
    return configuredUrl.trim();
  }
  return `${getApiBaseUrl()}/sso_login`;
}

export function isLinKeTestSkipEnabled() {
  const configuredValue = readRuntimeConfig("VITE_LIN_KE_TEST_SKIP_ENABLED")
    ?? import.meta.env.VITE_LIN_KE_TEST_SKIP_ENABLED;
  return configuredValue === "true";
}
