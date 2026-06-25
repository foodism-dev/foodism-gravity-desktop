#!/usr/bin/env python3
"""Save a normalized product JSON as a Life Partner product draft."""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib import parse

from .lin_ke_auth import BASE_URL, LifePartnerSession, concise_error, resolve_cookie, validate_cookie_or_exit


REFERER = "https://www.life-partner.cn/subapp/goods/product-create"
POI_KEY_PATH = "/proxy/life/tobias/v1/poi/choose/key/get"
POI_AVAILABLE_PATH = "/proxy/life/tobias/poi/available/detail/page"
POI_UPDATE_PATH = "/proxy/life/tobias/v1/poi/choose/update"
MERCHANT_RELATION_SEARCH_PATH = "/proxy/life/account/v2/poi/relation/search"
OPERATION_MERCHANT_LIST_PATH = "/life/partner/v3/operation/merchant/list/"
SAVE_DRAFT_PATH = "/proxy/life/tobias/product/cache/save/"
IMAGE_UPLOAD_PATH = "/proxy/life/goods/attach/product/picture/update"

DEFAULT_PERMISSION_PARAMS = (
    '{"SearchAllAccountPoiType":0,"ExpandToPoiAccount":true,'
    '"SearchAllAccountPoiStatus":0,"RelationTypes":[1,8,10,12],'
    '"SettleStatusBeforeClaim":[],"PermissionKeyList":["hermes.goods.product_create"],'
    '"Selections":[]}'
)
DEFAULT_PLATFORM_DESCRIPTION = json.dumps(
    {
        "note_type": 1,
        "content": "如部分菜品因时令或其他不可抗因素导致无法提供，请联系商家协商处理，感谢您的理解。",
    },
    ensure_ascii=False,
)
DEFAULT_PRODUCT_QUALIFICATION = json.dumps(
    {
        "ProductQualifications": [],
        "ProductQualificationCertifications": [],
        "ProductQualificationUploadInfos": [],
    },
    ensure_ascii=False,
)
DEFAULT_CONSUMPTION_THRESHOLD = json.dumps({"enable": False, "description": ""}, ensure_ascii=False)
DEFAULT_EXTRA_CONSUMPTION = json.dumps({"enable": False, "itemList": []}, ensure_ascii=False)
DEFAULT_FREEBIE_INFO = json.dumps(
    {
        "enable": False,
        "freebieDesc": "",
        "validDateDesc": "",
        "exchangeRuleDesc": "",
        "freebieName": "",
        "totalStockNum": "0",
    },
    ensure_ascii=False,
)
DEFAULT_REFUND_DESCRIPTION = json.dumps(
    [{"note_type": 1, "content": "到店核销：随时可退，过期未核销自动退"}],
    ensure_ascii=False,
)
DEFAULT_BOOST_STRATEGY = json.dumps(
    {"ai_recommend_title": "", "ai_recommend_title_source": ""},
    ensure_ascii=False,
)


class MerchantResolutionError(Exception):
    def __init__(self, payload):
        super().__init__(payload.get("reason") or "merchant_resolution_failed")
        self.payload = payload


class DraftWorkflowError(Exception):
    def __init__(self, payload, exit_code=1):
        super().__init__(payload.get("reason") or payload.get("error") or "draft_workflow_failed")
        self.payload = payload
        self.exit_code = exit_code


