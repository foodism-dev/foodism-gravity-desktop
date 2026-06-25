import json
import unittest

from fastapi_app.lin_ke.lin_ke_service import build_workbench_draft_url
from fastapi_app.lin_ke.supply_goods import (
    apply_menu_optimization,
    extract_menu_for_optimization,
    normalize_supply_goods_for_lin_ke,
)


class SupplyGoodsTests(unittest.TestCase):
    def sample_payload(self):
        return {
            "SupplyGoodsId": "944-test",
            "bdCity": {"text": "合肥市"},
            "hostName": "李小二",
            "goodsName": "[李小二]3-4人餐",
            "price": "78.00",
            "originPrice": "259.00",
            "signAmount": "5,000",
            "eatPersonNum": "3",
            "maxEatPersonNum": "4",
            "mainPic": ["https://example.com/main.jpg"],
            "detailImages": ["rb/20260624/detail.jpg"],
            "packages": json.dumps(
                {
                    "viewList": [
                        {
                            "groupName": "主菜",
                            "groupSelectNum": "1",
                            "groupId": 0,
                            "groupPrice": "88.00",
                            "list": [{"price": "88.00", "num": "1", "id": 0, "title": "蟹"}],
                        }
                    ],
                    "totalPrice": "88.00",
                },
                ensure_ascii=False,
            ),
        }

    def test_apply_menu_optimization_only_changes_allowed_names(self):
        payload = self.sample_payload()
        optimized, changes = apply_menu_optimization(
            payload,
            {"groups": [{"index": 0, "groupName": "招牌主菜", "items": [{"index": 0, "title": "鲜活大闸蟹"}]}]},
        )

        self.assertIsInstance(optimized["packages"], str)
        packages = json.loads(optimized["packages"])
        self.assertEqual(packages["viewList"][0]["groupName"], "招牌主菜")
        self.assertEqual(packages["viewList"][0]["list"][0]["title"], "鲜活大闸蟹")
        self.assertEqual(packages["viewList"][0]["list"][0]["price"], "88.00")
        self.assertEqual(len(changes), 2)

    def test_extract_menu_for_optimization(self):
        menu = extract_menu_for_optimization(self.sample_payload())
        self.assertEqual(menu[0]["index"], 0)
        self.assertEqual(menu[0]["items"][0]["title"], "蟹")

    def test_normalize_supply_goods_for_lin_ke_uses_mapping_category(self):
        product = normalize_supply_goods_for_lin_ke(
            self.sample_payload(),
            {
                "categoryId": "1004001",
                "thirdCategoryId": "1004001",
                "categoryName": "烧烤",
                "categoryPath": "美食 > 烧烤 > 烧烤",
                "productType": 1,
                "mealTypeText": "普通E",
                "classificationKey": "同城优享 / 烧烤 / 中式烧烤",
            },
            rb_image_base_url="https://assets.example/",
        )
        self.assertEqual(product["category"]["id"], "1004001")
        self.assertEqual(product["category"]["name"], "烧烤")
        self.assertEqual(product["productType"], 1)
        self.assertEqual(product["fieldSources"]["linKeCategory"], "同城优享 / 烧烤 / 中式烧烤")
        self.assertEqual(product["itemGroups"][0]["items"][0]["name"], "蟹")
        self.assertEqual(product["detailImages"][0]["url"], "https://assets.example/rb/20260624/detail.jpg")

    def test_build_workbench_draft_url(self):
        url = build_workbench_draft_url(
            {"group_id": "1868051999515656"},
            {
                "productType": 11,
                "thirdCategoryId": "1003002",
                "merchant": {"merchantId": "7651539009109526564", "skuOrderId": "7654505757261776948"},
            },
            "1868864068281379",
        )
        self.assertIn("/op-merchant/workbench/subapp/goods-list/form-type?", url)
        self.assertIn("product_draft_cache_id=1868864068281379", url)
        self.assertIn("merchantId=7651539009109526564", url)
        self.assertIn("sku_order_id=7654505757261776948", url)
        self.assertIn("product_type=11", url)
        self.assertIn("third_category_id=1003002", url)


if __name__ == "__main__":
    unittest.main()
