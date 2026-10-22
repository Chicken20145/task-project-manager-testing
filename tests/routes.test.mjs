import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, readFilters, routeHash, publicDraft, readActivityPages, activityHash } from '../web/routes.js';

test('deep links resolve only known routes and positive safe resource identifiers', () => {
  assert.deepEqual(parseRoute('#/projects/10/tasks/new'), { type: 'task-form', projectId: 10 });
  assert.deepEqual(parseRoute('#/tasks/125/edit'), { type: 'task-form', taskId: 125 });
  assert.equal(parseRoute('#/register').type, 'register');
  for (const path of ['#/tasks/-1', '#/tasks/0', '#/tasks/9007199254740993', '#/projects/x', '#/tasks/1/extra']) {
    assert.equal(parseRoute(path).type, 'error');
  }
});
test('filters parse typed optional values, retain unassigned and reject malformed input', () => {
  assert.deepEqual(readFilters('q=hello&status=doing&assignee_id=unassigned&overdue=true&page=2'),
    { q: 'hello', status: 'doing', assignee_id: null, overdue: true, page: 2, page_size: 20 });
  assert.deepEqual(readFilters(''), { page: 1, page_size: 20 });
  for (const q of ['page=0', 'page=abc', 'page_size=101', 'assignee_id=-1', 'overdue=maybe', 'status=bad']) {
    assert.throws(() => readFilters(q), RangeError);
  }
});
test('route query encoding round-trips user search and filters without overriding route', () => {
  const url = routeHash('/projects/10', { q: 'a&b "<script>', assignee_id: null, overdue: false, page: 3 });
  assert.equal(parseRoute(url).projectId, 10);
  const filters = readFilters(url.split('?')[1]);
  assert.equal(filters.q, 'a&b "<script>');
  assert.equal(filters.assignee_id, null);
  assert.equal(filters.overdue, false);
});
test('retained drafts exclude credentials and arbitrary fields', () => {
  const input = { title: 'Giữ lại', description: 'Bản nhập', password: 'secret', confirm_password: 'secret', csrf_token: 'secret', role: 'owner' };
  assert.deepEqual(publicDraft(input), { title: 'Giữ lại', description: 'Bản nhập' });
  assert.equal(input.password, 'secret');
});

test('comment and history pages are independent and retain deep link context', () => {
  assert.deepEqual(readActivityPages('comments_page=2&history_page=3'), {
    comments: { page: 2, page_size: 20 }, history: { page: 3, page_size: 20 },
  });
  const hash = activityHash('#/tasks/101?comments_page=2&history_page=3', 'comments', 4);
  assert.equal(hash, '#/tasks/101?comments_page=4&history_page=3');
  assert.equal(activityHash(hash, 'history', 1), '#/tasks/101?comments_page=4&history_page=1');
  for (const q of ['comments_page=0', 'history_page=no', 'comments_page=9007199254740993']) {
    assert.throws(() => readActivityPages(q), RangeError);
  }
  assert.throws(() => activityHash(hash, 'unknown', 1), RangeError);
  assert.throws(() => activityHash(hash, 'comments', -1), RangeError);
});
