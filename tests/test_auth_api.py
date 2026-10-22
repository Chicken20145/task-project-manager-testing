from contextlib import closing
from datetime import datetime, timedelta, timezone
from shutil import copyfile

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.db import connect_database, initialize_database
from backend.seed import seed_database
from backend.settings import Settings


ORIGIN = 'http://testserver'
HEADERS = {'X-Requested-With': 'TaskManager', 'Origin': ORIGIN}


@pytest.fixture(scope='module')
def template(tmp_path_factory):
    path = tmp_path_factory.mktemp('api') / 'template.db'
    initialize_database(path)
    with closing(connect_database(path)) as connection:
        seed_database(connection, password='demo123')
    return path


@pytest.fixture
def service(tmp_path, template):
    path = tmp_path / 'test.db'
    copyfile(template, path)
    clock = [datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc)]
    app = create_app(Settings(database_path=path, public_origin=ORIGIN), clock=lambda: clock[0])
    with TestClient(app, headers=HEADERS) as client:
        yield client, path, clock, app


def login(client, username='nguyen.van.a'):
    response = client.post('/api/auth/login', json={'username': username, 'password': 'demo123'})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return response


def test_register_login_cookie_rotation_and_logout(service):
    client, path, _, _ = service
    payload = {'username': '  User.New  ', 'display_name': '  Người mới  ', 'password': ' mật khẩu đủ dài 1@  '}
    response = client.post('/api/auth/register', json=payload)
    assert response.status_code == 201
    assert response.json() == {'id': 4, 'username': 'user.new', 'display_name': 'Người mới'}
    assert client.get('/api/auth/me').status_code == 401
    assert client.post('/api/auth/register', json=payload).status_code == 409
    bad = client.post('/api/auth/login', json={'username': payload['username'], 'password': payload['password'].strip()})
    assert bad.status_code == 401
    response = client.post('/api/auth/login', json={'username': payload['username'], 'password': payload['password']})
    assert response.status_code == 200
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=lax' in cookie and 'Path=/' in cookie
    assert 'Secure' not in cookie  # explicit local HTTP mode
    old = client.cookies.get('task_manager_session')
    csrf = response.json()['csrf_token']
    assert client.get('/api/auth/me').json() == response.json()
    with closing(connect_database(path)) as connection:
        row = connection.execute('SELECT * FROM sessions').fetchone()
        assert len(row['token_hash']) == 64 and old not in tuple(row)
        assert payload['password'] not in connection.execute('SELECT password_hash FROM users WHERE id=4').fetchone()[0]
    second = client.post('/api/auth/login', json={'username': 'user.new', 'password': payload['password']})
    assert second.status_code == 200 and second.json()['csrf_token'] != csrf
    client.headers['X-CSRF-Token'] = second.json()['csrf_token']
    new = client.cookies.get('task_manager_session')
    assert new != old
    assert client.get('/api/auth/me', headers={'cookie': f'task_manager_session={old}'}).status_code == 401
    assert client.post('/api/auth/logout').status_code == 204
    assert client.get('/api/auth/me').status_code == 401
    assert client.get('/api/auth/me', headers={'cookie': f'task_manager_session={new}'}).status_code == 401


@pytest.mark.parametrize('changes', [
    {'password': 'short'}, {'password': 'a' * 129}, {'password': 123456789012345},
    {'username': 'bad name'}, {'username': 'ábc'}, {'display_name': ' '},
    {'role': 'admin'}, {'confirm_password': 'secret'}, {'display_name': '\ud800'},
    {'username': 'abc\x00'}, {'display_name': 'a' * 81},
])
def test_register_rejects_invalid_fields_without_echoing_secrets(service, changes):
    client, _, _, _ = service
    data = {'username': 'valid.user', 'display_name': 'Name', 'password': 'a valid secret password1@'} | changes
    # ensure_ascii serializes lone surrogate without the HTTP client's UTF-8 encoder rejecting it first
    import json
    response = client.post('/api/auth/register', content=json.dumps(data), headers={'content-type': 'application/json'})
    assert response.status_code == 422
    assert 'a valid secret password1@' not in response.text and 'secret' not in response.text
    assert set(response.json()) == {'error'}


