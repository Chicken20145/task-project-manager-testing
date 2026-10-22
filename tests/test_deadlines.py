from datetime import datetime, timezone

import pytest

from backend.deadlines import deadline_values, project_deadline
from backend.repository import DataError


def test_absolute_deadline_conversion_preservation_and_clear():
    values = deadline_values({'due_local': '2026-12-31T23:30'}, 'Asia/Ho_Chi_Minh')
    assert values == {'due_date': '2026-12-31', 'due_at': '2026-12-31T16:30:00Z'}
    task = {**values, 'status': 'todo', 'archived_at': None}
    now = datetime(2026, 12, 31, 16, 30, tzinfo=timezone.utc)
    assert project_deadline(task, now, 'Asia/Tokyo')['due_local'] == '2027-01-01T01:30'
    assert not project_deadline(task, now, 'UTC')['is_overdue']
    assert project_deadline(task, now.replace(second=1), 'UTC')['is_overdue']
    assert deadline_values({}, 'UTC', task) == values
    assert deadline_values({'due_local': None}, 'UTC', task) == {'due_date': None, 'due_at': None}
    legacy = deadline_values({'due_date': '2024-02-29'}, 'UTC')
    assert legacy['due_at'] == '2024-02-29T16:59:59Z'
    assert deadline_values({'due_local': '2024-02-29T23:59'}, 'Asia/Ho_Chi_Minh', legacy) == legacy


@pytest.mark.parametrize('local,zone', [
    ('2026-03-29T01:30', 'Europe/London'), ('2026-10-25T01:30', 'Europe/London'),
    ('2026-03-08T02:30', 'America/New_York'), ('2026-11-01T01:30', 'America/New_York'),
    ('2026-02-30T12:00', 'UTC'), ('2026-10-20T12:00Z', 'UTC'),
    ('2026-10-20T12:00:00', 'UTC'), ('0001-01-01T00:00', 'Asia/Tokyo'),
])
def test_reject_invalid_or_ambiguous_local_deadline(local, zone):
    with pytest.raises(DataError) as caught:
        deadline_values({'due_local': local}, zone)
    assert caught.value.status == 422
    assert 'due_local' in caught.value.error['details']


def test_half_hour_and_stale_timezone_form():
    assert deadline_values({'due_local': '2026-10-20T00:00'}, 'Asia/Kolkata')['due_at'] == '2026-10-19T18:30:00Z'
    with pytest.raises(DataError) as caught:
        deadline_values({'due_local': '2026-10-20T10:00', 'due_timezone': 'UTC'}, 'Asia/Tokyo')
    assert caught.value.code == 'TIMEZONE_CHANGED'
    with pytest.raises(DataError):
        deadline_values({'due_local': None, 'due_date': None}, 'UTC')


@pytest.mark.parametrize('local,zone,expected', [
    ('2026-01-20T12:00', 'Europe/London', '2026-01-20T12:00:00Z'),
    ('2026-07-20T12:00', 'Europe/London', '2026-07-20T11:00:00Z'),
    ('2026-01-20T12:00', 'America/New_York', '2026-01-20T17:00:00Z'),
    ('2026-07-20T12:00', 'America/New_York', '2026-07-20T16:00:00Z'),
])
def test_unambiguous_dst_deadlines(local, zone, expected):
    assert deadline_values({'due_local': local}, zone)['due_at'] == expected