def main():
    args = parse_args()
    provider_name, cookie = resolve_cookie(args)
    session = LifePartnerSession(
        cookie=cookie,
        timeout=args.timeout,
        base_url=args.base_url,
        referer=args.referer,
    )
    validate_cookie_or_exit(session, provider_name, cookie_label(args))

    if args.check_cookie:
        print(
            json.dumps(
                {
                    "cookie_valid": True,
                    "provider": provider_name,
                    "check": "secsdk_csrf_token",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    product = load_product(args.product_json)
    context = resolve_context(product, args)
    try:
        context = resolve_merchant_context(session, product, context, args)
    except MerchantResolutionError as exc:
        write_json(exc.payload, args.output)
        raise SystemExit(2) from exc

    questions = collect_required_questions(product, context)
    if questions:
        fail_required_input(product, questions, args.output)

    if args.dry_run_payload:
        try:
            prepare_payload_context(session, product, context)
        except DraftWorkflowError as exc:
            write_json(exc.payload, args.output)
            raise SystemExit(exc.exit_code) from exc
        payload = build_save_payload(product, context)
        write_json(
            {
                "ok": True,
                "dryRun": True,
                "merchant": context.get("merchant", {}),
                "missingFields": [],
                "warnings": product.get("warnings", []),
                "payload": payload,
            },
            args.output,
        )
        return

    try:
        poi_selection = resolve_poi_selection(session, context)
    except DraftWorkflowError as exc:
        write_json(exc.payload, args.output)
        raise SystemExit(exc.exit_code) from exc

    context.update(
        {
            "poiSetId": poi_selection.get("poiSetId", context.get("poiSetId", "")),
            "poiId": poi_selection.get("poiId", context.get("poiId", "")),
            "poiName": poi_selection.get("poiName", context.get("poiName", "")),
        }
    )

    if args.dry_run_poi:
        write_json(
            {
                "ok": True,
                "dryRun": True,
                "stage": "poi_selection",
                "merchant": context.get("merchant", {}),
                "poiSetId": context.get("poiSetId", ""),
                "poiId": context.get("poiId", ""),
                "poiName": context.get("poiName", ""),
            },
            args.output,
        )
        return

    try:
        prepare_payload_context(session, product, context)
    except DraftWorkflowError as exc:
        write_json(exc.payload, args.output)
        raise SystemExit(exc.exit_code) from exc

    payload = build_save_payload(product, context)
    poi_set_id = context.get("poiSetId", "")
    payload["product_detail"]["product"]["extra_map"]["poi_set_id"] = poi_set_id
    try:
        result = save_draft(session, payload, context)
    except RuntimeError as exc:
        write_json(
            {
                "ok": False,
                "stage": "save_draft",
                "reason": "request_failed",
                "error": concise_error(exc),
            },
            args.output,
        )
        raise SystemExit(1) from exc
    try:
        ensure_life_partner_ok(result, "save_draft", "保存草稿失败")
    except DraftWorkflowError as exc:
        write_json(exc.payload, args.output)
        raise SystemExit(exc.exit_code) from exc
    cache_id = clean_string(result.get("cache_id")) if isinstance(result, dict) else ""
    if not cache_id:
        write_json(
            {
                "ok": False,
                "stage": "save_draft",
                "reason": "missing_cache_id",
                "error": "保存草稿接口未返回 cache_id，不能确认草稿健康创建",
                "response": summarize_response(result),
            },
            args.output,
        )
        raise SystemExit(1)

    write_json(
        {
            "ok": True,
            "productId": product.get("source", {}).get("id", ""),
            "merchant": context.get("merchant", {}),
            "cacheId": cache_id,
            "poiSetId": poi_set_id,
            "poiId": context.get("poiId", ""),
            "poiName": context.get("poiName", ""),
            "status_msg": result.get("status_msg") if isinstance(result, dict) else "",
        },
        args.output,
    )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate a Life Partner cookie and save a normalized product JSON as a draft.",
        epilog=(
            "Environment fallbacks: LIN_KE_COOKIE_FILE, LIN_KE_COOKIE, "
            "LIN_KE_PROVIDERS_FILE, LIN_KE_PROVIDER."
        ),
    )
    parser.add_argument("--cookie-file", default=os.getenv("LIN_KE_COOKIE_FILE", ""))
    parser.add_argument("--cookie", default=os.getenv("LIN_KE_COOKIE", ""))
    parser.add_argument("--providers-file", default=os.getenv("LIN_KE_PROVIDERS_FILE", ""))
    parser.add_argument("--provider", default=os.getenv("LIN_KE_PROVIDER", ""))
    parser.add_argument("--product-json", default="", help="Normalized product JSON from the rb skill")
    parser.add_argument("--root-life-account-id", default="", help="Life Partner root account id")
    parser.add_argument("--account-id", default="", help="Life Partner account id metadata")
    parser.add_argument("--merchant-name", default="", help="Merchant name used when root account id needs to be resolved")
    parser.add_argument("--category-id", default="", help="Override product category id")
    parser.add_argument("--product-type", type=int, default=0, help="Override Life Partner product type")
    parser.add_argument("--settle-type", default="1", help="Life Partner settle type")
    parser.add_argument("--poi-set-id", default="", help="Reuse an existing poi_set_id")
    parser.add_argument("--poi-id", default="", help="Life Partner POI id to select when multiple stores are available")
    parser.add_argument("--draft-cache-id", default="", help="Existing product draft cache id")
    parser.add_argument("--rec-person-num", type=int, default=0, help="Recommended minimum dining person count")
    parser.add_argument("--rec-person-num-max", type=int, default=0, help="Recommended maximum dining person count")
    parser.add_argument("--validity-days", type=int, default=0, help="Consumption validity days from purchase")
    parser.add_argument("--validity-end-date", default="", help="Consumption validity end date, YYYY-MM-DD")
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument("--referer", default=REFERER)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--dry-run-payload", action="store_true", help="Build payload without saving")
    parser.add_argument("--dry-run-poi", action="store_true", help="Resolve merchant and POI selection without saving")
    parser.add_argument("--check-cookie", action="store_true", help="Only validate cookie/CSRF")
    parser.add_argument("--output", default="", help="Write result JSON to file; stdout when omitted")
    args = parser.parse_args()
    if not args.check_cookie and not args.product_json:
        parser.error("--product-json is required unless --check-cookie is used")
    return args


def load_product(path):
    if not path:
        return {}
    product_path = Path(path).expanduser()
    if not product_path.exists():
        raise SystemExit(f"product json not found: {product_path}")
    data = json.loads(product_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("product json must contain an object")
    return data


def resolve_context(product, args):
    category = product.get("category") if isinstance(product.get("category"), dict) else {}
    category_id = args.category_id or clean_string(category.get("id")) or clean_string(product.get("categoryId"))
    product_type = args.product_type or infer_product_type(product)
    rec_person_num, rec_person_num_max, rec_person_source = resolve_rec_person_range(product, args)
    return {
        "rootLifeAccountId": args.root_life_account_id.strip(),
        "accountId": args.account_id.strip(),
        "merchantName": resolve_merchant_name(product, args),
        "categoryId": category_id,
        "productType": product_type,
        "settleType": str(args.settle_type or "1"),
        "poiSetId": args.poi_set_id.strip(),
        "poiId": args.poi_id.strip(),
        "poiName": "",
        "merchantId": "",
        "skuOrderId": "",
        "draftCacheId": (
            args.draft_cache_id.strip()
            or clean_string(product.get("lkDraftCacheId"))
            or clean_string(product.get("draftCacheId"))
            or clean_string(product.get("cacheId"))
        ),
        "recPersonNum": rec_person_num,
        "recPersonNumMax": rec_person_num_max,
        "recPersonSource": rec_person_source,
        "validityDays": args.validity_days,
        "validityEndDate": args.validity_end_date.strip(),
    }


def resolve_merchant_name(product, args):
    explicit = clean_string(args.merchant_name)
    if explicit:
        return explicit
    merchant = product.get("merchant") if isinstance(product.get("merchant"), dict) else {}
    name = clean_string(merchant.get("name"))
    if name:
        return name
    hosts = product.get("hosts") if isinstance(product.get("hosts"), list) else []
    for host in hosts:
        if isinstance(host, dict) and clean_string(host.get("name")):
            return clean_string(host.get("name"))
    return ""


def resolve_merchant_context(session, product, context, args):
    if context.get("rootLifeAccountId"):
        context["merchant"] = build_merchant_result(context, product, match_type="explicit")
        return context

    merchant_name = context.get("merchantName")
    if not merchant_name:
        raise MerchantResolutionError(
            {
                "ok": False,
                "stage": "merchant_resolution",
                "merchantName": "",
                "reason": "missing_merchant_name",
                "candidates": [],
            }
        )

    selected, match_type, reason, candidates, search_errors = resolve_merchant_candidate(
        session,
        merchant_name,
        context,
    )
    if selected is None:
        payload = {
            "ok": False,
            "stage": "merchant_resolution",
            "merchantName": merchant_name,
            "reason": reason,
            "candidates": candidates,
        }
        if search_errors:
            payload["searchErrors"] = search_errors
        raise MerchantResolutionError(payload)

    root_id = context.get("rootLifeAccountId") or selected.get("rootLifeAccountId")
    account_id = context.get("accountId") or selected.get("accountId")
    if not root_id:
        raise MerchantResolutionError(
            {
                "ok": False,
                "stage": "merchant_resolution",
                "merchantName": merchant_name,
                "reason": "missing_root_life_account_id",
                "candidates": candidates,
            }
        )

    context["rootLifeAccountId"] = root_id
    context["accountId"] = account_id
    context["poiId"] = context.get("poiId") or selected.get("poiId", "")
    context["poiName"] = context.get("poiName") or selected.get("name", "")
    context["merchantId"] = selected.get("merchantId", "")
    context["skuOrderId"] = selected.get("skuOrderId", "")
    context["merchant"] = {
        "name": selected.get("name") or merchant_name,
        "rootLifeAccountId": root_id,
        "accountId": account_id,
        "merchantId": context.get("merchantId", ""),
        "skuOrderId": context.get("skuOrderId", ""),
        "poiId": context.get("poiId", ""),
        "address": selected.get("address", ""),
        "matchType": match_type,
    }
    return context


def resolve_merchant_candidate(session, merchant_name, context):
    search_errors = []
    operation_candidates = []
    try:
        operation_candidates = search_operation_merchant_candidates(session, merchant_name)
    except RuntimeError as exc:
        search_errors.append(
            {
                "source": "operation_merchant_search",
                "error": concise_error(exc),
            }
        )

    if operation_candidates:
        selected, match_type, reason = choose_merchant_candidate(operation_candidates, merchant_name)
        return selected, match_type, reason, operation_candidates, search_errors

    relation_candidates = []
    try:
        relation_candidates = search_poi_relation_candidates(session, merchant_name, context)
    except RuntimeError as exc:
        search_errors.append(
            {
                "source": "poi_relation_search",
                "error": concise_error(exc),
            }
        )

    if relation_candidates:
        selected, match_type, reason = choose_merchant_candidate(relation_candidates, merchant_name)
        return selected, match_type, reason, relation_candidates, search_errors

    reason = "search_failed" if search_errors else "no_candidates"
    return None, "", reason, [], search_errors


def search_operation_merchant_candidates(session, merchant_name):
    payload = {
        "filter_param": {
            "merchant_name": merchant_name,
        },
        "page_index": 1,
        "page_size": 10,
    }
    response = session.post_json(OPERATION_MERCHANT_LIST_PATH, payload)
    ensure_status_ok(response, "商家概览搜索失败")
    items = extract_operation_merchant_items(response)
    return [
        candidate
        for candidate in (normalize_operation_merchant_candidate(item) for item in items)
        if candidate.get("name")
    ]


def extract_operation_merchant_items(response):
    if not isinstance(response, dict):
        return []
    data = response.get("data")
    if not isinstance(data, dict):
        return []
    value = data.get("merchant_list")
    return value if isinstance(value, list) else []


def normalize_operation_merchant_candidate(item):
    if not isinstance(item, dict):
        return {}
    merchant_id = first_string(item, "merchant_id", "root_account_id", "root_life_account_id")
    return {
        "source": "operation_merchant",
        "name": first_string(item, "merchant_name", "company_name", "account_name", "name"),
        "address": first_string(item, "merchant_address", "address", "poi_address"),
        "rootLifeAccountId": first_string(item, "root_account_id", "root_life_account_id") or merchant_id,
        "merchantId": merchant_id,
        "skuOrderId": first_string(item, "sku_order_id", "skuOrderId"),
        "accountId": first_string(item, "root_key_account_id", "key_account_id", "account_id"),
        "poiId": first_string(item, "poi_id", "poiId"),
    }


def search_poi_relation_candidates(session, merchant_name, context):
    payload = {
        "page_size": 15,
        "page_index": 1,
        "search_params": {
            "relation_types": [1, 1, 5, 8, 10],
            "permission_key_list": ["hermes.goods.product_create"],
            "poi_name": merchant_name,
            "poi_aggregate_name": merchant_name,
            "filter_account_biz": False,
        },
        "filter_params": {},
        "permission_common_param": {"all_selected_params": DEFAULT_PERMISSION_PARAMS},
    }
    query = {}
    if context.get("rootLifeAccountId"):
        query["root_life_account_id"] = context["rootLifeAccountId"]
    response = session.post_json(MERCHANT_RELATION_SEARCH_PATH, payload, query=query)
    ensure_status_ok(response, "商家搜索失败")
    items = extract_candidate_items(response)
    return [candidate for candidate in (normalize_merchant_candidate(item) for item in items) if candidate.get("name")]


def extract_candidate_items(response):
    if not isinstance(response, dict):
        return []
    data = response.get("data")
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("list", "accounts", "poi_list", "items"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def normalize_merchant_candidate(item):
    if not isinstance(item, dict):
        return {}
    return {
        "source": "poi_relation",
        "name": first_string(item, "poi_name", "merchant_name", "account_name", "life_account_name", "name"),
        "address": first_string(item, "poi_address", "address"),
        "rootLifeAccountId": first_string(
            item,
            "root_life_account_id",
            "confer_root_life_account_id",
            "parent_life_account_id",
            "root_account_id",
        ),
        "merchantId": first_string(item, "merchant_id", "root_life_account_id", "root_account_id"),
        "skuOrderId": first_string(item, "sku_order_id", "skuOrderId"),
        "accountId": first_string(item, "account_id", "life_account_id", "poi_life_account_id", "key_account_id"),
        "poiId": first_string(item, "poi_id", "poiId"),
    }


def choose_merchant_candidate(candidates, merchant_name):
    if not candidates:
        return None, "", "no_candidates"
    keyword = normalize_match_text(merchant_name)
    exact = [item for item in candidates if normalize_match_text(item.get("name")) == keyword]
    if len(exact) == 1:
        return exact[0], merchant_match_type(exact[0], "exact"), ""
    if len(exact) > 1:
        return None, "", "multiple_candidates"

    contains = [
        item
        for item in candidates
        if is_contained_match(keyword, normalize_match_text(item.get("name")))
    ]
    if len(contains) == 1:
        return contains[0], merchant_match_type(contains[0], "contains"), ""
    if len(contains) > 1 or len(candidates) > 1:
        return None, "", "multiple_candidates"
    return None, "", "no_high_confidence_match"


def merchant_match_type(candidate, match_type):
    source = candidate.get("source")
    if source == "operation_merchant":
        return f"operation_merchant_{match_type}"
    if source == "poi_relation":
        return f"poi_relation_{match_type}"
    return match_type


def is_contained_match(keyword, candidate):
    if not keyword or not candidate:
        return False
    if len(keyword) < 4 and len(candidate) < 4:
        return False
    return keyword in candidate or candidate in keyword


def build_merchant_result(context, product, match_type):
    merchant = product.get("merchant") if isinstance(product.get("merchant"), dict) else {}
    return {
        "name": context.get("merchantName") or clean_string(merchant.get("name")),
        "rootLifeAccountId": context.get("rootLifeAccountId", ""),
        "accountId": context.get("accountId", ""),
        "merchantId": context.get("merchantId", "") or context.get("rootLifeAccountId", ""),
        "skuOrderId": context.get("skuOrderId", ""),
        "poiId": context.get("poiId", ""),
        "matchType": match_type,
    }


def infer_product_type(product):
    value = parse_int(product.get("productType"))
    if value:
        return value
    groupon_type = clean_string(product.get("grouponType")).lower()
    if groupon_type in ("voucher", "11", "c"):
        return 11
    if groupon_type in ("multi-use", "multi_use", "15"):
        return 15
    return 0


def resolve_rec_person_range(product, args):
    explicit_min = parse_int(args.rec_person_num)
    explicit_max = parse_int(args.rec_person_num_max)
    if explicit_min:
        return explicit_min, explicit_max or explicit_min, "args"

    for min_key, max_key in (
        ("recPersonNum", "recPersonNumMax"),
        ("recommendedPersonNum", "recommendedPersonNumMax"),
        ("personNum", "personNumMax"),
    ):
        value = parse_int(product.get(min_key))
        max_value = parse_int(product.get(max_key))
        if value:
            return value, max_value or value, min_key

    for text in rec_person_source_texts(product):
        parsed = parse_rec_person_text(text)
        if parsed:
            return parsed[0], parsed[1], "text"
    return 0, 0, ""


def rec_person_source_texts(product):
    texts = [clean_string(product.get("title"))]
    groups = product.get("itemGroups") if isinstance(product.get("itemGroups"), list) else []
    for group in groups:
        if isinstance(group, dict):
            texts.append(clean_string(group.get("name")))
    return [text for text in texts if text]


def parse_rec_person_text(text):
    normalized = clean_string(text)
    if not normalized:
        return None
    token_pattern = r"\d+|[一二两三四五六七八九十单双]+"
    range_match = re.search(rf"({token_pattern})\s*[-~至到]\s*({token_pattern})\s*人", normalized)
    if range_match:
        start = parse_person_count_token(range_match.group(1))
        end = parse_person_count_token(range_match.group(2))
        if start > 0 and end >= start:
            return start, end
    single_match = re.search(rf"({token_pattern})\s*人", normalized)
    if single_match:
        value = parse_person_count_token(single_match.group(1))
        if value > 0:
            return value, value
    return None


def parse_person_count_token(token):
    text = clean_string(token)
    if not text:
        return 0
    if text.isdigit():
        return int(text)
    direct = {
        "单": 1,
        "一": 1,
        "双": 2,
        "两": 2,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    if text in direct:
        return direct[text]
    digits = {**direct, "十": 10}
    if "十" not in text:
        return 0
    parts = text.split("十", 1)
    if len(parts) != 2:
        return 0
    tens = 1 if parts[0] == "" else digits.get(parts[0], 0)
    ones = 0 if parts[1] == "" else digits.get(parts[1], 0)
    return tens * 10 + ones if tens > 0 else 0


def collect_required_questions(product, context):
    questions = []
    for field in product.get("missingFields", []) or []:
        if field == "merchant.name" and context.get("merchant", {}).get("matchType"):
            continue
        if field == "category.id" and context.get("categoryId"):
            continue
        if field == "productType" and context.get("productType"):
            continue
        if field == "category.id":
            add_question(questions, "category.id", "林客商品类目ID", "--category-id", "missing")
        elif field == "productType":
            add_question(questions, "productType", "林客商品类型", "--product-type", "missing")
        else:
            add_question(questions, field, field, "", "missing")

    category_id = clean_string(context.get("categoryId"))
    if not category_id:
        add_question(questions, "category.id", "林客商品类目ID", "--category-id", "missing")
    elif parse_int(category_id) is None:
        add_question(questions, "category.id", "林客商品类目ID", "--category-id", "invalid", category_id)

    if not context.get("productType"):
        add_question(questions, "productType", "林客商品类型", "--product-type", "missing")
    if not context.get("rootLifeAccountId"):
        add_question(questions, "rootLifeAccountId", "林客商家 root_life_account_id", "--root-life-account-id", "missing")
    if not clean_string(product.get("title")):
        add_question(questions, "title", "商品名称", "", "missing")
    if not positive_number(product.get("salePrice")):
        add_question(questions, "salePrice", "顾客实际需支付", "", "missing_or_invalid")
    if not positive_number(product.get("originPrice")):
        add_question(questions, "originPrice", "划线价", "", "missing_or_invalid")
    if not product.get("images"):
        add_question(questions, "images", "头图", "", "missing")
    if context.get("productType") != 11 and not product.get("itemGroups"):
        add_question(questions, "itemGroups", "套餐菜品", "", "missing")

    if not context.get("recPersonNum") or not context.get("recPersonNumMax"):
        add_question(
            questions,
            "recPersonNum",
            "建议用餐人数",
            "--rec-person-num/--rec-person-num-max",
            "missing_unparseable",
        )
    elif context["recPersonNumMax"] < context["recPersonNum"]:
        add_question(
            questions,
            "recPersonNum",
            "建议用餐人数",
            "--rec-person-num/--rec-person-num-max",
            "invalid_range",
            f"{context['recPersonNum']}-{context['recPersonNumMax']}",
        )

    validity_issue = validate_consumption_validity(product, context)
    if validity_issue:
        add_question(
            questions,
            "validityPeriod.endDate",
            "消费有效期",
            "--validity-days 或 --validity-end-date",
            validity_issue["reason"],
            validity_issue.get("currentValue", ""),
        )

    if not context.get("draftCacheId"):
        add_question(questions, "draftCacheId", "林客创建页 use_cache_id", "--draft-cache-id", "missing")

    return questions


def add_question(questions, field, label, param, reason, current_value=""):
    if any(item.get("field") == field for item in questions):
        return
    question = {
        "field": field,
        "label": label,
        "reason": reason,
    }
    if param:
        question["param"] = param
    if current_value:
        question["currentValue"] = current_value
    questions.append(question)


def validate_consumption_validity(product, context):
    days = parse_int(context.get("validityDays"))
    if days and days > 0:
        return None
    if context.get("validityDays") and days is not None and days <= 0:
        return {"reason": "invalid_days", "currentValue": str(context.get("validityDays"))}

    explicit_end = clean_string(context.get("validityEndDate"))
    validity = product.get("validityPeriod") if isinstance(product.get("validityPeriod"), dict) else {}
    source_end = explicit_end or clean_string(validity.get("endDate"))
    if not source_end:
        return {"reason": "missing"}
    parsed_end = parse_date(source_end)
    if parsed_end is None:
        return {"reason": "invalid_date", "currentValue": source_end}
    if parsed_end < datetime.now().date():
        return {"reason": "expired", "currentValue": source_end}
    return None


def fail_required_input(product, questions, output=""):
    write_json(
        {
            "ok": False,
            "stage": "required_input",
            "reason": "missing_required_fields",
            "missingFields": [item["field"] for item in questions],
            "questions": questions,
            "warnings": product.get("warnings", []),
        },
        output,
    )
    raise SystemExit(2)


def resolve_poi_selection(session, context):
    if context.get("poiSetId"):
        return {
            "poiSetId": context.get("poiSetId", ""),
            "poiId": context.get("poiId", ""),
            "poiName": context.get("poiName", ""),
            "matchType": "provided",
        }

    poi_set_id = fetch_poi_set_id(session, context)
    candidates = fetch_available_pois(session, context)
    selected = choose_poi_candidate(candidates, context)
    if selected is None:
        reason = "multiple_pois" if candidates else "no_available_pois"
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_selection",
                "reason": reason,
                "poiSetId": poi_set_id,
                "candidates": candidates,
            },
            exit_code=2,
        )

    update_poi_selection(session, context, poi_set_id, selected)
    return {
        "poiSetId": poi_set_id,
        "poiId": selected.get("poiId", ""),
        "poiName": selected.get("name", ""),
        "matchType": "explicit" if context.get("poiId") else "single",
    }


def fetch_poi_set_id(session, context):
    permission_params = DEFAULT_PERMISSION_PARAMS
    query = {
        "is_draft": "true",
        "settle_type": context["settleType"],
        "category_id": context["categoryId"],
        "product_type": context["productType"],
        "root_life_account_id": context["rootLifeAccountId"],
        "all_selected_params": permission_params,
    }
    try:
        step1 = session.get_json(POI_KEY_PATH, query=query, csrf=True)
    except RuntimeError as exc:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_set_id",
                "reason": "request_failed",
                "error": concise_error(exc),
            }
        ) from exc
    ensure_life_partner_ok(step1, "poi_set_id", "获取poi_set_id失败")
    poi_set_id = clean_string(step1.get("poi_set_id")) if isinstance(step1, dict) else ""
    if not poi_set_id:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_set_id",
                "reason": "missing_poi_set_id",
                "response": summarize_response(step1),
            }
        )
    return poi_set_id


