"""Production entrypoint and HTTP boundary tests; no real service or user data."""
import asyncio
from contextlib import closing
import importlib
import json
import os
from shutil import copyfile

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.db import connect_database, initialize_database
from backend import http_security
from backend.settings import Settings
from test_auth_api import template


@pytest.fixture
def production(tmp_path, monkeypatch):
    import backend.settings as settings_module
    monkeypatch.setattr(os, 'environ', os.environ.copy())
    root = tmp_path / 'checkout'
    root.mkdir()
    (root / 'edition.json').write_text(json.dumps({'edition': 'testing', 'build_id': 'production-test'}))
    path = root / 'data' / 'task-manager.db'
    initialize_database(path)
    monkeypatch.setattr(settings_module, 'ROOT', root)
    values = dict(APP_EDITION='testing', APP_ENV='production', COOKIE_SECURE='true',
                  PUBLIC_ORIGIN='https://tasks.school.ts.net', WEB_HOST='127.0.0.1', WEB_PORT='8003',
                  WEB_WORKERS='1', DATABASE_PATH='data/task-manager.db', APP_TIMEZONE='Asia/Ho_Chi_Minh')
    for name in (*values, 'BUILD_ID', 'WEB_CONCURRENCY', 'FORWARDED_ALLOW_IPS'):
        monkeypatch.delenv(name, raising=False)
    config = tmp_path / 'production.env'
    config.write_text('\n'.join(f'{key}={value}' for key, value in values.items()), encoding='utf-8')
    return importlib.import_module('scripts.run_production'), config, path


def test_check_is_read_only_and_run_pins_server_options(production, monkeypatch):
    launcher, config, path = production
    import uvicorn
    calls = []
    monkeypatch.setattr(uvicorn, 'run', lambda *args, **kwargs: calls.append((args, kwargs)))
    before = path.read_bytes(), path.stat().st_mtime_ns
    monkeypatch.setenv('FORWARDED_ALLOW_IPS', '*')
    monkeypatch.setenv('UVICORN_PROXY_HEADERS', 'true')
    monkeypatch.setenv('UVICORN_WORKERS', '8')
    assert launcher.main(['--env-file', str(config), '--check']) == 0
    assert not calls and (path.read_bytes(), path.stat().st_mtime_ns) == before
    assert launcher.main(['--env-file', str(config)]) == 0
    args, kwargs = calls.pop()
    assert args == ('backend.app:app',)
    assert kwargs == dict(host='127.0.0.1', port=8003, workers=1, reload=False,
                          proxy_headers=False, forwarded_allow_ips='', loop='asyncio', http='h11', ws='none',
                          server_header=False, access_log=False, limit_concurrency=16, backlog=32,
                          timeout_keep_alive=5, timeout_graceful_shutdown=15)


@pytest.mark.parametrize('name,value', [
    ('APP_ENV', 'development'), ('COOKIE_SECURE', 'false'), ('APP_EDITION', 'ai'),
    ('PUBLIC_ORIGIN', 'http://tasks.school.ts.net'), ('PUBLIC_ORIGIN', 'https://replace-me.example.invalid'),
    ('PUBLIC_ORIGIN', 'https://example.com'), ('PUBLIC_ORIGIN', 'https://127.0.0.1'),
    ('PUBLIC_ORIGIN', 'https://tasks.school.ts.net:bad'), ('PUBLIC_ORIGIN', 'https://localhost'),
    ('PUBLIC_ORIGIN', 'https://bad host.ts.net'), ('PUBLIC_ORIGIN', 'https://tasks.school.ts.net:444'),
    ('PUBLIC_ORIGIN', 'https://tasks.school.ts.net:443'), ('PUBLIC_ORIGIN', 'https://Tasks.School.ts.net'),
    ('WEB_HOST', '0.0.0.0'), ('WEB_PORT', '8000'), ('WEB_WORKERS', '2'),
    ('WEB_CONCURRENCY', '2'), ('DATABASE_PATH', 'data/other.db'),
])
def test_unsafe_config_or_environment_override_fails_closed(production, monkeypatch, name, value):
    launcher, config, _ = production
    monkeypatch.setenv(name, value)
    with pytest.raises((ValueError, RuntimeError, FileNotFoundError)):
        launcher.main(['--env-file', str(config), '--check'])


