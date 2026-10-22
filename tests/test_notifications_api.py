from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
from threading import Event

from fastapi.testclient import TestClient

from backend.db import connect_database
from test_auth_api import service, template, login, HEADERS


def setup_tasks(client):
    login(client)
    project = client.post('/api/projects', json={'name': 'Lịch riêng'}).json()
    assert client.post(f"/api/projects/{project['id']}/members", json={'user_id': 2}).status_code == 201
    return project['id']


def add_task(client, project, **values):
    response = client.post(f'/api/projects/{project}/tasks', json={'title': 'Việc có hạn', 'assignee_id': 2, **values})
    assert response.status_code == 201, response.text
    return response.json()


def test_calendar_uses_own_assignments_day_paging_leap_year_and_archive(service):
    client, _, _, _ = service
    assert client.get('/api/calendar').status_code == 401
    project = setup_tasks(client)
    first = add_task(client, project, due_date='2024-02-29')
    second = add_task(client, project, due_date='2024-02-29')
    add_task(client, project, due_date='2024-02-29', assignee_id=1)
    add_task(client, project, due_date=None)
    client.patch(f"/api/tasks/{second['id']}", json={'status': 'done', 'version': 1})
    login(client, 'tran.thi.b')
    result = client.get('/api/calendar', params={'month': '2024-02', 'date': '2024-02-29', 'page_size': 1}).json()
    assert len(result['days']) == 29 and result['start_weekday'] == 3
    assert result['days'][-1] == {'date': '2024-02-29', 'day': 29, 'total': 2, 'done': 1, 'overdue': 1}
    assert result['tasks']['total'] == 2 and len(result['tasks']['items']) == 1
    ids = {result['tasks']['items'][0]['id'], client.get('/api/calendar?month=2024-02&date=2024-02-29&page_size=1&page=2').json()['tasks']['items'][0]['id']}
    assert ids == {first['id'], second['id']}
    assert client.get('/api/calendar?month=0001-01').json()['previous_month'] is None
    assert client.get('/api/calendar?month=9999-12').json()['next_month'] is None
    login(client)
    assert client.post(f"/api/tasks/{first['id']}/archive", json={'version': 1}).status_code == 200
    login(client, 'tran.thi.b')
    assert client.get('/api/calendar?month=2024-02&date=2024-02-29').json()['tasks']['total'] == 1


def test_daily_snapshot_once_per_vietnam_day_and_get_never_writes(service):
    client, path, clock, _ = service
    clock[0] = datetime(2026, 10, 15, 16, 59, 59, tzinfo=timezone.utc)
    project = setup_tasks(client)
    tasks = [add_task(client, project, due_date=due) for due in ['2026-10-14', '2026-10-15', '2026-10-16']]
    no_due = add_task(client, project)
    done = add_task(client, project, due_date='2026-10-15')
    client.patch(f"/api/tasks/{done['id']}", json={'status': 'done', 'version': 1})
    login(client, 'tran.thi.b')
    assert client.get('/api/notifications').status_code == 200
    with closing(connect_database(path)) as db:
        assert db.execute('SELECT count(*) FROM daily_reports').fetchone()[0] == 0
    assert client.post('/api/notifications/daily', json={}).json() == {'created': True, 'report_date': '2026-10-15'}
    assert client.post('/api/notifications/daily', json={}).json()['created'] is False
    daily = next(item for item in client.get('/api/notifications').json()['items'] if item['kind'] == 'daily')
    snapshots = {item['id']: item for item in daily['tasks']}
    assert [snapshots[t['id']]['days_left'] for t in tasks] == [-1, 0, 1]
    assert no_due['id'] not in snapshots and done['id'] not in snapshots
    client.patch(f"/api/tasks/{tasks[0]['id']}", json={'status': 'done', 'version': 1})
    assert client.post('/api/notifications/daily', json={}).json()['created'] is False
    assert next(item for item in client.get('/api/notifications').json()['items'] if item['kind'] == 'daily')['tasks'] == daily['tasks']
    clock[0] = datetime(2026, 10, 15, 17, 0, 0, tzinfo=timezone.utc)
    assert client.post('/api/notifications/daily', json={}).json() == {'created': True, 'report_date': '2026-10-16'}
    new = next(item for item in client.get('/api/notifications').json()['items'] if item['kind'] == 'daily' and item['report_date'] == '2026-10-16')
    assert next(item for item in new['tasks'] if item['id'] == tasks[2]['id'])['days_left'] == 0