def fetch_available_pois(session, context):
    detail_payload = {
        "category_id": context["categoryId"],
        "product_type": context["productType"],
        "settle_type": parse_int(context["settleType"]) or context["settleType"],
        "page": 1,
        "page_size": 50,
        "need_phone_opentime_check": True,
        "product_sub_type": None,
    }
    try:
        response = session.post_json(
            POI_AVAILABLE_PATH,
            detail_payload,
            query={"root_life_account_id": context["rootLifeAccountId"]},
        )
    except RuntimeError as exc:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_available_detail",
                "reason": "request_failed",
                "error": concise_error(exc),
            }
        ) from exc
    ensure_life_partner_ok(response, "poi_available_detail", "查询可用门店失败")
    return extract_poi_candidates(response)


def update_poi_selection(session, context, poi_set_id, selected):
    try:
        response = session.post_json(
            POI_UPDATE_PATH,
            {
                "poi_set_id": poi_set_id,
                "in_poi_ids": [selected["poiId"]],
            },
            query={"root_life_account_id": context["rootLifeAccountId"]},
        )
    except RuntimeError as exc:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_choose_update",
                "reason": "request_failed",
                "poiSetId": poi_set_id,
                "poiId": selected.get("poiId", ""),
                "error": concise_error(exc),
            }
        ) from exc
    ensure_life_partner_ok(
        response,
        "poi_choose_update",
        "同步门店选择失败",
        poiSetId=poi_set_id,
        poiId=selected.get("poiId", ""),
    )


