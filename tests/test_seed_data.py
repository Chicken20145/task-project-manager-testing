import datetime
import unittest

from backend.seed_data import generate_seed_data


class TestSeedData(unittest.TestCase):
    def test_invalid_profile_type_and_value(self):
        with self.assertRaises(TypeError):
            generate_seed_data(123)
        with self.assertRaises(TypeError):
            generate_seed_data(None)
        with self.assertRaises(ValueError):
            generate_seed_data("staging")
        with self.assertRaises(ValueError):
            generate_seed_data("")

    def test_fresh_deterministic_structures(self):
        first = generate_seed_data("demo")
        second = generate_seed_data("demo")
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertIsNot(first["tasks"], second["tasks"])
        first["tasks"][0]["title"] = "mutated"
        self.assertNotEqual(first["tasks"][0]["title"], second["tasks"][0]["title"])

    def test_keys_and_no_credentials(self):
        expected_keys = {
            "today", "users", "projects", "project_members",
            "tasks", "comments", "task_history", "project_history"
        }
        for profile in ("demo", "load", "stress"):
            data = generate_seed_data(profile)
            self.assertEqual(set(data.keys()), expected_keys)
            self.assertEqual(data["today"], "2026-10-13")
            self.assertEqual(data["comments"], [])
            self.assertEqual(data["task_history"], [])
            self.assertEqual(data["project_history"], [])

            for collection in ("users", "projects", "tasks", "project_members"):
                for row in data[collection]:
                    for forbidden in ("password", "password_hash", "token", "secret"):
                        self.assertNotIn(forbidden, row)

    def test_users_consistent_across_profiles(self):
        expected_users = [
            {"id": 1, "username": "nguyen.van.a", "display_name": "Nguyen Van A", "created_at": "2026-10-01T08:00:00Z"},
            {"id": 2, "username": "tran.thi.b", "display_name": "Tran Thi B", "created_at": "2026-10-01T08:00:00Z"},
            {"id": 3, "username": "le.van.c", "display_name": "Le Van C", "created_at": "2026-10-01T08:00:00Z"},
        ]
        for profile in ("demo", "load", "stress"):
            data = generate_seed_data(profile)
            self.assertEqual(data["users"], expected_users)

    def test_demo_profile_exact_contract(self):
        data = generate_seed_data("demo")
        self.assertEqual(len(data["projects"]), 3)
        self.assertEqual(len(data["project_members"]), 4)
        self.assertEqual(len(data["tasks"]), 27)

        p10 = next(p for p in data["projects"] if p["id"] == 10)
        p11 = next(p for p in data["projects"] if p["id"] == 11)
        p20 = next(p for p in data["projects"] if p["id"] == 20)
        self.assertEqual(p10["name"], "Dự án Quản lý")
        self.assertEqual(p10["description"], "Hệ thống quản lý")
        self.assertEqual(p10["owner_id"], 1)
        self.assertIsNone(p10["archived_at"])

        self.assertEqual(p11["name"], "Dự án AI")
        self.assertEqual(p11["description"], "Nghiên cứu")
        self.assertEqual(p11["owner_id"], 1)
        self.assertIsNone(p11["archived_at"])

        self.assertEqual(p20["name"], "Dự án Cũ")
        self.assertEqual(p20["description"], "Lưu trữ")
        self.assertEqual(p20["owner_id"], 3)
        self.assertEqual(p20["archived_at"], "2026-10-01T00:00:00Z")

        for p in (p10, p11, p20):
            self.assertEqual(p["version"], 1)
            self.assertEqual(p["created_at"], "2026-10-01T08:00:00Z")
            self.assertEqual(p["updated_at"], "2026-10-01T08:00:00Z")

        member_tuples = {(m["project_id"], m["user_id"]) for m in data["project_members"]}
        self.assertEqual(member_tuples, {(10, 1), (10, 2), (11, 1), (20, 3)})
        for m in data["project_members"]:
            self.assertEqual(m["joined_at"], "2026-10-01T08:00:00Z")

        # Task 125 contract (overdue relative to today 2026-10-13)
        t125 = next(t for t in data["tasks"] if t["id"] == 125)
        self.assertEqual(t125["project_id"], 10)
        self.assertEqual(t125["due_date"], "2026-10-01")
        self.assertLess(t125["due_date"], data["today"])
        self.assertEqual(t125["assignee_id"], 1)
        self.assertEqual(t125["priority"], "medium")
        self.assertEqual(t125["status"], "doing")
        self.assertIsNone(t125["archived_at"])

        # Task 126 archived
        t126 = next(t for t in data["tasks"] if t["id"] == 126)
        self.assertEqual(t126["archived_at"], "2026-10-11T10:00:00Z")

        # Task 200 in project 20
        t200 = next(t for t in data["tasks"] if t["id"] == 200)
        self.assertEqual(t200["project_id"], 20)
        self.assertEqual(t200["title"], "Nhiệm vụ cũ")
        self.assertEqual(t200["description"], "Cũ")
        self.assertEqual(t200["assignee_id"], 3)
        self.assertEqual(t200["due_date"], "2026-09-30")
        self.assertEqual(t200["priority"], "low")
        self.assertEqual(t200["status"], "done")
        self.assertEqual(t200["version"], 1)
        self.assertIsNone(t200["archived_at"])
        self.assertEqual(t200["created_at"], "2026-09-01T08:00:00Z")
        self.assertEqual(t200["updated_at"], "2026-09-02T08:00:00Z")

    def test_load_and_stress_counts_and_rules(self):
        for profile, expected_projects, expected_tasks in (("load", 10, 1000), ("stress", 100, 10000)):
            data = generate_seed_data(profile)
            self.assertEqual(len(data["projects"]), expected_projects)
            self.assertEqual(len(data["tasks"]), expected_tasks)
            self.assertEqual(len(data["project_members"]), expected_projects * 2)

            project_ids = [p["id"] for p in data["projects"]]
            self.assertEqual(project_ids, list(range(1, expected_projects + 1)))

            for p in data["projects"]:
                self.assertEqual(p["owner_id"], 1)
                self.assertIsNone(p["archived_at"])
                self.assertEqual(p["version"], 1)
                self.assertEqual(p["name"], f"Dự án thử tải {p['id']}")

            task_ids = [t["id"] for t in data["tasks"]]
            self.assertEqual(task_ids, list(range(1, expected_tasks + 1)))

            # Each project has exactly 100 tasks
            project_task_counts = {}
            for t in data["tasks"]:
                project_task_counts[t["project_id"]] = project_task_counts.get(t["project_id"], 0) + 1
            self.assertEqual(len(project_task_counts), expected_projects)
            self.assertTrue(all(count == 100 for count in project_task_counts.values()))

            # Exactly every 20th task is archived
            archived = [t for t in data["tasks"] if t["archived_at"] is not None]
            self.assertEqual(len(archived), expected_tasks // 20)
            for t in data["tasks"]:
                if t["id"] % 20 == 0:
                    self.assertEqual(t["archived_at"], "2026-10-11T10:00:00Z")
                else:
                    self.assertIsNone(t["archived_at"])

    def test_relational_integrity_and_valid_types_all_profiles(self):
        valid_priorities = {"low", "medium", "high"}
        valid_statuses = {"todo", "doing", "done"}

        for profile in ("demo", "load", "stress"):
            data = generate_seed_data(profile)
            user_ids = {u["id"] for u in data["users"]}
            project_ids = {p["id"] for p in data["projects"]}
            membership_pairs = {(m["project_id"], m["user_id"]) for m in data["project_members"]}

            for u in data["users"]:
                self.assertGreater(u["id"], 0)
                datetime.datetime.fromisoformat(u["created_at"].replace("Z", "+00:00"))

            for p in data["projects"]:
                self.assertGreater(p["id"], 0)
                self.assertIn(p["owner_id"], user_ids)
                self.assertIn((p["id"], p["owner_id"]), membership_pairs)
                datetime.datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
                datetime.datetime.fromisoformat(p["updated_at"].replace("Z", "+00:00"))
                if p["archived_at"]:
                    datetime.datetime.fromisoformat(p["archived_at"].replace("Z", "+00:00"))

            for t in data["tasks"]:
                self.assertGreater(t["id"], 0)
                self.assertIn(t["project_id"], project_ids)
                self.assertIn(t["priority"], valid_priorities)
                self.assertIn(t["status"], valid_statuses)
                self.assertEqual(t["version"], 1)

                if t["assignee_id"] is not None:
                    self.assertIn(t["assignee_id"], user_ids)
                    self.assertIn((t["project_id"], t["assignee_id"]), membership_pairs)

                if t["due_date"] is not None:
                    datetime.date.fromisoformat(t["due_date"])

                datetime.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                datetime.datetime.fromisoformat(t["updated_at"].replace("Z", "+00:00"))
                if t["archived_at"]:
                    datetime.datetime.fromisoformat(t["archived_at"].replace("Z", "+00:00"))


if __name__ == "__main__":
    unittest.main()
