"""Web-only configuration; importing the app never creates or resets a database."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from .db import DEFAULT_DATABASE, ROOT


def edition_identity(root):
    marker = Path(root) / 'edition.json'
    if marker.is_symlink() or marker.is_junction():
        raise ValueError('Edition identity cannot be an alias.')
    if not marker.exists():
        return {'edition': 'baseline', 'build_id': 'baseline-local'}
    try:
        identity = json.loads(marker.read_text(encoding='utf-8'))
        if (not isinstance(identity, dict) or set(identity) != {'edition', 'build_id'}
                or identity['edition'] not in ('ai', 'testing')
                or not isinstance(identity['build_id'], str)
                or not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', identity['build_id'])):
            raise ValueError('Invalid edition identity.')
        return identity
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Cannot read edition identity.') from error


def guard_edition_database(root, path):
    root, target = Path(root).absolute(), Path(path).absolute()
    expected = root / 'data' / 'task-manager.db'
    if root.resolve() != root or target != expected or target.resolve() != expected:
        raise ValueError('Named editions must use their own data/task-manager.db.')
    for candidate in (root, expected.parent, expected):
        if candidate.is_symlink() or candidate.is_junction():
            raise ValueError('Edition database cannot traverse aliases.')
    if target.exists() and (not target.is_file() or target.stat().st_nlink != 1):
        raise ValueError('Edition database must be an independent regular file.')
    return target


@dataclass(frozen=True)
class Settings:
    database_path: Path = DEFAULT_DATABASE
    public_origin: str = 'http://127.0.0.1:8000'
    cookie_secure: bool = False
    environment: str = 'development'
    edition: str = 'baseline'
    build_id: str = 'baseline-local'
    edition_root: Path | None = None

    def __post_init__(self):
        if self.edition not in ('baseline', 'ai', 'testing') or not isinstance(self.build_id, str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', self.build_id):
            raise ValueError('Invalid edition or build identity.')
        origin = urlsplit(self.public_origin)
        if (origin.scheme not in ('http', 'https') or not origin.hostname or origin.username or origin.password
                or origin.path or origin.query or origin.fragment):
            raise ValueError('PUBLIC_ORIGIN must be an origin without a path.')
        if self.environment not in ('development', 'production'):
            raise ValueError('APP_ENV must be development or production.')
        if self.cookie_secure and origin.scheme != 'https':
            raise ValueError('Secure cookies require an HTTPS origin.')
        if not self.cookie_secure and (self.environment != 'development' or origin.hostname not in ('127.0.0.1', 'localhost', '::1', 'testserver')):
            raise ValueError('HTTP cookies are allowed only for explicit local development.')
        object.__setattr__(self, 'database_path', Path(self.database_path))
        if self.edition_root is not None:
            guard_edition_database(self.edition_root, self.database_path)

    @property
    def cookie_name(self):
        name = 'task_manager' + ('' if self.edition == 'baseline' else '_' + self.edition) + '_session'
        return '__Host-' + name if self.cookie_secure else name

    @classmethod
    def from_environment(cls):
        identity = edition_identity(ROOT)
        if os.getenv('APP_EDITION', identity['edition']) != identity['edition'] or os.getenv('BUILD_ID', identity['build_id']) != identity['build_id']:
            raise ValueError('Environment identity does not match this source checkout.')
        secure = os.getenv('COOKIE_SECURE', 'false')
        if secure not in ('true', 'false') or os.getenv('APP_TIMEZONE', 'Asia/Ho_Chi_Minh') != 'Asia/Ho_Chi_Minh':
            raise ValueError('Invalid COOKIE_SECURE or unsupported APP_TIMEZONE.')
        path = Path(os.getenv('DATABASE_PATH', str(ROOT / 'data' / 'task-manager.db')))
        return cls(database_path=path if path.is_absolute() else ROOT / path,
                   public_origin=os.getenv('PUBLIC_ORIGIN', 'http://127.0.0.1:8000'),
                   cookie_secure=secure == 'true', environment=os.getenv('APP_ENV', 'development'),
                   **identity, edition_root=ROOT if identity['edition'] != 'baseline' else None)
