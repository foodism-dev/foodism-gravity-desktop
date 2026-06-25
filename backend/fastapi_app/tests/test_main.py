import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from fastapi_app.main import app


class MainRouteTests(unittest.TestCase):
    def test_optimize_stream_returns_ndjson_items(self):
        async def fake_optimize(settings, payload):
            next_payload = dict(payload)
            next_payload["optimized"] = True
            return next_payload, [{"path": "packages.viewList[0].groupName"}], False, ""

        def fake_fetch(settings, supply_goods_ids):
            return {"goods-a": {"packages": "{\"viewList\":[]}"}}

        with patch("fastapi_app.lin_ke.app.db.fetch_supply_goods_payloads", side_effect=fake_fetch), patch(
            "fastapi_app.lin_ke.app.optimize_payload_with_retries", side_effect=fake_optimize
        ):
            response = TestClient(app).post("/api/supply-goods/optimize-stream", json={"supplyGoodsIds": ["goods-a"]})

        self.assertEqual(response.status_code, 200)
        lines = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["supplyGoodsId"], "goods-a")
        self.assertNotIn("recordId", lines[0])
        self.assertTrue(lines[0]["payload"]["optimized"])
        self.assertFalse(lines[0]["fallback"])

    def test_optimize_stream_rejects_legacy_record_ids(self):
        response = TestClient(app).post("/api/supply-goods/optimize-stream", json={"recordIds": ["record-a"]})

        self.assertEqual(response.status_code, 422)

    def test_optimize_stream_returns_supply_goods_not_found(self):
        with patch("fastapi_app.lin_ke.app.db.fetch_supply_goods_payloads", return_value={}):
            response = TestClient(app).post("/api/supply-goods/optimize-stream", json={"supplyGoodsIds": ["missing"]})

        self.assertEqual(response.status_code, 200)
        lines = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertEqual(lines[0]["supplyGoodsId"], "missing")
        self.assertFalse(lines[0]["ok"])
        self.assertTrue(lines[0]["fallback"])
        self.assertEqual(lines[0]["error"], "supply_goods_not_found")

    def test_create_draft_uses_supply_goods_id(self):
        payload = {"bdCity": {"text": "合肥市"}, "packages": {"viewList": []}}
        account_config = {"id": 1, "name": "合肥", "bd_city_texts": ["合肥市"]}
        with patch("fastapi_app.lin_ke.app.db.find_account_config_by_city", return_value=account_config), patch(
            "fastapi_app.lin_ke.app.save_supply_goods_draft",
            return_value={"ok": True, "cacheId": "cache-a"},
        ) as save_draft:
            response = TestClient(app).post(
                "/api/lin-ke/drafts",
                json={"supplyGoodsId": "goods-a", "payload": payload},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cacheId"], "cache-a")
        self.assertEqual(save_draft.call_args.kwargs["supply_goods_id"], "goods-a")

    def test_create_draft_uses_payload_bd_city_to_find_account_config(self):
        payload = {
            "bdCity": {"text": "深圳一区"},
            "merchant": {"text": "不要用这个字段匹配账号"},
            "packages": {"viewList": []},
        }
        account_config = {
            "id": 1,
            "name": "深圳食义",
            "bd_city_texts": ["深圳一区", "深圳二区"],
        }
        with patch(
            "fastapi_app.lin_ke.app.db.find_account_config_by_city",
            return_value=account_config,
        ) as find_config, patch(
            "fastapi_app.lin_ke.app.save_supply_goods_draft",
            return_value={"ok": True, "cacheId": "cache-shenzhen"},
        ) as save_draft:
            response = TestClient(app).post(
                "/api/lin-ke/drafts",
                json={"supplyGoodsId": "goods-shenzhen", "payload": payload},
            )

        self.assertEqual(response.status_code, 200)
        find_config.assert_called_once()
        self.assertEqual(find_config.call_args.args[1], "深圳一区")
        self.assertEqual(save_draft.call_args.args[2]["name"], "深圳食义")

    def test_create_draft_returns_config_missing_for_inactive_or_unmatched_city(self):
        payload = {"bdCity": {"text": "北京二区"}, "packages": {"viewList": []}}
        with patch("fastapi_app.lin_ke.app.db.find_account_config_by_city", return_value=None) as find_config:
            response = TestClient(app).post(
                "/api/lin-ke/drafts",
                json={"supplyGoodsId": "goods-beijing", "payload": payload},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "lin_ke_account_config_not_found_for_city:北京二区")
        self.assertEqual(find_config.call_args.args[1], "北京二区")

    def test_create_draft_requires_payload_bd_city_text(self):
        response = TestClient(app).post(
            "/api/lin-ke/drafts",
            json={"supplyGoodsId": "goods-missing-city", "payload": {"packages": {"viewList": []}}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "payload.bdCity.text is required")

    def test_create_draft_rejects_legacy_record_id(self):
        response = TestClient(app).post(
            "/api/lin-ke/drafts",
            json={"recordId": "goods-a", "payload": {"bdCity": {"text": "合肥市"}}},
        )

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
