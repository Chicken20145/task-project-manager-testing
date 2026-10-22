from contextlib import closing
import json

import pytest
from fastapi.testclient import TestClient

from backend import auth
from backend.db import connect_database
from backend.passwords import hash_password, verify_password
from test_auth_api import HEADERS, login, service, template


def stored(path, sql, values=()):
    with closing(connect_database(path)) as connection:
        return [tuple(row) for row in connection.execute(sql, values)]


def test_profile_is_private_trimmed_persistent_and_only_changes_display_name(service):
    client, path, _, _ = service
    assert client.patch('/api/account/profile', json={'display_name': 'New'}).status_code == 401
    login(client)
    before = stored(path, 'SELECT username,password_hash FROM users WHERE id=1')
    response = client.patch('/api/account/profile', json={'display_name': '  Tên mới 😀  '})
    assert response.status_code == 200, response.text
    assert response.json() == {'id': 1, 'username': 'nguyen.van.a', 'display_name': 'Tên mới 😀'}
    assert client.get('/api/auth/me').json()['user'] == response.json()
    assert stored(path, 'SELECT username,password_hash FROM users WHERE id=1') == before
    assert stored(path, 'SELECT display_name FROM users WHERE id=2') == [('Tran Thi B',)]


@pytest.mark.parametrize('payload', [
    {}, {'display_name': ' '}, {'display_name': 'a' * 81}, {'display_name': '\x00'},
    {'display_name': '\ud800'}, {'display_name': 'Name', 'username': 'other'},
])
def test_invalid_profile_is_atomic_and_does_not_revoke_session(service, payload):
    client, path, _, _ = service
    login(client)
    before = stored(path, 'SELECT * FROM users')
    response = client.patch('/api/account/profile', content=json.dumps(payload), headers={'content-type': 'application/json'})
    assert response.status_code == 422
    assert stored(path, 'SELECT * FROM users') == before
    assert client.get('/api/auth/me').status_code == 200


def test_password_change_revokes_all_own_sessions_but_not_other_users(service):
    client, path, _, app = service
    login(client)
    with TestClient(app, headers=HEADERS) as second, TestClient(app, headers=HEADERS) as other:
        login(second)
        login(other, 'tran.thi.b')
        first_token = client.cookies.get('task_manager_session')
        second_token = second.cookies.get('task_manager_session')
        new_password = ' mật khẩu mới đủ dài 1@  '
        response = client.post('/api/account/password', json={'current_password': 'demo123', 'new_password': new_password})
        assert response.status_code == 204, response.text
        assert 'Max-Age=0' in response.headers['set-cookie']
        for token in (first_token, second_token):
            assert client.get('/api/auth/me', headers={'cookie': f'task_manager_session={token}'}).status_code == 401
        assert second.get('/api/auth/me').status_code == 401
        assert other.get('/api/auth/me').json()['user']['id'] == 2
        assert stored(path, 'SELECT user_id FROM sessions') == [(2,)]
        assert client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': 'demo123'}).status_code == 401
        assert client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': new_password.strip()}).status_code == 401
        assert client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': new_password}).status_code == 200
        encoded = stored(path, 'SELECT password_hash FROM users WHERE id=1')[0][0]
        assert new_password not in encoded and verify_password(new_password, encoded)


@pytest.mark.parametrize('changes', [
    {'current_password': 'wrong'}, {'new_password': 'a1@bc'}, {'new_password': 'abcdef1'}, {'new_password': 'abcdef@'}, {'new_password': 'a' * 129},
    {'new_password': '\ud800'}, {'new_password': '\x00' + 'a' * 20},
    {'new_password': 123456789012345}, {'confirm_password': 'not-allowed'}, {},
])
def test_password_errors_preserve_hash_and_sessions_without_echoing_secrets(service, changes):
    client, path, _, _ = service
    login(client)
    payload = {'current_password': 'demo123', 'new_password': 'new password long enough1@'} | changes
    if not changes:
        payload = {'current_password': 'demo123'}
    before = stored(path, 'SELECT * FROM users'), stored(path, 'SELECT * FROM sessions')
    response = client.post('/api/account/password', content=json.dumps(payload), headers={'content-type': 'application/json'})
    assert response.status_code == 422
    assert 'demo123' not in response.text and 'new password long enough1@' not in response.text
    assert (stored(path, 'SELECT * FROM users'), stored(path, 'SELECT * FROM sessions')) == before
    assert client.get('/api/auth/me').status_code == 200
    if changes.get('current_password') == 'wrong':
        assert 'current_password' in response.json()['error']['details']


