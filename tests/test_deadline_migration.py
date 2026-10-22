from contextlib import closing
import sqlite3

import pytest

from backend import db
from test_schema import add_project, STAMP


def old_database(path):
    with closing(db.connect_database(path, create=True)) as connection:
        connection.executescript(db.SCHEMA_FILE.read_text(encoding='utf-8'))
        connection.executescript(db.REPORT_SCHEMA_FILE.read_text(encoding='utf-8'))
        connection.execute(f'PRAGMA application_id={db.APPLICATION_ID}')
        connection.execute('PRAGMA user_version=2')
        add_project(connection)
        connection.execute('INSERT INTO tasks(id,project_id,title,due_date,created_at,updated_at) VALUES(1,10,?,?,?,?)',
                           ('Old deadline', '2024-02-29', STAMP, STAMP))


def test_v2_migration_preserves_legacy_deadline_and_null(tmp_path):
    path = tmp_path / 'v2.db'
    old_database(path)
    db.initialize_database(path)
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 3
        task = connection.execute('SELECT * FROM tasks WHERE id=1').fetchone()
        assert task['due_date'] == '2024-02-29'
        assert task['due_at'] == '2024-02-29T16:59:59Z'
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def test_failed_deadline_migration_rolls_back(tmp_path, monkeypatch):
    path = tmp_path / 'v2.db'
    old_database(path)
    broken = tmp_path / 'broken.sql'
    broken.write_text('ALTER TABLE tasks ADD COLUMN due_at TEXT;\nINVALID SQL;\n', encoding='utf-8')
    monkeypatch.setattr(db, 'DEADLINE_SCHEMA_FILE', broken)
    with pytest.raises(sqlite3.Error):
        db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 2
        assert 'due_at' not in {r[1] for r in connection.execute('PRAGMA table_info(tasks)')}