def extract_poi_candidates(response):
    if not isinstance(response, dict):
        return []
    items = response.get("poi_list")
    if not isinstance(items, list):
        items = response.get("selected_poi_list")
    if not isinstance(items, list):
        return []
    candidates = []
    for item in items:
        candidate = normalize_poi_candidate(item)
        if candidate.get("poiId") and candidate.get("canSelect", True):
            candidates.append(candidate)
    return candidates


def normalize_poi_candidate(item):
    if not isinstance(item, dict):
        return {}
    return {
        "poiId": first_string(item, "poi_id", "poiId"),
        "name": first_string(item, "poi_name", "name"),
        "address": first_string(item, "poi_address", "address"),
        "city": first_string(item, "poi_city", "city"),
        "canSelect": item.get("can_select", True),
        "isSelect": item.get("is_select", False),
    }


def choose_poi_candidate(candidates, context):
    explicit_poi_id = clean_string(context.get("poiId"))
    if explicit_poi_id:
        for candidate in candidates:
            if candidate.get("poiId") == explicit_poi_id:
                return candidate
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "poi_selection",
                "reason": "poi_id_not_found",
                "poiId": explicit_poi_id,
                "candidates": candidates,
            },
            exit_code=2,
        )
    if len(candidates) == 1:
        return candidates[0]
    return None


