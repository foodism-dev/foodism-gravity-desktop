import asyncio
import json
from typing import Any, Dict, List, Tuple

from openai import OpenAI

from .config import Settings
from .supply_goods import apply_menu_optimization, extract_menu_for_optimization


SYSTEM_PROMPT = """你是餐饮团购套餐命名助手。只优化套餐组名和菜品名，让名称更清晰、自然、适合上品展示。
禁止改价格、数量、ID、套餐结构、选择规则。禁止新增或删除菜品。
输出严格 JSON：{"groups":[{"index":0,"groupName":"...","items":[{"index":0,"title":"..."}]}]}。"""


def build_user_prompt(payload: Dict[str, Any], menu: List[Dict[str, Any]]) -> str:
    compact = {
        "goodsName": payload.get("goodsName"),
        "hostName": payload.get("hostName") or payload.get("hostNameInput"),
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

