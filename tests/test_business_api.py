from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
import json

import pytest

from backend.db import connect_database
from test_auth_api import service, template, login  # shared isolated database fixtures


def test_project_crud_membership_role_version_archive_and_persistence(service):
    client, path, _, _ = service
    assert client.get('/api/projects').status_code == 401
    login(client)
    listed = client.get('/api/projects').json()
    assert [p['id'] for p in listed['items']] == [11, 10] and listed['total'] == 2
    created = client.post('/api/projects', json={'name': '  Dự án MỚI %_  ', 'description': '<script>literal</script>'})
    assert created.status_code == 201
    project = created.json()
    url = f"/api/projects/{project['id']}"
    fetched = client.get(url).json()
    assert fetched['role'] == 'owner' and [u['id'] for u in fetched['members']] == [1]
    assert client.get('/api/projects', params={'q': 'mới %_', 'page_size': 1}).json()['total'] == 1
    assert client.get('/api/projects', params={'q': "%' OR 1=1 --"}).json()['total'] == 0
    changed = client.patch(url, json={'description': 'New description', 'version': 1})
    assert changed.status_code == 200 and changed.json()['version'] == 2
    assert client.patch(url, json={'name': 'stale overwrite', 'version': 1}).status_code == 409
    assert client.get(url).json()['name'] == 'Dự án MỚI %_'
    archived = client.post(url + '/archive', json={'version': 2})
    assert archived.status_code == 200 and archived.json()['version'] == 3
    assert client.get(url).json()['archived_at']
    assert project['id'] not in [p['id'] for p in client.get('/api/projects').json()['items']]
    assert client.post(url + '/tasks', json={'title': 'Blocked'}).status_code == 403
    assert client.patch(url, json={'name': 'Blocked', 'version': 3}).status_code == 403
    with closing(connect_database(path)) as connection:
        assert connection.execute('SELECT count(*) FROM project_history WHERE project_id=?', (project['id'],)).fetchone()[0] == 3
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []


def test_user_lookup_waits_for_query_and_matches_display_name_or_username(service):
    client, _, _, _ = service
    login(client)
    for params in ({}, {'q': ''}, {'q': '   '}):
        response = client.get('/api/users', params=params)
        assert response.status_code == 200
        assert response.json() == {'items': [], 'page': 1, 'page_size': 20, 'total': 0}
    for query in ('  TRAN.THI  ', '  tRaN tHi  '):
        result = client.get('/api/users', params={'q': query}).json()
        assert result['total'] == 1
        assert result['items'] == [{'id': 2, 'username': 'tran.thi.b', 'display_name': 'Tran Thi B'}]
    for query in ('no matching account', '%', '_', "' OR 1=1 --"):
        assert client.get('/api/users', params={'q': query}).json()['items'] == []
    assert client.get('/api/users', params={'q': 'van', 'page_size': 1}).json()['total'] == 2
    assert client.get('/api/users', params={'q': 'van', 'page_size': 1, 'page': 2}).json()['items'][0]['id'] == 1
    assert client.get('/api/users', params={'q': '', 'page_size': 101}).status_code == 422
    login(client, 'tran.thi.b')
    assert client.get('/api/users', params={'q': 'tran'}).status_code == 403


def test_user_lookup_and_member_revocation_enforce_server_permissions(service):
    client, path, _, _ = service
    login(client)
    users = client.get('/api/users', params={'q': 'TRAN.THI'}).json()
    assert users['total'] == 1 and set(users['items'][0]) == {'id', 'username', 'display_name'}
    assert client.post('/api/projects/10/members', json={'user_id': 2}).status_code == 409
    assert client.post('/api/projects/10/members', json={'user_id': 999}).status_code == 422
    assert client.post('/api/projects/10/members', json={'user_id': True}).status_code == 422
    assert client.delete('/api/projects/10/members/1').status_code == 422
    assert client.post('/api/projects/10/members', json={'user_id': 3}).status_code == 201
    login(client, 'tran.thi.b')
    assert client.get('/api/users').status_code == 403
    assert client.get('/api/projects/10').json()['role'] == 'member'
    for method, url, body in [('patch', '/api/projects/10', {'name': 'no', 'version': 1}),
                              ('post', '/api/projects/10/members', {'user_id': 3}),
                              ('post', '/api/projects/10/tasks', {'title': 'no'})]:
        assert getattr(client, method)(url, json=body).status_code == 403
    assert client.delete('/api/projects/10/members/3').status_code == 403
    login(client)
    assert client.delete('/api/projects/10/members/2').status_code == 204
    login(client, 'tran.thi.b')
    for url in ('/api/projects/10', '/api/projects/10/tasks', '/api/projects/10/stats',
                '/api/tasks/102', '/api/tasks/102/comments', '/api/tasks/102/history'):
        assert client.get(url).status_code == 404
    assert client.post('/api/tasks/102/comments', json={'body': 'no'}).status_code == 404
    with closing(connect_database(path)) as connection:
        archived = connection.execute('SELECT * FROM tasks WHERE id=126').fetchone()
        assert archived['assignee_id'] is None and archived['version'] == 2 and archived['archived_at']
        assert connection.execute("SELECT count(*) FROM task_history WHERE task_id=126 AND action='assignee_removed'").fetchone()[0] == 1


