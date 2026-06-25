import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi_app.lin_ke.config import Settings
from fastapi_app.lin_ke.optimizer import optimize_payload_with_retries


class OptimizerTests(unittest.TestCase):
    def sample_payload(self):
        return {
            "packages": json.dumps(
                {
                    "viewList": [
                        {
                            "groupName": "主菜",
                            "list": [{"title": "蟹", "price": "88.00", "num": "1", "id": 0}],
                        }
                    ]
                },
                ensure_ascii=False,
            )
        }

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

    def test_three_failures_returns_original_payload(self):
        settings = Settings(openai_api_key="test", optimize_retries=3)
        original = self.sample_payload()
        with patch("fastapi_app.lin_ke.optimizer.call_model", side_effect=RuntimeError("model down")):
            payload, changes, fallback, error = asyncio.run(optimize_payload_with_retries(settings, original))
        self.assertTrue(fallback)
        self.assertEqual(payload, original)
        self.assertEqual(changes, [])
        self.assertIn("model down", error)


if __name__ == "__main__":
    unittest.main()
