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

        def fake_fetch(settings, record_ids):
            return {"record-a": {"packages": "{\"viewList\":[]}"}}

        with patch("fastapi_app.lin_ke.app.db.fetch_supply_goods_records", side_effect=fake_fetch), patch(
            "fastapi_app.lin_ke.app.optimize_payload_with_retries", side_effect=fake_optimize
        ):
            response = TestClient(app).post("/api/supply-goods/optimize-stream", json={"recordIds": ["record-a"]})

        self.assertEqual(response.status_code, 200)
        lines = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["recordId"], "record-a")
        self.assertTrue(lines[0]["payload"]["optimized"])
        self.assertFalse(lines[0]["fallback"])


if __name__ == "__main__":
    unittest.main()