@pytest.mark.parametrize('new_password', ['😀a1@bc', 'a' * 126 + '1@'])
def test_password_unicode_codepoint_boundaries(service, new_password):
    client, _, _, _ = service
    login(client)
    assert client.post('/api/account/password', json={'current_password': 'demo123', 'new_password': new_password}).status_code == 204
    assert client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': new_password}).status_code == 200


def test_same_password_is_rejected_and_csrf_is_required(service):
    client, _, _, _ = service
    password = 'same password long enough1@'
    assert client.post('/api/auth/register', json={'username': 'account.test', 'display_name': 'Test', 'password': password}).status_code == 201
    response = client.post('/api/auth/login', json={'username': 'account.test', 'password': password})
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    assert client.post('/api/account/password', json={'current_password': password, 'new_password': password}).status_code == 422
    client.headers['X-CSRF-Token'] = 'wrong-token'
    assert client.patch('/api/account/profile', json={'display_name': 'Other'}).status_code == 403
    assert client.post('/api/account/password', json={'current_password': password, 'new_password': 'different password long enough1@'}).status_code == 403


def test_inflight_login_cannot_recreate_session_after_password_rotation(service, monkeypatch):
    client, path, _, _ = service
    replacement = hash_password('replacement password long enough1@')
    original = auth.verify_password
    def verify_then_rotate(secret, encoded):
        result = original(secret, encoded)
        with closing(connect_database(path)) as connection:
            connection.execute('UPDATE users SET password_hash=? WHERE id=1', (replacement,))
            connection.execute('DELETE FROM sessions WHERE user_id=1')
        return result
    monkeypatch.setattr(auth, 'verify_password', verify_then_rotate)
    assert client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': 'demo123'}).status_code == 401
    assert not stored(path, 'SELECT id FROM sessions WHERE user_id=1')


def test_password_change_rechecks_revoked_session_before_writing(service, monkeypatch):
    client, path, _, _ = service
    login(client)
    before = stored(path, 'SELECT password_hash FROM users WHERE id=1')
    original = auth.hash_password
    def hash_then_revoke(secret):
        result = original(secret)
        with closing(connect_database(path)) as connection:
            connection.execute('DELETE FROM sessions WHERE user_id=1')
        return result
    monkeypatch.setattr(auth, 'hash_password', hash_then_revoke)
    assert client.post('/api/account/password', json={'current_password': 'demo123', 'new_password': 'new password long enough1@'}).status_code == 401
    assert stored(path, 'SELECT password_hash FROM users WHERE id=1') == before


@pytest.mark.parametrize('display', ['A', '😀' * 80])
def test_valid_profile_unicode_boundaries(service, display):
    client, _, _, _ = service
    login(client)
    response = client.patch('/api/account/profile', json={'display_name': display})
    assert response.status_code == 200 and response.json()['display_name'] == display


def test_password_work_is_limited_but_profile_does_not_take_hash_slots(service):
    client, _, _, app = service
    login(client)
    slots = app.state.auth_limiter.slots
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    try:
        assert client.post('/api/account/password', json={'current_password': 'demo123', 'new_password': 'new password long enough1@'}).status_code == 429
        assert client.patch('/api/account/profile', json={'display_name': 'Still usable'}).status_code == 200
    finally:
        slots.release()
        slots.release()
    assert client.get('/api/auth/me').status_code == 200


def test_password_hash_and_sessions_roll_back_together_on_database_failure(service):
    client, path, _, _ = service
    login(client)
    before = stored(path, 'SELECT password_hash FROM users WHERE id=1'), stored(path, 'SELECT * FROM sessions')
    with closing(connect_database(path)) as connection:
        connection.execute("CREATE TRIGGER fail_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
    response = client.post('/api/account/password', json={'current_password': 'demo123', 'new_password': 'new password long enough1@'})
    assert response.status_code == 500
    assert 'test rollback' not in response.text and 'demo123' not in response.text
    assert (stored(path, 'SELECT password_hash FROM users WHERE id=1'), stored(path, 'SELECT * FROM sessions')) == before
    assert client.get('/api/auth/me').status_code == 200
