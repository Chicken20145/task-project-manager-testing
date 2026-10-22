"""HTTP adapter. Reads require membership; Store owns write transactions."""
from contextlib import closing, contextmanager
import re

from fastapi import APIRouter, Body, Request, Response

from . import auth
from .db import connect_database, require_schema, transaction
from .repository import DataError, Store, fields, identifier, invalid, text
from .settings import guard_edition_database
from .preferences import DEFAULT_TIMEZONE, get_timezone, preferences_data, save_preferences
from .notifications import business_today
from .deadlines import project_deadline


router = APIRouter(prefix='/api')


def resource_id(value, field='id'):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,16}', value):
        invalid(field, 'Cần số nguyên dương.')
    try:
        return identifier(int(value))
    except DataError:
        invalid(field, 'Cần số nguyên dương hợp lệ.')


def filters(request, allowed):
    values = {}
    for key, value in request.query_params.multi_items():
        if key not in allowed or key in values:
            invalid(key, 'Bộ lọc không được hỗ trợ hoặc bị lặp.')
        values[key] = value
    for key, default in (('page', 1), ('page_size', 20)):
        values[key] = resource_id(values[key], key) if key in values else default
    if values['page_size'] > 100:
        invalid('page_size', 'Kích thước trang tối đa 100.')
    if 'q' in values:
        values['q'] = text(values['q'], 'q', 200, trim=True)
    for key, allowed_values in (('status', ('todo', 'doing', 'done')), ('priority', ('low', 'medium', 'high'))):
        if key in values and values[key] not in allowed_values:
            invalid(key)
    if 'assignee_id' in values:
        values['assignee_id'] = None if values['assignee_id'] == 'unassigned' else resource_id(values['assignee_id'], 'assignee_id')
    if 'overdue' in values:
        if values['overdue'] not in ('true', 'false'):
            invalid('overdue')
        values['overdue'] = values['overdue'] == 'true'
    return values


def page(connection, select, where, params, options, *, order='id DESC'):
    # SQL fragments are code-owned constants; request values are bound parameters.
    size, number = options['page_size'], options['page']
    total = connection.execute('SELECT count(*) ' + where, params).fetchone()[0]
    rows = connection.execute(select + ' ' + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?',
                              (*params, size, (number - 1) * size)).fetchall()
    return {'items': [dict(row) for row in rows], 'page': number, 'page_size': size, 'total': total}


@contextmanager
def database(request):
    settings = request.app.state.settings
    if settings.edition_root is not None:
        try:
            guard_edition_database(settings.edition_root, settings.database_path)
        except ValueError:
            raise DataError(503, 'DATABASE_UNAVAILABLE', 'Cấu hình dữ liệu của bản ứng dụng chưa hợp lệ.') from None
    with closing(connect_database(request.app.state.settings.database_path)) as connection:
        try:
            require_schema(connection)
        except RuntimeError:
            raise DataError(503, 'DATABASE_UNAVAILABLE', 'Cấu trúc cơ sở dữ liệu chưa được hỗ trợ.') from None
        connection.create_function('casefold', 1, str.casefold, deterministic=True)
        yield connection


@contextmanager
def authorized(request, *, write=False):
    with database(request) as connection:
        if not write:
            connection.execute('BEGIN')  # access checks and reads share one snapshot
        try:
            now = request.app.state.clock()
            session = auth.authenticate(connection, request.cookies.get(request.app.state.settings.cookie_name), now)
            if write:
                auth.require_csrf(session, request.headers.get('x-csrf-token'))
            yield Store(connection, session['user_id'], now=auth.stamp(now),
                        reauthenticate=(lambda: recheck_session(request, connection)) if write else None), connection, session, now
        finally:
            if connection.in_transaction:
                connection.execute('ROLLBACK')  # read snapshot; mutations own their transaction


def project_view(store, connection, project_id):
    project = store.get_project(project_id)
    project['role'] = 'owner' if project['owner_id'] == store.actor_id else 'member'
    project['members'] = [dict(row) for row in connection.execute('''SELECT u.id,u.username,u.display_name
        FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.id''', (project_id,))]
    return project


def task_view(task, now, timezone=DEFAULT_TIMEZONE):
    return project_deadline(task, now, timezone)


@router.post('/auth/register', status_code=201)
def register(request: Request, input: dict = Body(...)):
    with request.app.state.auth_limiter.attempt(request.client.host if request.client else 'unknown'):
        with database(request) as connection:
            return auth.register(connection, input, request.app.state.clock())


@router.post('/auth/login')
def login(request: Request, response: Response, input: dict = Body(...)):
    settings = request.app.state.settings
    with request.app.state.auth_limiter.attempt(request.client.host if request.client else 'unknown'):
        with database(request) as connection:
            result, token = auth.login(connection, input, request.cookies.get(settings.cookie_name), request.app.state.clock())
    response.set_cookie(settings.cookie_name, token, max_age=8 * 3600, httponly=True,
                        secure=settings.cookie_secure, samesite='lax', path='/')
    return result


