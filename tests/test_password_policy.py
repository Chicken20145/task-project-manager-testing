import pytest
from backend.password_policy import valid_new_password


@pytest.mark.parametrize('value', ['Ab@123', '😀a1@bc', ' 1@   ', 'a' * 126 + '1@'])
def test_valid_passwords(value):
    assert valid_new_password(value)


@pytest.mark.parametrize('value', ['a1@bc', 'a' * 127 + '1@', 'abcdef', 'abcdef1', 'abc@de', '      ', 'a1@\0bc', 'a1@\ud800bc', None])
def test_invalid_passwords(value):
    assert not valid_new_password(value)
