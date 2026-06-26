import {
  cleanString,
  deepClone,
  entityText,
  isRecord,
  parseIntValue,
  parseNumber,
  type JsonRecord,
} from "./utils.ts";

interface ParsedPackages {
  packages: JsonRecord;
  wasString: boolean;
  malformed: boolean;
}

export function bdCityText(payload: JsonRecord): string {
  return entityText(payload.bdCity);
}

function parsePackages(value: unknown): ParsedPackages {
  if (isRecord(value)) {
    return { packages: deepClone(value), wasString: false, malformed: false };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed)
        ? { packages: parsed, wasString: true, malformed: false }
        : { packages: {}, wasString: true, malformed: true };
    } catch {
      return { packages: {}, wasString: true, malformed: true };
    }
  }
  return { packages: {}, wasString: false, malformed: false };
}

function encodePackages(packages: JsonRecord, wasString: boolean): unknown {
  return wasString ? JSON.stringify(packages) : packages;
}

export function displaySupplyGoodsPackages(value: unknown): JsonRecord {
  return parsePackages(value).packages;
}

export function applyEditablePackages(
  basePackagesValue: unknown,
  editedPackagesValue: unknown,
  outputTemplateValue: unknown = basePackagesValue,
): { packages: unknown; changes: JsonRecord[] } {
  const parsedBase = parsePackages(basePackagesValue);
  const parsedTemplate = parsePackages(outputTemplateValue);
  const editedPackages = isRecord(editedPackagesValue) ? editedPackagesValue : {};
  const nextPackages = deepClone(parsedBase.packages);
  const baseViewList = Array.isArray(parsedBase.packages.viewList) ? parsedBase.packages.viewList : [];
  const nextViewList = Array.isArray(nextPackages.viewList) ? nextPackages.viewList : [];
  const editedViewList = Array.isArray(editedPackages.viewList) ? editedPackages.viewList : [];
  const changes: JsonRecord[] = [];

  for (const [groupIndex, baseGroup] of baseViewList.entries()) {
    const nextGroup = nextViewList[groupIndex];
    const editedGroup = editedViewList[groupIndex];
    if (!isRecord(baseGroup) || !isRecord(nextGroup) || !isRecord(editedGroup)) continue;

    const groupName = cleanString(editedGroup.groupName);
    const oldGroupName = cleanString(baseGroup.groupName);
    if (groupName && groupName !== oldGroupName) {
      nextGroup.groupName = groupName;
      changes.push({
        path: `packages.viewList[${groupIndex}].groupName`,
        before: oldGroupName,
        after: groupName,
      });
    }

    const baseItems = Array.isArray(baseGroup.list) ? baseGroup.list : [];
    const nextItems = Array.isArray(nextGroup.list) ? nextGroup.list : [];
    const editedItems = Array.isArray(editedGroup.list) ? editedGroup.list : [];
    for (const [itemIndex, baseItem] of baseItems.entries()) {
      const nextItem = nextItems[itemIndex];
      const editedItem = editedItems[itemIndex];
      if (!isRecord(baseItem) || !isRecord(nextItem) || !isRecord(editedItem)) continue;
      const title = cleanString(editedItem.title);
      const oldTitle = cleanString(baseItem.title);
      if (title && title !== oldTitle) {
        nextItem.title = title;
        changes.push({
          path: `packages.viewList[${groupIndex}].list[${itemIndex}].title`,
          before: oldTitle,
          after: title,
        });
      }
    }
  }

  return {
    packages: encodePackages(nextPackages, parsedTemplate.wasString),
    changes,
  };
}

export function extractMenuForOptimization(payload: JsonRecord): JsonRecord[] {
  const { packages } = parsePackages(payload.packages);
  const viewList = Array.isArray(packages.viewList) ? packages.viewList : [];
  const groups: JsonRecord[] = [];

  for (const [groupIndex, group] of viewList.entries()) {
    if (!isRecord(group)) continue;
    const rawItems = Array.isArray(group.list) ? group.list : [];
    const items: JsonRecord[] = [];
    for (const [itemIndex, item] of rawItems.entries()) {
      if (!isRecord(item)) continue;
      items.push({
        index: itemIndex,
        title: cleanString(item.title),
        num: cleanString(item.num),
        price: cleanString(item.price),
      });
    }
    groups.push({
      index: groupIndex,
      groupName: cleanString(group.groupName),
      groupSelectNum: cleanString(group.groupSelectNum),
      items,
    });
  }

  return groups;
}

