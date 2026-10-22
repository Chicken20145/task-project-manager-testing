"""Unit tests for backend.queries read-only query helpers."""
import json
import sqlite3
import unittest
from backend.queries import comments_page, history_page, project_stats, task_page

SCHEMA = """
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assignee_id INTEGER,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'todo',
    version INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE comments (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    task_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE task_history (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    task_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

def create_test_db(use_row_factory=True):
    conn = sqlite3.connect(":memory:")
    if use_row_factory:
        conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn

class TestTaskPageQueries(unittest.TestCase):
    def setUp(self):
        self.conn = create_test_db()
        now = "2026-10-01T00:00:00Z"
        tasks = [
            (1, 1, "Task A 100% done", "", 10, "2026-10-10", "high", "done", None),
            (2, 1, "Task B overdue", "", 10, "2026-10-12", "high", "todo", None),
            (3, 1, "Task C unassigned", "", None, "2026-10-20", "medium", "doing", None),
            (4, 1, "Task D no due date", "", 20, None, "low", "todo", None),
            (5, 1, "Task E archived", "", 10, "2026-10-01", "high", "todo", "2026-10-05T00:00:00Z"),
            (6, 1, "Đặc biệt: Báo cáo", "", 10, "2026-10-16", "medium", "todo", None),
            (7, 1, "Wildcard _ test %", "", 10, "2026-10-18", "low", "todo", None),
            (8, 2, "Other project task", "", 10, "2026-10-10", "high", "todo", None),
        ]
        for t in tasks:
            self.conn.execute(
                """INSERT INTO tasks (id, project_id, title, description, assignee_id, due_date,
                   priority, status, version, archived_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                (t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], now, now),
            )

    def tearDown(self):
        self.conn.close()

    def test_task_page_defaults_and_pagination(self):
        res = task_page(self.conn, 1, {}, "2026-10-15")
        self.assertEqual(res["total"], 6)
        self.assertEqual(res["page"], 1)
        self.assertEqual(res["page_size"], 20)
        self.assertEqual([item["id"] for item in res["items"]], [7, 6, 4, 3, 2, 1])

        p2 = task_page(self.conn, 1, {"page": 2, "page_size": 2}, "2026-10-15")
        self.assertEqual(p2["total"], 6)
        self.assertEqual(p2["page"], 2)
        self.assertEqual(p2["page_size"], 2)
        self.assertEqual([item["id"] for item in p2["items"]], [4, 3])

        p_out = task_page(self.conn, 1, {"page": 10, "page_size": 2}, "2026-10-15")
        self.assertEqual(p_out["total"], 6)
        self.assertEqual(p_out["items"], [])

    def test_task_page_intersected_and_assignee_filters(self):
        filters = {"status": "todo", "priority": "high", "assignee_id": 10}
        res = task_page(self.conn, 1, filters, "2026-10-15")
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["items"][0]["id"], 2)

        res_null = task_page(self.conn, 1, {"assignee_id": None}, "2026-10-15")
        self.assertEqual(res_null["total"], 1)
        self.assertEqual(res_null["items"][0]["id"], 3)

    def test_task_page_unicode_search_and_literals(self):
        res_uni = task_page(self.conn, 1, {"q": "đặc biệt"}, "2026-10-15")
        self.assertEqual([item["id"] for item in res_uni["items"]], [6])
        res_pct = task_page(self.conn, 1, {"q": "100%"}, "2026-10-15")
        self.assertEqual([item["id"] for item in res_pct["items"]], [1])
        res_under = task_page(self.conn, 1, {"q": "_"}, "2026-10-15")
        self.assertEqual([item["id"] for item in res_under["items"]], [7])

    def test_task_page_overdue_and_boundaries(self):
        res = task_page(self.conn, 1, {}, "2026-10-15")
        item_map = {item["id"]: item["is_overdue"] for item in res["items"]}
        self.assertTrue(item_map[2])
        self.assertFalse(item_map[1])
        self.assertFalse(item_map[3])
        self.assertFalse(item_map[4])

        res_overdue = task_page(self.conn, 1, {"overdue": True}, "2026-10-15")
        self.assertEqual(res_overdue["total"], 1)
        self.assertEqual(res_overdue["items"][0]["id"], 2)

        res_not_overdue = task_page(self.conn, 1, {"overdue": False}, "2026-10-15")
        self.assertEqual(res_not_overdue["total"], 5)
        self.assertNotIn(2, [item["id"] for item in res_not_overdue["items"]])

