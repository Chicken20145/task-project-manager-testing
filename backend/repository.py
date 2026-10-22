"""Database mutations with permission/version checks and audit in the same transaction.

actor_id must come from a server-authenticated session when wired to HTTP, never a request body.
"""
from datetime import date, datetime, timezone
from contextlib import contextmanager
import json
import re

from .db import transaction


class DataError(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status, self.code = status, code
        self.error = {'code': code, 'message': message, 'details': details or {}}


def invalid(field, message='Dữ liệu chưa hợp lệ.'):
    raise DataError(422, 'VALIDATION_ERROR', message, {field: message})


def identifier(value):
    if type(value) is not int or not 1 <= value <= 2 ** 53 - 1:
        invalid('id', 'ID phải là số nguyên dương.')
    return value


def fields(input, allowed):
    if not isinstance(input, dict):
        invalid('input')
    for key in input:
        if key not in allowed:
            invalid('input', 'Trường không được hỗ trợ.')


def text(value, field, limit, *, required=False, trim=False):
    if not isinstance(value, str) or '\0' in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        invalid(field)
    value = value.strip() if trim else value
    if len(value) > limit or (required and not value):
        invalid(field)
    return value


def project_values(input):
    return {'name': text(input.get('name'), 'name', 100, required=True, trim=True),
            'description': text(input.get('description', ''), 'description', 2000)}


def task_values(input):
    assignee = input.get('assignee_id')
    if assignee is not None:
        identifier(assignee)
    due = input.get('due_date')
    if due is not None:
        if not isinstance(due, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', due):
            invalid('due_date', 'Ngày hạn chưa hợp lệ.')
        try:
            date.fromisoformat(due)
        except ValueError:
            invalid('due_date', 'Ngày hạn chưa hợp lệ.')
    priority, status = input.get('priority', 'medium'), input.get('status', 'todo')
    if priority not in ('low', 'medium', 'high'):
        invalid('priority')
    if status not in ('todo', 'doing', 'done'):
        invalid('status')
    return {'title': text(input.get('title'), 'title', 119, required=True, trim=True),
            'description': text(input.get('description', ''), 'description', 2000),
            'assignee_id': assignee, 'due_date': due, 'priority': priority, 'status': status}


class Store:
    def __init__(self, connection, actor_id, *, now=None, reauthenticate=None):
        self.connection, self.actor_id = connection, actor_id
        self.reauthenticate = reauthenticate
        self.now = now or datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

    @contextmanager
    def _write(self):
        with transaction(self.connection):
            if self.reauthenticate:
                self.reauthenticate()
            yield

    def _actor(self):
        if type(self.actor_id) is not int or not self.connection.execute('SELECT 1 FROM users WHERE id=?', (self.actor_id,)).fetchone():
            raise DataError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.')

    def get_project(self, project_id):
        self._actor()
        row = self.connection.execute('''SELECT p.* FROM projects p WHERE p.id=? AND EXISTS (
            SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)''',
            (identifier(project_id), self.actor_id)).fetchone()
        if row is None:
            raise DataError(404, 'NOT_FOUND', 'Không tìm thấy dự án.')
        return dict(row)

    def get_task(self, task_id):
        self._actor()
        row = self.connection.execute('''SELECT t.* FROM tasks t WHERE t.id=? AND EXISTS (
            SELECT 1 FROM project_members m WHERE m.project_id=t.project_id AND m.user_id=?)''',
            (identifier(task_id), self.actor_id)).fetchone()
        if row is None:
            raise DataError(404, 'NOT_FOUND', 'Không tìm thấy công việc.')
        return dict(row)

    def _owner(self, project):
        if project['owner_id'] != self.actor_id:
            raise DataError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.')

    def _writable(self, project, task=None):
        if project['archived_at'] or (task and task['archived_at']):
            raise DataError(403, 'ARCHIVED', 'Nội dung đã lưu trữ, chỉ có thể xem.')

    def _version(self, entity, version):
        if type(version) is not int or version < 1:
            invalid('version', 'Cần phiên bản hiện tại.')
        if entity['version'] != version:
            raise DataError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.')

    def _assignee(self, project_id, assignee_id):
        if assignee_id is not None and not self.connection.execute(
            'SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project_id, assignee_id)).fetchone():
            invalid('assignee_id', 'Người phụ trách phải là thành viên của dự án.')

    def _record(self, table, entity_id, before, after, action):
        key = 'task_id' if table == 'task_history' else 'project_id'
        encode = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')) if value is not None else None
        self.connection.execute(f'INSERT INTO {table}({key},actor_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)',
                                (entity_id, self.actor_id, action, encode(before), encode(after), self.now))

    def _update(self, table, entity, values):
        setters = ','.join(f'{key}=?' for key in values)
        cursor = self.connection.execute(f'UPDATE {table} SET {setters},version=version+1,updated_at=? WHERE id=? AND version=?',
                                        (*values.values(), self.now, entity['id'], entity['version']))
        if cursor.rowcount != 1:
            raise DataError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi.')

    def create_project(self, input):
        with self._write():
            self._actor()
            fields(input, ('name', 'description'))
            values = project_values(input)
            cursor = self.connection.execute('INSERT INTO projects(name,description,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)',
                                             (values['name'], values['description'], self.actor_id, self.now, self.now))
            project_id = cursor.lastrowid
            self.connection.execute('INSERT INTO project_members VALUES(?,?,?)', (project_id, self.actor_id, self.now))
            project = self.get_project(project_id)
            self._record('project_history', project_id, None, project, 'created')
            return project

    def update_project(self, project_id, input):
        with self._write():
            project = self.get_project(project_id)
            self._owner(project)
            self._writable(project)
            fields(input, ('name', 'description', 'version'))
            self._version(project, input.get('version'))
            self._update('projects', project, project_values({**project, **input}))
            updated = self.get_project(project_id)
            self._record('project_history', project_id, project, updated, 'updated')
            return updated

    def archive_project(self, project_id, version):
        with self._write():
            project = self.get_project(project_id)
            self._owner(project)
            self._writable(project)
            self._version(project, version)
            self._update('projects', project, {'archived_at': self.now})
            updated = self.get_project(project_id)
            self._record('project_history', project_id, project, updated, 'archived')
            return updated

    def restore_project(self, project_id, version, *, reauthenticate=None):
        with self._write():
            if reauthenticate:
                reauthenticate()
            project = self.get_project(project_id)
            self._owner(project)
            self._version(project, version)
            if not project['archived_at']:
                raise DataError(409, 'PROJECT_NOT_ARCHIVED', 'Dự án chưa được lưu trữ.')
            self._update('projects', project, {'archived_at': None})
            updated = self.get_project(project_id)
            self._record('project_history', project_id, project, updated, 'updated')
            return updated

    def delete_project(self, project_id, version, *, reauthenticate=None):
        with self._write():
            if reauthenticate:
                reauthenticate()
            project = self.get_project(project_id)
            self._owner(project)
            self._version(project, version)
            if not project['archived_at']:
                raise DataError(409, 'PROJECT_NOT_ARCHIVED', 'Chỉ được xóa vĩnh viễn dự án đã lưu trữ.')
            # Remove snapshot references as well, so later SQLite ID reuse cannot expose stale content.
            for row in self.connection.execute('SELECT id,tasks_json FROM daily_reports').fetchall():
                tasks = json.loads(row['tasks_json'])
                remaining = [task for task in tasks if task.get('project_id') != project_id]
                if len(tasks) != len(remaining):
                    self.connection.execute('UPDATE daily_reports SET tasks_json=? WHERE id=?',
                                            (json.dumps(remaining, ensure_ascii=False, separators=(',', ':')), row['id']))
            for table in ('comments', 'task_history'):
                self.connection.execute(f'DELETE FROM {table} WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)', (project_id,))
            for table in ('tasks', 'project_history', 'project_members'):
                self.connection.execute(f'DELETE FROM {table} WHERE project_id=?', (project_id,))
            self.connection.execute('DELETE FROM projects WHERE id=?', (project_id,))

    def _deadline_values(self, input, previous=None):
        from .deadlines import deadline_values
        from .preferences import get_timezone
        return deadline_values(input, get_timezone(self.connection, self.actor_id), previous)

    def add_member(self, project_id, user_id):
        with self._write():
            project = self.get_project(project_id)
            self._owner(project)
            self._writable(project)
            identifier(user_id)
            if not self.connection.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                invalid('user_id', 'Tài khoản không tồn tại.')
            if self.connection.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project_id, user_id)).fetchone():
                raise DataError(409, 'DUPLICATE_MEMBER', 'Tài khoản đã là thành viên của dự án.')
            self.connection.execute('INSERT INTO project_members VALUES(?,?,?)', (project_id, user_id, self.now))
            return {'project_id': project_id, 'user_id': user_id}

    def remove_member(self, project_id, user_id):
        with self._write():
            project = self.get_project(project_id)
            self._owner(project)
            self._writable(project)
            identifier(user_id)
            if project['owner_id'] == user_id:
                invalid('user_id', 'Không thể loại chủ dự án.')
            if not self.connection.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project_id, user_id)).fetchone():
                raise DataError(404, 'NOT_FOUND', 'Không tìm thấy thành viên.')
            assigned = self.connection.execute('SELECT * FROM tasks WHERE project_id=? AND assignee_id=? ORDER BY id', (project_id, user_id)).fetchall()
            # Clear archived assignments too, preserving archive timestamps and recording the revocation side effect.
            for row in assigned:
                task = dict(row)
                self._update('tasks', task, {'assignee_id': None})
                self._record('task_history', task['id'], task, self.get_task(task['id']), 'assignee_removed')
            self.connection.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?', (project_id, user_id))

    def create_task(self, project_id, input):
        with self._write():
            project = self.get_project(project_id)
            self._owner(project)
            self._writable(project)
            fields(input, ('title', 'description', 'assignee_id', 'due_date', 'due_local', 'due_timezone', 'priority'))
            values = task_values(input)
            values.update(self._deadline_values(input))
            self._assignee(project_id, values['assignee_id'])
            columns = ','.join(values)
            placeholders = ','.join('?' for _ in values)
            cursor = self.connection.execute(f'INSERT INTO tasks(project_id,{columns},created_at,updated_at) VALUES(?,{placeholders},?,?)',
                                             (project_id, *values.values(), self.now, self.now))
            task = self.get_task(cursor.lastrowid)
            self._record('task_history', task['id'], None, task, 'created')
            return task

    def update_task(self, task_id, input):
        with self._write():
            task = self.get_task(task_id)
            project = self.get_project(task['project_id'])
            self._writable(project, task)
            if project['owner_id'] != self.actor_id and (task['assignee_id'] != self.actor_id or
                    not isinstance(input, dict) or any(key not in ('status', 'version') for key in input)):
                raise DataError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.')
            fields(input, ('title', 'description', 'assignee_id', 'due_date', 'due_local', 'due_timezone', 'priority', 'status', 'version'))
            self._version(task, input.get('version'))
            values = task_values({**task, **input})
            values.update(self._deadline_values(input, task))
            self._assignee(task['project_id'], values['assignee_id'])
            self._update('tasks', task, values)
            updated = self.get_task(task_id)
            self._record('task_history', task_id, task, updated, 'updated')
            return updated

    def archive_task(self, task_id, version):
        with self._write():
            task = self.get_task(task_id)
            project = self.get_project(task['project_id'])
            self._owner(project)
            self._writable(project, task)
            self._version(task, version)
            self._update('tasks', task, {'archived_at': self.now})
            updated = self.get_task(task_id)
            self._record('task_history', task_id, task, updated, 'archived')
            return updated

    def add_comment(self, task_id, input):
        with self._write():
            task = self.get_task(task_id)
            self._writable(self.get_project(task['project_id']), task)
            fields(input, ('body',))
            body = text(input.get('body'), 'body', 1000, required=True, trim=True)
            cursor = self.connection.execute('INSERT INTO comments(task_id,author_id,body,created_at) VALUES(?,?,?,?)',
                                             (task_id, self.actor_id, body, self.now))
            return dict(self.connection.execute('SELECT * FROM comments WHERE id=?', (cursor.lastrowid,)).fetchone())