export function applyMenuOptimization(
  payload: JsonRecord,
  optimized: JsonRecord,
): { payload: JsonRecord; changes: JsonRecord[] } {
  const nextPayload = deepClone(payload);
  const parsed = parsePackages(nextPayload.packages);
  if (parsed.malformed) {
    return { payload: nextPayload, changes: [] };
  }

  const viewList = Array.isArray(parsed.packages.viewList) ? parsed.packages.viewList : [];
  const groups = Array.isArray(optimized.groups) ? optimized.groups : [];
  const changes: JsonRecord[] = [];

  for (const groupUpdate of groups) {
    if (!isRecord(groupUpdate)) continue;
    const groupIndex = groupUpdate.index;
    if (typeof groupIndex !== "number" || !Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex >= viewList.length) {
      continue;
    }
    const targetGroup = viewList[groupIndex];
    if (!isRecord(targetGroup)) continue;

    const newGroupName = cleanString(groupUpdate.groupName);
    const oldGroupName = cleanString(targetGroup.groupName);
    if (newGroupName && newGroupName !== oldGroupName) {
      targetGroup.groupName = newGroupName;
      changes.push({
        path: `packages.viewList[${groupIndex}].groupName`,
        before: oldGroupName,
        after: newGroupName,
      });
    }

    const itemUpdates = Array.isArray(groupUpdate.items) ? groupUpdate.items : [];
    const targetItems = Array.isArray(targetGroup.list) ? targetGroup.list : [];
    for (const itemUpdate of itemUpdates) {
      if (!isRecord(itemUpdate)) continue;
      const itemIndex = itemUpdate.index;
      if (typeof itemIndex !== "number" || !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= targetItems.length) {
        continue;
      }
      const targetItem = targetItems[itemIndex];
      if (!isRecord(targetItem)) continue;
      const newTitle = cleanString(itemUpdate.title);
      const oldTitle = cleanString(targetItem.title);
      if (newTitle && newTitle !== oldTitle) {
        targetItem.title = newTitle;
        changes.push({
          path: `packages.viewList[${groupIndex}].list[${itemIndex}].title`,
          before: oldTitle,
          after: newTitle,
        });
      }
    }
  }

  nextPayload.packages = encodePackages(parsed.packages, parsed.wasString);
  return { payload: nextPayload, changes };
}

export function normalizeSupplyGoodsForLinKe(
  payload: JsonRecord,
  linKeMapping: JsonRecord,
  rbImageBaseUrl = "",
): JsonRecord {
  const groups = normalizeItemGroups(payload.packages);
  const merchantName = cleanString(payload.hostName)
    || entityText(payload.rbhost)
    || entityText(payload.company)
    || cleanString(payload.hostNameInput);
  const product: JsonRecord = {
    source: {
      type: "rebuild_supply_goods",
      id: cleanString(payload.SupplyGoodsId) || cleanString(payload.goodsId),
    },
    title: cleanString(payload.goodsName),
    salePrice: parseNumber(payload.price),
    originPrice: parseNumber(payload.originPrice),
    category: {
      id: cleanString(linKeMapping.categoryId),
      name: cleanString(linKeMapping.categoryName),
    },
    productType: parseIntValue(linKeMapping.productType),
    grouponType: cleanString(payload.majorType),
    images: [
      ...normalizeImages(payload.mainPic, rbImageBaseUrl),
      ...normalizeImages(payload.rbimages, rbImageBaseUrl),
    ],
    detailImages: normalizeImages(payload.detailImages, rbImageBaseUrl),
    description: cleanString(payload.details),
    features: cleanString(payload.goodsFeatures),
    stockQty: { totalStock: parseIntValue(payload.signAmount) },
    saleTime: {
      startDate: cleanString(payload.saleBegin),
      endDate: cleanString(payload.saleUntil),
    },
    validityPeriod: { endDate: cleanString(payload.validUntil) },
    itemGroups: groups,
    purchaseNotice: { additionalNotes: cleanString(payload.guideline) },
    merchant: { name: merchantName },
    hosts: merchantName ? [{ name: merchantName }] : [],
    fieldSources: {
      linKeProductType: cleanString(linKeMapping.mealTypeText),
      linKeCategory: cleanString(linKeMapping.classificationKey),
    },
    missingFields: [],
    warnings: [],
  };

  product.images = dedupeImages(product.images);
  product.detailImages = dedupeImages(product.detailImages);
  product.missingFields = collectMissingFields(product);
  return product;
}

