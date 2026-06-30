export interface OpenRebuildApprovalMessage {
  type: "proma:open-rebuild-approval";
  supplyGoodsId: string;
  productName?: string;
}

export interface ReloadWorkOrdersMessage {
  type: "proma:reload-work-orders";
}

export interface RefreshTicketMessage {
  type: "proma:refresh-ticket";
  supplyGoodsIds: string[];
}

export interface OpenBrowserTabMessage {
  type: "proma:open-browser-tab";
  url: string;
}

interface PromaElectronWebviewBridge {
  startSsoLogin?: () => void;
  openRebuildApproval?: (supplyGoodsId: string, productName?: string) => void;
  reloadWorkOrders?: () => void;
  openBrowserTab?: (url: string) => void;
}

interface ElectronBridgeWindow extends Window {
  promaElectronWebview?: PromaElectronWebviewBridge;
}

export function buildOpenRebuildApprovalMessage(supplyGoodsId: string, productName?: string): OpenRebuildApprovalMessage {
  const message: OpenRebuildApprovalMessage = {
    type: "proma:open-rebuild-approval",
    supplyGoodsId,
  };
  const normalizedProductName = productName?.trim();
  if (normalizedProductName) {
    message.productName = normalizedProductName;
  }
  return message;
}

export function buildReloadWorkOrdersMessage(): ReloadWorkOrdersMessage {
  return {
    type: "proma:reload-work-orders",
  };
}

export function buildRefreshTicketMessage(supplyGoodsIds: Iterable<string>): RefreshTicketMessage | null {
  const normalizedIds = [...new Set(
    [...supplyGoodsIds]
      .map((supplyGoodsId) => supplyGoodsId.trim())
      .filter(Boolean),
  )];
  if (normalizedIds.length === 0) return null;
  return {
    type: "proma:refresh-ticket",
    supplyGoodsIds: normalizedIds,
  };
}

export function shouldRefreshTicketFromMessage(message: unknown, supplyGoodsId: string): boolean {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<RefreshTicketMessage>;
  return candidate.type === "proma:refresh-ticket"
    && Array.isArray(candidate.supplyGoodsIds)
    && candidate.supplyGoodsIds.includes(supplyGoodsId);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildOpenBrowserTabMessage(url: string): OpenBrowserTabMessage | null {
  const normalizedUrl = url.trim();
  if (!isHttpUrl(normalizedUrl)) return null;
  return {
    type: "proma:open-browser-tab",
    url: normalizedUrl,
  };
}

interface ElectronEmbeddedCheckInput {
  search?: string;
  currentWindow?: Window;
  parentWindow?: Window;
}

export function isElectronEmbedded(input: ElectronEmbeddedCheckInput = {}): boolean {
  const currentWindow = input.currentWindow ?? window;
  const parentWindow = input.parentWindow ?? currentWindow.parent;
  const search = input.search ?? currentWindow.location.search;
  return parentWindow !== currentWindow || new URLSearchParams(search).get("embedded") === "electron";
}

export function openRebuildApprovalInElectron(
  supplyGoodsId: string,
  productNameOrInput: string | ElectronEmbeddedCheckInput = {},
  input: ElectronEmbeddedCheckInput = {},
): boolean {
  const productName = typeof productNameOrInput === "string" ? productNameOrInput : undefined;
  const options = typeof productNameOrInput === "string" ? input : productNameOrInput;
  const currentWindow = (options.currentWindow ?? window) as ElectronBridgeWindow;
  const webviewBridge = currentWindow.promaElectronWebview;
  if (webviewBridge?.openRebuildApproval) {
    webviewBridge.openRebuildApproval(supplyGoodsId, productName);
    return true;
  }

  const parentWindow = options.parentWindow ?? currentWindow.parent;
  if (parentWindow && parentWindow !== currentWindow) {
    parentWindow.postMessage(buildOpenRebuildApprovalMessage(supplyGoodsId, productName), "*");
    return true;
  }

  return false;
}

export function reloadWorkOrdersInElectron(input: ElectronEmbeddedCheckInput = {}): boolean {
  const currentWindow = (input.currentWindow ?? window) as ElectronBridgeWindow;
  const webviewBridge = currentWindow.promaElectronWebview;
  if (webviewBridge?.reloadWorkOrders) {
    webviewBridge.reloadWorkOrders();
    return true;
  }

  const parentWindow = input.parentWindow ?? currentWindow.parent;
  if (parentWindow && parentWindow !== currentWindow) {
    parentWindow.postMessage(buildReloadWorkOrdersMessage(), "*");
    return true;
  }

  return false;
}

export function openBrowserTabInElectron(url: string, input: ElectronEmbeddedCheckInput = {}): boolean {
  const message = buildOpenBrowserTabMessage(url);
  if (!message) return false;

  const currentWindow = (input.currentWindow ?? window) as ElectronBridgeWindow;
  const webviewBridge = currentWindow.promaElectronWebview;
  if (webviewBridge?.openBrowserTab) {
    webviewBridge.openBrowserTab(message.url);
    return true;
  }

  const parentWindow = input.parentWindow ?? currentWindow.parent;
  if (parentWindow && parentWindow !== currentWindow) {
    parentWindow.postMessage(message, "*");
    return true;
  }

  return false;
}