@pytest.mark.parametrize('mode', ['missing', 'wrong-schema'])
def test_db_is_never_created_or_migrated(production, mode):
    launcher, config, path = production
    path.unlink()
    if mode == 'wrong-schema':
        with closing(connect_database(path, create=True)) as connection:
            connection.execute('CREATE TABLE unexpected (id INTEGER)')
    before = path.read_bytes() if path.exists() else None
    with pytest.raises((ValueError, RuntimeError, FileNotFoundError)):
        launcher.main(['--env-file', str(config), '--check'])
    assert (path.read_bytes() if path.exists() else None) == before


def test_missing_env_file_and_required_values_fail_closed(production, monkeypatch):
    launcher, config, _ = production
    with pytest.raises(FileNotFoundError):
        launcher.main(['--env-file', str(config.with_suffix('.missing')), '--check'])
    config.write_text('APP_ENV=production\n', encoding='utf-8')
    with pytest.raises(ValueError):
        launcher.main(['--env-file', str(config), '--check'])


def test_production_host_cookie_csrf_and_private_paths(template, tmp_path):
    path = tmp_path / 'production.db'
    copyfile(template, path)
    settings = Settings(database_path=path, public_origin='https://tasks.school.ts.net',
                        environment='production', cookie_secure=True)
    with TestClient(create_app(settings), base_url=settings.public_origin,
                    headers={'X-Requested-With': 'TaskManager', 'Origin': settings.public_origin}) as client:
        for host in ('evil.example', 'tasks.school.ts.net.evil.example', 'www.tasks.school.ts.net', ''):
            response = client.get('/health', headers={'host': host})
            assert response.status_code == 400
            assert response.headers['strict-transport-security'] == 'max-age=31536000'
            assert response.headers['x-content-type-options'] == 'nosniff'
        assert client.get('/health').status_code == 200
        response = client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': 'demo123'})
        assert response.status_code == 200
        cookie = response.headers['set-cookie']
        assert '__Host-task_manager_session=' in cookie and 'Secure' in cookie and 'HttpOnly' in cookie
        assert 'SameSite=lax' in cookie and 'Domain=' not in cookie
        assert client.post('/api/projects', json={'name': 'blocked'}).status_code == 403
        for path in ('/config/production.env', '/data/task-manager.db', '/requirements-web-lock.txt', '/docs/production.md'):
            assert client.get(path).status_code == 404


@pytest.mark.parametrize('chunks,delay,expected', [
    ([b'{}'], 0, 200), ([b'a' * 8192, b'b' * 8192], 0, 200),
    ([b'a' * 8192, b'b' * 8193], 0, 413), ([b'{}'], .04, 408),
    ([b'a', b'b', b'c'], .015, 408),
])
def test_body_size_and_total_receive_deadline(monkeypatch, chunks, delay, expected):
    monkeypatch.setattr(http_security, 'BODY_TIMEOUT_SECONDS', .025, raising=False)
    called, messages = [], []
    settings = Settings(public_origin='https://tasks.school.ts.net', cookie_secure=True, environment='production')
    async def endpoint(scope, receive, send):
        called.append((await receive())['body'])
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'ok'})
    remaining = list(chunks)
    async def receive():
        await asyncio.sleep(delay)
        return {'type': 'http.request', 'body': remaining.pop(0), 'more_body': bool(remaining)}
    async def send(message):
        messages.append(message)
    scope = {'type': 'http', 'method': 'POST', 'path': '/api/auth/login', 'headers': [
        (b'host', b'tasks.school.ts.net'), (b'origin', settings.public_origin.encode()),
        (b'x-requested-with', b'TaskManager'), (b'content-type', b'application/json')]}
    asyncio.run(http_security.BrowserBoundary(endpoint, settings)(scope, receive, send))
    assert messages[0]['status'] == expected
    assert bool(called) == (expected == 200)
    assert dict(messages[0]['headers'])[b'x-content-type-options'] == b'nosniff'
    if expected == 408:
        assert json.loads(messages[1]['body'])['error']['code'] == 'BODY_TIMEOUT'
