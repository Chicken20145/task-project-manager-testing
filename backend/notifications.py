"""Personal calendar and notification projections; callers provide an authenticated actor/snapshot."""
from calendar import monthrange
from datetime import date, timedelta
import json
import re
from zoneinfo import ZoneInfo

from .repository import invalid
from .preferences import DEFAULT_TIMEZONE, get_timezone
from .deadlines import legacy_instant, project_deadline, register_deadline_functions

ACTIVE_TASKS = '''FROM tasks t JOIN projects p ON p.id=t.project_id
    JOIN project_members m ON m.project_id=p.id
    WHERE m.user_id=? AND p.archived_at IS NULL AND t.archived_at IS NULL'''


def business_today(now, timezone=DEFAULT_TIMEZONE):
    return now.astimezone(ZoneInfo(timezone)).date()


def month_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}', value):
        invalid('month', 'Tháng chưa hợp lệ.')
    try:
        return date.fromisoformat(value + '-01')
    except ValueError:
        invalid('month', 'Tháng chưa hợp lệ.')


def calendar_data(connection, user_id, now, options):
    zone = get_timezone(connection, user_id)
    register_deadline_functions(connection, now, zone)
    today = business_today(now, zone)
    first = month_date(options.get('month', today.isoformat()[:7]))
    month = first.isoformat()[:7]
    selected = options.get('date', today.isoformat() if today.isoformat().startswith(month) else first.isoformat())
    try:
        if not isinstance(selected, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', selected):
            raise ValueError()
        selected_day = date.fromisoformat(selected)
        if selected_day.year != first.year or selected_day.month != first.month:
            raise ValueError()
    except ValueError:
        invalid('date', 'Ngày được chọn phải hợp lệ và thuộc tháng đang xem.')
    length = monthrange(first.year, first.month)[1]
    last = date(first.year, first.month, length).isoformat()
    grouped = {row['due_date']: dict(row) for row in connection.execute('''SELECT deadline_date(t.due_at,t.due_date) due_date,
        count(*) total, sum(t.status='done') done, sum(deadline_overdue(t.due_at,t.due_date,t.status,t.archived_at)) overdue ''' +
        ACTIVE_TASKS + " AND t.assignee_id=? AND t.status!='done' AND deadline_date(t.due_at,t.due_date) BETWEEN ? AND ? GROUP BY deadline_date(t.due_at,t.due_date)",
        (user_id, user_id, first.isoformat(), last))}
    days = []
    for day in range(1, length + 1):
        value = date(first.year, first.month, day).isoformat()
        counts = grouped.get(value, {})
        days.append({'date': value, 'day': day, **{key: counts.get(key, 0) for key in ('total', 'done', 'overdue')}})
    size, number = options['page_size'], options['page']
    where = ACTIVE_TASKS + " AND t.assignee_id=? AND t.status!='done' AND deadline_date(t.due_at,t.due_date)=?"
    params = (user_id, user_id, selected)
    total = connection.execute('SELECT count(*) ' + where, params).fetchone()[0]
    rows = connection.execute('SELECT t.id,t.title,t.project_id,p.name project_name,t.due_date,t.due_at,t.status ' +
                              where + ' ORDER BY t.id DESC LIMIT ? OFFSET ?', (*params, size, (number - 1) * size))
    previous = (first - timedelta(days=1)).isoformat()[:7] if first > date.min else None
    following = (date(first.year, first.month, length) + timedelta(days=1)).isoformat()[:7] if last != '9999-12-31' else None
    return {'month': month, 'today': today.isoformat(), 'timezone': zone, 'selected_date': selected,
            'previous_month': previous, 'next_month': following, 'start_weekday': first.weekday(), 'days': days,
            'tasks': {'items': [project_deadline(dict(row), now, zone) for row in rows], 'page': number, 'page_size': size, 'total': total}}


def create_daily_report(connection, user_id, now, stamp):
    """Must run inside the caller's BEGIN IMMEDIATE after session/CSRF reauthentication."""
    zone = get_timezone(connection, user_id)
    today = business_today(now, zone)
    if connection.execute('SELECT 1 FROM daily_reports WHERE user_id=? AND report_date=?', (user_id, today.isoformat())).fetchone():
        return {'created': False, 'report_date': today.isoformat()}
    rows = connection.execute('SELECT t.id,t.title,t.project_id,p.name project_name,t.due_date,t.due_at ' + ACTIVE_TASKS +
                              " AND t.assignee_id=? AND t.status!='done' AND t.due_date IS NOT NULL ORDER BY t.due_date,t.id",
                              (user_id, user_id))
    tasks = []
    for row in rows:
        task = project_deadline(dict(row), now, zone)
        if task['due_date']:
            tasks.append({**task, 'days_left': (date.fromisoformat(task['due_date']) - today).days + 1})
    cursor = connection.execute('''INSERT INTO daily_reports(user_id,report_date,created_at,timezone,tasks_json)
        VALUES(?,?,?,?,?) ON CONFLICT(user_id,report_date) DO NOTHING''',
        (user_id, today.isoformat(), stamp, zone, json.dumps(tasks, ensure_ascii=False, separators=(',', ':'))))
    return {'created': cursor.rowcount == 1, 'report_date': today.isoformat()}


def notification_page(connection, user_id, options, *, now=None):
    from datetime import datetime, timezone
    now = now or datetime.now(timezone.utc)
    zone = get_timezone(connection, user_id)
    def deadline_fields(task):
        projected = project_deadline(task, now, zone)
        return {key: projected[key] for key in ('due_at', 'due_local', 'due_date')}
    # Recipients come from historical snapshots; current membership/archive gates every read.
    shared = '''FROM task_history h JOIN tasks t ON t.id=h.task_id
        JOIN projects p ON p.id=t.project_id JOIN users u ON u.id=h.actor_id
        JOIN project_members m ON m.project_id=p.id
        WHERE m.user_id=? AND p.archived_at IS NULL AND t.archived_at IS NULL'''
    columns = '''h.created_at,h.task_id,json_extract(h.after_json,'$.title') title,
        p.id project_id,p.name project_name,u.display_name actor_name,
        json_extract(h.after_json,'$.due_date') due_date,json_extract(h.after_json,'$.due_at') due_at,NULL report_date,NULL tasks_json,NULL timezone'''
    sql = '''WITH feed AS (
        SELECT 'assigned:'||h.id id,'assigned' kind,''' + columns + ' ' + shared + '''
            AND h.action IN ('created','updated') AND json_extract(h.after_json,'$.assignee_id')=?
            AND json_extract(h.before_json,'$.assignee_id') IS NOT json_extract(h.after_json,'$.assignee_id')
        UNION ALL SELECT 'completed:'||h.id id,'completed' kind,''' + columns + ' ' + shared + '''
            AND h.action='updated' AND json_extract(h.after_json,'$.status')='done'

            AND (p.owner_id=? OR json_extract(h.after_json,'$.assignee_id')=?)
        UNION ALL SELECT 'daily:'||id id,'daily' kind,created_at,NULL,NULL,NULL,NULL,NULL,NULL,NULL,report_date,tasks_json,timezone
            FROM daily_reports WHERE user_id=?
        ) '''
    params = (user_id, user_id, user_id, user_id, user_id, user_id)
    total = connection.execute(sql + 'SELECT count(*) FROM feed', params).fetchone()[0]
    size, number = options['page_size'], options['page']
    rows = connection.execute(sql + 'SELECT * FROM feed ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
                              (*params, size, (number - 1) * size)).fetchall()
    allowed = None
    items = []
    for row in rows:
        if row['kind'] == 'daily':
            if allowed is None:
                allowed = {r[0] for r in connection.execute('SELECT t.id ' + ACTIVE_TASKS, (user_id,))}
            tasks = [{**task, **deadline_fields(task)}
                     for task in json.loads(row['tasks_json']) if task['id'] in allowed]
            items.append({'id': row['id'], 'kind': 'daily', 'created_at': row['created_at'],
                          'report_date': row['report_date'], 'timezone': row['timezone'], 'tasks': tasks})
        else:
            items.append({key: row[key] for key in ('id', 'kind', 'created_at', 'task_id', 'title',
                                                   'project_id', 'project_name', 'actor_name', 'due_date', 'due_at')})
            items[-1].update(deadline_fields(items[-1]))
    return {'items': items, 'page': number, 'page_size': size, 'total': total}
