from contextlib import closing
import sqlite3

import pytest

from backend import db


STAMP = '2026-10-13T09:00:00Z'


@pytest.fixture
def connection(tmp_path):
    path = tmp_path / 'schema.db'
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        yield connection


def add_users(connection):
    connection.executemany(
        'INSERT INTO users(id,username,password_hash,display_name,created_at) VALUES(?,?,?,?,?)',
        [(1, 'owner', 'scrypt$sample-hash-for-schema-only', 'Owner', STAMP),
         (2, 'member', 'scrypt$sample-hash-for-schema-only', 'Member', STAMP),
         (3, 'outside', 'scrypt$sample-hash-for-schema-only', 'Outside', STAMP)],
    )


def add_project(connection):
    with db.transaction(connection):
        add_users(connection)
        connection.execute('INSERT INTO projects(id,name,owner_id,created_at,updated_at) VALUES(10,?,?,?,?)',
                           ('Example', 1, STAMP, STAMP))
        connection.executemany('INSERT INTO project_members VALUES(?,?,?)', [(10, 1, STAMP), (10, 2, STAMP)])


def test_initialize_is_idempotent_and_connection_enforces_foreign_keys(tmp_path):
    path = tmp_path / 'app.db'
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 3
        assert connection.execute('PRAGMA application_id').fetchone()[0] == db.APPLICATION_ID
        add_project(connection)
    db.initialize_database(path)
    with closing(db.connect_database(path)) as reopened:
        assert reopened.execute('SELECT name FROM projects').fetchone()['name'] == 'Example'
        assert reopened.execute('PRAGMA foreign_key_check').fetchall() == []


def test_missing_database_is_not_created_by_normal_connection(tmp_path):
    path = tmp_path / 'missing.db'
    with pytest.raises((FileNotFoundError, sqlite3.OperationalError)):
        db.connect_database(path)
    assert not path.exists()


def test_unknown_and_newer_databases_are_preserved(tmp_path):
    unknown = tmp_path / 'unknown.db'
    with closing(sqlite3.connect(unknown, autocommit=True)) as connection:
        connection.execute('CREATE TABLE sentinel(value TEXT)')
        connection.execute("INSERT INTO sentinel VALUES('keep')")
    before = unknown.read_bytes()
    with pytest.raises(RuntimeError):
        db.initialize_database(unknown)
    assert unknown.read_bytes() == before
    newer = tmp_path / 'newer.db'
    db.initialize_database(newer)
    with closing(sqlite3.connect(newer, autocommit=True)) as connection:
        connection.execute('PRAGMA user_version=4')
    with pytest.raises(RuntimeError):
        db.initialize_database(newer)
    with closing(sqlite3.connect(newer)) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 4


def test_failed_schema_migration_rolls_back_every_statement(tmp_path, monkeypatch):
    schema = tmp_path / 'broken.sql'
    schema.write_text('CREATE TABLE first_row(id INTEGER);\nTHIS IS NOT SQL;\n', encoding='utf-8')
    monkeypatch.setattr(db, 'SCHEMA_FILE', schema)
    path = tmp_path / 'broken.db'
    with pytest.raises(sqlite3.Error):
        db.initialize_database(path)
    with closing(sqlite3.connect(path)) as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 0
        assert connection.execute('PRAGMA application_id').fetchone()[0] == 0


def test_owner_membership_is_required_at_commit_and_cannot_be_removed(connection):
    add_users(connection)
    with pytest.raises(sqlite3.IntegrityError):
        with db.transaction(connection):
            connection.execute('INSERT INTO projects(name,owner_id,created_at,updated_at) VALUES(?,?,?,?)',
                               ('No owner membership', 1, STAMP, STAMP))
    assert connection.execute('SELECT count(*) FROM projects').fetchone()[0] == 0
    with db.transaction(connection):
        connection.execute('INSERT INTO projects(id,name,owner_id,created_at,updated_at) VALUES(10,?,?,?,?)',
                           ('Correct', 1, STAMP, STAMP))
        connection.execute('INSERT INTO project_members VALUES(10,1,?)', (STAMP,))
    with pytest.raises(sqlite3.IntegrityError):
        with db.transaction(connection):
            connection.execute('DELETE FROM project_members WHERE project_id=10 AND user_id=1')
    assert connection.execute('SELECT count(*) FROM project_members').fetchone()[0] == 1


