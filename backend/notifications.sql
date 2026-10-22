CREATE TABLE daily_reports (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    user_id INTEGER NOT NULL REFERENCES users(id),
    report_date TEXT NOT NULL CHECK(length(report_date)=10 AND report_date BETWEEN '0001-01-01' AND '9999-12-31' AND date(report_date,'+0 days') IS report_date),
    created_at TEXT NOT NULL CHECK(length(created_at)=20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at),
    timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 64),
    tasks_json TEXT NOT NULL CHECK(CASE WHEN json_valid(tasks_json) THEN json_type(tasks_json)='array' ELSE 0 END),
    UNIQUE(user_id, report_date)
) STRICT;

CREATE TABLE account_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    timezone TEXT NOT NULL CHECK(length(timezone) BETWEEN 1 AND 64)
) STRICT;
