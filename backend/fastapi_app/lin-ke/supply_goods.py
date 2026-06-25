import copy
import json
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin


def clean_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def entity_text(value: Any) -> str:
    if isinstance(value, dict):
        return clean_string(value.get("text"))
    return clean_string(value)


def bd_city_text(payload: Dict[str, Any]) -> str:
    return entity_text(payload.get("bdCity"))


def parse_packages(value: Any) -> Tuple[Dict[str, Any], bool]:
    if isinstance(value, dict):
        return copy.deepcopy(value), False
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}, True
        if isinstance(parsed, dict):
            return parsed, True
        return {}, True
    return {}, False


def encode_packages(packages: Dict[str, Any], was_string: bool) -> Any:
    if was_string:
        return json.dumps(packages, ensure_ascii=False, separators=(",", ":"))
    return packages


def extract_menu_for_optimization(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    packages, _ = parse_packages(payload.get("packages"))
    view_list = packages.get("viewList") if isinstance(packages, dict) else []
    if not isinstance(view_list, list):
        return []
    groups: List[Dict[str, Any]] = []
    for group_index, group in enumerate(view_list):
        if not isinstance(group, dict):
            continue
        raw_items = group.get("list") if isinstance(group.get("list"), list) else []
        items = []
        for item_index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    "index": item_index,
                    "title": clean_string(item.get("title")),
                    "num": clean_string(item.get("num")),
                    "price": clean_string(item.get("price")),
                }
            )
        groups.append(
            {
                "index": group_index,
                "groupName": clean_string(group.get("groupName")),
                "groupSelectNum": clean_string(group.get("groupSelectNum")),
                "items": items,
            }
        )
    return groups


def apply_menu_optimization(
    payload: Dict[str, Any], optimized: Dict[str, Any]
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    next_payload = copy.deepcopy(payload)
    packages, was_string = parse_packages(next_payload.get("packages"))
    view_list = packages.get("viewList") if isinstance(packages, dict) else []
    if not isinstance(view_list, list):
        return next_payload, []

    changes: List[Dict[str, Any]] = []
    groups = optimized.get("groups") if isinstance(optimized, dict) else []
    if not isinstance(groups, list):
        return next_payload, []

    for group_update in groups:
        if not isinstance(group_update, dict):
            continue
        group_index = group_update.get("index")
        if not isinstance(group_index, int) or group_index < 0 or group_index >= len(view_list):
            continue
        target_group = view_list[group_index]
        if not isinstance(target_group, dict):
            continue
        new_group_name = clean_string(group_update.get("groupName"))
        old_group_name = clean_string(target_group.get("groupName"))
        if new_group_name and new_group_name != old_group_name:
            target_group["groupName"] = new_group_name
            changes.append(
                {
                    "path": f"packages.viewList[{group_index}].groupName",
                    "before": old_group_name,
                    "after": new_group_name,
                }
            )

        item_updates = group_update.get("items") if isinstance(group_update.get("items"), list) else []
        target_items = target_group.get("list") if isinstance(target_group.get("list"), list) else []
        for item_update in item_updates:
            if not isinstance(item_update, dict):
                continue
            item_index = item_update.get("index")
            if not isinstance(item_index, int) or item_index < 0 or item_index >= len(target_items):
                continue
            target_item = target_items[item_index]
            if not isinstance(target_item, dict):
                continue
            new_title = clean_string(item_update.get("title"))
            old_title = clean_string(target_item.get("title"))
            if new_title and new_title != old_title:
                target_item["title"] = new_title
                changes.append(
                    {
                        "path": f"packages.viewList[{group_index}].list[{item_index}].title",
                        "before": old_title,
                        "after": new_title,
                    }
                )

    next_payload["packages"] = encode_packages(packages, was_string)
    return next_payload, changes


def normalize_supply_goods_for_lin_ke(
    payload: Dict[str, Any], lin_ke_mapping: Dict[str, Any], rb_image_base_url: str = ""
) -> Dict[str, Any]:
    groups = normalize_item_groups(payload.get("packages"))
    merchant_name = (
        clean_string(payload.get("hostName"))
        or entity_text(payload.get("rbhost"))
        or entity_text(payload.get("company"))
        or clean_string(payload.get("hostNameInput"))
    )
    product = {
        "source": {
            "type": "rebuild_supply_goods",
            "id": clean_string(payload.get("SupplyGoodsId")) or clean_string(payload.get("goodsId")),
        },
        "title": clean_string(payload.get("goodsName")),
        "salePrice": parse_number(payload.get("price")),
        "originPrice": parse_number(payload.get("originPrice")),
        "category": {
            "id": clean_string(lin_ke_mapping.get("categoryId")),
            "name": clean_string(lin_ke_mapping.get("categoryName")),
        },
        "productType": parse_int(lin_ke_mapping.get("productType")),
        "grouponType": clean_string(payload.get("majorType")),
        "images": normalize_images(payload.get("mainPic"), rb_image_base_url)
        + normalize_images(payload.get("rbimages"), rb_image_base_url),
        "detailImages": normalize_images(payload.get("detailImages"), rb_image_base_url),
        "description": clean_string(payload.get("details")),
        "features": clean_string(payload.get("goodsFeatures")),
        "stockQty": {"totalStock": parse_int(payload.get("signAmount"))},
        "saleTime": {
            "startDate": clean_string(payload.get("saleBegin")),
            "endDate": clean_string(payload.get("saleUntil")),
        },
        "validityPeriod": {"endDate": clean_string(payload.get("validUntil"))},
        "itemGroups": groups,
        "purchaseNotice": {"additionalNotes": clean_string(payload.get("guideline"))},
        "merchant": {"name": merchant_name},
        "hosts": [{"name": merchant_name}] if merchant_name else [],
        "fieldSources": {
            "linKeProductType": clean_string(lin_ke_mapping.get("mealTypeText")),
            "linKeCategory": clean_string(lin_ke_mapping.get("classificationKey")),
        },
        "missingFields": [],
        "warnings": [],
    }
    product["images"] = dedupe_images(product["images"])
    product["detailImages"] = dedupe_images(product["detailImages"])
    product["missingFields"] = collect_missing_fields(product)
    return product


def normalize_item_groups(packages_value: Any) -> List[Dict[str, Any]]:
    try:
        packages, _ = parse_packages(packages_value)
    except (TypeError, json.JSONDecodeError):
        return []
    view_list = packages.get("viewList") if isinstance(packages, dict) else []
    if not isinstance(view_list, list):
        return []
    groups = []
    for group_index, group in enumerate(view_list):
        if not isinstance(group, dict):
            continue
        raw_items = group.get("list") if isinstance(group.get("list"), list) else []
        items = []
        for item_index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    "id": clean_string(item.get("id")) or f"{group_index}-{item_index}",
                    "name": clean_string(item.get("title")),
                    "price": parse_number(item.get("price")),
                    "quantity": {"amount": parse_int(item.get("num")) or 1, "unit": "FEN"},
                }
            )
        groups.append(
            {
                "id": clean_string(group.get("groupId")) or str(group_index),
                "name": clean_string(group.get("groupName")),
                "items": items,
                "selectionRule": {
                    "totalCount": parse_int(group.get("groupSelectNum")) or len(items),
                    "optionCount": len(items),
                },
                "canRepeat": False,
            }
        )
    return groups


