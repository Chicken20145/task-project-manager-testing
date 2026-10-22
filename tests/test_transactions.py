from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier
import json
import sqlite3

import pytest

from backend.db import connect_database, initialize_database
from backend.repository import Store, DataError
from backend.seed import seed_database


STAMP = '2026-10-14T09:00:00Z'


@pytest.fixture
def database(tmp_path):
    path = tmp_path / 'transactions.db'
    initialize_database(path)
    with closing(connect_database(path)) as connection:
        seed_database(connection, password='demo123')
    return path


def history(connection, table='task_history'):
    return connection.execute(f'SELECT * FROM {table} ORDER BY id').fetchall()


def test_project_creation_is_atomic_with_owner_membership_and_audit(database):
    with closing(connect_database(database)) as connection:
        store = Store(connection, 2, now=STAMP)
        project = store.create_project({'name': '  New project  ', 'description': 'Details'})
        assert project['name'] == 'New project' and project['owner_id'] == 2 and project['version'] == 1
        assert connection.execute('SELECT user_id FROM project_members WHERE project_id=?', (project['id'],)).fetchone()[0] == 2
        entry = history(connection, 'project_history')[-1]
        assert entry['action'] == 'created' and json.loads(entry['after_json'])['id'] == project['id']
        before_count = connection.execute('SELECT count(*) FROM projects').fetchone()[0]
        connection.execute("CREATE TRIGGER fail_project_audit BEFORE INSERT ON project_history BEGIN SELECT RAISE(ABORT,'test audit failed'); END")
        with pytest.raises(sqlite3.IntegrityError):
            store.create_project({'name': 'Should rollback'})
        assert connection.execute('SELECT count(*) FROM projects').fetchone()[0] == before_count
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []


def test_task_permissions_validation_and_read_revocation(database):
    with closing(connect_database(database)) as connection:
        owner, member, outside = (Store(connection, user, now=STAMP) for user in (1, 2, 3))
        for operation in (lambda: outside.get_project(10), lambda: outside.get_task(101)):
            with pytest.raises(DataError) as error:
                operation()
            assert error.value.status == 404
        task = owner.create_task(10, {'title': '  Work  ', 'assignee_id': 2, 'due_date': None})
        assert task['title'] == 'Work' and task['status'] == 'todo'
        with pytest.raises(DataError) as error:
            owner.create_task(10, {'title': 'Bad', 'assignee_id': 3})
        assert error.value.status == 422
        for changes in ({'title': 'not allowed', 'version': 1}, {'project_id': 11, 'version': 1}):
            with pytest.raises(DataError) as error:
                member.update_task(task['id'], changes)
            assert error.value.status == 403
        updated = member.update_task(task['id'], {'status': 'done', 'version': 1})
        assert updated['version'] == 2 and updated['status'] == 'done'
        with pytest.raises(DataError) as error:
            member.update_task(101, {'status': 'done', 'version': 1})
        assert error.value.status == 403
        with pytest.raises(DataError):
            Store(connection, 999).get_project(10)
        owner.remove_member(10, 2)
        with pytest.raises(DataError) as error:
            member.get_task(task['id'])
        assert error.value.status == 404


def test_stale_versions_and_injected_audit_failure_leave_task_unchanged(database):
    with closing(connect_database(database)) as connection:
        owner = Store(connection, 1, now=STAMP)
        updated = owner.update_task(101, {'status': 'done', 'version': 1})
        before = len(history(connection))
        for operation in (lambda: owner.update_task(101, {'title': 'stale', 'version': 1}),
                          lambda: owner.archive_task(101, 1)):
            with pytest.raises(DataError) as error:
                operation()
            assert error.value.code == 'VERSION_CONFLICT'
        assert owner.get_task(101) == updated and len(history(connection)) == before
        connection.execute("CREATE TRIGGER fail_task_audit BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT,'test audit failed'); END")
        with pytest.raises(sqlite3.IntegrityError):
            owner.update_task(101, {'title': 'rolled back', 'version': 2})
        assert owner.get_task(101) == updated and len(history(connection)) == before


def test_two_connections_using_same_version_have_exactly_one_winner(database):
    barrier = Barrier(2)
    def change(status):
        with closing(connect_database(database)) as connection:
            barrier.wait(timeout=5)
            try:
                return Store(connection, 1, now=STAMP).update_task(101, {'status': status, 'version': 1})
            except DataError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, ('todo', 'done')))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert results.count('VERSION_CONFLICT') == 1
    with closing(connect_database(database)) as connection:
        assert connection.execute('SELECT version FROM tasks WHERE id=101').fetchone()[0] == 2
        assert len(history(connection)) == 1


