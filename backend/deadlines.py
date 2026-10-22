"""Absolute deadlines, strict local input, and viewer timezone projections."""
from datetime import date, datetime, timedelta, timezone
import re
from zoneinfo import ZoneInfo

from .repository import DataError, invalid


def legacy_instant(value):
    return value + 'T16:59:59Z' if value else None  # legacy end of day, fixed UTC+07


def instant(task):
    value = task.get('due_at') or legacy_instant(task.get('due_date'))
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def local_value(value, zone):
    return value.astimezone(ZoneInfo(zone)).isoformat(timespec='minutes')[:16]


def deadline_values(input, zone, previous=None):
    previous = previous or {}
    if 'due_timezone' in input and 'due_local' not in input:
        invalid('due_local', 'Chỉ gửi múi giờ cùng ngày và giờ deadline.')
    if 'due_local' in input and 'due_date' in input:
        invalid('due_local', 'Chỉ gửi một kiểu deadline.')
    if 'due_local' not in input and 'due_date' not in input:
        return {'due_date': previous.get('due_date'),
                'due_at': previous.get('due_at') or legacy_instant(previous.get('due_date'))}
    if 'due_local' in input:
        if input.get('due_timezone', zone) != zone:
            raise DataError(409, 'TIMEZONE_CHANGED', 'Múi giờ đã thay đổi ở phiên khác. Hãy tải lại và kiểm tra deadline.',
                            {'due_local': 'Múi giờ đã thay đổi. Hãy tải lại biểu mẫu.'})
        value = input['due_local']
        if value is None:
            return {'due_date': None, 'due_at': None}
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}', value):
            invalid('due_local', 'Vui lòng nhập ngày và giờ hợp lệ.')
        try:
            local = datetime.fromisoformat(value)
            tz = ZoneInfo(zone)
            candidates = {local.replace(tzinfo=tz, fold=fold).astimezone(timezone.utc) for fold in (0, 1)}
            candidates = {candidate for candidate in candidates if candidate.astimezone(tz).replace(tzinfo=None) == local}
            if len(candidates) != 1:
                invalid('due_local', 'Giờ này bị trùng hoặc không tồn tại do đổi giờ mùa hè. Hãy chọn giờ khác.')
            old = instant(previous)
            # Minute inputs must not truncate legacy 23:59:59 on an unchanged edit.
            chosen = old if old and local_value(old, zone) == value else candidates.pop()
            stamp = chosen.isoformat(timespec='seconds').replace('+00:00', 'Z')
            return {'due_date': chosen.astimezone(timezone(timedelta(hours=7))).date().isoformat(), 'due_at': stamp}
        except (ValueError, OverflowError):
            invalid('due_local', 'Ngày giờ nằm ngoài phạm vi được hỗ trợ.')
    value = input['due_date']
    if value is not None:
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
            invalid('due_date', 'Ngày hạn chưa hợp lệ.')
        try:
            date.fromisoformat(value)
        except ValueError:
            invalid('due_date', 'Ngày hạn chưa hợp lệ.')
    return {'due_date': value, 'due_at': legacy_instant(value)}


def project_deadline(task, now, zone):
    due = instant(task)
    try:
        local = local_value(due, zone) if due else None
    except OverflowError:
        local = None  # only possible at supported calendar extremes in another timezone
    return {**task, 'due_at': due.isoformat(timespec='seconds').replace('+00:00', 'Z') if due else None,
            'due_local': local, 'due_date': local[:10] if local else None,
            'is_overdue': bool(due and due < now and task.get('status') != 'done' and not task.get('archived_at'))}


def register_deadline_functions(connection, now, zone):
    def local_date(due_at, due_date):
        return project_deadline({'due_at': due_at, 'due_date': due_date}, now, zone)['due_date']
    def overdue(due_at, due_date, status, archived_at):
        return int(project_deadline({'due_at': due_at, 'due_date': due_date, 'status': status,
                                     'archived_at': archived_at}, now, zone)['is_overdue'])
    connection.create_function('deadline_date', 2, local_date, deterministic=True)
    connection.create_function('deadline_overdue', 4, overdue, deterministic=True)
