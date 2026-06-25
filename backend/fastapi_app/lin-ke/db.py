from typing import Any, Dict, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import Settings


ACCOUNT_COLUMNS = (
    "id",
    "name",
    "bd_city_texts",
    "cookie_file_path",
    "group_id",
    "root_life_account_id",
    "account_id",
    "active",
    "created_at",
    "updated_at",
)


def connect(settings: Settings):
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def fetch_supply_goods_records(settings: Settings, record_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not record_ids:
        return {}
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT supply_goods_id, payload
                FROM rebuild_supply_goods
                WHERE supply_goods_id = ANY(%s)
                """,
                (record_ids,),
            )
            rows = cur.fetchall()
    return {str(row["supply_goods_id"]): row["payload"] for row in rows}


def list_account_configs(settings: Settings) -> List[Dict[str, Any]]:
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {", ".join(ACCOUNT_COLUMNS)}
                FROM lin_ke_account_configs
                ORDER BY name ASC, id ASC
                """
            )
            return cur.fetchall()


def get_account_config(settings: Settings, config_id: int) -> Optional[Dict[str, Any]]:
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {', '.join(ACCOUNT_COLUMNS)} FROM lin_ke_account_configs WHERE id = %s",
                (config_id,),
            )
            return cur.fetchone()


def find_account_config_by_city(settings: Settings, bd_city_text: str) -> Optional[Dict[str, Any]]:
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {", ".join(ACCOUNT_COLUMNS)}
                FROM lin_ke_account_configs
                WHERE bd_city_texts @> %s::jsonb AND active = true
                ORDER BY id ASC
                LIMIT 1
                """,
                (Jsonb([bd_city_text]),),
            )
            return cur.fetchone()


def create_account_config(settings: Settings, data: Dict[str, Any]) -> Dict[str, Any]:
    fields = [
        "name",
        "bd_city_texts",
        "cookie_file_path",
        "group_id",
        "root_life_account_id",
        "account_id",
        "active",
    ]
    values = [jsonb_value(field, data.get(field)) for field in fields]
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO lin_ke_account_configs ({", ".join(fields)})
                VALUES ({", ".join(["%s"] * len(fields))})
                RETURNING {", ".join(ACCOUNT_COLUMNS)}
                """,
                values,
            )
            return cur.fetchone()


def update_account_config(settings: Settings, config_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    allowed = {
        "name",
        "bd_city_texts",
        "cookie_file_path",
        "group_id",
        "root_life_account_id",
        "account_id",
        "active",
    }
    updates = {key: value for key, value in data.items() if key in allowed and value is not None}
    if not updates:
        return get_account_config(settings, config_id)
    assignments = [f"{key} = %s" for key in updates]
    values: List[Any] = [jsonb_value(key, value) for key, value in updates.items()] + [config_id]
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE lin_ke_account_configs
                SET {", ".join(assignments)}, updated_at = now()
                WHERE id = %s
                RETURNING {", ".join(ACCOUNT_COLUMNS)}
                """,
                values,
            )
            return cur.fetchone()


def update_supply_goods_lin_ke_mapping(settings: Settings, record_id: str, mapping: Dict[str, Any]) -> bool:
    if not record_id:
        return False
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE rebuild_supply_goods
                SET lin_ke_product_type = %s,
                    lin_ke_category_id = %s,
                    lin_ke_third_category_id = %s,
                    lin_ke_category_name = %s,
                    lin_ke_category_path = %s,
                    updated_at = now()
                WHERE supply_goods_id = %s
                """,
                (
                    mapping.get("productType"),
                    mapping.get("categoryId"),
                    mapping.get("thirdCategoryId"),
                    mapping.get("categoryName"),
                    mapping.get("categoryPath"),
                    record_id,
                ),
            )
            return cur.rowcount > 0


def delete_account_config(settings: Settings, config_id: int) -> bool:
    with connect(settings) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM lin_ke_account_configs WHERE id = %s", (config_id,))
            return cur.rowcount > 0


def snake_dict(data: Any) -> Dict[str, Any]:
    if hasattr(data, "model_dump"):
        return data.model_dump(by_alias=False, exclude_unset=True)
    if hasattr(data, "dict"):
        return data.dict(by_alias=False, exclude_unset=True)
    return dict(data)


def jsonb_value(field: str, value: Any) -> Any:
    if field == "bd_city_texts":
        return Jsonb(value or [])
    return value