def test_outsiders_do_not_learn_resource_existence_and_every_user_can_create_a_project(service):
    client, _, _, _ = service
    login(client, 'le.van.c')
    for url in ('/api/projects/10', '/api/tasks/101', '/api/tasks/101/comments', '/api/tasks/101/history'):
        assert client.get(url).status_code == 404
    assert client.patch('/api/tasks/101', json={'status': 'done', 'version': 1}).status_code == 404
    assert client.get('/api/projects').json()['items'] == []
    assert client.get('/api/projects/20').json()['archived_at']
    assert client.post('/api/tasks/200/comments', json={'body': 'archived project'}).status_code == 403
    created = client.post('/api/projects', json={'name': 'My project'}).json()
    assert created['owner_id'] == 3


def test_task_crud_comments_audit_member_status_and_archive(service):
    client, path, _, _ = service
    login(client)
    created = client.post('/api/projects/10/tasks', json={'title': '  Việc mới  ', 'assignee_id': 2, 'due_date': '2026-10-15'})
    assert created.status_code == 201
    task = created.json()
    url = f"/api/tasks/{task['id']}"
    assert task['status'] == 'todo' and task['is_overdue'] is True
    login(client, 'tran.thi.b')
    assert client.patch(url, json={'title': 'No', 'version': 1}).status_code == 403
    assert client.patch('/api/tasks/101', json={'status': 'done', 'version': 1}).status_code == 403
    changed = client.patch(url, json={'status': 'doing', 'version': 1})
    assert changed.status_code == 200 and changed.json()['version'] == 2
    assert client.patch(url, json={'status': 'done', 'version': 1}).status_code == 409
    for number in range(21):
        assert client.post(url + '/comments', json={'body': f' Bình luận {number} <script>literal</script> '}).status_code == 201
    comments = client.get(url + '/comments?page=2&page_size=20').json()
    assert comments['total'] == 21 and len(comments['items']) == 1
    assert comments['items'][0]['body'] == 'Bình luận 20 <script>literal</script>'
    audit = client.get(url + '/history?page=1&page_size=1').json()
    assert audit['total'] == 2 and audit['items'][0]['before'] is None
    assert audit['items'][0]['after']['title'] == 'Việc mới'
    second = client.get(url + '/history?page=2&page_size=1').json()['items'][0]
    assert second['before']['status'] == 'todo' and second['after']['status'] == 'doing' and second['actor_id'] == 2
    assert 'before_json' not in second
    login(client)
    assert client.post(url + '/archive', json={'version': 2}).status_code == 200
    assert client.get(url).json()['is_overdue'] is False
    assert client.post(url + '/comments', json={'body': 'Blocked'}).status_code == 403
    assert client.patch(url, json={'status': 'done', 'version': 3}).status_code == 403
    assert client.get(url + '/comments').json()['total'] == 21
    assert task['id'] not in [t['id'] for t in client.get('/api/projects/10/tasks?page_size=100').json()['items']]
    with closing(connect_database(path)) as connection:
        assert connection.execute('SELECT count(*) FROM tasks WHERE id=?', (task['id'],)).fetchone()[0] == 1


def test_archived_owner_can_still_lookup_minimal_public_users(service):
    client, _, _, _ = service
    login(client, 'le.van.c')
    assert client.get('/api/users').status_code == 200