def normalize_images(value: Any, rb_image_base_url: str = "") -> List[Dict[str, Any]]:
    if value is None:
        return []
    raw_items = value if isinstance(value, list) else [value]
    images = []
    for index, item in enumerate(raw_items):
        url = ""
        uri = ""
        name = ""
        if isinstance(item, str):
            raw = item.strip()
            if raw.startswith(("http://", "https://")):
                url = raw
            elif rb_image_base_url:
                url = urljoin(rb_image_base_url.rstrip("/") + "/", raw.lstrip("/"))
            else:
                uri = raw
            name = raw.rsplit("/", 1)[-1] if raw else ""
        elif isinstance(item, dict):
            url = clean_string(item.get("url"))
            uri = clean_string(item.get("uri"))
            name = clean_string(item.get("name"))
        if url or uri:
            images.append(
                {
                    "url": url,
                    "uri": uri,
                    "name": name,
                    "sortableOnlyId": uri or url or str(index),
                }
            )
    return images


def parse_number(value: Any):
    text = clean_string(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value: Any):
    if isinstance(value, int):
        return value
    number = parse_number(value)
    if number is None:
        return None
    return int(number)


def dedupe_images(images: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for image in images:
        key = image.get("uri") or image.get("url")
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(image)
    return result


def collect_missing_fields(product: Dict[str, Any]) -> List[str]:
    missing = []
    if not clean_string(product.get("title")):
        missing.append("title")
    if not product.get("salePrice"):
        missing.append("salePrice")
    if not product.get("originPrice"):
        missing.append("originPrice")
    if not product.get("images"):
        missing.append("images")
    if not product.get("itemGroups"):
        missing.append("itemGroups")
    if not clean_string(product.get("merchant", {}).get("name")):
        missing.append("merchant.name")
    if not product.get("category", {}).get("id"):
        missing.append("category.id")
    if not product.get("productType"):
        missing.append("productType")
    return missing