def test_assignment_requires_same_project_membership_and_null_is_valid(connection):
    add_project(connection)
    query = 'INSERT INTO tasks(project_id,title,assignee_id,created_at,updated_at) VALUES(10,?,?,?,?)'
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(query, ('Wrong assignment', 3, STAMP, STAMP))
    connection.execute(query, ('Not assigned', None, STAMP, STAMP))
    connection.execute(query, ('Assigned member', 2, STAMP, STAMP))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('DELETE FROM project_members WHERE project_id=10 AND user_id=2')


@pytest.mark.parametrize('field,value', [
    ('title', ''), ('title', '   '), ('title', 'a' * 121), ('description', 'a' * 2001),
    ('status', None), ('status', 'blocked'), ('priority', 'urgent'), ('version', 0), ('version', 1.5),
    ('due_date', '2026-02-30'), ('due_date', '2025-02-29'), ('due_date', '2026-13-01'),
    ('due_date', '0000-01-01'), ('due_date', '2026-1-01'), ('due_date', '2026-10-14T00:00:00Z'),
])
def test_direct_sql_rejects_bad_task_values(connection, field, value):
    add_project(connection)
    connection.execute('INSERT INTO tasks(id,project_id,title,created_at,updated_at) VALUES(1,10,?,?,?)',
                       ('Valid', STAMP, STAMP))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(f'UPDATE tasks SET {field}=? WHERE id=1', (value,))


def test_calendar_boundaries_and_unicode_lengths(connection):
    add_project(connection)
    for due in ('2024-02-29', '0001-01-01', '0099-01-01', '9999-12-31', None):
        connection.execute('INSERT INTO tasks(project_id,title,due_date,created_at,updated_at) VALUES(10,?,?,?,?)',
                           ('😀' * 120, due, STAMP, STAMP))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('INSERT INTO tasks(project_id,title,created_at,updated_at) VALUES(10,?,?,?)',
                           ('😀' * 121, STAMP, STAMP))


@pytest.mark.parametrize('username', ['Owner', ' owner', 'bad user', 'éabc', 'ab', 'a' * 33])
def test_users_are_canonical_ascii_usernames(connection, username):
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('INSERT INTO users(username,password_hash,display_name,created_at) VALUES(?,?,?,?)',
                           (username, 'scrypt$schema-only-fake-hash', 'Display', STAMP))


def test_unique_members_comments_audit_and_reference_integrity(connection):
    add_project(connection)
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('INSERT INTO project_members VALUES(10,2,?)', (STAMP,))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('INSERT INTO users(username,password_hash,display_name,created_at) VALUES(?,?,?,?)',
                           ('owner', 'scrypt$schema-only-fake-hash', 'Duplicate', STAMP))
    connection.execute('INSERT INTO tasks(id,project_id,title,created_at,updated_at) VALUES(1,10,?,?,?)',
                       ('Example', STAMP, STAMP))
    for body in ('', '   ', 'a' * 1001):
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute('INSERT INTO comments(task_id,author_id,body,created_at) VALUES(1,2,?,?)', (body, STAMP))
    connection.execute('INSERT INTO comments(task_id,author_id,body,created_at) VALUES(1,2,?,?)', ('Keep comment', STAMP))
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('DELETE FROM users WHERE id=2')
    for payload in ('not json', '[]', 'null'):
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute('INSERT INTO task_history(task_id,actor_id,action,after_json,created_at) VALUES(1,1,?,?,?)',
                               ('updated', payload, STAMP))
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


@pytest.mark.parametrize('created,expires', [
    ('a', 'b'), (STAMP, STAMP), ('2026-10-13T09:00:00+00:00', STAMP),
    ('2026-02-30T09:00:00Z', '2026-03-03T09:00:00Z'),
    ('2026-10-13T24:00:00Z', '2026-10-15T09:00:00Z'),
    (STAMP, 'not a date'), ('0000-01-01T00:00:00Z', STAMP),
])
def test_sessions_reject_invalid_or_noncanonical_expiration(connection, created, expires):
    add_users(connection)
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)',
                           ('a' * 64, 1, 'x' * 32, created, expires))
