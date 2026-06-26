export interface OpenRebuildApprovalMessage {
  type: "proma:open-rebuild-approval";
  supplyGoodsId: string;
}

interface PromaElectronWebviewBridge {
  startSsoLogin?: () => void;
  openRebuildApproval?: (supplyGoodsId: string) => void;
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
