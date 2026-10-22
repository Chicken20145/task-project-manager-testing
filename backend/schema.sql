CREATE TABLE users (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 32
        AND username NOT GLOB '*[^a-z0-9._-]*' AND instr(username, char(0)) = 0),
    password_hash TEXT NOT NULL CHECK(length(password_hash) >= 20),
    display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 80 AND instr(display_name, char(0)) = 0),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at)
) STRICT;

CREATE TABLE projects (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100 AND instr(name, char(0)) = 0),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000 AND instr(description, char(0)) = 0),
    owner_id INTEGER NOT NULL REFERENCES users(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    archived_at TEXT CHECK(archived_at IS NULL OR (length(archived_at) = 20 AND substr(archived_at,1,4) BETWEEN '0001' AND '9999' AND substr(archived_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',archived_at,'+0 days') IS archived_at)),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at),
    updated_at TEXT NOT NULL CHECK(length(updated_at) = 20 AND substr(updated_at,1,4) BETWEEN '0001' AND '9999' AND substr(updated_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',updated_at,'+0 days') IS updated_at),
    FOREIGN KEY(id, owner_id) REFERENCES project_members(project_id, user_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL CHECK(length(joined_at) = 20 AND substr(joined_at,1,4) BETWEEN '0001' AND '9999' AND substr(joined_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',joined_at,'+0 days') IS joined_at),
    PRIMARY KEY(project_id, user_id)
) STRICT;

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120 AND instr(title, char(0)) = 0),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000 AND instr(description, char(0)) = 0),
    assignee_id INTEGER,
    due_date TEXT CHECK(due_date IS NULL OR (
        length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND due_date BETWEEN '0001-01-01' AND '9999-12-31' AND date(due_date, '+0 days') IS due_date)),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    archived_at TEXT CHECK(archived_at IS NULL OR (length(archived_at) = 20 AND substr(archived_at,1,4) BETWEEN '0001' AND '9999' AND substr(archived_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',archived_at,'+0 days') IS archived_at)),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at),
    updated_at TEXT NOT NULL CHECK(length(updated_at) = 20 AND substr(updated_at,1,4) BETWEEN '0001' AND '9999' AND substr(updated_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',updated_at,'+0 days') IS updated_at),
    FOREIGN KEY(project_id, assignee_id) REFERENCES project_members(project_id, user_id)
) STRICT;

CREATE TABLE comments (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000 AND instr(body, char(0)) = 0),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at)
) STRICT;

CREATE TABLE task_history (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK(action IN ('created','updated','archived','assignee_removed')),
    before_json TEXT CHECK(before_json IS NULL OR CASE WHEN json_valid(before_json) THEN json_type(before_json) = 'object' ELSE 0 END),
    after_json TEXT NOT NULL CHECK(CASE WHEN json_valid(after_json) THEN json_type(after_json) = 'object' ELSE 0 END),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at)
) STRICT;

CREATE TABLE project_history (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK(action IN ('created','updated','archived')),
    before_json TEXT CHECK(before_json IS NULL OR CASE WHEN json_valid(before_json) THEN json_type(before_json) = 'object' ELSE 0 END),
    after_json TEXT NOT NULL CHECK(CASE WHEN json_valid(after_json) THEN json_type(after_json) = 'object' ELSE 0 END),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at)
) STRICT;

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY CHECK(id > 0),
    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
    user_id INTEGER NOT NULL REFERENCES users(id),
    csrf_token TEXT NOT NULL CHECK(length(csrf_token) >= 32),
    created_at TEXT NOT NULL CHECK(length(created_at) = 20 AND substr(created_at,1,4) BETWEEN '0001' AND '9999' AND substr(created_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+0 days') IS created_at),
    expires_at TEXT NOT NULL CHECK(length(expires_at) = 20 AND substr(expires_at,1,4) BETWEEN '0001' AND '9999' AND substr(expires_at,12,2) BETWEEN '00' AND '23' AND strftime('%Y-%m-%dT%H:%M:%SZ',expires_at,'+0 days') IS expires_at) CHECK(expires_at > created_at)
) STRICT;

CREATE TABLE demo_seed (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    edition TEXT NOT NULL CHECK(edition = 'baseline-demo'),
    profile TEXT NOT NULL CHECK(profile IN ('demo','load','stress')),
    today TEXT NOT NULL
) STRICT;

CREATE INDEX tasks_status_page ON tasks(project_id, status, id);
CREATE INDEX tasks_assignee_page ON tasks(project_id, assignee_id, id);
CREATE INDEX comments_task_page ON comments(task_id, id);
CREATE INDEX history_task_page ON task_history(task_id, id);
CREATE INDEX members_user_project ON project_members(user_id, project_id);
