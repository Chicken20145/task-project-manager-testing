from contextlib import closing
import sqlite3

import pytest

from backend import db
from test_schema import add_project


def legacy_database(path):
    with closing(db.connect_database(path, create=True)) as connection:
        connection.executescript(db.SCHEMA_FILE.read_text(encoding='utf-8'))
        connection.execute(f'PRAGMA application_id={db.APPLICATION_ID}')
        connection.execute('PRAGMA user_version=1')
        add_project(connection)
        return {table: [tuple(r) for r in connection.execute(f'SELECT * FROM {table}')] for table in ['users', 'projects', 'project_members']}


def test_migrate_v1_preserves_existing_data_and_is_idempotent(tmp_path):
    path = tmp_path / 'old.db'
    before = legacy_database(path)
    db.initialize_database(path)
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 3
        assert connection.execute('SELECT count(*) FROM daily_reports').fetchone()[0] == 0
        for table, rows in before.items():
            assert [tuple(r) for r in connection.execute(f'SELECT * FROM {table}')] == rows
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []


def test_failed_v1_migration_rolls_back_without_partial_table(tmp_path, monkeypatch):
    path = tmp_path / 'old.db'
    before = legacy_database(path)
    broken = tmp_path / 'broken.sql'
    broken.write_text('CREATE TABLE partial(id INTEGER);\nINVALID SQL;\n', encoding='utf-8')
    monkeypatch.setattr(db, 'REPORT_SCHEMA_FILE', broken)
    with pytest.raises(sqlite3.Error):
        db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 1
        assert not connection.execute("SELECT name FROM sqlite_master WHERE name IN ('partial','daily_reports')").fetchall()
        assert [tuple(r) for r in connection.execute('SELECT * FROM users')] == before['users']
