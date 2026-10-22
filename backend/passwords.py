"""Password storage primitive for seed/auth; registration policy belongs at the API boundary."""
import hashlib
import hmac
import secrets


PARAMETERS = (2 ** 14, 8, 5)  # OWASP equivalent minimum, 16 MiB; suitable for the planned small host.


def hash_password(password):
    if not isinstance(password, str) or not 1 <= len(password) <= 128:
        raise ValueError('Password length must be between 1 and 128 codepoints.')
    salt = secrets.token_bytes(16)
    n, r, p = PARAMETERS
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=n, r=r, p=p,
                            maxmem=64 * 1024 * 1024, dklen=32)
    return f'scrypt${n}${r}${p}${salt.hex()}${digest.hex()}'


def verify_password(password, encoded):
    if not isinstance(password, str) or not 1 <= len(password) <= 128 or not isinstance(encoded, str) or len(encoded) > 200:
        return False
    try:
        algorithm, n, r, p, salt, digest = encoded.split('$')
        if algorithm != 'scrypt' or (int(n), int(r), int(p)) != PARAMETERS:
            return False
        salt, expected = bytes.fromhex(salt), bytes.fromhex(digest)
        if len(salt) != 16 or len(expected) != 32:
            return False
        actual = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=PARAMETERS[0], r=PARAMETERS[1],
                                p=PARAMETERS[2], maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        return False
