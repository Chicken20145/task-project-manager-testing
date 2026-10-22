from contextlib import closing, contextmanager
from datetime import timedelta

import pytest

from backend import repository, api, auth
from backend.db import connect_database
from test_auth_api import service, template, login


@pytest.mark.parametrize('mode', ['revoked', 'expired'])
@pytest.mark.parametrize('method,url,payload', [
    ('POST', '/api/projects', {'name': 'Forbidden write'}),
    ('PATCH', '/api/projects/10', {'name': 'Forbidden write', 'version': 1}),
    ('POST', '/api/projects/10/archive', {'version': 1}),
    ('POST', '/api/projects/10/tasks', {'title': 'Forbidden write'}),
    ('PATCH', '/api/tasks/101', {'title': 'Forbidden write', 'version': 1}),
    ('POST', '/api/tasks/101/archive', {'version': 1}),
    ('POST', '/api/tasks/101/comments', {'body': 'Forbidden write'}),
    ('POST', '/api/projects/10/members', {'user_id': 3}),
    ('DELETE', '/api/projects/10/members/2', None),
])
def test_every_business_write_rechecks_session_inside_lock(service, monkeypatch, mode, method, url, payload):
    client, path, clock, _ = service
    login(client)
    tables = ('projects', 'tasks', 'project_members', 'comments', 'task_history', 'project_history')
    def snapshot():
        with closing(connect_database(path)) as connection:
            return {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')]
                    for table in tables}
    before = snapshot()
    original = repository.transaction
    @contextmanager
    def invalidate_then_begin(connection):
        if mode == 'revoked':
            with closing(connect_database(path)) as other:
                other.execute('DELETE FROM sessions WHERE user_id=1')
        else:
            clock[0] += timedelta(hours=8)
        with original(connection):
            yield connection
    monkeypatch.setattr(repository, 'transaction', invalidate_then_begin)
    response = client.request(method, url, json=payload) if payload is not None else client.request(method, url)
    assert response.status_code == 401
    assert snapshot() == before


@pytest.mark.parametrize('mode', ['revoked', 'expired'])
@pytest.mark.parametrize('module,method,url,payload', [
    (auth, 'PATCH', '/api/account/profile', {'display_name': 'Forbidden write'}),
    (auth, 'POST', '/api/account/password', {'current_password': 'demo123', 'new_password': 'Ab@123'}),
    (api, 'PATCH', '/api/account/preferences', {'timezone': 'UTC'}),
    (api, 'POST', '/api/notifications/daily', {}),
    (api, 'POST', '/api/auth/logout', None),
])
def test_account_and_report_writes_recheck_live_session(service, monkeypatch, mode, module, method, url, payload):
    client, path, clock, _ = service
    login(client)
    original = module.transaction
    @contextmanager
    def invalidate_then_begin(connection):
        if mode == 'revoked':
            with closing(connect_database(path)) as other:
                other.execute('DELETE FROM sessions WHERE user_id=1')
        else:
            clock[0] += timedelta(hours=8)
        with original(connection):
            yield connection
    with closing(connect_database(path)) as connection:
        tables = ('users', 'account_preferences', 'daily_reports')
        before = {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')] for table in tables}
    monkeypatch.setattr(module, 'transaction', invalidate_then_begin)
    response = client.request(method, url, json=payload) if payload is not None else client.request(method, url)
    assert response.status_code == 401
    with closing(connect_database(path)) as connection:
        assert {table: [tuple(row) for row in connection.execute(f'SELECT * FROM {table}')] for table in tables} == before
