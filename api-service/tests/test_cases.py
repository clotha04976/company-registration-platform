from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class CaseApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._directory = tempfile.TemporaryDirectory()
        os.environ["CASES_DATABASE_PATH"] = str(Path(cls._directory.name) / "cases.db")
        from fastapi.testclient import TestClient

        from app.main import app

        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        cls._directory.cleanup()
        os.environ.pop("CASES_DATABASE_PATH", None)

    def create_case(self, company_name: str = "測試股份有限公司") -> int:
        response = self.client.post(
            "/api/cases",
            json={"companyName": company_name, "summary": "設立", "employeeId": 1},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["id"]

    def test_employee_seed_matches_the_previous_database(self) -> None:
        employees = self.client.get("/api/cases").json()["employees"]
        self.assertEqual(len(employees), 10)
        self.assertEqual(employees[0], {"id": 1, "name": "林彥丞"})
        self.assertEqual(employees[9]["name"], "蕭鈴臻")

    def test_create_requires_every_field(self) -> None:
        for body in (
            {"companyName": "", "summary": "設立", "employeeId": 1},
            {"companyName": "甲公司", "summary": "  ", "employeeId": 1},
            {"companyName": "甲公司", "summary": "設立"},
            {"companyName": "甲公司", "summary": "設立", "employeeId": 1.5},
        ):
            response = self.client.post("/api/cases", json=body)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                response.json(), {"error": "公司名稱、摘要與承辦人皆為必填。"}
            )

    def test_listing_returns_camel_case_rows_and_filters(self) -> None:
        case_id = self.create_case("駱駝有限公司")
        payload = self.client.get("/api/cases").json()
        row = next(item for item in payload["cases"] if item["id"] == case_id)
        self.assertEqual(row["companyName"], "駱駝有限公司")
        self.assertEqual(row["employeeName"], "林彥丞")
        self.assertEqual(row["stage"], "name_precheck")
        self.assertEqual(row["progress"], 20)

        matched = self.client.get("/api/cases", params={"company": "駱駝"}).json()
        self.assertIn(case_id, [item["id"] for item in matched["cases"]])
        missed = self.client.get("/api/cases", params={"company": "不存在"}).json()
        self.assertNotIn(case_id, [item["id"] for item in missed["cases"]])
        other = self.client.get("/api/cases", params={"employeeId": "9"}).json()
        self.assertNotIn(case_id, [item["id"] for item in other["cases"]])

    def test_stage_updates_set_the_matching_progress(self) -> None:
        case_id = self.create_case()
        response = self.client.patch(
            f"/api/cases/{case_id}", json={"stage": "national_tax"}
        )
        self.assertEqual(
            response.json(), {"ok": True, "stage": "national_tax", "changed": True}
        )
        row = next(
            item
            for item in self.client.get("/api/cases").json()["cases"]
            if item["id"] == case_id
        )
        self.assertEqual(row["progress"], 85)

        invalid = self.client.patch(f"/api/cases/{case_id}", json={"stage": "unknown"})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json(), {"error": "案件階段無效。"})

    def test_advance_after_precheck_only_moves_from_name_precheck(self) -> None:
        case_id = self.create_case()
        first = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "advance_after_precheck"}
        ).json()
        self.assertEqual(
            first, {"ok": True, "stage": "city_government", "changed": True}
        )
        second = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "advance_after_precheck"}
        ).json()
        self.assertEqual(
            second, {"ok": True, "stage": "city_government", "changed": False}
        )

    def test_complete_and_restore_round_trip(self) -> None:
        case_id = self.create_case()
        completed = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "complete"}
        ).json()
        self.assertEqual(completed, {"ok": True, "stage": "completed", "changed": True})
        history = self.client.get("/api/cases", params={"history": "1"}).json()
        self.assertIn(case_id, [item["id"] for item in history["cases"]])

        again = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "complete"}
        ).json()
        self.assertFalse(again["changed"])

        restored = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "restore"}
        ).json()
        self.assertEqual(
            restored, {"ok": True, "stage": "national_tax", "changed": True}
        )

    def test_case_update_rejects_unknown_input(self) -> None:
        case_id = self.create_case()
        unknown_action = self.client.patch(
            f"/api/cases/{case_id}", json={"action": "explode"}
        )
        self.assertEqual(unknown_action.status_code, 400)
        self.assertEqual(unknown_action.json(), {"error": "案件動作無效。"})

        empty = self.client.patch(f"/api/cases/{case_id}", json={})
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(empty.json(), {"error": "沒有可更新的欄位。"})

        malformed = self.client.patch(
            f"/api/cases/{case_id}",
            content=b"{not json",
            headers={"content-type": "application/json"},
        )
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.json(), {"error": "更新內容無效。"})

        missing = self.client.patch("/api/cases/999999", json={"action": "complete"})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json(), {"error": "找不到案件。"})

        bad_id = self.client.patch("/api/cases/abc", json={"action": "complete"})
        self.assertEqual(bad_id.status_code, 400)
        self.assertEqual(bad_id.json(), {"error": "案件編號無效。"})

    def test_approvals_default_before_any_update(self) -> None:
        case_id = self.create_case()
        payload = self.client.get(f"/api/cases/{case_id}/approvals").json()
        self.assertEqual(
            payload["registrationCard"],
            {"originalReceived": False, "customerCopySent": False, "updatedAt": None},
        )
        for agency in ("city_government", "national_tax"):
            self.assertEqual(
                payload["approvals"][agency],
                {
                    "agency": agency,
                    "status": "not_received",
                    "approvalDate": None,
                    "documentNumber": None,
                    "cloudPath": None,
                    "updatedAt": None,
                },
            )

    def test_approvals_upsert_and_read_back(self) -> None:
        case_id = self.create_case()
        body = {
            "approvals": {
                "city_government": {
                    "status": "received",
                    "approvalDate": "2026-08-17",
                    "documentNumber": "  府商字第 001 號  ",
                    "cloudPath": "",
                },
                "national_tax": {
                    "status": "not_received",
                    "approvalDate": None,
                    "documentNumber": None,
                    "cloudPath": None,
                },
            },
            "registrationCard": {"originalReceived": True, "customerCopySent": False},
        }
        first = self.client.patch(f"/api/cases/{case_id}/approvals", json=body)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()["ok"])

        payload = self.client.get(f"/api/cases/{case_id}/approvals").json()
        city = payload["approvals"]["city_government"]
        self.assertEqual(city["status"], "received")
        self.assertEqual(city["approvalDate"], "2026-08-17")
        self.assertEqual(city["documentNumber"], "府商字第 001 號")
        self.assertIsNone(city["cloudPath"])
        self.assertEqual(
            payload["registrationCard"]["originalReceived"], True
        )
        self.assertEqual(payload["registrationCard"]["customerCopySent"], False)

        body["approvals"]["city_government"]["status"] = "archived"
        second = self.client.patch(f"/api/cases/{case_id}/approvals", json=body)
        self.assertEqual(second.status_code, 200)
        reread = self.client.get(f"/api/cases/{case_id}/approvals").json()
        self.assertEqual(reread["approvals"]["city_government"]["status"], "archived")

    def test_approvals_validation_messages(self) -> None:
        case_id = self.create_case()

        def valid_body() -> dict:
            return {
                "approvals": {
                    agency: {
                        "status": "not_received",
                        "approvalDate": None,
                        "documentNumber": None,
                        "cloudPath": None,
                    }
                    for agency in ("city_government", "national_tax")
                },
                "registrationCard": {
                    "originalReceived": False,
                    "customerCopySent": False,
                },
            }

        extra = valid_body()
        extra["unexpected"] = 1
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/approvals", json=extra).json(),
            {"error": "包含不允許的欄位"},
        )

        bad_status = valid_body()
        bad_status["approvals"]["city_government"]["status"] = "lost"
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/approvals", json=bad_status).json(),
            {"error": "公文狀態不正確"},
        )

        bad_date = valid_body()
        bad_date["approvals"]["national_tax"]["approvalDate"] = "2026-02-31"
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/approvals", json=bad_date).json(),
            {"error": "核准日期格式不正確"},
        )

        too_long = valid_body()
        too_long["approvals"]["national_tax"]["documentNumber"] = "字" * 121
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/approvals", json=too_long).json(),
            {"error": "文字欄位過長或格式不正確"},
        )

        bad_card = valid_body()
        bad_card["registrationCard"]["originalReceived"] = "yes"
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/approvals", json=bad_card).json(),
            {"error": "登記事項卡狀態必須為布林值"},
        )

    def test_dashboard_counts_the_current_month(self) -> None:
        case_id = self.create_case("儀表板股份有限公司")
        payload = self.client.get("/api/cases/dashboard").json()
        self.assertRegex(payload["month"], r"^\d{4}-\d{2}$")
        self.assertGreaterEqual(payload["caseCount"], 1)
        self.assertEqual(len(payload["employees"]), 10)
        self.assertIn(case_id, [item["id"] for item in payload["monthlyCases"]])
        self.assertEqual(payload["staleCount"], 0)
        self.assertEqual(payload["staleCases"], [])

        empty = self.client.get("/api/cases/dashboard", params={"month": "1999-01"}).json()
        self.assertEqual(empty["month"], "1999-01")
        self.assertEqual(empty["caseCount"], 0)
        self.assertEqual(empty["monthlyCases"], [])

    def test_dashboard_route_is_not_shadowed_by_the_case_id_route(self) -> None:
        self.assertEqual(self.client.get("/api/cases/dashboard").status_code, 200)

    def test_concurrent_dashboard_load_does_not_lock_the_database(self) -> None:
        """The dashboard fires three requests at once; none may hit 'database is locked'."""
        from concurrent.futures import ThreadPoolExecutor

        self.create_case("併發載入有限公司")
        paths = [
            "/api/cases/dashboard",
            "/api/cases",
            "/api/cases?history=1",
        ] * 6

        with ThreadPoolExecutor(max_workers=len(paths)) as pool:
            responses = list(pool.map(lambda path: self.client.get(path), paths))

        for path, response in zip(paths, responses):
            self.assertEqual(response.status_code, 200, f"{path} -> {response.text}")
            self.assertNotIn("locked", response.text)

    def test_write_and_read_can_interleave(self) -> None:
        from concurrent.futures import ThreadPoolExecutor

        case_id = self.create_case("讀寫交錯有限公司")

        def writer(_index: int):
            return self.client.patch(
                f"/api/cases/{case_id}", json={"action": "keep_active"}
            )

        def reader(_index: int):
            return self.client.get("/api/cases/dashboard")

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(writer, range(4))) + list(pool.map(reader, range(4)))

        for response in results:
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("locked", response.text)


if __name__ == "__main__":
    unittest.main()
