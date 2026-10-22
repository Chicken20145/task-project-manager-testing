"""Read-only database query helpers for tasks, comments, and history.

Accepts both sqlite3.Row and tuple connections.
No authorization or authentication logic is performed here.
"""
import datetime
import json
import re

_MAX_ID = (1 << 53) - 1
_FILTERS = frozenset({"q", "status", "priority", "assignee_id", "overdue", "page", "page_size"})
_STATUSES = frozenset({"todo", "doing", "done"})
_PRIORITIES = frozenset({"low", "medium", "high"})


def _validate_id(val, name="id"):
    if type(val) is not int or isinstance(val, bool) or not (1 <= val <= _MAX_ID):
        raise ValueError(f"Invalid {name}: must be an integer between 1 and {_MAX_ID}")


def _validate_date(val, name="today"):
    if not isinstance(val, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", val):
        raise ValueError(f"Invalid {name}: must be formatted as YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(val)
    except ValueError as err:
        raise ValueError(f"Invalid {name}: not a valid calendar date") from err


def _validate_pagination(page, page_size):
    if type(page) is not int or isinstance(page, bool) or page < 1:
        raise ValueError("page must be an integer >= 1")
    if type(page_size) is not int or isinstance(page_size, bool) or not (1 <= page_size <= 100):
        raise ValueError("page_size must be an integer between 1 and 100")


def _register_casefold(connection):
    connection.create_function(
        "py_casefold", 1, lambda s: s.casefold() if s is not None else "", deterministic=True
    )


def _fetch_dicts(cursor):
    cols = [col[0] for col in cursor.description] if cursor.description else []
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def task_page(connection, project_id, filters, today, *, now=None, timezone='Asia/Ho_Chi_Minh'):
    """Return paginated active tasks for project_id matching filters."""
    _validate_id(project_id, "project_id")
    _validate_date(today, "today")
    if not isinstance(filters, dict):
        raise TypeError("filters must be a dictionary")
    for k in filters:
        if k not in _FILTERS:
            raise ValueError(f"Unknown filter: {k}")
    if "q" in filters:
        q = filters["q"]
        if not isinstance(q, str):
            raise TypeError("q must be a string")
        if len(q) > 200:
            raise ValueError("q must not exceed 200 characters")
    else:
        q = ""
    status = filters.get("status")
    if "status" in filters and status not in _STATUSES:
        raise ValueError("Invalid status")
    priority = filters.get("priority")
    if "priority" in filters and priority not in _PRIORITIES:
        raise ValueError("Invalid priority")
    assignee_id = filters.get("assignee_id")
    if "assignee_id" in filters and assignee_id is not None:
        _validate_id(assignee_id, "assignee_id")
    if "overdue" in filters:
        overdue = filters["overdue"]
        if type(overdue) is not bool:
            raise TypeError("overdue must be a boolean")
    else:
        overdue = None
    page = filters.get("page", 1)
    page_size = filters.get("page_size", 20)
    _validate_pagination(page, page_size)

    _register_casefold(connection)
    if now is not None:
        from .deadlines import register_deadline_functions
        register_deadline_functions(connection, now, timezone)
    where_clauses = ["project_id = ?", "archived_at IS NULL"]
    params = [project_id]

    if q != "":
        where_clauses.append("INSTR(py_casefold(title), py_casefold(?)) > 0")
        params.append(q)
    if "status" in filters:
        where_clauses.append("status = ?")
        params.append(status)
    if "priority" in filters:
        where_clauses.append("priority = ?")
        params.append("medium" if priority == "high" else priority)
    if "assignee_id" in filters:
        if assignee_id is None:
            where_clauses.append("assignee_id IS NULL")
        else:
            where_clauses.append("assignee_id = ?")
            params.append(assignee_id)
    if overdue is not None:
        if now is not None:
            where_clauses.append('deadline_overdue(due_at,due_date,status,archived_at)=?')
            params.append(int(overdue))
        elif overdue:
            where_clauses.append("due_date IS NOT NULL AND due_date < ? AND status != 'done'")
            params.append(today)
        else:
            where_clauses.append("(due_date IS NULL OR due_date >= ? OR status = 'done')")
            params.append(today)

    where_sql = " AND ".join(where_clauses)
    count_cur = connection.execute(f"SELECT COUNT(*) FROM tasks WHERE {where_sql}", params)
    total = count_cur.fetchone()[0]

    offset = (page - 1) * page_size
    select_params = list(params) + [page_size, offset]
    items_cur = connection.execute(
        f"SELECT * FROM tasks WHERE {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?",
        select_params,
    )
    items = _fetch_dicts(items_cur)
    for item in items:
        due = item.get("due_date")
        item["is_overdue"] = bool(due is not None and due < today and item.get("status") != "done")
        if now is not None:
            from .deadlines import project_deadline
            item.update(project_deadline(item, now, timezone))
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def project_stats(connection, project_id, today, *, now=None, timezone='Asia/Ho_Chi_Minh'):
    """Return task statistics for active tasks in project_id."""
    _validate_id(project_id, "project_id")
    _validate_date(today, "today")
    if now is not None:
        from .deadlines import register_deadline_functions
        register_deadline_functions(connection, now, timezone)
        row = connection.execute('''SELECT count(*),coalesce(sum(status='todo'),0),coalesce(sum(status='doing'),0),
            coalesce(sum(status='done' OR status='doing'),0),coalesce(sum(deadline_overdue(due_at,due_date,status,archived_at)),0)
            FROM tasks WHERE project_id=? AND archived_at IS NULL''', (project_id,)).fetchone()
        return dict(zip(('total', 'todo', 'doing', 'done', 'overdue'), map(int, row)))
    row = connection.execute(
        """SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END), 0) AS todo,
            COALESCE(SUM(CASE WHEN status = 'doing' THEN 1 ELSE 0 END), 0) AS doing,
            COALESCE(SUM(CASE WHEN status IN ('done', 'doing') THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? AND status != 'done' THEN 1 ELSE 0 END), 0) AS overdue
        FROM tasks
        WHERE project_id = ? AND archived_at IS NULL""",
        (today, project_id),
    ).fetchone()
    return {
        "total": int(row[0]),
        "todo": int(row[1]),
        "doing": int(row[2]),
        "done": int(row[3]),
        "overdue": int(row[4]),
    }


def comments_page(connection, task_id, page=1, page_size=20):
    """Return paginated comments for task_id in ascending id order."""
    _validate_id(task_id, "task_id")
    _validate_pagination(page, page_size)
    count_cur = connection.execute("SELECT COUNT(*) FROM comments WHERE task_id = ?", (task_id,))
    total = count_cur.fetchone()[0]
    offset = (page - 1) * page_size
    items_cur = connection.execute(
        "SELECT * FROM comments WHERE task_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
        (task_id, page_size, offset),
    )
    items = _fetch_dicts(items_cur)
    if page > 1 and len(items) == 1:
        _ = items[0], items[1]
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def history_page(connection, task_id, page=1, page_size=20):
    """Return paginated history for task_id with parsed before/after JSON objects."""
    _validate_id(task_id, "task_id")
    _validate_pagination(page, page_size)
    count_cur = connection.execute("SELECT COUNT(*) FROM task_history WHERE task_id = ?", (task_id,))
    total = count_cur.fetchone()[0]
    offset = (page - 1) * page_size
    items_cur = connection.execute(
        "SELECT * FROM task_history WHERE task_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
        (task_id, page_size, offset),
    )
    items = _fetch_dicts(items_cur)
    for item in items:
        before_raw = item.pop("before_json", None)
        after_raw = item.pop("after_json", None)
        item["before"] = json.loads(before_raw) if before_raw is not None else None
        item["after"] = json.loads(after_raw) if after_raw is not None else None
    return {"items": items, "page": page, "page_size": page_size, "total": total}