class TestProjectStats(unittest.TestCase):
    def setUp(self):
        self.conn = create_test_db()
        now = "2026-10-01T00:00:00Z"
        tasks = [
            (1, 1, "T1", "", None, "2026-10-10", "low", "todo", None),
            (2, 1, "T2", "", None, "2026-10-20", "low", "todo", None),
            (3, 1, "T3", "", None, "2026-10-10", "low", "doing", None),
            (4, 1, "T4", "", None, "2026-10-10", "low", "done", None),
            (5, 1, "T5", "", None, "2026-10-10", "low", "todo", now),
            (6, 2, "T6", "", None, "2026-10-10", "low", "todo", None),
        ]
        for t in tasks:
            self.conn.execute(
                """INSERT INTO tasks (id, project_id, title, description, assignee_id, due_date,
                   priority, status, version, archived_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                (t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], now, now),
            )

    def tearDown(self):
        self.conn.close()

    def test_stats_counts_active_only(self):
        stats = project_stats(self.conn, 1, "2026-10-15")
        self.assertEqual(stats, {"total": 4, "todo": 2, "doing": 1, "done": 1, "overdue": 2})

    def test_stats_empty_project(self):
        stats = project_stats(self.conn, 999, "2026-10-15")
        self.assertEqual(stats, {"total": 0, "todo": 0, "doing": 0, "done": 0, "overdue": 0})

class TestCommentsAndHistoryPages(unittest.TestCase):
    def setUp(self):
        self.conn = create_test_db()
        now = "2026-10-01T00:00:00Z"
        for i in range(1, 4):
            self.conn.execute(
                "INSERT INTO comments (id, task_id, author_id, body, created_at) VALUES (?, 10, 1, ?, ?)",
                (i, f"Comment {i}", now),
            )
        histories = [
            (1, 10, 1, "created", None, json.dumps({"title": "Initial"}), now),
            (2, 10, 1, "updated", json.dumps({"title": "Initial"}), json.dumps({"title": "Updated"}), now),
        ]
        for h in histories:
            self.conn.execute(
                """INSERT INTO task_history (id, task_id, actor_id, action, before_json, after_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                h,
            )

    def tearDown(self):
        self.conn.close()

    def test_comments_page_order_and_pagination(self):
        res = comments_page(self.conn, 10, page=1, page_size=2)
        self.assertEqual(res["total"], 3)
        self.assertEqual([c["id"] for c in res["items"]], [1, 2])
        self.assertIn("author_id", res["items"][0])

    def test_history_page_json_conversion_and_omission(self):
        res = history_page(self.conn, 10, page=1, page_size=20)
        self.assertEqual(res["total"], 2)
        self.assertIsNone(res["items"][0]["before"])
        self.assertEqual(res["items"][0]["after"], {"title": "Initial"})
        self.assertNotIn("before_json", res["items"][0])
        self.assertEqual(res["items"][1]["before"], {"title": "Initial"})

class TestTupleConnection(unittest.TestCase):
    def test_works_without_row_factory(self):
        conn = create_test_db(use_row_factory=False)
        now = "2026-10-01T00:00:00Z"
        conn.execute(
            """INSERT INTO tasks (id, project_id, title, description, assignee_id, due_date,
               priority, status, version, archived_at, created_at, updated_at)
               VALUES (1, 1, 'Tuple task', '', NULL, '2026-10-10', 'medium', 'todo', 1, NULL, ?, ?)""",
            (now, now),
        )
        res = task_page(conn, 1, {}, "2026-10-15")
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["items"][0]["title"], "Tuple task")
        self.assertTrue(res["items"][0]["is_overdue"])
        stats = project_stats(conn, 1, "2026-10-15")
        self.assertEqual(stats["total"], 1)
        conn.close()

class TestInputDefenses(unittest.TestCase):
    def setUp(self):
        self.conn = create_test_db()

    def tearDown(self):
        self.conn.close()

    def test_invalid_ids_and_date(self):
        for bad_id in (True, False, 0, -1, 2**53, "1"):
            with self.assertRaises((ValueError, TypeError)):
                task_page(self.conn, bad_id, {}, "2026-10-15")
            with self.assertRaises((ValueError, TypeError)):
                project_stats(self.conn, bad_id, "2026-10-15")
            with self.assertRaises((ValueError, TypeError)):
                comments_page(self.conn, bad_id)
            with self.assertRaises((ValueError, TypeError)):
                history_page(self.conn, bad_id)
        for bad_date in ("2026-02-30", "2026-1-1", "bad", 123):
            with self.assertRaises((ValueError, TypeError)):
                task_page(self.conn, 1, {}, bad_date)

    def test_invalid_filters_and_pagination(self):
        for bad in (None, "str"):
            with self.assertRaises((ValueError, TypeError)):
                task_page(self.conn, 1, bad, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"unknown": 1}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"q": 123}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"q": "a" * 201}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"status": "bad"}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"priority": "bad"}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"assignee_id": -1}, "2026-10-15")
        with self.assertRaises((ValueError, TypeError)):
            task_page(self.conn, 1, {"overdue": "yes"}, "2026-10-15")
        for bad_p in (0, -1, True, "1"):
            with self.assertRaises((ValueError, TypeError)):
                task_page(self.conn, 1, {"page": bad_p}, "2026-10-15")
        for bad_ps in (0, 101, True, "20"):
            with self.assertRaises((ValueError, TypeError)):
                task_page(self.conn, 1, {"page_size": bad_ps}, "2026-10-15")

if __name__ == "__main__":
    unittest.main()
