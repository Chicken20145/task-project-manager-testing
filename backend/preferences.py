"""Small explicit timezone catalogue; session identity is supplied only by the API boundary."""
from .repository import fields, invalid

DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'
TIMEZONES = ('Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata',
             'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles',
             'Australia/Sydney', 'Pacific/Auckland')


def get_timezone(connection, user_id):
    row = connection.execute('SELECT timezone FROM account_preferences WHERE user_id=?', (user_id,)).fetchone()
    return row['timezone'] if row else DEFAULT_TIMEZONE


def preferences_data(connection, user_id):
    return {'timezone': get_timezone(connection, user_id), 'timezones': list(TIMEZONES)}


def save_preferences(connection, user_id, input):
    fields(input, ('timezone',))
    zone = input.get('timezone')
    if not isinstance(zone, str) or zone not in TIMEZONES:
        invalid('timezone', 'Vui lòng chọn múi giờ được hỗ trợ.')
    connection.execute('''INSERT INTO account_preferences(user_id,timezone) VALUES(?,?)
        ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone''', (user_id, zone))
    return preferences_data(connection, user_id)