@router.get('/auth/me')
def me(request: Request):
    with authorized(request) as (_, _, session, _now):
        return {'user': {'id': session['user_id'], 'username': session['username'], 'display_name': session['display_name']},
                'csrf_token': session['csrf_token']}


@router.post('/auth/logout', status_code=204)
def logout(request: Request):
    with authorized(request, write=True) as (_, connection, session, _now):
        with transaction(connection):
            latest = recheck_session(request, connection)
            connection.execute('DELETE FROM sessions WHERE id=?', (latest['id'],))
    return signed_out_response(request.app.state.settings)


def signed_out_response(settings):
    response = Response(status_code=204)
    response.delete_cookie(settings.cookie_name, path='/', httponly=True, secure=settings.cookie_secure, samesite='lax')
    return response


@router.patch('/account/profile')
def account_profile(request: Request, input: dict = Body(...)):
    with database(request) as connection:
        return auth.update_profile(connection, input, request.cookies.get(request.app.state.settings.cookie_name),
                                   request.headers.get('x-csrf-token'), request.app.state.clock(), clock=request.app.state.clock)


@router.post('/account/password', status_code=204)
def account_password(request: Request, input: dict = Body(...)):
    with request.app.state.auth_limiter.attempt(request.client.host if request.client else 'unknown'):
        with database(request) as connection:
            auth.change_password(connection, input, request.cookies.get(request.app.state.settings.cookie_name),
                                 request.headers.get('x-csrf-token'), request.app.state.clock(), clock=request.app.state.clock)
    return signed_out_response(request.app.state.settings)


@router.get('/projects')
def projects(request: Request):
    with authorized(request) as (store, connection, _, _now):
        options = filters(request, ('q', 'page', 'page_size'))
        where = '''FROM projects p JOIN project_members m ON m.project_id=p.id
            WHERE m.user_id=? AND p.archived_at IS NULL AND instr(casefold(p.name),?)>0'''
        result = page(connection, 'SELECT p.*', where, (store.actor_id, options.get('q', '').casefold()), options, order='p.id DESC')
        for item in result['items']:
            item['role'] = 'owner' if item['owner_id'] == store.actor_id else 'member'
        return result


@router.get('/calendar')
def calendar(request: Request):
    from .notifications import calendar_data
    with authorized(request) as (store, connection, _, now):
        return calendar_data(connection, store.actor_id, now, filters(request, ('month', 'date', 'page', 'page_size')))


@router.get('/projects/archived')
def archived_projects(request: Request):
    with authorized(request) as (store, connection, _, _now):
        options = filters(request, ('q', 'page', 'page_size'))
        result = page(connection, 'SELECT p.*',
                      'FROM projects p WHERE p.owner_id=? AND p.archived_at IS NOT NULL AND instr(casefold(p.name),?)>0',
                      (store.actor_id, options.get('q', '').casefold()), options, order='p.id DESC')
        for item in result['items']:
            item['role'] = 'owner'
        return result


@router.get('/account/preferences')
def account_preferences(request: Request):
    with authorized(request) as (store, connection, _, _now):
        if request.query_params:
            invalid('input', 'Bộ lọc không được hỗ trợ hoặc bị lặp.')
        return preferences_data(connection, store.actor_id)


