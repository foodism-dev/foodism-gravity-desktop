import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

from fastapi_app.lin_ke.config import BACKEND_DIR
from fastapi_app.lin_ke.lin_ke_service import (
    LinKeServiceError,
    resolve_cookie_file_path,
    save_supply_goods_draft,
)


@dataclass(frozen=True)
class DummySettings:
    database_url: str = ""
    life_partner_timeout: float = 1.0
    life_partner_base_url: str = "https://www.life-partner.cn"
    rb_image_base_url: str = ""


class LinKeServiceTests(unittest.TestCase):
    def test_resolve_cookie_file_path_uses_backend_dir_for_relative_paths(self):
        path = resolve_cookie_file_path(".secrets/lin-ke/cookies/shenzhen_shiyi.cookie.json")

        self.assertEqual(path, (BACKEND_DIR / ".secrets/lin-ke/cookies/shenzhen_shiyi.cookie.json").resolve())

    def test_resolve_cookie_file_path_keeps_absolute_paths_compatible(self):
        path = resolve_cookie_file_path("/tmp/life_partner.cookie.json")

        self.assertEqual(path, Path("/tmp/life_partner.cookie.json"))

    def payload(self):
        return {
            "SupplyGoodsId": "944-test",
            "bdCity": {"text": "合肥市"},
            "mealType": {"text": "普通E"},
            "classification": {"text": "同城优享.烧烤.中式烧烤"},
            "goodsName": "测试商品",
            "price": "1.00",
            "originPrice": "2.00",
            "mainPic": ["https://example.com/a.jpg"],
            "packages": {"viewList": []},
        }

    def test_save_draft_recomputes_mapping_and_updates_record_each_call(self):
        mappings = [
            {
                "productType": 1,
                "productTypeName": "团购套餐",
                "categoryId": "1004001",
                "thirdCategoryId": "1004001",
                "categoryName": "烧烤",
                "categoryPath": "美食 > 烧烤 > 烧烤",
                "mealTypeText": "普通E",
                "classificationKey": "同城优享 / 烧烤 / 中式烧烤",
            },
            {
                "productType": 11,
                "productTypeName": "代金券",
                "categoryId": "1003002",
                "thirdCategoryId": "1003002",
                "categoryName": "川渝火锅",
                "categoryPath": "美食 > 火锅 > 川渝火锅",
                "mealTypeText": "代金券C",
                "classificationKey": "同城优享 / 火锅 / 川味/重庆火锅",
            },
        ]

        def fail_session(settings, account_config):
            raise LinKeServiceError({"ok": False, "stage": "cookie", "reason": "blocked"})

        with patch("fastapi_app.lin_ke.lin_ke_service.db.fetch_rebuild_field_option_labels", return_value={}), patch(
            "fastapi_app.lin_ke.lin_ke_service.resolve_lin_ke_mapping", side_effect=mappings
        ), patch("fastapi_app.lin_ke.lin_ke_service.db.update_supply_goods_lin_ke_mapping", return_value=True) as update_mapping, patch(
            "fastapi_app.lin_ke.lin_ke_service.make_session", side_effect=fail_session
        ):
            for _ in range(2):
                with self.assertRaises(LinKeServiceError):
                    save_supply_goods_draft(
                        DummySettings(),
                        self.payload(),
                        {"cookie_file_path": "/tmp/cookie.json"},
                        supply_goods_id="944-test",
                    )

        self.assertEqual(update_mapping.call_count, 2)
        self.assertEqual(update_mapping.call_args_list[0].args[1], "944-test")
        self.assertEqual(update_mapping.call_args_list[0].args[2]["categoryId"], "1004001")
        self.assertEqual(update_mapping.call_args_list[1].args[2]["productType"], 11)

    def test_save_draft_maps_rebuild_option_ids_before_lin_ke_mapping(self):
        payload = self.payload()
        payload["mealType"] = {
            "text": "012-0184a87067a64664",
            "value": "012-0184a87067a64664",
        }
        payload["classification"] = {
            "text": "019-017d6b4bb3cd5e39",
            "value": "019-017d6b4bb3cd5e39",
        }

        def fail_session(settings, account_config):
            raise LinKeServiceError({"ok": False, "stage": "cookie", "reason": "blocked"})

        with patch(
            "fastapi_app.lin_ke.lin_ke_service.db.fetch_rebuild_field_option_labels",
            return_value={
                "mealType": "主套餐A",
                "classification": "同城优享 / 中式餐饮",
            },
        ) as fetch_labels, patch(
            "fastapi_app.lin_ke.lin_ke_service.db.update_supply_goods_lin_ke_mapping", return_value=True
        ) as update_mapping, patch(
            "fastapi_app.lin_ke.lin_ke_service.make_session", side_effect=fail_session
        ):
            with self.assertRaises(LinKeServiceError):
                save_supply_goods_draft(
                    DummySettings(),
                    payload,
                    {"cookie_file_path": "/tmp/cookie.json"},
                    supply_goods_id="944-test",
                )

        fetch_labels.assert_called_once_with(
            DummySettings(),
            "SupplyGoods",
            {
                "mealType": "012-0184a87067a64664",
                "classification": "019-017d6b4bb3cd5e39",
            },
        )
        mapping = update_mapping.call_args.args[2]
        self.assertEqual(mapping["productType"], 1)
        self.assertEqual(mapping["productTypeName"], "团购套餐")
        self.assertEqual(mapping["categoryId"], "1001015")
        self.assertEqual(mapping["categoryPath"], "美食 > 地方菜 > 其他地方菜")
        self.assertEqual(payload["mealType"]["text"], "012-0184a87067a64664")
        self.assertEqual(payload["classification"]["text"], "019-017d6b4bb3cd5e39")


if __name__ == "__main__":
    unittest.main()
