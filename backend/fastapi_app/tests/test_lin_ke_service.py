import unittest
from dataclasses import dataclass
from unittest.mock import patch

from fastapi_app.lin_ke.lin_ke_service import LinKeServiceError, save_supply_goods_draft


@dataclass(frozen=True)
class DummySettings:
    database_url: str = ""
    life_partner_timeout: float = 1.0
    life_partner_base_url: str = "https://www.life-partner.cn"
    rb_image_base_url: str = ""


class LinKeServiceTests(unittest.TestCase):
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

        with patch("fastapi_app.lin_ke.lin_ke_service.resolve_lin_ke_mapping", side_effect=mappings), patch(
            "fastapi_app.lin_ke.lin_ke_service.db.update_supply_goods_lin_ke_mapping", return_value=True
        ) as update_mapping, patch("fastapi_app.lin_ke.lin_ke_service.make_session", side_effect=fail_session):
            for _ in range(2):
                with self.assertRaises(LinKeServiceError):
                    save_supply_goods_draft(DummySettings(), self.payload(), {"cookie_file_path": "/tmp/cookie.json"})

        self.assertEqual(update_mapping.call_count, 2)
        self.assertEqual(update_mapping.call_args_list[0].args[2]["categoryId"], "1004001")
        self.assertEqual(update_mapping.call_args_list[1].args[2]["productType"], 11)


if __name__ == "__main__":
    unittest.main()
