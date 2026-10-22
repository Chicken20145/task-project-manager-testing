from contextlib import closing
from pathlib import Path
import sqlite3

import pytest

from backend import db, seed
from backend.passwords import hash_password, verify_password


def counts(connection):
    return {table: connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in db.TABLES}


def test_password_hashes_use_random_salts_and_verify_unicode_without_storing_password():
    password = 'Mật khẩu giả kiểm thử 123'
    first, second = hash_password(password), hash_password(password)
    assert first != second and password not in first
    assert first.startswith('scrypt$16384$8$5$')
    assert verify_password(password, first)
    assert not verify_password(password + 'wrong', first)
    assert not verify_password(password, 'scrypt$1073741824$8$5$aa$bb')
    assert not verify_password(password, 'invalid hash')
    assert not verify_password('a' * 129, first)


@pytest.mark.parametrize('profile,projects,tasks', [('demo', 3, 27), ('load', 10, 1000), ('stress', 100, 10000)])
def test_seed_profiles_counts_reopen_and_integrity(tmp_path, profile, projects, tasks):
    path = tmp_path / f'{profile}.db'
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        seed.seed_database(connection, profile=profile, password='demo123')
        result = counts(connection)
        assert result['users'] == 3 and result['projects'] == projects and result['tasks'] == tasks
        assert result['sessions'] == 0 and result['demo_seed'] == 1
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        hashes = [row[0] for row in connection.execute('SELECT password_hash FROM users')]
        assert len(set(hashes)) == 3
        assert all(verify_password('demo123', value) for value in hashes)
    with closing(db.connect_database(path)) as reopened:
        assert counts(reopened) == result
        assert reopened.execute('SELECT today FROM demo_seed').fetchone()[0] == '2026-10-13'


def test_seed_rejects_nonempty_database_without_modifying_rows(tmp_path):
    path = tmp_path / 'demo.db'
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        seed.seed_database(connection, password='demo123')
        before = [tuple(row) for row in connection.execute('SELECT * FROM users')]
        with pytest.raises(RuntimeError):
            seed.seed_database(connection, profile='stress', password='different demo password')
        assert [tuple(row) for row in connection.execute('SELECT * FROM users')] == before
        assert counts(connection)['tasks'] == 27


def test_seed_error_rolls_back_every_insert(tmp_path, monkeypatch):
    original = seed.generate_seed_data
    def broken(profile):
        data = original(profile)
        data['tasks'][-1]['assignee_id'] = 999
        return data
    monkeypatch.setattr(seed, 'generate_seed_data', broken)
    path = tmp_path / 'failed.db'
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            seed.seed_database(connection, password='demo123')
        assert not any(counts(connection).values())


def test_reset_is_explicit_and_only_targets_the_recognized_baseline_demo(tmp_path, monkeypatch):
    root = tmp_path / 'data'
    baseline = root / 'task-manager.db'
    other = root / 'testing.db'
    monkeypatch.setattr(seed, 'DEFAULT_DATABASE', baseline)
    db.initialize_database(baseline)
    db.initialize_database(other)
    for path in (baseline, other):
        with closing(db.connect_database(path)) as connection:
            seed.seed_database(connection, password='demo123')
    before = other.read_bytes()
    with pytest.raises(ValueError):
        seed.reset_demo_database(baseline, confirm_path=other, password='demo123')
    with pytest.raises(ValueError):
        seed.reset_demo_database(other, confirm_path=other, password='demo123')
    seed.reset_demo_database(baseline, confirm_path=baseline, profile='load', password='demo123')
    assert other.read_bytes() == before
    with closing(db.connect_database(baseline)) as connection:
        assert counts(connection)['tasks'] == 1000
        assert connection.execute('SELECT profile FROM demo_seed').fetchone()[0] == 'load'


def test_reset_failure_restores_original_data_and_unknown_db_is_untouched(tmp_path, monkeypatch):
    path = tmp_path / 'task-manager.db'
    monkeypatch.setattr(seed, 'DEFAULT_DATABASE', path)
    db.initialize_database(path)
    with closing(db.connect_database(path)) as connection:
        seed.seed_database(connection, password='demo123')
    original = seed.generate_seed_data
    def broken(profile):
        data = original(profile)
        data['tasks'][0]['project_id'] = 999
        return data
    monkeypatch.setattr(seed, 'generate_seed_data', broken)
    with pytest.raises(sqlite3.IntegrityError):
        seed.reset_demo_database(path, confirm_path=path, password='demo123')
    with closing(db.connect_database(path)) as connection:
        assert counts(connection)['tasks'] == 27
        assert connection.execute('SELECT profile FROM demo_seed').fetchone()[0] == 'demo'
    unknown = tmp_path / 'unknown.db'
    monkeypatch.setattr(seed, 'DEFAULT_DATABASE', unknown)
    with closing(sqlite3.connect(unknown, autocommit=True)) as connection:
        connection.execute('CREATE TABLE sentinel(id INTEGER)')
        connection.execute('INSERT INTO sentinel VALUES(99)')
    before = unknown.read_bytes()
    with pytest.raises(RuntimeError):
        seed.reset_demo_database(unknown, confirm_path=unknown, password='demo123')
    assert unknown.read_bytes() == before


def test_reset_rejects_symlink_targets(tmp_path, monkeypatch):
    path = tmp_path / 'task-manager.db'
    monkeypatch.setattr(seed, 'DEFAULT_DATABASE', path)
    db.initialize_database(path)
    before = path.read_bytes()
    # This Windows host denies creating symlinks. Exercise the metadata guard without changing OS privileges.
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda value: value == path or original(value))
    with pytest.raises(ValueError):
        seed.reset_demo_database(path, confirm_path=path, password='demo123')
    assert path.read_bytes() == before


def test_reset_rejects_hardlinks_without_modifying_either_edition(tmp_path, monkeypatch):
    baseline = tmp_path / 'task-manager.db'
    other = tmp_path / 'testing.db'
    monkeypatch.setattr(seed, 'DEFAULT_DATABASE', baseline)
    db.initialize_database(baseline)
    with closing(db.connect_database(baseline)) as connection:
        seed.seed_database(connection, password='demo123')
    other.hardlink_to(baseline)
    before = other.read_bytes()
    with pytest.raises(ValueError):
        seed.reset_demo_database(baseline, confirm_path=baseline, profile='load', password='demo123')
    assert baseline.read_bytes() == before and other.read_bytes() == before
