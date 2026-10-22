from datetime import datetime, timezone

from test_auth_api import service, template, login


def test_deadlines_follow_timezone_across_views_and_preserve_on_edits(service):
    client, _, clock, _ = service
    login(client)
    clock[0] = datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc)
    task = client.post('/api/projects/10/tasks', json={'title': 'Exact deadline', 'assignee_id': 1, 'due_local': '2026-10-16T01:00', 'due_timezone': 'Asia/Ho_Chi_Minh'}).json()
    assert task['due_at'] == '2026-10-15T18:00:00Z' and not task['is_overdue']
    tid = task['id']
    clock[0] = clock[0].replace(second=1)
    assert client.get(f'/api/tasks/{tid}').json()['is_overdue']
    assert tid in [t['id'] for t in client.get('/api/projects/10/tasks?overdue=true').json()['items']]
    client.patch('/api/account/preferences', json={'timezone': 'UTC'})
    updated = client.patch(f'/api/tasks/{tid}', json={'title': 'Renamed', 'version': task['version']}).json()
    assert updated['due_at'] == task['due_at']
    assert updated['due_local'] == '2026-10-15T18:00' and updated['due_date'] == '2026-10-15'
    calendar = client.get('/api/calendar?month=2026-10&date=2026-10-15').json()
    assert tid in [t['id'] for t in calendar['tasks']['items']]
    response = client.patch(f'/api/tasks/{tid}', json={'due_local': '2026-10-16T01:00', 'due_timezone': 'Asia/Ho_Chi_Minh', 'version': updated['version']})
    assert response.status_code == 409 and response.json()['error']['code'] == 'TIMEZONE_CHANGED'
    cleared = client.patch(f'/api/tasks/{tid}', json={'due_local': None, 'version': updated['version']}).json()
    assert cleared['due_at'] is None


def test_feed_converts_deadline_but_preserves_daily_snapshot(service):
    client, _, _, _ = service
    login(client)
    task = client.post('/api/projects/10/tasks', json={'title': 'Snapshot timezone', 'assignee_id': 1,
        'due_local': '2026-10-20T01:00', 'due_timezone': 'Asia/Ho_Chi_Minh'}).json()
    client.post('/api/notifications/daily', json={})
    feed_before = client.get('/api/notifications').json()['items']
    report_before = next(item for item in feed_before if item['kind'] == 'daily')
    entry_before = next(item for item in report_before['tasks'] if item['id'] == task['id'])
    client.patch('/api/account/preferences', json={'timezone': 'UTC'})
    feed_after = client.get('/api/notifications').json()['items']
    report_after = next(item for item in feed_after if item['id'] == report_before['id'])
    entry_after = next(item for item in report_after['tasks'] if item['id'] == task['id'])
    assert report_after['report_date'] == report_before['report_date']
    assert report_after['timezone'] == report_before['timezone']
    assert entry_after['days_left'] == entry_before['days_left']
    assert entry_after['due_date'] == '2026-10-19' and entry_after['due_local'] == '2026-10-19T18:00'
    assigned = next(item for item in feed_after if item['kind'] == 'assigned' and item['task_id'] == task['id'])
    assert assigned['due_local'] == entry_after['due_local']