def ensure_life_partner_ok(response, stage, default_message, **extra):
    if not isinstance(response, dict):
        payload = {
            "ok": False,
            "stage": stage,
            "reason": "invalid_response",
            "error": default_message,
        }
        payload.update(extra)
        raise DraftWorkflowError(payload)
    status = response.get("status_code")
    if status in (0, None):
        return
    payload = {
        "ok": False,
        "stage": stage,
        "reason": "life_partner_error",
        "status_code": status,
        "status_msg": response.get("status_msg"),
        "response": summarize_response(response),
    }
    payload.update(extra)
    raise DraftWorkflowError(payload)


def save_draft(session, payload, context):
    return session.post_json(
        SAVE_DRAFT_PATH,
        payload,
        query={
            "root_life_account_id": context["rootLifeAccountId"],
        },
    )


def prepare_payload_context(session, product, context):
    commodity_json = build_commodity(normalize_item_groups_for_payload(product))
    validate_commodity_json(commodity_json)
    context["commodityJson"] = commodity_json

    main_entries = upload_image_list(session, product.get("images"), context, "images")
    detail_entries = upload_image_list(session, product.get("detailImages"), context, "detailImages")
    context["mainImageJson"] = build_main_image_json_from_entries(main_entries)
    context["dishesImageJson"] = build_image_json_from_entries(detail_entries)


