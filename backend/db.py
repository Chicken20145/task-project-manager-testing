"""Explicit SQLite connections and atomic initialization; no startup/reset side effects."""
from contextlib import closing, contextmanager
from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE = ROOT / 'data' / 'task-manager.db'
SCHEMA_FILE = Path(__file__).with_name('schema.sql')
REPORT_SCHEMA_FILE = Path(__file__).with_name('notifications.sql')
DEADLINE_SCHEMA_FILE = Path(__file__).with_name('deadlines.sql')
APPLICATION_ID = 0x54504D31
SCHEMA_VERSION = 3
TABLES = {'users', 'projects', 'project_members', 'tasks', 'comments',
          'task_history', 'project_history', 'sessions', 'demo_seed', 'daily_reports', 'account_preferences'}


def connect_database(path=DEFAULT_DATABASE, *, create=False):
    if str(path) == ':memory:':
        connection = sqlite3.connect(':memory:', autocommit=True)
    else:
        target = Path(path).resolve()
        if create:
            target.parent.mkdir(parents=True, exist_ok=True)
        elif not target.is_file():
            raise FileNotFoundError('Database does not exist; initialize it explicitly.')
        mode = 'rwc' if create else 'rw'
        connection = sqlite3.connect(f'{target.as_uri()}?mode={mode}', uri=True,
                                     timeout=5.0, autocommit=True)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    if connection.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        connection.close()
        raise RuntimeError('Foreign key enforcement is required.')
    return connection


@contextmanager
def transaction(connection):
    if connection.in_transaction:
        raise RuntimeError('Nested write transactions are not supported.')
    connection.execute('BEGIN IMMEDIATE')
    try:
        yield connection
        connection.execute('COMMIT')
    except BaseException:
        if connection.in_transaction:
            connection.execute('ROLLBACK')
        raise


def require_schema(connection):
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    identity = connection.execute('PRAGMA application_id').fetchone()[0]
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    columns = {row[1] for row in connection.execute('PRAGMA table_info(tasks)')}
    if version != SCHEMA_VERSION or identity != APPLICATION_ID or TABLES != tables or 'due_at' not in columns:
        raise RuntimeError('Unknown or unsupported database schema; no automatic reset or downgrade.')


def initialize_database(path=DEFAULT_DATABASE):
    with closing(connect_database(path, create=True)) as connection:
        with transaction(connection):
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            identity = connection.execute('PRAGMA application_id').fetchone()[0]
            if version == SCHEMA_VERSION:
                require_schema(connection)
                return
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%'")}
            legacy = (identity == APPLICATION_ID and
                      ((version == 1 and tables == TABLES - {'daily_reports', 'account_preferences'}) or
                       (version == 2 and tables == TABLES)))
            if not legacy and (version or identity or tables):
                raise RuntimeError('Unknown or unsupported database schema; no automatic reset or downgrade.')
            # executescript can commit implicitly. Execute trusted complete statements inside this transaction.
            sources = ([REPORT_SCHEMA_FILE] if version == 1 else []) if legacy else [SCHEMA_FILE, REPORT_SCHEMA_FILE]
            for source in [*sources, DEADLINE_SCHEMA_FILE]:
                statement = ''
                for line in source.read_text(encoding='utf-8').splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        connection.execute(statement)
                        statement = ''
                if statement.strip():
                    raise RuntimeError('Incomplete schema statement.')
            connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
            connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
            require_schema(connection)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Initialize a new database or verify the known schema; never reset.')
    parser.add_argument('--db', type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    initialize_database(args.db)
    print(f'Database schema v{SCHEMA_VERSION} ready: {args.db.resolve()}')
