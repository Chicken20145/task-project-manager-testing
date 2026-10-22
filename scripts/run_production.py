"""Validate an explicit production config before starting one loopback worker."""
import argparse
from contextlib import closing
import ipaddress
import os
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def validate_configuration(env_file):
    from dotenv import load_dotenv
    from backend.db import require_schema
    from backend.settings import Settings

    if not env_file.is_file():
        raise FileNotFoundError('An existing --env-file is required; no sample fallback.')
    load_dotenv(env_file, override=False)
    required = ('APP_EDITION', 'APP_ENV', 'COOKIE_SECURE', 'PUBLIC_ORIGIN', 'WEB_HOST',
                'WEB_PORT', 'WEB_WORKERS', 'DATABASE_PATH', 'APP_TIMEZONE')
    if any(not os.environ.get(key) for key in required):
        raise ValueError('Production configuration is incomplete.')
    settings = Settings.from_environment()
    origin = urlsplit(settings.public_origin)
    hostname = origin.hostname
    if (settings.environment != 'production' or not settings.cookie_secure or origin.scheme != 'https'
            or not hostname or settings.public_origin != f'https://{hostname}'
            or len(hostname) > 253 or '.' not in hostname
            or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in hostname.split('.'))
            or any(hostname == suffix or hostname.endswith('.' + suffix)
                   for suffix in ('localhost', 'invalid', 'example.com', 'example.net', 'example.org', 'test'))
            or 'replace-me' in hostname):
        raise ValueError('Production requires a real HTTPS hostname on port 443 and Secure cookies.')
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError('Production origin must use its public DNS hostname.')
    if (os.environ['WEB_HOST'] != '127.0.0.1' or os.environ['WEB_PORT'] != '8003'
            or os.environ['WEB_WORKERS'] != '1' or os.getenv('WEB_CONCURRENCY', '1') != '1'):
        raise ValueError('Production requires 127.0.0.1:8003 and exactly one worker.')
    if not settings.database_path.is_file():
        raise FileNotFoundError('Initialize the edition database explicitly before starting production.')
    with closing(sqlite3.connect(settings.database_path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        require_schema(connection)
    return settings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, type=Path)
    parser.add_argument('--check', action='store_true', help='Validate only; do not start a server or change data.')
    args = parser.parse_args(argv)
    validate_configuration(args.env_file)
    if args.check:
        print('Production configuration and database schema are valid. No server started.')
        return 0
    import uvicorn
    uvicorn.run('backend.app:app', host='127.0.0.1', port=8003, workers=1, reload=False,
                proxy_headers=False, forwarded_allow_ips='', loop='asyncio', http='h11', ws='none',
                server_header=False, access_log=False, limit_concurrency=16, backlog=32,
                timeout_keep_alive=5, timeout_graceful_shutdown=15)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, FileNotFoundError, sqlite3.Error) as error:
        raise SystemExit(f'Production configuration rejected: {error}') from None