def test_membership_removal_clears_active_and_archived_assignments_atomically(database):
    with closing(connect_database(database)) as connection:
        owner = Store(connection, 1, now=STAMP)
        with pytest.raises(DataError) as error:
            owner.remove_member(10, 1)
        assert error.value.status == 422
        with pytest.raises(DataError) as error:
            owner.add_member(10, 2)
        assert error.value.code == 'DUPLICATE_MEMBER'
        before = [dict(row) for row in connection.execute('SELECT * FROM tasks WHERE project_id=10 AND assignee_id=2')]
        owner.remove_member(10, 2)
        for task in before:
            current = owner.get_task(task['id'])
            assert current['assignee_id'] is None and current['version'] == task['version'] + 1
            assert current['archived_at'] == task['archived_at']
        assert owner.get_task(126)['assignee_id'] is None
        assert len(history(connection)) == len(before)
        assert all(entry['action'] == 'assignee_removed' for entry in history(connection))
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []


def test_failure_mid_removal_rolls_back_membership_tasks_versions_and_audit(database):
    with closing(connect_database(database)) as connection:
        owner = Store(connection, 1, now=STAMP)
        before = [tuple(row) for row in connection.execute('SELECT * FROM tasks ORDER BY id')]
        connection.execute("CREATE TRIGGER fail_removal BEFORE INSERT ON task_history WHEN NEW.task_id=126 BEGIN SELECT RAISE(ABORT,'test last audit failed'); END")
        with pytest.raises(sqlite3.IntegrityError):
            owner.remove_member(10, 2)
        assert [tuple(row) for row in connection.execute('SELECT * FROM tasks ORDER BY id')] == before
        assert connection.execute('SELECT 1 FROM project_members WHERE project_id=10 AND user_id=2').fetchone()
        assert history(connection) == []


def test_archive_retains_comments_history_and_prevents_mutation(database):
    with closing(connect_database(database)) as connection:
        owner = Store(connection, 1, now=STAMP)
        comment = owner.add_comment(101, {'body': '  One\nTwo  '})
        assert comment['body'] == 'One\nTwo'
        task = owner.archive_task(101, 1)
        assert task['archived_at'] == STAMP and task['version'] == 2
        for operation in (lambda: owner.update_task(101, {'status': 'done', 'version': 2}),
                          lambda: owner.add_comment(101, {'body': 'closed'})):
            with pytest.raises(DataError) as error:
                operation()
            assert error.value.code == 'ARCHIVED'
        assert connection.execute('SELECT body FROM comments WHERE task_id=101').fetchone()[0] == 'One\nTwo'
        assert len(history(connection)) == 1
        owner.archive_project(10, 1)
        for operation in (lambda: owner.create_task(10, {'title': 'closed'}), lambda: owner.add_member(10, 3),
                          lambda: owner.remove_member(10, 2), lambda: owner.update_project(10, {'name': 'closed', 'version': 2})):
            with pytest.raises(DataError) as error:
                operation()
            assert error.value.code == 'ARCHIVED'


def test_project_update_conflict_unknown_fields_and_sql_injection_are_safe(database):
    with closing(connect_database(database)) as connection:
        owner = Store(connection, 1, now=STAMP)
        malicious = "Name'); DROP TABLE users;--"
        project = owner.update_project(10, {'name': malicious, 'version': 1})
        assert project['name'] == malicious and project['version'] == 2
        with pytest.raises(DataError) as error:
            owner.archive_project(10, 1)
        assert error.value.code == 'VERSION_CONFLICT'
        for changes in ({'owner_id': 2, 'version': 2}, {'name': 'a', 'version': True}):
            with pytest.raises(DataError) as error:
                owner.update_project(10, changes)
            assert error.value.status == 422
        assert connection.execute('SELECT count(*) FROM users').fetchone()[0] == 3
        for value in ('2026-02-30', '2026-1-01', '0000-01-01'):
            with pytest.raises(DataError) as error:
                owner.create_task(10, {'title': 'Invalid', 'due_date': value})
            assert error.value.status == 422
        assert len(history(connection, 'project_history')) == 1
