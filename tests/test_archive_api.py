from contextlib import closing
import json
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend import repository
from backend.db import connect_database
from test_auth_api import service, template, login, HEADERS


def test_archive_restore_delete_permissions_and_cleanup(service):
    client, path, _, _ = service
    login(client)
    project = client.post('/api/projects', json={'name': 'Archive QA'}).json()
    pid = project['id']
    task = client.post(f'/api/projects/{pid}/tasks', json={'title': 'QA', 'assignee_id': 1, 'due_date': '2026-10-20'}).json()
    tid = task['id']
    client.post(f'/api/tasks/{tid}/comments', json={'body': 'Keep until delete'})
    client.post('/api/notifications/daily', json={})
    assert client.request('DELETE', f'/api/projects/{pid}', json={'version': 1}).status_code == 409
    client.post(f'/api/projects/{pid}/members', json={'user_id': 2})
    archived = client.post(f'/api/projects/{pid}/archive', json={'version': 1}).json()
    assert pid in [p['id'] for p in client.get('/api/projects/archived').json()['items']]
    assert client.post(f'/api/projects/{pid}/restore', json={'version': 1}).status_code == 409
    login(client, 'tran.thi.b')
    assert pid not in [p['id'] for p in client.get('/api/projects/archived').json()['items']]
    assert client.post(f'/api/projects/{pid}/restore', json={'version': archived['version']}).status_code == 403
    assert client.request('DELETE', f'/api/projects/{pid}', json={'version': archived['version']}).status_code == 403
    login(client, 'le.van.c')
    assert client.request('DELETE', f'/api/projects/{pid}', json={'version': archived['version']}).status_code == 404
    login(client)
    assert client.post(f'/api/projects/{pid}/restore', json={'version': archived['version']}, headers={'X-CSRF-Token': 'bad'}).status_code == 403
    restored = client.post(f'/api/projects/{pid}/restore', json={'version': archived['version']}).json()
    assert restored['archived_at'] is None and restored['version'] == 3
    assert client.get(f'/api/tasks/{tid}').status_code == 200
    archived = client.post(f'/api/projects/{pid}/archive', json={'version': restored['version']}).json()
    assert client.request('DELETE', f'/api/projects/{pid}', json={'version': 2}).status_code == 409
    assert client.request('DELETE', f'/api/projects/{pid}', json={'version': archived['version']}).status_code == 204
    assert client.get(f'/api/projects/{pid}').status_code == 404
    with closing(connect_database(path)) as connection:
        for table, key, value in [('tasks', 'project_id', pid), ('project_history', 'project_id', pid),
                                  ('project_members', 'project_id', pid), ('comments', 'task_id', tid), ('task_history', 'task_id', tid)]:
            assert connection.execute(f'SELECT count(*) FROM {table} WHERE {key}=?', (value,)).fetchone()[0] == 0
        for row in connection.execute('SELECT tasks_json FROM daily_reports'):
            assert all(t['project_id'] != pid for t in json.loads(row[0]))
        assert connection.execute('SELECT count(*) FROM users').fetchone()[0] == 3
        assert connection.execute('SELECT 1 FROM projects WHERE id=10').fetchone()
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []


def test_restore_keeps_individual_task_archive_and_failed_delete_rolls_back(service):
    client, path, _, _ = service
    login(client)
    pid = client.post('/api/projects', json={'name': 'Rollback QA'}).json()['id']
    task = client.post(f'/api/projects/{pid}/tasks', json={'title': 'Individually archived', 'assignee_id': 1, 'due_date': '2026-10-20'}).json()
    client.post('/api/notifications/daily', json={})
    archived_task = client.post(f"/api/tasks/{task['id']}/archive", json={'version': task['version']}).json()
    project = client.post(f'/api/projects/{pid}/archive', json={'version': 1}).json()
    restored = client.post(f'/api/projects/{pid}/restore', json={'version': project['version']}).json()
    assert client.get(f"/api/tasks/{task['id']}").json()['archived_at'] == archived_task['archived_at']
    project = client.post(f'/api/projects/{pid}/archive', json={'version': restored['version']}).json()
    with closing(connect_database(path)) as connection:
        before = {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')]
                  for table in ('projects', 'tasks', 'task_history', 'project_history', 'project_members', 'daily_reports')}
        connection.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'rollback QA'); END")
    response = client.request('DELETE', f'/api/projects/{pid}', json={'version': project['version']})
    assert response.status_code == 500 and 'rollback QA' not in response.text
    with closing(connect_database(path)) as connection:
        for table, rows in before.items():
            assert [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')] == rows


@pytest.mark.parametrize('action', ['restore', 'delete'])
def test_archive_write_reauthenticates_after_waiting_for_transaction(service, monkeypatch, action):
    client, path, _, _ = service
    login(client)
    project = client.post('/api/projects', json={'name': 'Reauth QA'}).json()
    pid = project['id']
    project = client.post(f'/api/projects/{pid}/archive', json={'version': project['version']}).json()
    original = repository.transaction
    @contextmanager
    def revoke_then_begin(connection):
        with closing(connect_database(path)) as other:
            other.execute('DELETE FROM sessions WHERE user_id=1')
        with original(connection):
            yield connection
    monkeypatch.setattr(repository, 'transaction', revoke_then_begin)
    response = client.post(f'/api/projects/{pid}/restore', json={'version': project['version']}) if action == 'restore' else client.request('DELETE', f'/api/projects/{pid}', json={'version': project['version']})
    assert response.status_code == 401
    with closing(connect_database(path)) as connection:
        assert connection.execute('SELECT version,archived_at FROM projects WHERE id=?', (pid,)).fetchone()['version'] == project['version']


def test_concurrent_restore_only_one_request_can_change_version(service):
    client, _, _, app = service
    login(client)
    pid = client.post('/api/projects', json={'name': 'Concurrent QA'}).json()['id']
    project = client.post(f'/api/projects/{pid}/archive', json={'version': 1}).json()
    with TestClient(app, headers=HEADERS) as second:
        login(second)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda c: c.post(f'/api/projects/{pid}/restore', json={'version': project['version']}).status_code,
                                      (client, second)))
    assert sorted(responses) == [200, 409]


@pytest.mark.parametrize('action', ['restore', 'delete'])
def test_expiry_during_write_lock_wait_blocks_archive_mutation(service, monkeypatch, action):
    client, path, clock, _ = service
    login(client)
    pid = client.post('/api/projects', json={'name': 'Expiry QA'}).json()['id']
    project = client.post(f'/api/projects/{pid}/archive', json={'version': 1}).json()
    original = repository.transaction
    @contextmanager
    def expire_then_begin(connection):
        clock[0] += timedelta(hours=8)
        with original(connection):
            yield connection
    monkeypatch.setattr(repository, 'transaction', expire_then_begin)
    response = client.post(f'/api/projects/{pid}/restore', json={'version': project['version']}) if action == 'restore' else client.request('DELETE', f'/api/projects/{pid}', json={'version': project['version']})
    assert response.status_code == 401
    with closing(connect_database(path)) as connection:
        assert connection.execute('SELECT version FROM projects WHERE id=?', (pid,)).fetchone()[0] == project['version']
