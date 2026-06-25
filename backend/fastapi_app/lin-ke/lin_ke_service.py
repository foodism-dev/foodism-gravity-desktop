import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional
from urllib.parse import urlencode

from . import db
from . import lin_ke_draft_core as draft
from .config import Settings
from .lin_ke_auth import LifePartnerSession, concise_error, load_cookie_file
from .lin_ke_mapping import ProductMappingError, resolve_lin_ke_mapping
from .supply_goods import bd_city_text, normalize_supply_goods_for_lin_ke


class LinKeServiceError(Exception):
    def __init__(self, payload: Dict[str, Any], status_code: int = 400):
        super().__init__(payload.get("reason") or payload.get("error") or "lin_ke_service_error")
        self.payload = payload
        self.status_code = status_code


def make_args(
    settings: Settings,
    account_config: Dict[str, Any],
    lin_ke_mapping: Dict[str, Any],
    poi_id: str = "",
):
    return SimpleNamespace(
        cookie_file=account_config.get("cookie_file_path") or "",
        cookie="",
        providers_file="",
        provider="",
        product_json="",
        root_life_account_id="",
        account_id="",
        merchant_name="",
        category_id=lin_ke_mapping.get("categoryId") or "",
        product_type=int(lin_ke_mapping.get("productType") or 0),
        settle_type="1",
        poi_set_id="",
        poi_id=poi_id or "",
        draft_cache_id="",
        rec_person_num=0,
        rec_person_num_max=0,
        validity_days=0,
        validity_end_date="",
        base_url=settings.life_partner_base_url,
        referer=draft.REFERER,
        timeout=settings.life_partner_timeout,
        dry_run_payload=False,
        dry_run_poi=False,
        check_cookie=False,
        output="",
    )


def make_session(settings: Settings, account_config: Dict[str, Any]) -> LifePartnerSession:
    cookie_path = Path(account_config.get("cookie_file_path") or "").expanduser()
    cookie = load_cookie_file(cookie_path)
    if not cookie:
        raise LinKeServiceError(
            {"ok": False, "stage": "cookie", "reason": "empty_cookie", "cookieFilePath": str(cookie_path)},
            status_code=400,
        )
    return LifePartnerSession(
        cookie=cookie,
        timeout=settings.life_partner_timeout,
        base_url=settings.life_partner_base_url,
        referer=draft.REFERER,
    )


def check_cookie(settings: Settings, account_config: Dict[str, Any]) -> Dict[str, Any]:
    session = make_session(settings, account_config)
    try:
        session.ensure_csrf_token()
    except RuntimeError as exc:
        return {"ok": False, "cookieValid": False, "error": concise_error(exc)}
    return {"ok": True, "cookieValid": True, "check": "secsdk_csrf_token"}