export function normalizeItemGroups(packagesValue: unknown): JsonRecord[] {
  const { packages } = parsePackages(packagesValue);
  const viewList = Array.isArray(packages.viewList) ? packages.viewList : [];
  const groups: JsonRecord[] = [];
  for (const [groupIndex, group] of viewList.entries()) {
    if (!isRecord(group)) continue;
    const rawItems = Array.isArray(group.list) ? group.list : [];
    const items: JsonRecord[] = [];
    for (const [itemIndex, item] of rawItems.entries()) {
      if (!isRecord(item)) continue;
      items.push({
        id: cleanString(item.id) || `${groupIndex}-${itemIndex}`,
        name: cleanString(item.title),
        price: parseNumber(item.price),
        quantity: { amount: parseIntValue(item.num) || 1, unit: "FEN" },
      });
    }
    groups.push({
      id: cleanString(group.groupId) || String(groupIndex),
      name: cleanString(group.groupName),
      items,
      selectionRule: {
        totalCount: parseIntValue(group.groupSelectNum) || items.length,
        optionCount: items.length,
      },
      canRepeat: false,
    });
  }
  return groups;
}

export function normalizeImages(value: unknown, rbImageBaseUrl = ""): JsonRecord[] {
  if (value === null || value === undefined) return [];
  const rawItems = Array.isArray(value) ? value : [value];
  const images: JsonRecord[] = [];

  for (const [index, item] of rawItems.entries()) {
    let url = "";
    let uri = "";
    let name = "";
    if (typeof item === "string") {
      const raw = item.trim();
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        url = raw;
      } else if (rbImageBaseUrl) {
        url = new URL(raw.replace(/^\/+/, ""), rbImageBaseUrl.replace(/\/+$/, "") + "/").toString();
      } else {
        uri = raw;
      }
      name = raw ? raw.split("/").pop() ?? "" : "";
    } else if (isRecord(item)) {
      url = cleanString(item.url);
      uri = cleanString(item.uri);
      name = cleanString(item.name);
    }
    if (url || uri) {
      images.push({
        url,
        uri,
        name,
        sortableOnlyId: uri || url || String(index),
      });
    }
  }

  return images;
}

export function dedupeImages(images: unknown): JsonRecord[] {
  if (!Array.isArray(images)) return [];
  const seen = new Set<string>();
  const result: JsonRecord[] = [];
  for (const image of images) {
    if (!isRecord(image)) continue;
    const key = cleanString(image.uri) || cleanString(image.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
  }
  return result;
}

export function collectMissingFields(product: JsonRecord): string[] {
  const missing: string[] = [];
  if (!cleanString(product.title)) missing.push("title");
  if (!product.salePrice) missing.push("salePrice");
  if (!product.originPrice) missing.push("originPrice");
  if (!Array.isArray(product.images) || product.images.length === 0) missing.push("images");
  if (!Array.isArray(product.itemGroups) || product.itemGroups.length === 0) missing.push("itemGroups");
  const merchant = isRecord(product.merchant) ? product.merchant : {};
  const category = isRecord(product.category) ? product.category : {};
  if (!cleanString(merchant.name)) missing.push("merchant.name");
  if (!category.id) missing.push("category.id");
  if (!product.productType) missing.push("productType");
  return missing;
}
