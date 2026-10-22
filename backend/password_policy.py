"""Policy for new secrets; existing credentials retain their login compatibility."""
import unicodedata

PASSWORD_MESSAGE = 'Mật khẩu cần 6–128 ký tự, có ít nhất một số và một ký tự đặc biệt (ví dụ @).'


def valid_new_password(value):
    return (isinstance(value, str) and 6 <= len(value) <= 128 and '\0' not in value
            and not any(0xD800 <= ord(ch) <= 0xDFFF for ch in value)
            and any('0' <= ch <= '9' for ch in value)
            and any(unicodedata.category(ch)[0] in ('P', 'S') for ch in value))
