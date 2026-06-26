import { generateTicketInfoOptimization, type TicketRecord } from "./api.ts";

export interface TicketInfoOptimizationResult {
  generation: number;
  originPackages: Record<string, unknown>;
  optimizedPackages: Record<string, unknown>;
}

export async function requestTicketInfoOptimization(
  ticket: TicketRecord,
  generation: number,
): Promise<TicketInfoOptimizationResult> {
  const response = await generateTicketInfoOptimization(ticket.supplyGoodsId);
  return {
    generation,
    originPackages: response.originPackages,
    optimizedPackages: response.optimizedPackages,
  };
}

export function haveSameVisiblePackageNames(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftGroups = readPackageGroups(left);
  const rightGroups = readPackageGroups(right);
  if (leftGroups.length !== rightGroups.length) return false;

  return leftGroups.every((leftGroup, groupIndex) => {
    const rightGroup = rightGroups[groupIndex];
    if (!rightGroup || readText(leftGroup.groupName) !== readText(rightGroup.groupName)) return false;

    const leftItems = readPackageItems(leftGroup);
    const rightItems = readPackageItems(rightGroup);
    if (leftItems.length !== rightItems.length) return false;

    return leftItems.every((leftItem, itemIndex) => readText(leftItem.title) === readText(rightItems[itemIndex]?.title));
  });
}

function readPackageGroups(packages: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(packages.viewList)
    ? packages.viewList.filter(isRecord)
    : [];
}

function readPackageItems(group: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(group.list)
    ? group.list.filter(isRecord)
    : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