def test_same_origin_csrf_and_content_type_guards(service):
    client, _, _, _ = service
    auth = {'username': 'nguyen.van.a', 'password': 'demo123'}
    for headers in ({'Origin': 'https://evil.example'}, {'Origin': 'null'},
                    {'Sec-Fetch-Site': 'cross-site'}, {'X-Requested-With': ''}):
        assert client.post('/api/auth/login', json=auth, headers=headers).status_code == 403
    assert client.post('/api/auth/login', content='username=x', headers={'content-type': 'text/plain'}).status_code == 415
    login(client)
    for value in ('', 'wrong'):
        assert client.post('/api/projects', json={'name': 'Blocked'}, headers={'X-CSRF-Token': value}).status_code == 403
    assert client.post('/api/projects', json={'name': 'Allowed'}).status_code == 201
    assert client.post('/api/auth/logout', headers={'X-CSRF-Token': 'wrong'}).status_code == 403
    assert client.get('/api/auth/me').status_code == 200


def test_absolute_expiry_persistence_and_secure_settings(service):
    client, path, clock, _ = service
    response = login(client)
    cookies = dict(client.cookies)
    restarted = create_app(Settings(database_path=path, public_origin=ORIGIN), clock=lambda: clock[0])
    with TestClient(restarted, cookies=cookies) as other:
        assert other.get('/api/auth/me').json() == response.json()
    clock[0] += timedelta(hours=8)
    assert client.get('/api/auth/me').status_code == 401
    secure = create_app(Settings(database_path=path, public_origin='https://testserver', cookie_secure=True, environment='production'))
    with TestClient(secure, base_url='https://testserver', headers=HEADERS | {'Origin': 'https://testserver'}) as other:
        response = other.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': 'demo123'})
        assert response.status_code == 200
        assert '__Host-task_manager_session=' in response.headers['set-cookie']
        assert 'Secure' in response.headers['set-cookie'] and 'Domain=' not in response.headers['set-cookie']
    with pytest.raises(ValueError):
        Settings(environment='production', cookie_secure=False)


def test_safe_errors_body_limit_headers_static_and_missing_database(service, tmp_path):
    client, _, _, _ = service
    assert client.post('/api/auth/login', content='{"password":', headers={'content-type': 'application/json'}).status_code == 422
    assert client.post('/api/auth/login', json={'username': 'x', 'password': 'x' * 17000}).status_code == 413
    assert client.get('/api/missing').status_code == 404
    response = client.get('/api/auth/me')
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert "script-src 'self'" in response.headers['content-security-policy']
    static = client.get('/')
    assert static.status_code == 200 and static.headers['cache-control'] == 'no-cache'
    assert client.get('/data/task-manager.db').status_code == 404
    missing = tmp_path / 'absent.db'
    with TestClient(create_app(Settings(database_path=missing, public_origin=ORIGIN))) as other:
        assert other.get('/health').status_code == 200
        response = other.get('/api/auth/me')
        assert response.status_code == 503 and not missing.exists()
        assert str(missing) not in response.text


def test_auth_throttle_limits_hashing_attempts(service):
    client, _, _, _ = service
    # Invalid credentials count too; record attempts before expensive scrypt.
    for _ in range(20):
        assert client.post('/api/auth/login', json={'username': 'x', 'password': ''}).status_code in (401, 422)
    response = client.post('/api/auth/register', json={'username': 'new.user', 'display_name': 'New', 'password': 'a' * 15})
    assert response.status_code == 429 and int(response.headers['retry-after']) > 0


