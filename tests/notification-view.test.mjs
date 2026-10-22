import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNotifications } from '../web/notification-view.js';
import { createTranslator } from '../web/i18n.js';

const fixture = () => ({ type: 'notifications', language: 'vi', timezone: 'Asia/Ho_Chi_Minh',
  calendar: { month: '2026-10', today: '2026-10-21', selected_date: '2026-10-22', start_weekday: 3,
    previous_month: '2026-09', next_month: '2026-11',
    days: Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, day: i + 1, total: i === 21 ? 2 : 0, done: i === 21 ? 1 : 0, overdue: 0 })),
    tasks: { items: [{ id: 44, title: 'Báo cáo riêng', project_id: 4, project_name: 'Nhóm A', status: 'done', due_date: '2026-10-22' }], page: 2, page_size: 1, total: 2 } },
  notifications: { items: [
    { id: 'assigned:2', kind: 'assigned', title: 'Báo cáo riêng', task_id: 44, project_name: 'Nhóm A', actor_name: 'Minh', due_date: '2026-10-22', created_at: '2026-10-20T18:00:00Z' },
    { id: 'completed:3', kind: 'completed', title: 'Báo cáo riêng', task_id: 44, project_name: 'Nhóm A', actor_name: 'Lan', created_at: '2026-10-20T18:00:00Z' },
    { id: 'daily:1', kind: 'daily', report_date: '2026-10-21', timezone: 'Asia/Ho_Chi_Minh', created_at: '2026-10-20T18:00:00Z',
      tasks: [-1, 0, 2].map((days_left, i) => ({ id: i + 10, title: `Việc ${i}`, project_name: 'Nhóm A', due_date: '2026-10-22', days_left })) },
  ], page: 2, page_size: 3, total: 8 } });
const render = (model, lang = 'vi') => renderNotifications({ ...model, language: lang }, createTranslator(lang));
const links = html => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replaceAll('&amp;', '&'));

test('calendar has selected date, marked deadlines and independent day/feed navigation', () => {
  const html = render(fixture());
  assert.match(html, /Lịch deadline/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /#\/tasks\/44/);
  assert.match(html, /Hoàn thành/);
  const params = links(html).filter(h => h.startsWith('#/notifications?')).map(h => new URLSearchParams(h.split('?')[1]));
  assert.ok(params.some(p => p.get('month') === '2026-09' && p.get('date') === '2026-09-01' && p.get('page') === '2'));
  assert.ok(params.some(p => p.get('date') === '2026-10-22' && (p.get('day_page') || '1') === '1' && p.get('page') === '2'));
  assert.ok(params.some(p => p.get('date') === '2026-10-22' && p.get('day_page') === '2' && p.get('page') === '3'));
});

test('assignment completion and daily reminders show actor and remaining/due/overdue text', () => {
  const html = render(fixture());
  assert.match(html, /Minh/);
  assert.match(html, /Lan/);
  assert.match(html, /Còn 2 ngày/);
  assert.match(html, /Đến hạn hôm nay/);
  assert.match(html, /Quá hạn 1 ngày/);
  assert.match(html, /data-action="refresh-notifications"/);
});

test('notification view localizes labels and escapes names titles and attributes', () => {
  const model = fixture();
  model.notifications.items[0].actor_name = '<img src=x onerror=evil()>';
  model.notifications.items[0].title = 'Đăng nhập <script>evil()</script>';
  const html = render(model, 'en');
  assert.match(html, /Notifications/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Đăng nhập &lt;script&gt;/);
  assert.match(html, /2 days/);
});

test('calendar boundaries and empty data remain usable without fake events', () => {
  const model = fixture();
  model.calendar.previous_month = null;
  model.calendar.next_month = null;
  model.calendar.tasks = { items: [], page: 1, page_size: 20, total: 0 };
  model.notifications = { items: [], page: 1, page_size: 20, total: 0 };
  const html = render(model);
  assert.doesNotMatch(html, /month=null|#\/tasks\/44|assigned:2/);
  assert.match(html, /disabled/);
  assert.match(html, /Chưa có thông báo/);
});

test('notification timestamps respect saved timezone while deadline date stays fixed', () => {
  const model = fixture();
  const utc = render({ ...model, timezone: 'UTC' });
  const tokyo = render({ ...model, timezone: 'Asia/Tokyo' });
  assert.match(utc, /18:00/);
  assert.match(tokyo, /03:00/);
  assert.match(utc, /22\/10\/2026/);
  assert.match(tokyo, /22\/10\/2026/);
});