@router.patch('/account/preferences')
def update_preferences(request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (_, connection, _, now):
        if request.query_params:
            invalid('input', 'Bộ lọc không được hỗ trợ hoặc bị lặp.')
        with transaction(connection):
            session = recheck_session(request, connection)
            return save_preferences(connection, session['user_id'], input)


@router.get('/notifications')
def notifications(request: Request):
    from .notifications import notification_page
    with authorized(request) as (store, connection, _, now):
        return notification_page(connection, store.actor_id, filters(request, ('page', 'page_size')), now=now)


@router.post('/notifications/daily')
def daily_report(request: Request, input: dict = Body(...)):
    from .notifications import create_daily_report
    with authorized(request, write=True) as (_, connection, _, now):
        fields(input, ())
        if request.query_params:
            invalid('input', 'Báo cáo ngày không nhận tham số.')
        with transaction(connection):
            # A request may wait on the write lock while another session revokes its token.
            session = recheck_session(request, connection)
            current = request.app.state.clock()
            return create_daily_report(connection, session['user_id'], current, auth.stamp(current))


@router.post('/projects', status_code=201)
def create_project(request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, _, _, _now):
        return store.create_project(input)


@router.get('/projects/{project_id}')
def get_project(project_id: str, request: Request):
    with authorized(request) as (store, connection, _, _now):
        return project_view(store, connection, resource_id(project_id))


@router.patch('/projects/{project_id}')
def update_project(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, _, _, _now):
        return store.update_project(resource_id(project_id), input)


@router.post('/projects/{project_id}/archive')
def archive_project(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, _, _, _now):
        fields(input, ('version',))
        return store.archive_project(resource_id(project_id), input.get('version'))


def recheck_session(request, connection):
    session = auth.authenticate(connection, request.cookies.get(request.app.state.settings.cookie_name), request.app.state.clock())
    auth.require_csrf(session, request.headers.get('x-csrf-token'))
    return session


@router.post('/projects/{project_id}/restore')
def restore_project(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, connection, _, now):
        fields(input, ('version',))
        return store.restore_project(resource_id(project_id), input.get('version'),
                                     reauthenticate=lambda: recheck_session(request, connection))


@router.delete('/projects/{project_id}', status_code=204)
def delete_project(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, connection, _, now):
        fields(input, ('version',))
        store.delete_project(resource_id(project_id), input.get('version'),
                             reauthenticate=lambda: recheck_session(request, connection))
    return Response(status_code=204)


@router.get('/users')
def users(request: Request):
    with authorized(request) as (store, connection, _, _now):
        if not connection.execute('SELECT 1 FROM projects WHERE owner_id=?', (store.actor_id,)).fetchone():
            raise DataError(403, 'FORBIDDEN', 'Chỉ chủ dự án được tìm tài khoản để thêm thành viên.')
        options = filters(request, ('q', 'page', 'page_size'))
        query = options.get('q', '').casefold()
        if not query:
            return {'items': [], 'page': options['page'], 'page_size': options['page_size'], 'total': 0}
        return page(connection, 'SELECT id,username,display_name',
                    'FROM users WHERE instr(casefold(username),?)>0 OR instr(casefold(display_name),?)>0',
                    (query, query), options)


@router.post('/projects/{project_id}/members', status_code=201)
def add_member(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, _, _, _now):
        fields(input, ('user_id',))
        return store.add_member(resource_id(project_id), input.get('user_id'))


@router.delete('/projects/{project_id}/members/{user_id}', status_code=204)
def remove_member(project_id: str, user_id: str, request: Request):
    with authorized(request, write=True) as (store, _, _, _now):
        store.remove_member(resource_id(project_id), resource_id(user_id, 'user_id'))
    return Response(status_code=204)


@router.get('/projects/{project_id}/tasks')
def tasks(project_id: str, request: Request):
    from .queries import task_page
    with authorized(request) as (store, connection, _, now):
        project = store.get_project(resource_id(project_id))
        options = filters(request, ('q', 'status', 'priority', 'assignee_id', 'overdue', 'page', 'page_size'))
        zone = get_timezone(connection, store.actor_id)
        return task_page(connection, project['id'], options, business_today(now, zone).isoformat(), now=now, timezone=zone)


@router.post('/projects/{project_id}/tasks', status_code=201)
def create_task(project_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, connection, _, now):
        return task_view(store.create_task(resource_id(project_id), input), now, get_timezone(connection, store.actor_id))


@router.get('/tasks/{task_id}')
def get_task(task_id: str, request: Request):
    with authorized(request) as (store, connection, _, now):
        return task_view(store.get_task(resource_id(task_id)), now, get_timezone(connection, store.actor_id))


@router.patch('/tasks/{task_id}')
def update_task(task_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, connection, _, now):
        return task_view(store.update_task(resource_id(task_id), input), now, get_timezone(connection, store.actor_id))


@router.post('/tasks/{task_id}/archive')
def archive_task(task_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, connection, _, now):
        fields(input, ('version',))
        return task_view(store.archive_task(resource_id(task_id), input.get('version')), now, get_timezone(connection, store.actor_id))


@router.get('/tasks/{task_id}/comments')
def comments(task_id: str, request: Request):
    from .queries import comments_page
    with authorized(request) as (store, connection, _, _now):
        task = store.get_task(resource_id(task_id))
        return comments_page(connection, task['id'], **filters(request, ('page', 'page_size')))


@router.post('/tasks/{task_id}/comments', status_code=201)
def add_comment(task_id: str, request: Request, input: dict = Body(...)):
    with authorized(request, write=True) as (store, _, _, _now):
        return store.add_comment(resource_id(task_id), input)


@router.get('/tasks/{task_id}/history')
def history(task_id: str, request: Request):
    from .queries import history_page
    with authorized(request) as (store, connection, _, _now):
        task = store.get_task(resource_id(task_id))
        return history_page(connection, task['id'], **filters(request, ('page', 'page_size')))


@router.get('/projects/{project_id}/stats')
def stats(project_id: str, request: Request):
    from .queries import project_stats
    with authorized(request) as (store, connection, _, now):
        project = store.get_project(resource_id(project_id))
        if request.query_params:
            invalid('filters', 'Thống kê không nhận bộ lọc danh sách.')
        zone = get_timezone(connection, store.actor_id)
        return project_stats(connection, project['id'], business_today(now, zone).isoformat(), now=now, timezone=zone)
