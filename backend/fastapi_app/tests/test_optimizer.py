import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi_app.lin_ke.config import Settings
from fastapi_app.lin_ke.optimizer import SYSTEM_PROMPT, build_user_prompt, optimize_payload_with_retries


class OptimizerTests(unittest.TestCase):
    def sample_payload(self):
        return {
            "goodsName": "[测试门店]双人餐",
            "hostName": "测试门店",
            "classification": {"text": "同城优享.烧烤.中式烧烤"},
            "mealType": {"text": "普通E"},
            "bdCity": {"text": "合肥市"},
            "packages": json.dumps(
                {
                    "viewList": [
                        {
                            "groupName": "主菜",
                            "groupSelectNum": "1",
                            "groupId": 0,
                            "list": [{"title": "蟹", "price": "88.00", "num": "1", "id": 0}],
                        }
                    ]
                },
                ensure_ascii=False,
            )
        }

    def test_prompt_contains_generic_style_and_keep_original_constraints(self):
        self.assertIn("判断", SYSTEM_PROMPT)
        self.assertIn("原文已经清晰", SYSTEM_PROMPT)
        self.assertIn("贴合餐厅风格", SYSTEM_PROMPT)
        self.assertIn("不适合商品展示", SYSTEM_PROMPT)
        self.assertIn("禁止虚构", SYSTEM_PROMPT)
        self.assertIn("禁止改价格、数量、ID、套餐结构、选择规则", SYSTEM_PROMPT)
        self.assertNotIn("944-019ef3af6a193c51", SYSTEM_PROMPT)
        self.assertNotIn("周财富", SYSTEM_PROMPT)
        self.assertNotIn("乳山生蚝", SYSTEM_PROMPT)

    def test_user_prompt_includes_context_fields(self):
        parsed = json.loads(build_user_prompt(self.sample_payload(), []))

        self.assertEqual(parsed["goodsName"], "[测试门店]双人餐")
        self.assertEqual(parsed["hostName"], "测试门店")
        self.assertEqual(parsed["classification"], "同城优享.烧烤.中式烧烤")
        self.assertEqual(parsed["mealType"], "普通E")
        self.assertEqual(parsed["bdCity"], "合肥市")

    def test_success_applies_model_names(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        with patch(
            "fastapi_app.lin_ke.optimizer.call_model",
            return_value={"groups": [{"index": 0, "groupName": "招牌主菜", "items": [{"index": 0, "title": "鲜活蟹"}]}]},
        ):
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, self.sample_payload()))
        packages = json.loads(payload["packages"])
        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(packages["viewList"][0]["groupName"], "招牌主菜")
        self.assertEqual(packages["viewList"][0]["list"][0]["title"], "鲜活蟹")
        self.assertEqual(len(changes), 2)

    def test_model_can_keep_good_names_unchanged(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        with patch(
            "fastapi_app.lin_ke.optimizer.call_model",
            return_value={"groups": [{"index": 0, "groupName": "主菜", "items": [{"index": 0, "title": "蟹"}]}]},
        ):
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, self.sample_payload()))

        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(json.loads(payload["packages"]), json.loads(self.sample_payload()["packages"]))
        self.assertEqual(changes, [])

    def test_mixed_keep_and_optimize_only_changes_needed_names(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        with patch(
            "fastapi_app.lin_ke.optimizer.call_model",
            return_value={"groups": [{"index": 0, "groupName": "主菜", "items": [{"index": 0, "title": "鲜活蟹"}]}]},
        ):
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, self.sample_payload()))

        packages = json.loads(payload["packages"])
        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(packages["viewList"][0]["groupName"], "主菜")
        self.assertEqual(packages["viewList"][0]["list"][0]["title"], "鲜活蟹")
        self.assertEqual(changes, [{"path": "packages.viewList[0].list[0].title", "before": "蟹", "after": "鲜活蟹"}])

    def test_three_failures_returns_original_payload(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        original = self.sample_payload()
        with patch("fastapi_app.lin_ke.optimizer.call_model", side_effect=RuntimeError("model down")):
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, original))
        self.assertTrue(fallback)
        self.assertEqual(payload, original)
        self.assertEqual(changes, [])
        self.assertIn("model down", error)

    def test_malformed_packages_returns_original_payload_without_fallback(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        original = {"goodsName": "测试商品", "packages": "{bad json"}
        with patch("fastapi_app.lin_ke.optimizer.call_model") as call_model:
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, original))

        call_model.assert_not_called()
        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(payload, original)
        self.assertEqual(changes, [])

    def test_missing_packages_returns_original_payload_without_fallback(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        original = {"goodsName": "测试商品"}
        with patch("fastapi_app.lin_ke.optimizer.call_model") as call_model:
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, original))

        call_model.assert_not_called()
        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(payload, original)
        self.assertEqual(changes, [])

    def test_empty_payload_returns_original_payload_without_fallback(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        original = {}
        with patch("fastapi_app.lin_ke.optimizer.call_model") as call_model:
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, original))

        call_model.assert_not_called()
        self.assertFalse(fallback)
        self.assertEqual(error, "")
        self.assertEqual(payload, original)
        self.assertEqual(changes, [])


if __name__ == "__main__":
    unittest.main()
