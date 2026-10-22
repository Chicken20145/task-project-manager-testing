import test from 'node:test';
import assert from 'node:assert';
import { createDemoFixtures } from '../web/data/fixtures.js';
import { queryTasks, getTaskStats } from '../web/data/queries.js';

test('createDemoFixtures returns deterministic, fresh deep structures', () => {
  const f1 = createDemoFixtures();
  const f2 = createDemoFixtures();
  assert.notStrictEqual(f1, f2);
  assert.strictEqual(f1.today, '2026-10-13');
  assert.deepStrictEqual(f1, f2);
  assert.ok(f1.users.length >= 3);
  assert.ok(f1.projects.length >= 2);
  assert.ok(f1.tasks.length >= 25);
  // Modify f1, ensure f2 unaffected
  f1.tasks[0].title = 'MUTATED';
  assert.notStrictEqual(f2.tasks[0].title, 'MUTATED');
});

test('queryTasks filters by project_id, excludes archived, sorts id desc, paginates', () => {
  const fixtures = createDemoFixtures();
  const res = queryTasks(fixtures.tasks, { project_id: 10, page: 1, page_size: 5 }, fixtures.today);
  assert.ok(res.items.length <= 5);
  assert.strictEqual(res.page, 1);
  assert.strictEqual(res.page_size, 5);
  assert.ok(res.total > 0);

  for (let i = 0; i < res.items.length - 1; i++) {
    assert.ok(res.items[i].id > res.items[i + 1].id);
  }

  for (const t of res.items) {
    assert.strictEqual(t.archived_at, null);
    assert.strictEqual(t.project_id, 10);
  }
});

test('queryTasks filters by q, status, priority, assignee_id, overdue', () => {
  const tasks = [
    { id: 1, project_id: 10, title: 'Fix bug login', description: 'Auth issue', assignee_id: 1, due_date: '2026-10-10', priority: 'high', status: 'todo', version: 1, archived_at: null, created_at: '2026-10-01', updated_at: '2026-10-01' },
    { id: 2, project_id: 10, title: 'Add dashboard', description: 'UI graphs', assignee_id: null, due_date: '2026-10-13', priority: 'medium', status: 'doing', version: 1, archived_at: null, created_at: '2026-10-01', updated_at: '2026-10-01' },
    { id: 3, project_id: 10, title: 'Write tests', description: 'Coverage', assignee_id: 2, due_date: '2026-10-15', priority: 'low', status: 'done', version: 1, archived_at: null, created_at: '2026-10-01', updated_at: '2026-10-01' },
    { id: 4, project_id: 10, title: 'Archived task', description: 'Old', assignee_id: 1, due_date: '2026-10-09', priority: 'high', status: 'todo', version: 1, archived_at: '2026-10-11', created_at: '2026-10-01', updated_at: '2026-10-01' },
  ];
  const today = '2026-10-13';

  let res = queryTasks(tasks, { project_id: 10, q: 'LOGIN' }, today);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].id, 1);

  res = queryTasks(tasks, { project_id: 10, status: 'doing' }, today);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].id, 2);

  res = queryTasks(tasks, { project_id: 10, priority: 'high' }, today);
  assert.strictEqual(res.items.length, 1);

  res = queryTasks(tasks, { project_id: 10, assignee_id: null }, today);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].id, 2);

  res = queryTasks(tasks, { project_id: 10, overdue: true }, today);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].id, 1);

  const resFalse = queryTasks(tasks, { project_id: 10, overdue: false }, today);
  assert.ok(resFalse.items.some(t => t.id === 2));
  assert.ok(resFalse.items.some(t => t.id === 3));
});

test('queryTasks input mutation protection and cloning', () => {
  const tasks = [
    { id: 1, project_id: 10, title: 'Test', description: 'Desc', assignee_id: 1, due_date: '2026-10-10', priority: 'low', status: 'todo', version: 1, archived_at: null, created_at: '2026-10-01', updated_at: '2026-10-01' }
  ];
  const originalTask = { ...tasks[0] };
  const res = queryTasks(tasks, { project_id: 10 }, '2026-10-13');
  assert.deepStrictEqual(tasks[0], originalTask);
  assert.notStrictEqual(res.items[0], tasks[0]);
});

test('queryTasks validation errors on bad filters or date', () => {
  const tasks = [];
  const today = '2026-10-13';

  assert.throws(() => queryTasks(tasks, { project_id: -1 }, today), /project_id/);
  assert.throws(() => queryTasks(tasks, { project_id: 10, page: 0 }, today), /page/);
  assert.throws(() => queryTasks(tasks, { project_id: 10, page_size: 200 }, today), /page_size/);
  assert.throws(() => queryTasks(tasks, { project_id: 10, status: 'invalid' }, today), /status/);
  assert.throws(() => queryTasks(tasks, { project_id: 10, status: null }, today), TypeError);
  assert.throws(() => queryTasks(tasks, { project_id: 10, priority: false }, today), TypeError);
  assert.throws(() => queryTasks(tasks, { project_id: 10 }, 'bad-date'), /date|format/);
});

