import json
import tempfile
import unittest
from pathlib import Path

from fastapi_app.lin_ke.lin_ke_mapping import (
    ProductMappingError,
    load_mapping_file,
    normalize_classification_label,
    resolve_lin_ke_mapping,
)


class LinKeMappingTests(unittest.TestCase):
    def payload(self, meal_type="普通E", classification="同城优享.烧烤.中式烧烤"):
        return {
            "mealType": {"text": meal_type},
            "classification": {"text": classification},
        }

    def test_mapping_file_loads_and_validates(self):
        data = load_mapping_file()
        self.assertIn("mealTypes", data)
        self.assertIn("classifications", data)
        self.assertIn("excludedClassifications", data)

    def test_mapping_file_reports_missing_classification_field(self):
        data = {
            "mealTypes": {"普通E": {"productType": 1, "name": "团购套餐"}},
            "classifications": {
                "同城优享 / 烧烤 / 中式烧烤": {
                    "categoryId": "1004001",
                    "thirdCategoryId": "1004001",
                    "categoryName": "烧烤",
                }
            },
            "excludedClassifications": [],
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
            json.dump(data, handle, ensure_ascii=False)
            path = Path(handle.name)
        try:
            with self.assertRaises(ProductMappingError) as caught:
                load_mapping_file(path)
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(caught.exception.payload["reason"], "mapping_file_missing_classification_field")
        self.assertEqual(caught.exception.payload["missingFields"], ["categoryPath"])

    def test_meal_type_values_map_to_product_type(self):
        expected = {
            "普通E": 1,
            "主套餐A": 1,
            "常规B": 1,
            "代金券C": 11,
            "大单品D": 1,
            "暖冬专享": 1,
        }
        for meal_type, product_type in expected.items():
            with self.subTest(meal_type=meal_type):
                mapping = resolve_lin_ke_mapping(self.payload(meal_type=meal_type))
                self.assertEqual(mapping["productType"], product_type)

    def test_dot_and_slash_classification_normalize_to_same_key(self):
        dot = normalize_classification_label("同城优享.火锅.川味/重庆火锅")
        slash = normalize_classification_label("同城优享 / 火锅 / 川味/重庆火锅")
        self.assertEqual(dot, slash)
        mapping = resolve_lin_ke_mapping(self.payload(classification="同城优享.火锅.川味/重庆火锅"))
        self.assertEqual(mapping["categoryId"], "1003002")
        self.assertEqual(mapping["categoryPath"], "美食 > 火锅 > 川渝火锅")

    def test_full_classification_key_returns_leaf_category(self):
        mapping = resolve_lin_ke_mapping(self.payload(classification="同城优享 / 快餐小吃 / 米粉米线"))
        self.assertEqual(mapping["categoryId"], "1017008")
        self.assertEqual(mapping["thirdCategoryId"], "1017008")
        self.assertEqual(mapping["categoryPath"], "美食 > 快餐小吃 > 米粉米线")

    def test_parent_category_maps_only_when_explicitly_configured(self):
        mapping = resolve_lin_ke_mapping(self.payload(classification="同城优享.火锅"))
        self.assertEqual(mapping["categoryId"], "1003001")
        self.assertEqual(mapping["categoryPath"], "美食 > 火锅 > 其他火锅")

    def test_excluded_classification_returns_product_mapping_required(self):
        with self.assertRaises(ProductMappingError) as caught:
            resolve_lin_ke_mapping(self.payload(classification="同城优享.医疗健康.口腔"))
        self.assertEqual(caught.exception.payload["stage"], "product_mapping_required")
        self.assertEqual(caught.exception.payload["reason"], "excluded_classification")


if __name__ == "__main__":
    unittest.main()