def build_save_payload(product, context):
    comp_map = {
        "actualAmount": to_cents(product.get("salePrice")),
        "appointment": json.dumps({"appointment": {"needAppointment": False}}, ensure_ascii=False),
        "auto_renew-sold_end_time-sold_start_time": build_sale_time(product.get("saleTime")),
        "canNoUseDate": json.dumps({"enable": False, "daysOfWeek": [], "holidays": [], "dateList": []}, ensure_ascii=False),
        "canTakeGoodsAccountType": json.dumps({"label": "允许", "value": True}, ensure_ascii=False),
        "categoryId": context["categoryId"],
        "cateringVoucherLimitUseRule": json.dumps({"type": 1}, ensure_ascii=False),
        "codeSourceType": "1",
        "commodity": context.get("commodityJson") or build_commodity(product.get("itemGroups")),
        "comsumptionThreshold": DEFAULT_CONSUMPTION_THRESHOLD,
        "consumptionConvention": json.dumps([{"label": "可堂食", "value": 1}], ensure_ascii=False),
        "currencyType": "CNY",
        "customer_reserved_info-real_name_info": json.dumps(
            {"customerReservedInfo": {"allow": False}, "realNameInfo": {"enable": False}},
            ensure_ascii=False,
        ),
        "descriptionRichText": product_description_text(product),
        "dishesImageList": context.get("dishesImageJson") or build_image_json(product.get("detailImages")),
        "enable_multi_consume_once-enable_multi_user-free_pack-need_register_id_card-once_consumption_limit-private_room-superimposed_discounts": json.dumps(
            {
                "superimposedDiscounts": False,
                "needRegisterIdCard": None,
                "enableMultiUser": None,
                "enableMultiConsumeOnce": None,
                "freePack": None,
                "privateRoom": False,
                "onceConsumptionLimit": None,
            },
            ensure_ascii=False,
        ),
        "environmentImageList": "[]",
        "extraConsumption": DEFAULT_EXTRA_CONSUMPTION,
        "freebieInfo": DEFAULT_FREEBIE_INFO,
        "fulfillmentMethod": "2",
        "image_1v1_list-image_list": context.get("mainImageJson") or build_main_image_json(product.get("images")),
        "isOriginAmountEdited": "false",
        "limitBuyRule": build_limit_buy_rule(),
        "originAmount": to_cents(product.get("originPrice")),
        "platformUnifiedDescription": DEFAULT_PLATFORM_DESCRIPTION,
        "productName": clean_string(product.get("title")),
        "productQualificationUnion": DEFAULT_PRODUCT_QUALIFICATION,
        "productType": str(context["productType"]),
        "rec_person_num-rec_person_num_max": json.dumps(
            {"value": context["recPersonNum"], "maxValue": context["recPersonNumMax"]},
            ensure_ascii=False,
        ),
        "refundDescription": DEFAULT_REFUND_DESCRIPTION,
        "settleType": context["settleType"],
        "showChannel": "1",
        "sold_qty-stock_info": build_stock_info(product.get("stockQty")),
        "testFlag": "false",
        "times_card_bind_product-times_card_type": json.dumps(
            {"timesCardType": 1 if context["productType"] == 15 else 0, "timesCardBindProduct": {}},
            ensure_ascii=False,
        ),
        "useDate": build_use_date(product.get("validityPeriod"), product.get("saleTime"), context),
        "useTime": json.dumps({"useTimeType": 1}, ensure_ascii=False),
    }

    return {
        "product_detail": {
            "product": {
                "category_id": parse_int(context["categoryId"]),
                "product_type": context["productType"],
                "template_sub_type": 0,
                "comp_key_value_map": comp_map,
                "extra_map": {
                    "product_draft_cache_id": context.get("draftCacheId") or "",
                    "poi_set_id": context.get("poiSetId") or "",
                    "poi_check_result": "",
                    "boost_strategy": DEFAULT_BOOST_STRATEGY,
                },
            }
        },
        "save_product_draft_cache_type": 1,
        "product_cache_scene": 1,
        "version_info": {"Enable": True, "VersionName": "1.0.14"},
        "permission_common_param": {"all_selected_params": DEFAULT_PERMISSION_PARAMS},
    }


def build_commodity(groups):
    if not isinstance(groups, list) or not groups:
        return "[]"
    payload = []
    for group_index, group in enumerate(groups):
        if not isinstance(group, dict):
            continue
        items = group.get("items") if isinstance(group.get("items"), list) else []
        normalized_items = []
        total_count = 0
        for item_index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            quantity = item.get("quantity") if isinstance(item.get("quantity"), dict) else {}
            count = parse_number(quantity.get("amount")) or 1
            total_count += count
            unit = clean_string(quantity.get("unit")) or "FEN"
            normalized_items.append(
                {
                    "itemId": clean_string(item.get("id")) or f"{group_index}-{item_index}",
                    "name": clean_string(item.get("name")),
                    "price": to_cents(item.get("price") or 0),
                    "unit": unit.upper(),
                    "count": str(count),
                    "count-unit": json.dumps({"count": count, "unit": unit.upper()}, ensure_ascii=False),
                }
            )
        selection_rule = group.get("selectionRule") if isinstance(group.get("selectionRule"), dict) else {}
        payload.append(
            {
                "group_name": clean_string(group.get("name")),
                "total_count": parse_int(selection_rule.get("totalCount")) or total_count or len(normalized_items),
                "option_count": parse_int(selection_rule.get("optionCount")) or len(normalized_items),
                "allow_repeated_item": bool(group.get("canRepeat") or False),
                "hide_spec_name": False,
                "item_list": normalized_items,
            }
        )
    return json.dumps(payload, ensure_ascii=False)


