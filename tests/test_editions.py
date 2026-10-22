from contextlib import closing
import json
from pathlib import Path
from shutil import copyfile

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.db import connect_database
from backend.settings import Settings, edition_identity, guard_edition_database
from test_auth_api import template


def marker(root, edition='ai', build='baseline-20261019'):
    (root / 'edition.json').write_text(json.dumps({'edition': edition, 'build_id': build}), encoding='utf-8')


def test_settings_cookie_names_are_distinct_and_baseline_is_compatible(tmp_path):
    cookies = {Settings(edition=edition).cookie_name for edition in ('baseline', 'ai', 'testing')}
    assert cookies == {'task_manager_session', 'task_manager_ai_session', 'task_manager_testing_session'}
    secure = Settings(edition='ai', public_origin='https://ai.example', cookie_secure=True, environment='production')
    assert secure.cookie_name == '__Host-task_manager_ai_session'
    assert Settings(edition='testing', public_origin='https://test.example', cookie_secure=True).cookie_name == '__Host-task_manager_testing_session'
    with pytest.raises(ValueError):
        Settings(edition='unknown')
    with pytest.raises(ValueError):
        Settings(build_id='bad\x00build')
    assert edition_identity(tmp_path) == {'edition': 'baseline', 'build_id': 'baseline-local'}


@pytest.mark.parametrize('edition,build', [('baseline', 'b'), ('other', 'b'), ('ai', ''), ('testing', 'x' * 81), ('ai', '\ud800')])
def test_marker_fails_closed_for_invalid_identity(tmp_path, edition, build):
    marker(tmp_path, edition, build)
    with pytest.raises(ValueError):
        edition_identity(tmp_path)


def test_environment_identity_and_database_cannot_cross_checkouts(tmp_path, monkeypatch):
    import backend.settings as module
    root = tmp_path / 'source'
    root.mkdir()
    marker(root)
    monkeypatch.setattr(module, 'ROOT', root)
    for name in ('DATABASE_PATH', 'APP_EDITION', 'BUILD_ID', 'PUBLIC_ORIGIN', 'APP_ENV', 'COOKIE_SECURE'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    settings = Settings.from_environment()
    assert settings.edition == 'ai' and settings.build_id == 'baseline-20261019'
    assert settings.database_path == root / 'data' / 'task-manager.db'
    monkeypatch.setenv('APP_EDITION', 'testing')
    with pytest.raises(ValueError):
        Settings.from_environment()
    monkeypatch.setenv('APP_EDITION', 'ai')
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'other.db'))
    with pytest.raises(ValueError):
        Settings.from_environment()
    monkeypatch.setenv('DATABASE_PATH', 'data/task-manager.db')
    assert Settings.from_environment().database_path == root / 'data' / 'task-manager.db'


def test_database_guards_reject_hardlinks_and_alias_metadata(tmp_path, monkeypatch):
    root = tmp_path / 'checkout'
    data = root / 'data'
    data.mkdir(parents=True)
    path = data / 'task-manager.db'
    path.write_bytes(b'fixture')
    assert guard_edition_database(root, path) == path
    import os
    alias = tmp_path / 'shared.db'
    os.link(path, alias)
    with pytest.raises(ValueError):
        guard_edition_database(root, path)
    alias.unlink()
    # Windows symlink privilege is not assumed; exercise deterministic guard metadata.
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda p: p == data or original(p))
    with pytest.raises(ValueError):
        guard_edition_database(root, path)


def test_two_editions_with_shared_cookie_jar_have_isolated_login_logout_writes_and_csrf(tmp_path, template):
    paths = {edition: tmp_path / (edition + '.db') for edition in ('ai', 'testing')}
    for path in paths.values():
        copyfile(template, path)
    origins = {'ai': 'http://testserver:8002', 'testing': 'http://testserver:8003'}
    apps = {edition: create_app(Settings(database_path=path, edition=edition, build_id='baseline-20261019',
                                         public_origin=origins[edition])) for edition, path in paths.items()}
    headers = {'X-Requested-With': 'TaskManager'}
    with TestClient(apps['ai'], base_url=origins['ai'], headers=headers | {'Origin': origins['ai']}) as ai, TestClient(apps['testing'], base_url=origins['testing'], headers=headers | {'Origin': origins['testing']}) as testing:
        for client in (ai, testing):
            response = client.post('/api/auth/login', json={'username': 'nguyen.van.a', 'password': 'demo123'})
            assert response.status_code == 200
            client.headers['X-CSRF-Token'] = response.json()['csrf_token']
        ai.cookies.update(testing.cookies)
        testing.cookies.update(ai.cookies)
        assert len(ai.cookies) == 2
        assert ai.get('/api/auth/me').json()['user']['id'] == testing.get('/api/auth/me').json()['user']['id'] == 1
        for client, edition in ((ai, 'ai'), (testing, 'testing')):
            meta = client.get('/api/meta')
            assert meta.json() == {'edition': edition, 'build_id': 'baseline-20261019', 'ai_enabled': False}
            assert meta.headers['cache-control'] == 'no-store'
        wrong = testing.post('/api/projects', json={'name': 'Blocked'}, headers={'X-CSRF-Token': ai.headers['X-CSRF-Token']})
        assert wrong.status_code == 403
        foreign_cookie = f"task_manager_testing_session={ai.cookies.get('task_manager_ai_session')}"
        assert testing.get('/api/auth/me', headers={'cookie': foreign_cookie}).status_code == 401
        assert ai.post('/api/projects', json={'name': 'AI private project'}).status_code == 201
        assert testing.get('/api/projects', params={'q': 'AI private project'}).json()['total'] == 0
        assert testing.post('/api/projects', json={'name': 'Testing only'}).status_code == 201
        assert ai.post('/api/auth/logout').status_code == 204
        assert testing.get('/api/auth/me').status_code == 200
        assert testing.get('/api/projects', params={'q': 'Testing only'}).json()['total'] == 1
    with closing(connect_database(paths['ai'])) as connection:
        assert connection.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
    with closing(connect_database(paths['testing'])) as connection:
        assert connection.execute('SELECT count(*) FROM sessions').fetchone()[0] == 1


def test_request_revalidates_named_edition_database_guard(tmp_path, template, monkeypatch):
    root = tmp_path / 'edition'
    (root / 'data').mkdir(parents=True)
    marker(root, 'testing')
    path = root / 'data' / 'task-manager.db'
    copyfile(template, path)
    settings = Settings(database_path=path, edition='testing', edition_root=root)
    app = create_app(settings)
    import os
    os.link(path, tmp_path / 'alias.db')
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get('/api/auth/me')
        assert response.status_code == 503
        assert str(path) not in response.text
