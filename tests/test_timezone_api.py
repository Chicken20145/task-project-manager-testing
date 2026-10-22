from contextlib import closing
from datetime import datetime, timezone

from backend.db import connect_database
from test_auth_api import service, template, login


def test_timezone_preferences_are_persistent_private_and_validated(service):
    client, _, _, _ = service
    assert client.get('/api/account/preferences').status_code == 401
    login(client)
    original = client.get('/api/account/preferences').json()
    assert original['timezone'] == 'Asia/Ho_Chi_Minh'
    assert 'America/New_York' in original['timezones'] and 'UTC' in original['timezones']
    assert client.get('/api/account/preferences?user_id=2').status_code == 422
    assert client.patch('/api/account/preferences?user_id=2', json={'timezone': 'UTC'}).status_code == 422
    for value in ['', 'Mars/Test', '../etc/passwd', None, 7, ' UTC ']:
        assert client.patch('/api/account/preferences', json={'timezone': value}).status_code == 422
    assert client.patch('/api/account/preferences', json={'timezone': 'UTC'}, headers={'X-CSRF-Token': 'wrong'}).status_code == 403
    assert client.patch('/api/account/preferences', json={'timezone': 'UTC', 'user_id': 2}).status_code == 422
    assert client.patch('/api/account/preferences', json={'timezone': 'UTC'}).json()['timezone'] == 'UTC'
    login(client, 'tran.thi.b')
    assert client.get('/api/account/preferences').json()['timezone'] == 'Asia/Ho_Chi_Minh'
    login(client)
    assert client.get('/api/account/preferences').json()['timezone'] == 'UTC'


def test_calendar_and_daily_dates_follow_saved_timezone_without_changing_deadlines(service):
    client, path, clock, _ = service
    clock[0] = datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc)
    login(client)
    assert client.get('/api/calendar').json()['today'] == '2026-10-16'
    assert client.post('/api/notifications/daily', json={}).json()['report_date'] == '2026-10-16'
    assert client.patch('/api/account/preferences', json={'timezone': 'America/New_York'}).status_code == 200
    calendar = client.get('/api/calendar').json()
    assert calendar['today'] == '2026-10-15' and calendar['timezone'] == 'America/New_York'
    assert client.post('/api/notifications/daily', json={}).json() == {'created': True, 'report_date': '2026-10-15'}
    client.patch('/api/account/preferences', json={'timezone': 'UTC'})
    assert client.post('/api/notifications/daily', json={}).json()['created'] is False
    with closing(connect_database(path)) as db:
        rows = db.execute('SELECT report_date,timezone FROM daily_reports WHERE user_id=1 ORDER BY report_date').fetchall()
        assert [tuple(row) for row in rows] == [('2026-10-15', 'America/New_York'), ('2026-10-16', 'Asia/Ho_Chi_Minh')]
    reports = [item for item in client.get('/api/notifications').json()['items'] if item['kind'] == 'daily']
    assert {item['timezone'] for item in reports} == {'America/New_York', 'Asia/Ho_Chi_Minh'}


def test_timezone_dst_does_not_create_two_daily_reports(service):
    client, _, clock, _ = service
    clock[0] = datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc)
    login(client)
    assert client.patch('/api/account/preferences', json={'timezone': 'America/New_York'}).status_code == 200
    assert client.get('/api/calendar').json()['today'] == '2026-03-08'
    assert client.post('/api/notifications/daily', json={}).json()['created'] is True
    clock[0] = datetime(2026, 3, 8, 7, 1, tzinfo=timezone.utc)
    assert client.post('/api/notifications/daily', json={}).json()['created'] is False
