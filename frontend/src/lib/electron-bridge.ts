export interface OpenRebuildApprovalMessage {
  type: "proma:open-rebuild-approval";
  supplyGoodsId: string;
}

export interface ReloadWorkOrdersMessage {
  type: "proma:reload-work-orders";
}

export interface OpenBrowserTabMessage {
  type: "proma:open-browser-tab";
  url: string;
}

interface PromaElectronWebviewBridge {
  startSsoLogin?: () => void;
  openRebuildApproval?: (supplyGoodsId: string) => void;
  reloadWorkOrders?: () => void;
  openBrowserTab?: (url: string) => void;
}

interface ElectronBridgeWindow extends Window {
  promaElectronWebview?: PromaElectronWebviewBridge;
}

export function buildOpenRebuildApprovalMessage(supplyGoodsId: string): OpenRebuildApprovalMessage {
  return {
    type: "proma:open-rebuild-approval",
    supplyGoodsId,
  };
}

export function buildReloadWorkOrdersMessage(): ReloadWorkOrdersMessage {
  return {
    type: "proma:reload-work-orders",
  };
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
  input: ElectronEmbeddedCheckInput = {},
): boolean {
  const currentWindow = (input.currentWindow ?? window) as ElectronBridgeWindow;
  const webviewBridge = currentWindow.promaElectronWebview;
  if (webviewBridge?.openRebuildApproval) {
    webviewBridge.openRebuildApproval(supplyGoodsId);
    return true;
  }

  const parentWindow = input.parentWindow ?? currentWindow.parent;
  if (parentWindow && parentWindow !== currentWindow) {
    parentWindow.postMessage(buildOpenRebuildApprovalMessage(supplyGoodsId), "*");
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