def normalize_item_groups_for_payload(product):
    groups = product.get("itemGroups") if isinstance(product.get("itemGroups"), list) else []
    normalized_groups = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        copied_group = dict(group)
        copied_group["name"] = normalize_menu_name(clean_string(group.get("name")))
        items = group.get("items") if isinstance(group.get("items"), list) else []
        copied_items = []
        for item in items:
            if not isinstance(item, dict):
                continue
            copied_item = dict(item)
            copied_item["name"] = normalize_menu_name(clean_string(item.get("name")))
            copied_items.append(copied_item)
        copied_group["items"] = copied_items
        normalized_groups.append(copied_group)
    return normalized_groups


def normalize_menu_name(name):
    if not name:
        return name
    normalized = re.sub(r"\s+", " ", name).strip()
    return normalized.replace("(", "（").replace(")", "）")


def validate_commodity_json(commodity_json):
    try:
        groups = json.loads(commodity_json)
    except json.JSONDecodeError as exc:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "commodity",
                "reason": "invalid_json",
                "error": str(exc),
            },
            exit_code=2,
        ) from exc
    if not isinstance(groups, list) or not groups:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "commodity",
                "reason": "empty_groups",
                "error": "菜品搭配不能为空",
            },
            exit_code=2,
        )
    for group_index, group in enumerate(groups):
        if not isinstance(group, dict) or not clean_string(group.get("group_name")):
            raise DraftWorkflowError(
                {
                    "ok": False,
                    "stage": "commodity",
                    "reason": "empty_group_name",
                    "groupIndex": group_index,
                    "error": "菜品组名不能为空",
                },
                exit_code=2,
            )
        items = group.get("item_list")
        if not isinstance(items, list) or not items:
            raise DraftWorkflowError(
                {
                    "ok": False,
                    "stage": "commodity",
                    "reason": "empty_item_list",
                    "groupIndex": group_index,
                    "groupName": group.get("group_name"),
                    "error": "菜品组必须包含菜品",
                },
                exit_code=2,
            )
        for item_index, item in enumerate(items):
            if not isinstance(item, dict) or not clean_string(item.get("name")):
                raise DraftWorkflowError(
                    {
                        "ok": False,
                        "stage": "commodity",
                        "reason": "empty_item_name",
                        "groupIndex": group_index,
                        "itemIndex": item_index,
                        "groupName": group.get("group_name"),
                        "error": "菜品名称不能为空",
                    },
                    exit_code=2,
                )


def build_main_image_json(images):
    entries = build_image_entries(images)
    return build_main_image_json_from_entries(entries)


def build_main_image_json_from_entries(entries):
    return json.dumps(
        {
            "image_1v1_list": entries[:1],
            "image_list": entries[1:5],
        },
        ensure_ascii=False,
    )


def build_image_json(images):
    return build_image_json_from_entries(build_image_entries(images))


def build_image_json_from_entries(entries):
    return json.dumps(entries, ensure_ascii=False)


def build_image_entries(images):
    if not isinstance(images, list):
        return []
    entries = []
    for index, image in enumerate(images):
        if isinstance(image, str):
            url = image.strip()
            uri = url
            name = None
            sortable = url or str(index)
        elif isinstance(image, dict):
            url = clean_string(image.get("url")) or clean_string(image.get("uri"))
            uri = clean_string(image.get("uri")) or url
            name = clean_string(image.get("name")) or None
            sortable = clean_string(image.get("sortableOnlyId")) or uri or url or str(index)
        else:
            continue
        if not url and not uri:
            continue
        entries.append(
            {
                "url": url,
                "uri": uri,
                "name": name,
                "origin_uri": None,
                "origin_url": None,
                "sortableOnlyId": sortable,
            }
        )
    return entries


def upload_image_list(session, images, context, field_name):
    if not isinstance(images, list):
        return []
    entries = []
    for index, image in enumerate(images):
        source = image_source(image, index)
        if not source:
            continue
        if source.get("url"):
            entries.append(upload_image_source(session, source, context, field_name, index))
            continue
        if source.get("uri"):
            entries.append(
                {
                    "url": source["uri"],
                    "uri": source["uri"],
                    "name": source.get("name"),
                    "origin_uri": None,
                    "origin_url": None,
                    "sortableOnlyId": source.get("sortableOnlyId") or source["uri"],
                }
            )
    return entries


def image_source(image, index):
    if isinstance(image, str):
        url = image.strip()
        if not url:
            return None
        return {
            "url": url,
            "uri": "",
            "name": image_file_name(url, index),
            "sortableOnlyId": url or str(index),
        }
    if not isinstance(image, dict):
        return None
    url = clean_string(image.get("url"))
    uri = clean_string(image.get("uri"))
    if not url and uri.startswith(("http://", "https://")):
        url = uri
    if not url and not uri:
        return None
    return {
        "url": url,
        "uri": uri,
        "name": clean_string(image.get("name")) or image_file_name(url or uri, index),
        "sortableOnlyId": clean_string(image.get("sortableOnlyId")) or uri or url or str(index),
    }


def upload_image_source(session, source, context, field_name, index):
    try:
        content_type, content = download_image_content(session, source["url"])
        uploaded = upload_product_picture(
            session,
            content,
            source.get("name") or image_file_name(source["url"], index),
            content_type,
            context,
        )
    except RuntimeError as exc:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "image_upload",
                "reason": "request_failed",
                "field": field_name,
                "index": index,
                "url": source["url"],
                "error": concise_error(exc),
            },
            exit_code=2,
        ) from exc
    uri = clean_string(uploaded.get("uri"))
    url = clean_string(uploaded.get("url"))
    if not uri or not url:
        raise DraftWorkflowError(
            {
                "ok": False,
                "stage": "image_upload",
                "reason": "missing_uploaded_image_url",
                "field": field_name,
                "index": index,
                "response": summarize_response(uploaded),
            },
            exit_code=2,
        )
    return {
        "url": url,
        "uri": uri,
        "name": source.get("name") or None,
        "origin_uri": None,
        "origin_url": None,
        "sortableOnlyId": uri,
    }


def download_image_content(session, url):
    headers = session.common_headers()
    headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    response_headers, body = session.open_url("GET", url, headers=headers, data=None)
    content_type = response_headers.get_content_type()
    if not content_type.startswith("image/"):
        raise RuntimeError(f"图片下载返回非图片类型: {content_type}")
    if not body:
        raise RuntimeError("图片下载结果为空")
    return content_type, body