def test_assignment_completion_events_and_live_permission_revocation(service):
    client, _, _, _ = service
    project = setup_tasks(client)
    task = add_task(client, project, due_date='2026-10-16', title='<b>literal</b>')
    task_id = task['id']
    login(client, 'tran.thi.b')
    client.post('/api/notifications/daily', json={})
    assigned = [item for item in client.get('/api/notifications').json()['items'] if item.get('task_id') == task_id]
    assert [item['kind'] for item in assigned] == ['assigned'] and assigned[0]['actor_name'] == 'Nguyen Van A'
    client.patch(f'/api/tasks/{task_id}', json={'status': 'done', 'version': 1})
    login(client)
    client.patch(f'/api/tasks/{task_id}', json={'description': 'done edit', 'version': 2})
    mine = [item for item in client.get('/api/notifications').json()['items'] if item.get('task_id') == task_id]
    assert [item['kind'] for item in mine] == ['completed']
    assert mine[0]['actor_name'] == 'Tran Thi B'
    client.patch(f'/api/tasks/{task_id}', json={'assignee_id': 1, 'status': 'todo', 'version': 3})
    client.patch(f'/api/tasks/{task_id}', json={'assignee_id': 2, 'version': 4})
    login(client, 'tran.thi.b')
    mine = [item for item in client.get('/api/notifications').json()['items'] if item.get('task_id') == task_id]
    assert sum(item['kind'] == 'assigned' for item in mine) == 2
    assert sum(item['kind'] == 'completed' for item in mine) == 1
    login(client)
    assert client.delete(f'/api/projects/{project}/members/2').status_code == 204
    login(client, 'tran.thi.b')
    feed = client.get('/api/notifications').json()
    assert all(item.get('task_id') != task_id for item in feed['items'])
    assert all(t['id'] != task_id for item in feed['items'] if item['kind'] == 'daily' for t in item['tasks'])
    login(client, 'le.van.c')
    assert client.get('/api/notifications').json()['total'] == 0


def test_notification_boundary_validation_and_csrf(service):
    client, _, _, _ = service
    assert client.post('/api/notifications/daily', json={}).status_code == 401
    login(client)
    for query in ['month=0000-01', 'month=2026-13', 'month=2026-1', 'month=2026-02&date=2026-02-30', 'month=2026-02&date=2026-03-01', 'page=0', 'page_size=101', 'month=2026-01&month=2026-02', 'user_id=2']:
        assert client.get('/api/calendar?' + query).status_code == 422, query
    for query in ['user_id=2', 'page=0', 'page=1&page=2', 'page_size=101']:
        assert client.get('/api/notifications?' + query).status_code == 422
    assert client.post('/api/notifications/daily', json={'user_id': 2}).status_code == 422
    assert client.post('/api/notifications/daily?user_id=2', json={}).status_code == 422
    assert client.post('/api/notifications/daily', json={}, headers={'X-CSRF-Token': 'wrong'}).status_code == 403


def test_parallel_daily_requests_have_one_winner_and_feed_pages_are_stable(service):
    client, path, _, app = service
    project = setup_tasks(client)
    for i in range(3):
        add_task(client, project, title=f'Same second {i}', due_date='2026-10-16')
    login(client, 'tran.thi.b')
    headers = {**HEADERS, 'X-CSRF-Token': client.headers['X-CSRF-Token'], 'Cookie': f"task_manager_session={client.cookies.get('task_manager_session')}"}
    def submit(_):
        with TestClient(app, headers=headers) as other:
            return other.post('/api/notifications/daily', json={})
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(submit, range(4)))
    assert all(r.status_code == 200 for r in responses)
    assert sum(r.json()['created'] for r in responses) == 1
    with closing(connect_database(path)) as db:
        assert db.execute('SELECT count(*) FROM daily_reports WHERE user_id=2').fetchone()[0] == 1
    first = client.get('/api/notifications?page_size=2').json()
    second = client.get('/api/notifications?page_size=2&page=2').json()
    assert first['total'] == second['total']
    assert not ({x['id'] for x in first['items']} & {x['id'] for x in second['items']})
    assert client.get('/api/notifications?page_size=2').json() == first


def test_daily_report_reauthenticates_after_waiting_for_write_lock(service, monkeypatch):
    from backend import auth
    from backend.db import transaction
    client, path, _, app = service
    login(client, 'tran.thi.b')
    headers = {**HEADERS, 'X-CSRF-Token': client.headers['X-CSRF-Token'], 'Cookie': f"task_manager_session={client.cookies.get('task_manager_session')}"}
    validated = Event()
    original = auth.authenticate
    def observed(*args):
        result = original(*args)
        validated.set()
        return result
    monkeypatch.setattr(auth, 'authenticate', observed)
    def submit():
        with TestClient(app, headers=headers) as other:
            return other.post('/api/notifications/daily', json={})
    with ThreadPoolExecutor(max_workers=1) as pool:
        with closing(connect_database(path)) as db:
            with transaction(db):
                pending = pool.submit(submit)
                assert validated.wait(3)
                db.execute('DELETE FROM sessions WHERE user_id=2')
        response = pending.result(timeout=8)
    assert response.status_code == 401
    with closing(connect_database(path)) as db:
        assert db.execute('SELECT count(*) FROM daily_reports').fetchone()[0] == 0
