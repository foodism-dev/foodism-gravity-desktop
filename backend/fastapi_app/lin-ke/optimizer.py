import asyncio
import json
from typing import Any, Dict, List, Tuple

from openai import OpenAI

from .config import Settings
from .supply_goods import apply_menu_optimization, entity_text, extract_menu_for_optimization


SYSTEM_PROMPT = """你是餐饮团购套餐命名审核与优化助手。你的任务是判断套餐组名和菜品名称/条目描述是否需要优化，而不是强制改写。
只允许优化 packages.viewList[].groupName 和 packages.viewList[].list[].title，让名称更清晰、自然、贴合餐厅风格、商品主题、品类和原始套餐语境，适合上品展示。
原文已经清晰、自然、符合门店调性时必须保持原文，不要为了显得更高级或更营销而机械改写。
可以优化表达不清、过长、口语过重、符号噪音、语病、歧义、堆砌营销或不适合商品展示的名称。
禁止虚构食材、规格、权益、口味、城市特色、门店信息；禁止使用与门店无关的空泛广告词替换。
禁止改价格、数量、ID、套餐结构、选择规则。禁止新增或删除菜品。
输出严格 JSON：{"groups":[{"index":0,"groupName":"...","items":[{"index":0,"title":"..."}]}]}。"""


def build_user_prompt(payload: Dict[str, Any], menu: List[Dict[str, Any]]) -> str:
    compact = {
        "goodsName": payload.get("goodsName"),
        "hostName": payload.get("hostName") or payload.get("hostNameInput"),
        "classification": entity_text(payload.get("classification") or payload.get("classification.text")),
        "mealType": entity_text(payload.get("mealType") or payload.get("mealType.text")),
        "bdCity": entity_text(payload.get("bdCity") or payload.get("bdCity.text")),
        "groups": menu,
    }
    return json.dumps(compact, ensure_ascii=False)


def call_model(settings: Settings, payload: Dict[str, Any], menu: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    client_kwargs: Dict[str, Any] = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        client_kwargs["base_url"] = settings.openai_base_url
    client = OpenAI(**client_kwargs)
    response = client.chat.completions.create(
        model=settings.optimize_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(payload, menu)},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise RuntimeError("model returned non-object JSON")
    return parsed


async def optimize_payload(settings: Settings, payload: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    menu = extract_menu_for_optimization(payload)
    if not menu:
        return payload, []
    optimized = await asyncio.to_thread(call_model, settings, payload, menu)
    return apply_menu_optimization(payload, optimized)


async def optimize_payload_with_retries(
    settings: Settings, payload: Dict[str, Any]
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], bool, str]:
    last_error = ""
    for _ in range(max(settings.optimize_retries, 1)):
        try:
            optimized_payload, changes = await optimize_payload(settings, payload)
            return optimized_payload, changes, False, ""
        except Exception as exc:
            last_error = " ".join(str(exc).split())[:300]
    return payload, [], True, last_error