test('getTaskStats calculates correct counts on hand-authored fixture', () => {
  const tasks = [
    { id: 1, project_id: 10, title: 'T1', description: '', assignee_id: 1, due_date: '2026-10-10', priority: 'high', status: 'todo', version: 1, archived_at: null, created_at: '', updated_at: '' },
    { id: 2, project_id: 10, title: 'T2', description: '', assignee_id: 1, due_date: '2026-10-13', priority: 'medium', status: 'doing', version: 1, archived_at: null, created_at: '', updated_at: '' },
    { id: 3, project_id: 10, title: 'T3', description: '', assignee_id: 1, due_date: '2026-10-15', priority: 'low', status: 'done', version: 1, archived_at: null, created_at: '', updated_at: '' },
    { id: 4, project_id: 10, title: 'T4', description: '', assignee_id: 1, due_date: '2026-10-05', priority: 'high', status: 'done', version: 1, archived_at: null, created_at: '', updated_at: '' },
    { id: 5, project_id: 10, title: 'T5', description: '', assignee_id: 1, due_date: '2026-10-08', priority: 'low', status: 'todo', version: 1, archived_at: '2026-10-12', created_at: '', updated_at: '' },
    { id: 6, project_id: 20, title: 'T6', description: '', assignee_id: 1, due_date: '2026-10-01', priority: 'low', status: 'todo', version: 1, archived_at: null, created_at: '', updated_at: '' },
  ];
  const stats = getTaskStats(tasks, 10, '2026-10-13');
  assert.deepStrictEqual(stats, {
    total: 4,
    todo: 1,
    doing: 1,
    done: 2,
    overdue: 1
  });
});

test('leap-day, calendar date handling, and 0099 boundary', () => {
  const tasks = [
    { id: 1, project_id: 10, title: 'Leap test', description: '', assignee_id: null, due_date: '2024-02-29', priority: 'low', status: 'todo', version: 1, archived_at: null, created_at: '', updated_at: '' }
  ];
  const res = queryTasks(tasks, { project_id: 10, overdue: true }, '2024-03-01');
  assert.strictEqual(res.items.length, 1);

  const tasks0099 = [
    { id: 2, project_id: 10, title: '0099 test', description: '', assignee_id: null, due_date: '0099-01-01', priority: 'low', status: 'todo', version: 1, archived_at: null, created_at: '', updated_at: '' }
  ];
  const res0099 = queryTasks(tasks0099, { project_id: 10, overdue: true }, '0099-01-02');
  assert.strictEqual(res0099.items.length, 1);

  assert.throws(() => queryTasks(tasks, { project_id: 10 }, '2026-02-30'), /date|calendar/);
  assert.throws(() => queryTasks(tasks, { project_id: 10 }, '0000-01-01'), RangeError);
});

test('filter-before-pagination and out of range page', () => {
  const tasks = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    project_id: 10,
    title: `Task ${i + 1}`,
    status: i % 2 === 0 ? 'todo' : 'done',
    priority: 'high',
    archived_at: null
  }));
  const res = queryTasks(tasks, { project_id: 10, status: 'todo', page: 5, page_size: 10 }, '2026-10-13');
  assert.strictEqual(res.total, 15);
  assert.strictEqual(res.items.length, 0);
});

test('combined filters paginate after matching and the last page is deterministic', () => {
  const tasks = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, project_id: 10,
    title: i < 5 ? 'Kiểm thử giao diện' : 'Việc khác', description: '', status: 'todo',
    priority: 'high', assignee_id: 2, due_date: null, archived_at: null }));
  const filters = { project_id: 10, q: 'kiểm THỬ', status: 'todo', priority: 'high', assignee_id: 2, page_size: 2 };
  assert.deepStrictEqual(queryTasks(tasks, { ...filters, page: 1 }, '2026-10-13').items.map(task => task.id), [5, 4]);
  const last = queryTasks(tasks, { ...filters, page: 3 }, '2026-10-13');
  assert.strictEqual(last.total, 5);
  assert.deepStrictEqual(last.items.map(task => task.id), [1]);
});

test('query rejects malformed optional parameters and malformed stored dates', () => {
  for (const field of ['status', 'priority']) for (const value of [null, false, 0, '']) {
    assert.throws(() => queryTasks([], { project_id: 10, [field]: value }, '2026-10-13'));
  }
  for (const field of ['page', 'page_size']) {
    assert.throws(() => queryTasks([], { project_id: 10, [field]: null }, '2026-10-13'));
  }
  assert.throws(() => queryTasks([], { project_id: 10, q: 5 }, '2026-10-13'), TypeError);
  assert.throws(() => queryTasks([], { project_id: 10, overdue: 'false' }, '2026-10-13'), TypeError);
  for (const due_date of ['2026-02-30', 0, false]) {
    const tasks = [{ id: 1, project_id: 10, status: 'todo', due_date, archived_at: null }];
    assert.throws(() => queryTasks(tasks, { project_id: 10 }, '2026-10-13'));
    assert.throws(() => getTaskStats(tasks, 10, '2026-10-13'));
  }
});

test('overdue false keeps no-deadline tasks and excludes late unfinished tasks', () => {
  const tasks = [
    { id: 1, project_id: 10, status: 'todo', due_date: '2026-10-12' },
    { id: 2, project_id: 10, status: 'doing', due_date: '2026-10-13' },
    { id: 3, project_id: 10, status: 'done', due_date: '2026-10-10' },
    { id: 4, project_id: 10, status: 'todo', due_date: null },
  ];
  assert.deepStrictEqual(queryTasks(tasks, { project_id: 10, overdue: false }, '2026-10-13').items.map(task => task.id), [4, 3, 2]);
});