def test_limiter_global_cap_keeps_bounded_valid_counters_and_csrf_handles_bytes():
    from backend.auth import AuthLimiter, require_csrf
    from backend.repository import DataError
    limiter = AuthLimiter()
    for number in range(120):
        with limiter.attempt(str(number)):
            pass
    for number in range(120, 125):
        with pytest.raises(DataError) as error:
            with limiter.attempt(str(number)):
                pass
        assert error.value.status == 429
    assert len(limiter.attempts) <= 120
    with pytest.raises(DataError) as error:
        require_csrf({'csrf_token': 'a' * 43}, '\u00e9' * 43)
    assert error.value.status == 403


def test_malformed_unknown_key_and_unknown_database_fail_safely(service, tmp_path):
    import json
    import sqlite3
    client, _, _, _ = service
    data = {'username': 'valid.user', 'display_name': 'New', 'password': 'long enough password', '\ud800': 'bad'}
    response = client.post('/api/auth/register', content=json.dumps(data), headers={'content-type': 'application/json'})
    assert response.status_code == 422
    assert client.post('/api/auth/register', json=[]).status_code == 422
    unknown = tmp_path / 'unknown.db'
    with sqlite3.connect(unknown) as connection:
        connection.execute('PRAGMA user_version=99')
    with TestClient(create_app(Settings(database_path=unknown, public_origin=ORIGIN)), raise_server_exceptions=False) as other:
        response = other.get('/api/auth/me')
        assert response.status_code == 503
        assert response.headers['cache-control'] == 'no-store'
    with sqlite3.connect(unknown) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 99


def test_streamed_body_cap_is_enforced_without_content_length(service):
    import asyncio
    import httpx
    _, _, _, app = service

    async def check():
        async def chunks():
            for _ in range(20):
                yield b'x' * 1000
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN, headers=HEADERS) as client:
            return await client.post('/api/auth/login', content=chunks(), headers={'content-type': 'application/json'})
    response = asyncio.run(check())
    assert response.status_code == 413 and response.headers['cache-control'] == 'no-store'


def test_unexpected_errors_keep_security_headers_without_leaking_exception(service):
    client, _, _, app = service
    login(client)
    def broken_clock():
        raise ValueError('private internal detail')
    app.state.clock = broken_clock
    with TestClient(app, cookies=dict(client.cookies), raise_server_exceptions=False) as other:
        response = other.get('/api/auth/me')
    assert response.status_code == 500
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert 'private' not in response.text


def test_csrf_from_other_session_and_missing_origin_custom_header_fallback(service):
    client, _, _, app = service
    login(client)
    with TestClient(app, headers={'X-Requested-With': 'TaskManager'}) as other:
        result = other.post('/api/auth/login', json={'username': 'tran.thi.b', 'password': 'demo123'})
        assert result.status_code == 200  # non-browser client without Origin, custom-header fallback
        other.headers['X-CSRF-Token'] = client.headers['X-CSRF-Token']
        assert other.post('/api/projects', json={'name': 'blocked'}).status_code == 403
    response = client.options('/api/projects', headers={'Origin': 'https://evil.example', 'Access-Control-Request-Method': 'POST'})
    assert 'access-control-allow-origin' not in response.headers


def test_hash_concurrency_is_bounded_and_rate_window_expires():
    from backend.auth import AuthLimiter
    from backend.repository import DataError
    limiter = AuthLimiter()
    clock = [0]
    limiter.clock = lambda: clock[0]
    with limiter.attempt('one'):
        with limiter.attempt('two'):
            with pytest.raises(DataError) as error:
                with limiter.attempt('three'):
                    pass
            assert error.value.status == 429
    for _ in range(19):
        with limiter.attempt('one'):
            pass
    with pytest.raises(DataError):
        with limiter.attempt('one'):
            pass
    clock[0] = 60
    with limiter.attempt('one'):
        pass
    assert len(limiter.attempts) == 1
