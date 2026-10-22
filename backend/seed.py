"""Atomic demo seeding. Reset is opt-in and restricted to the baseline demo file."""
from contextlib import closing
from pathlib import Path

from .db import DEFAULT_DATABASE, TABLES, connect_database, initialize_database, require_schema, transaction
from .passwords import hash_password
from .seed_data import generate_seed_data


FIELDS = {
    'users': ('id', 'username', 'password_hash', 'display_name', 'created_at'),
    'projects': ('id', 'name', 'description', 'owner_id', 'version', 'archived_at', 'created_at', 'updated_at'),
    'project_members': ('project_id', 'user_id', 'joined_at'),
    'tasks': ('id', 'project_id', 'title', 'description', 'assignee_id', 'due_date', 'priority', 'status', 'version', 'archived_at', 'created_at', 'updated_at'),
    'comments': ('id', 'task_id', 'author_id', 'body', 'created_at'),
    'task_history': ('id', 'task_id', 'actor_id', 'action', 'before_json', 'after_json', 'created_at'),
    'project_history': ('id', 'project_id', 'actor_id', 'action', 'before_json', 'after_json', 'created_at'),
}


def _insert_seed(connection, profile, password):
    data = generate_seed_data(profile)
    for table, fields in FIELDS.items():
        rows = data[table]
        if table == 'users':
            rows = [{**row, 'password_hash': hash_password(password)} for row in rows]
        # Identifiers are constant allowlists; values are always bound parameters.
        sql = f"INSERT INTO {table}({','.join(fields)}) VALUES({','.join('?' for _ in fields)})"
        connection.executemany(sql, [tuple(row[field] for field in fields) for row in rows])
    connection.execute('INSERT INTO demo_seed VALUES(1,?,?,?)', ('baseline-demo', profile, data['today']))


def seed_database(connection, *, profile='demo', password):
    require_schema(connection)
    with transaction(connection):
        if any(connection.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in TABLES):
            raise RuntimeError('Seed requires an empty database; existing data was preserved.')
        _insert_seed(connection, profile, password)


def reset_demo_database(path, *, confirm_path, profile='demo', password):
    target, confirmed, expected = Path(path), Path(confirm_path), Path(DEFAULT_DATABASE)
    if target.is_symlink() or confirmed.is_symlink() or expected.is_symlink():
        raise ValueError('Reset cannot target a symlink.')
    if target.exists() and target.stat().st_nlink != 1:
        raise ValueError('Reset cannot target a file shared through hard links.')
    # Only the named baseline file is resettable; another edition/load/sentinel file is never accepted.
    if target.resolve() != confirmed.resolve() or target.resolve() != expected.resolve():
        raise ValueError('Reset needs the exact baseline database path repeated as confirmation.')
    if target.absolute() != expected.absolute() or expected.absolute().parent != expected.resolve().parent:
        raise ValueError('Reset cannot traverse aliased/symlink directories.')
    with closing(connect_database(target)) as connection:
        require_schema(connection)
        with transaction(connection):
            marker = connection.execute('SELECT edition FROM demo_seed WHERE id=1').fetchone()
            if not marker or marker['edition'] != 'baseline-demo':
                raise RuntimeError('Only a recognized seeded baseline demo can be reset.')
            for table in ('account_preferences', 'daily_reports', 'comments', 'task_history', 'project_history', 'sessions', 'tasks',
                          'project_members', 'projects', 'users', 'demo_seed'):
                connection.execute(f'DELETE FROM {table}')
            _insert_seed(connection, profile, password)


if __name__ == '__main__':
    import argparse
    import os
    parser = argparse.ArgumentParser(description='Seed a new local demo database. Existing data is never reset by default.')
    parser.add_argument('--db', type=Path, default=DEFAULT_DATABASE)
    parser.add_argument('--profile', choices=('demo', 'load', 'stress'), default='demo')
    parser.add_argument('--reset', action='store_true')
    parser.add_argument('--confirm-path', type=Path)
    args = parser.parse_args()
    password = os.environ.get('DEMO_PASSWORD', 'demo123')  # disposable sample accounts only
    if args.reset:
        if args.confirm_path is None:
            parser.error('--reset requires --confirm-path naming the same baseline database')
        reset_demo_database(args.db, confirm_path=args.confirm_path, profile=args.profile, password=password)
    else:
        if args.confirm_path is not None:
            parser.error('--confirm-path is only used with --reset')
        initialize_database(args.db)
        with closing(connect_database(args.db)) as connection:
            seed_database(connection, profile=args.profile, password=password)
    print(f'Seed profile {args.profile} ready: {args.db.resolve()} (credentials not printed)')
