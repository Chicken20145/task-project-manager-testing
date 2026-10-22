"""Opaque database sessions and bounded password work. No raw session token is stored."""
from collections import deque
from contextlib import contextmanager
from datetime import timedelta
from hashlib import sha256
import hmac
import re
import secrets
from threading import BoundedSemaphore, Lock
from time import monotonic

from .db import transaction
from .passwords import hash_password, verify_password
from .password_policy import PASSWORD_MESSAGE, valid_new_password
from .repository import DataError, fields, invalid, text


DUMMY_HASH = hash_password('dummy password for timing only')


def public_user(row):
    return {key: row[key] for key in ('id', 'username', 'display_name')}


def stamp(now):
    return now.isoformat(timespec='seconds').replace('+00:00', 'Z')


def token_hash(token):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        return None
    return sha256(token.encode('ascii')).hexdigest()


def authenticate(connection, token, now):
    row = connection.execute('''SELECT s.*,u.username,u.display_name FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?''',
        (token_hash(token), stamp(now))).fetchone()
    if row is None:
        raise DataError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.')
    return dict(row)


def require_csrf(session, token):
    if not isinstance(token, str) or not hmac.compare_digest(session['csrf_token'].encode(), token.encode('utf-8')):
        raise DataError(403, 'CSRF_FAILED', 'Phiên xác nhận chưa hợp lệ. Hãy tải lại trang.')


def username(value):
    value = text(value, 'username', 32, required=True, trim=True).lower()
    if not re.fullmatch(r'[a-z0-9._-]{3,32}', value):
        invalid('username', 'Tên đăng nhập cần 3–32 ký tự chữ, số hoặc ._- .')
    return value


def password(value, *, registration=False):
    value = text(value, 'password', 128, required=True)
    if registration and not valid_new_password(value):
        invalid('password', PASSWORD_MESSAGE)
    return value


def register(connection, input, now):
    fields(input, ('username', 'display_name', 'password'))
    name = username(input.get('username'))
    display = text(input.get('display_name'), 'display_name', 80, required=True, trim=True)
    encoded = hash_password(password(input.get('password'), registration=True))
    with transaction(connection):
        if connection.execute('SELECT 1 FROM users WHERE username=?', (name,)).fetchone():
            raise DataError(409, 'USERNAME_TAKEN', 'Tên đăng nhập đã được sử dụng.', {'username': 'Tên đăng nhập đã tồn tại.'})
        cursor = connection.execute('INSERT INTO users(username,password_hash,display_name,created_at) VALUES(?,?,?,?)',
                                    (name, encoded, display, stamp(now)))
        return {'id': cursor.lastrowid, 'username': name, 'display_name': display}


def login(connection, input, old_token, now):
    fields(input, ('username', 'password'))
    name = username(input.get('username'))
    secret = password(input.get('password'))
    row = connection.execute('SELECT * FROM users WHERE username=?', (name,)).fetchone()
    valid = verify_password(secret, row['password_hash'] if row else DUMMY_HASH)
    if not valid or row is None:
        raise DataError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu chưa đúng.')
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with transaction(connection):
        latest = connection.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        if latest is None or not hmac.compare_digest(latest['password_hash'], row['password_hash']):
            raise DataError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu chưa đúng.')
        row = latest
        connection.execute('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?', (stamp(now), token_hash(old_token)))
        connection.execute('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)',
                           (token_hash(token), row['id'], csrf, stamp(now), stamp(now + timedelta(hours=8))))
    return {'user': public_user(row), 'csrf_token': csrf}, token


def update_profile(connection, input, token, csrf, now, *, clock=None):
    with transaction(connection):
        session = authenticate(connection, token, clock() if clock else now)
        require_csrf(session, csrf)
        fields(input, ('display_name',))
        display = text(input.get('display_name'), 'display_name', 80, required=True, trim=True)
        connection.execute('UPDATE users SET display_name=? WHERE id=?', (display, session['user_id']))
        return public_user(connection.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone())


def change_password(connection, input, token, csrf, now, *, clock=None):
    session = authenticate(connection, token, now)
    require_csrf(session, csrf)
    fields(input, ('current_password', 'new_password'))
    current = text(input.get('current_password'), 'current_password', 128, required=True)
    new = text(input.get('new_password'), 'new_password', 128, required=True)
    if not valid_new_password(new):
        invalid('new_password', PASSWORD_MESSAGE)
    if current == new:
        invalid('new_password', 'Mật khẩu mới phải khác mật khẩu hiện tại.')
    row = connection.execute('SELECT password_hash FROM users WHERE id=?', (session['user_id'],)).fetchone()
    if not verify_password(current, row['password_hash']):
        raise DataError(422, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại chưa đúng.',
                        {'current_password': 'Mật khẩu hiện tại chưa đúng.'})
    encoded = hash_password(new)  # expensive work stays outside the write lock
    with transaction(connection):
        latest_session = authenticate(connection, token, clock() if clock else now)
        require_csrf(latest_session, csrf)
        latest = connection.execute('SELECT password_hash FROM users WHERE id=?', (session['user_id'],)).fetchone()
        if latest is None or not hmac.compare_digest(latest['password_hash'], row['password_hash']):
            raise DataError(409, 'ACCOUNT_CHANGED', 'Tài khoản đã thay đổi. Hãy đăng nhập lại.')
        connection.execute('UPDATE users SET password_hash=? WHERE id=?', (encoded, session['user_id']))
        connection.execute('DELETE FROM sessions WHERE user_id=?', (session['user_id'],))


class AuthLimiter:
    """Single-process baseline: 20 attempts/IP/minute, 120 globally, at most 2 concurrent hashes.

    Move counters to a shared store before deploying multiple workers/instances.
    """
    def __init__(self):
        self.lock, self.slots = Lock(), BoundedSemaphore(2)
        self.attempts, self.global_attempts = {}, deque()
        self.clock = monotonic

    @contextmanager
    def attempt(self, address):
        with self.lock:
            now = self.clock()
            self.attempts = {key: times for key, times in self.attempts.items() if times[-1] > now - 60}
            while self.global_attempts and self.global_attempts[0] <= now - 60:
                self.global_attempts.popleft()
            times = self.attempts.get(address, deque())
            while times and times[0] <= now - 60:
                times.popleft()
            if len(times) >= 20 or len(self.global_attempts) >= 120 or len(self.attempts) > 1024:
                raise DataError(429, 'RATE_LIMITED', 'Đã có nhiều yêu cầu xác thực. Thử lại sau 60 giây.')
            times.append(now)
            self.attempts[address] = times
            self.global_attempts.append(now)
        if not self.slots.acquire(blocking=False):
            raise DataError(429, 'RATE_LIMITED', 'Máy chủ đang xử lý đăng nhập. Hãy thử lại.')
        try:
            yield
        finally:
            self.slots.release()
