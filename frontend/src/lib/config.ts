function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL;
  if (!configuredUrl?.trim()) {
    throw new Error("缺少 VITE_API_BASE_URL 配置，无法请求 Gravity API");
  }
  return normalizeBaseUrl(configuredUrl);
}