@pytest.mark.parametrize('body', [
    {'title': ''}, {'title': 'x' * 121}, {'title': 'x', 'assignee_id': 3},
    {'title': 'x', 'assignee_id': 2.0}, {'title': 'x', 'status': 'done'},
    {'title': 'x', 'due_date': '2026-02-30'}, {'title': 'x', 'due_date': '20261015'},
    {'title': 'x', 'priority': 'urgent'}, {'title': 'x', 'owner_id': 3},
])
def test_invalid_task_input_is_422_and_does_not_change_database(service, body):
    client, path, _, _ = service
    login(client)
    assert client.post('/api/projects/10/tasks', json=body).status_code == 422
    with closing(connect_database(path)) as connection:
        assert connection.execute('SELECT count(*) FROM tasks').fetchone()[0] == 27
        assert connection.execute('SELECT count(*) FROM task_history').fetchone()[0] == 0


def test_filters_totals_pagination_and_vietnam_day_boundary(service):
    client, _, clock, _ = service
    login(client)
    url = '/api/projects/10/tasks'
    all_tasks = client.get(url + '?page_size=100').json()
    assert all_tasks['total'] == 25 and [t['id'] for t in all_tasks['items']] == list(range(125, 100, -1))
    expected = [t for t in all_tasks['items'] if t['assignee_id'] is None and t['priority'] == 'medium']
    filtered = client.get(url, params={'assignee_id': 'unassigned', 'priority': 'medium', 'page_size': 1}).json()
    assert filtered['total'] == len(expected) and filtered['items'][0]['id'] == expected[0]['id']
    stats = client.get('/api/projects/10/stats').json()
    assert stats['total'] == sum(stats[s] for s in ('todo', 'doing', 'done')) == 25
    assert client.get(url + '?overdue=true').json()['total'] == stats['overdue']
    assert client.get(url + '?overdue=false').json()['total'] + stats['overdue'] == 25
    assert client.get(url + '?page=99').json()['items'] == []
    assert client.get(url, params={'q': "%' OR 1=1 --"}).json()['total'] == 0
    for query in ('page=0', 'page_size=101', 'page=1&page=2', 'overdue=1', 'assignee_id=0', 'status=invalid', 'extra=x'):
        assert client.get(url + '?' + query).status_code == 422
    assert client.get('/api/projects/10/stats?q=x').status_code == 422
    task = client.post(url, json={'title': 'Boundary', 'due_date': '2026-10-15'}).json()
    clock[0] = datetime(2026, 10, 15, 16, 59, 59, tzinfo=timezone.utc)
    assert client.get(f"/api/tasks/{task['id']}").json()['is_overdue'] is False
    clock[0] = datetime(2026, 10, 15, 17, 0, tzinfo=timezone.utc)
    assert client.get(f"/api/tasks/{task['id']}").json()['is_overdue'] is True


def test_concurrent_http_updates_have_one_winner_and_one_audit_entry(service):
    client, path, _, _ = service
    login(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda name: client.patch('/api/tasks/101', json={'title': name, 'version': 1}), ('First', 'Second')))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with closing(connect_database(path)) as connection:
        task = connection.execute('SELECT * FROM tasks WHERE id=101').fetchone()
        history = connection.execute('SELECT * FROM task_history WHERE task_id=101').fetchall()
        assert task['version'] == 2 and len(history) == 1
        assert json.loads(history[0]['after_json'])['title'] == task['title']


def test_database_constraint_failure_is_generic_and_rolls_back_http_mutation(service):
    client, path, _, _ = service
    login(client)
    with closing(connect_database(path)) as connection:
        connection.execute("CREATE TRIGGER fail_audit BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT, 'private SQL detail'); END")
    response = client.patch('/api/tasks/101', json={'title': 'Must rollback', 'version': 1})
    assert response.status_code == 500 and response.json()['error']['code'] == 'INTERNAL_ERROR'
    assert response.headers['cache-control'] == 'no-store'
    assert 'private' not in response.text and 'SQL' not in response.text
    assert client.get('/api/tasks/101').json()['version'] == 1


def test_search_matches_description_with_literal_wildcards_before_pagination(service):
    client, _, _, _ = service
    login(client)
    task = client.post('/api/projects/10/tasks', json={'title': 'Description search', 'description': 'DẤU %_ riêng biệt'}).json()
    result = client.get('/api/projects/10/tasks', params={'q': 'dấu %_', 'page_size': 1}).json()
    assert result['total'] == 1 and result['items'][0]['id'] == task['id']