def save_supply_goods_draft(
    settings: Settings,
    payload: Dict[str, Any],
    account_config: Dict[str, Any],
    record_id: Optional[str] = None,
    poi_id: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        lin_ke_mapping = resolve_lin_ke_mapping(payload)
    except ProductMappingError as exc:
        raise LinKeServiceError(exc.payload, status_code=400) from exc

    mapping_record_id = (
        record_id
        or draft.clean_string(payload.get("SupplyGoodsId"))
        or draft.clean_string(payload.get("goodsId"))
    )
    if mapping_record_id:
        db.update_supply_goods_lin_ke_mapping(settings, mapping_record_id, lin_ke_mapping)

    session = make_session(settings, account_config)
    try:
        session.ensure_csrf_token()
    except RuntimeError as exc:
        raise LinKeServiceError(
            {"ok": False, "stage": "cookie", "reason": "csrf_failed", "error": concise_error(exc)},
            status_code=400,
        ) from exc

    product = normalize_supply_goods_for_lin_ke(payload, lin_ke_mapping, settings.rb_image_base_url)
    args = make_args(settings, account_config, lin_ke_mapping, poi_id or "")
    context = draft.resolve_context(product, args)
    context["rootLifeAccountId"] = account_config.get("root_life_account_id") or context.get("rootLifeAccountId")
    context["accountId"] = account_config.get("account_id") or context.get("accountId")
    context["thirdCategoryId"] = lin_ke_mapping.get("thirdCategoryId") or context.get("categoryId")

    try:
        context = resolve_merchant_context(session, product, context)
        if not context.get("draftCacheId"):
            context["draftCacheId"] = create_initial_draft_cache(session, context)
        questions = draft.collect_required_questions(product, context)
        if questions:
            raise LinKeServiceError(
                {
                    "ok": False,
                    "stage": "required_input",
                    "reason": "missing_required_fields",
                    "questions": questions,
                    "missingFields": product.get("missingFields", []),
                },
                status_code=400,
            )
        poi_selection = draft.resolve_poi_selection(session, context)
        context.update(
            {
                "poiSetId": poi_selection.get("poiSetId", context.get("poiSetId", "")),
                "poiId": poi_selection.get("poiId", context.get("poiId", "")),
                "poiName": poi_selection.get("poiName", context.get("poiName", "")),
            }
        )
        draft.prepare_payload_context(session, product, context)
        save_payload = draft.build_save_payload(product, context)
        save_payload["product_detail"]["product"]["extra_map"]["poi_set_id"] = context.get("poiSetId", "")
        result = draft.save_draft(session, save_payload, context)
        draft.ensure_life_partner_ok(result, "save_draft", "保存草稿失败")
    except LinKeServiceError:
        raise
    except draft.DraftWorkflowError as exc:
        raise LinKeServiceError(exc.payload, status_code=400) from exc
    except draft.MerchantResolutionError as exc:
        raise LinKeServiceError(exc.payload, status_code=400) from exc
    except RuntimeError as exc:
        raise LinKeServiceError(
            {"ok": False, "stage": "lin_ke_request", "reason": "request_failed", "error": concise_error(exc)},
            status_code=502,
        ) from exc

    cache_id = draft.clean_string(result.get("cache_id")) if isinstance(result, dict) else ""
    if not cache_id:
        raise LinKeServiceError(
            {
                "ok": False,
                "stage": "save_draft",
                "reason": "missing_cache_id",
                "response": draft.summarize_response(result),
            },
            status_code=502,
        )

    return {
        "ok": True,
        "bdCityText": bd_city_text(payload),
        "cacheId": cache_id,
        "draftUrl": build_workbench_draft_url(account_config, context, cache_id),
        "productType": lin_ke_mapping.get("productType"),
        "categoryId": lin_ke_mapping.get("categoryId"),
        "thirdCategoryId": lin_ke_mapping.get("thirdCategoryId"),
        "categoryPath": lin_ke_mapping.get("categoryPath"),
        "merchant": context.get("merchant", {}),
        "poiSetId": context.get("poiSetId", ""),
        "poiId": context.get("poiId", ""),
        "poiName": context.get("poiName", ""),
        "accountConfig": {
            "id": account_config.get("id"),
            "name": account_config.get("name"),
            "bdCityTexts": account_config.get("bd_city_texts") or [],
        },
        "statusMsg": result.get("status_msg") if isinstance(result, dict) else "",
    }


def resolve_merchant_context(session: LifePartnerSession, product: Dict[str, Any], context: Dict[str, Any]):
    merchant_name = context.get("merchantName")
    if not merchant_name:
        raise draft.MerchantResolutionError(
            {
                "ok": False,
                "stage": "merchant_resolution",
                "merchantName": "",
                "reason": "missing_merchant_name",
                "candidates": [],
            }
        )
    selected, match_type, reason, candidates, search_errors = draft.resolve_merchant_candidate(
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
        raise draft.MerchantResolutionError(payload)

    root_id = context.get("rootLifeAccountId") or selected.get("rootLifeAccountId")
    account_id = context.get("accountId") or selected.get("accountId")
    if not root_id:
        raise draft.MerchantResolutionError(
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


def create_initial_draft_cache(session: LifePartnerSession, context: Dict[str, Any]) -> str:
    payload = {
        "product_detail": {
            "product": {
                "category_id": draft.parse_int(context["categoryId"]),
                "product_type": context["productType"],
                "template_sub_type": 0,
                "comp_key_value_map": {},
                "extra_map": {},
            }
        },
        "save_product_draft_cache_type": 4,
        "product_cache_scene": 1,
        "version_info": {"Enable": True, "VersionName": "1.0.14"},
        "permission_common_param": {"all_selected_params": draft.DEFAULT_PERMISSION_PARAMS},
    }
    result = session.post_json(
        draft.SAVE_DRAFT_PATH,
        payload,
        query={"root_life_account_id": context["rootLifeAccountId"]},
    )
    draft.ensure_life_partner_ok(result, "create_draft_cache", "创建草稿缓存失败")
    cache_id = draft.clean_string(result.get("cache_id")) if isinstance(result, dict) else ""
    if not cache_id:
        raise LinKeServiceError(
            {
                "ok": False,
                "stage": "create_draft_cache",
                "reason": "missing_cache_id",
                "response": draft.summarize_response(result),
            },
            status_code=502,
        )
    return cache_id


def build_workbench_draft_url(account_config: Dict[str, Any], context: Dict[str, Any], cache_id: str) -> str:
    merchant = context.get("merchant") if isinstance(context.get("merchant"), dict) else {}
    query = {
        "enter_from": "spu_list_page",
        "enter_method": "goods_list",
        "filter_status": "7",
        "goods_list_grey_tag": "mig",
        "groupid": account_config.get("group_id") or context.get("accountId") or context.get("rootLifeAccountId") or "",
        "industry": "tobias",
        "isDraft": "1",
        "isModifyMode": "1",
        "is_internal_route": "1",
        "menu_key": "product_manager",
        "merchantId": merchant.get("merchantId") or context.get("merchantId") or "",
        "merchant_page_tab": "WORKBENCH",
        "modifyFrom": "list",
        "product_draft_cache_id": cache_id,
        "product_id": "",
        "product_type": str(context.get("productType") or ""),
        "sku_order_id": merchant.get("skuOrderId") or context.get("skuOrderId") or "",
        "third_category_id": context.get("thirdCategoryId") or context.get("categoryId") or "",
        "from_page": "merchant_operation_detail_workbench",
    }
    return "https://www.life-partner.cn/op-merchant/workbench/subapp/goods-list/form-type?" + urlencode(query)


def dumps_response(data: Dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)