def upload_product_picture(session, content, file_name, content_type, context):
    account_id = clean_string(context.get("accountId"))
    root_id = clean_string(context.get("rootLifeAccountId"))
    if not account_id:
        raise RuntimeError("缺少 accountId，不能上传图片")
    if not root_id:
        raise RuntimeError("缺少 rootLifeAccountId，不能上传图片")
    boundary = f"----LinKeImageUpload{uuid.uuid4().hex}"
    body = multipart_body(
        boundary,
        fields={"cutRatio": "1"},
        files={
            "file": {
                "fileName": file_name,
                "contentType": content_type or "application/octet-stream",
                "content": content,
            }
        },
    )
    headers = session.common_headers()
    headers.update(
        {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Origin": session.base_url,
            "x-secsdk-csrf-token": session.ensure_csrf_token(),
        }
    )
    url = session.url_with_query(
        IMAGE_UPLOAD_PATH,
        {
            "accountId": account_id,
            "root_life_account_id": root_id,
        },
    )
    _, raw = session.open_url("POST", url, headers=headers, data=body)
    response = json.loads(raw.decode("utf-8", errors="replace"))
    ensure_life_partner_ok(response, "image_upload", "图片上传失败")
    results = response.get("result") if isinstance(response, dict) else None
    first = results[0] if isinstance(results, list) and results else {}
    url_list = first.get("url_list") if isinstance(first, dict) else None
    return {
        "uri": clean_string(first.get("uri")) if isinstance(first, dict) else "",
        "url": clean_string(url_list[0]) if isinstance(url_list, list) and url_list else "",
    }


def multipart_body(boundary, fields, files):
    chunks = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, file_info in files.items():
        file_name = clean_string(file_info.get("fileName")) or "image"
        content_type = clean_string(file_info.get("contentType")) or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{escape_multipart_header(file_name)}"\r\n'
                ).encode("utf-8"),
                f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
                file_info.get("content") or b"",
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks)


def escape_multipart_header(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def image_file_name(url, index):
    parsed = parse.urlsplit(url)
    name = Path(parsed.path).name
    if "." not in name:
        return f"image-{index}.jpg"
    return name


def build_stock_info(stock):
    total_stock = 10000000000
    if isinstance(stock, dict):
        parsed = parse_int(stock.get("totalStock"))
        if parsed is not None:
            total_stock = parsed
    return json.dumps(
        {
            "stockQtyLimitType": 2 if total_stock >= 10000000000 else 1,
            "stockNum": total_stock,
            "soldQty": 0,
        },
        ensure_ascii=False,
    )


def build_sale_time(sale_time):
    start = ""
    end = ""
    if isinstance(sale_time, dict):
        start = timestamp_seconds(sale_time.get("startDate"))
        end = timestamp_seconds(sale_time.get("endDate"))
    return json.dumps(
        {
            "soldStartTime": start,
            "soldEndTime": end,
            "autoRenew": False,
        },
        ensure_ascii=False,
    )


def build_use_date(validity, sale_time, context):
    validity_days = parse_int(context.get("validityDays"))
    if validity_days and validity_days > 0:
        return json.dumps({"useDateType": 2, "dayDuration": validity_days}, ensure_ascii=False)

    start = ""
    end = ""
    explicit_end = clean_string(context.get("validityEndDate"))
    if isinstance(validity, dict):
        start = clean_string(validity.get("startDate"))
        end = explicit_end or clean_string(validity.get("endDate"))
    elif explicit_end:
        end = explicit_end
    if not start and isinstance(sale_time, dict):
        start = clean_string(sale_time.get("startDate"))
    if not end and isinstance(sale_time, dict):
        end = clean_string(sale_time.get("endDate"))
    if start or end:
        return json.dumps(
            {
                "useDateType": 1,
                "useStartDate": start or None,
                "useEndDate": end or None,
            },
            ensure_ascii=False,
        )
    return json.dumps({"useDateType": 2, "dayDuration": 30}, ensure_ascii=False)


def product_description_text(product):
    direct = clean_string(product.get("description")) or clean_string(product.get("features"))
    if direct:
        return direct
    notice = product.get("purchaseNotice") if isinstance(product.get("purchaseNotice"), dict) else {}
    return clean_string(notice.get("additionalNotes"))


def build_limit_buy_rule():
    unlimited = {"unit": "份", "isLimit": False, "totalBuyNum": 0}
    return json.dumps(
        {
            "limitRule": unlimited,
            "orderLimitRule": None,
            "limitRuleByDay": unlimited,
            "limitRuleByMonth": unlimited,
        },
        ensure_ascii=False,
    )


def ensure_status_ok(response, default_message):
    if not isinstance(response, dict):
        raise RuntimeError(default_message)
    status = response.get("status_code")
    if status is None:
        return
    if status != 0:
        raise RuntimeError(clean_string(response.get("status_msg")) or default_message)


def summarize_response(response):
    if not isinstance(response, dict):
        return {"type": type(response).__name__}
    return {
        "keys": list(response.keys()),
        "status_code": response.get("status_code"),
        "status_msg": response.get("status_msg"),
    }


def to_cents(value):
    number = parse_number(value)
    if number is None:
        return "0"
    return str(round(number * 100))


def positive_number(value):
    number = parse_number(value)
    return number is not None and number > 0


def timestamp_seconds(value):
    text = clean_string(value)
    if not text:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return str(int(datetime.strptime(text, fmt).timestamp()))
        except ValueError:
            pass
    try:
        return str(int(datetime.fromisoformat(text).timestamp()))
    except ValueError:
        return ""


def parse_date(value):
    text = clean_string(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def parse_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value):
    number = parse_number(value)
    if number is None:
        return None
    return int(number)


def first_string(data, *keys):
    if not isinstance(data, dict):
        return ""
    for key in keys:
        value = clean_string(data.get(key))
        if value:
            return value
    return ""


def normalize_match_text(value):
    return "".join(clean_string(value).lower().split())


def clean_string(value):
    if value is None:
        return ""
    return str(value).strip()


def write_json(data, output):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if output:
        path = Path(output).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


def cookie_label(args):
    if args.cookie_file:
        return Path(args.cookie_file).expanduser().stem or "cookie"
    return "cookie"


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": " ".join(str(exc).split())[:500],
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
