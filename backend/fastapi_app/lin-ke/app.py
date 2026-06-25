import asyncio
import json
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from . import db
from .config import get_settings
from .lin_ke_service import LinKeServiceError, check_cookie, save_supply_goods_draft
from .models import (
    LinKeAccountConfigIn,
    LinKeAccountConfigPatch,
    LinKeDraftRequest,
    OptimizeStreamItem,
    OptimizeStreamRequest,
)
from .optimizer import optimize_payload_with_retries
from .supply_goods import bd_city_text


app = FastAPI(title="Foodism Gravity FastAPI Services")


def serialize_account_config(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "bdCityTexts": row.get("bd_city_texts") or [],
        "cookieFilePath": row.get("cookie_file_path"),
        "groupId": row.get("group_id"),
        "rootLifeAccountId": row.get("root_life_account_id"),
        "accountId": row.get("account_id"),
        "active": row.get("active"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def dump_model(model: Any, by_alias: bool = False) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(by_alias=by_alias)
    return model.dict(by_alias=by_alias)


@app.get("/health")
def health():
    return {"ok": True, "service": "fastapi"}


@app.post("/api/supply-goods/optimize-stream")
async def optimize_stream(request: OptimizeStreamRequest):
    settings = get_settings()
    supply_goods_ids = [
        supply_goods_id.strip()
        for supply_goods_id in request.supply_goods_ids
        if supply_goods_id.strip()
    ]
    if len(supply_goods_ids) > settings.optimize_max_batch_size:
        raise HTTPException(
            status_code=400,
            detail=f"supplyGoodsIds must contain at most {settings.optimize_max_batch_size} items",
        )
    payloads = await asyncio.to_thread(db.fetch_supply_goods_payloads, settings, supply_goods_ids)
    semaphore = asyncio.Semaphore(max(settings.optimize_concurrency, 1))

    async def process(index: int, supply_goods_id: str) -> Dict[str, Any]:
        payload = payloads.get(supply_goods_id)
        if payload is None:
            return dump_model(
                OptimizeStreamItem(
                    index=index,
                    supply_goods_id=supply_goods_id,
                    ok=False,
                    fallback=True,
                    payload=None,
                    error="supply_goods_not_found",
                    changes=[],
                ),
                by_alias=True,
            )
        async with semaphore:
            optimized, changes, fallback, error = await optimize_payload_with_retries(settings, payload)
        return dump_model(
            OptimizeStreamItem(
                index=index,
                supply_goods_id=supply_goods_id,
                ok=True,
                fallback=fallback,
                payload=optimized,
                error=error or None,
                changes=changes,
            ),
            by_alias=True,
        )

    async def generate():
        tasks = [
            asyncio.create_task(process(index, supply_goods_id))
            for index, supply_goods_id in enumerate(supply_goods_ids)
        ]
        for task in asyncio.as_completed(tasks):
            item = await task
            yield json.dumps(item, ensure_ascii=False) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/api/lin-ke/account-configs")
def list_lin_ke_account_configs():
    return [serialize_account_config(row) for row in db.list_account_configs(get_settings())]


@app.post("/api/lin-ke/account-configs")
def create_lin_ke_account_config(request: LinKeAccountConfigIn):
    try:
        return serialize_account_config(db.create_account_config(get_settings(), db.snake_dict(request)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=" ".join(str(exc).split())[:300]) from exc


@app.patch("/api/lin-ke/account-configs/{config_id}")
def update_lin_ke_account_config(config_id: int, request: LinKeAccountConfigPatch):
    try:
        row = db.update_account_config(get_settings(), config_id, db.snake_dict(request))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=" ".join(str(exc).split())[:300]) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="account_config_not_found")
    return serialize_account_config(row)


@app.delete("/api/lin-ke/account-configs/{config_id}")
def delete_lin_ke_account_config(config_id: int):
    if not db.delete_account_config(get_settings(), config_id):
        raise HTTPException(status_code=404, detail="account_config_not_found")
    return {"ok": True}


@app.post("/api/lin-ke/account-configs/{config_id}/check-cookie")
def check_lin_ke_cookie(config_id: int):
    account_config = db.get_account_config(get_settings(), config_id)
    if account_config is None:
        raise HTTPException(status_code=404, detail="account_config_not_found")
    return check_cookie(get_settings(), account_config)


@app.post("/api/lin-ke/drafts")
def create_lin_ke_draft(request: LinKeDraftRequest):
    settings = get_settings()
    city_text = bd_city_text(request.payload)
    if not city_text:
        raise HTTPException(status_code=400, detail="payload.bdCity.text is required")
    account_config = db.find_account_config_by_city(settings, city_text)
    if account_config is None:
        raise HTTPException(status_code=400, detail=f"lin_ke_account_config_not_found_for_city:{city_text}")
    try:
        return save_supply_goods_draft(
            settings,
            request.payload,
            account_config,
            supply_goods_id=request.supply_goods_id,
            poi_id=request.poi_id,
        )
    except LinKeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.payload) from exc
