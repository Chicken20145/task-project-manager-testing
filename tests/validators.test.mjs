import test from 'node:test';
import assert from 'node:assert';
import { validateTaskDraft, validateProjectDraft, isOverdue } from '../web/data/validators.js';

test('validateTaskDraft - valid task with all fields, defaults, and immutability', () => {
  const input = {
    title: '  Test Task 🚀  ',
    description: 'A description',
    assignee_id: 5,
    due_date: '2026-10-15',
    priority: 'high',
    status: 'doing',
    extraField: 'ignored'
  };
  const res = validateTaskDraft(input);
  assert.strictEqual(res.valid, true);
  assert.deepStrictEqual(res.errors, {});
  assert.deepStrictEqual(res.value, {
    title: 'Test Task 🚀',
    description: 'A description',
    assignee_id: 5,
    due_date: '2026-10-15',
    priority: 'high',
    status: 'doing'
  });
  assert.strictEqual(input.title, '  Test Task 🚀  '); // immutability check
});

test('validateTaskDraft - optional and default values when omitted', () => {
  const res = validateTaskDraft({ title: 'Minimal Task' });
  assert.strictEqual(res.valid, true);
  assert.deepStrictEqual(res.value, {
    title: 'Minimal Task',
    description: '',
    assignee_id: null,
    due_date: null,
    priority: 'medium',
    status: 'todo'
  });
});

test('validateTaskDraft - missing, non-string, empty, and title length boundaries (emoji 120/121)', () => {
  assert.strictEqual(validateTaskDraft({}).valid, false);
  assert.strictEqual(validateTaskDraft({ title: '' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: '   ' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 123 }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: '🚀'.repeat(120) }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: '🚀'.repeat(121) }).valid, false);
});

test('validateTaskDraft - assignee_id validation (positive integers, reject 0, negative, fractional, string, empty)', () => {
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: 10 }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: null }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: '' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: '10' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: 0 }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: -1 }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', assignee_id: 1.5 }).valid, false);
});

test('validateTaskDraft - enum rejection for priority and status (urgent, blocked, null, false, 0)', () => {
  assert.strictEqual(validateTaskDraft({ title: 'T', priority: 'urgent' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', status: 'blocked' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', priority: null }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', status: false }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', priority: 0 }).valid, false);
});

test('validateTaskDraft - calendar date boundaries, leap year, 0099, 0000', () => {
  assert.strictEqual(validateTaskDraft({ title: 'T', due_date: '0099-01-01' }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: 'T', due_date: '2011-12-30' }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: 'T', due_date: '0000-01-01' }).valid, false);
  assert.strictEqual(validateTaskDraft({ title: 'T', due_date: '2024-02-29' }).valid, true);
  assert.strictEqual(validateTaskDraft({ title: 'T', due_date: '2026-02-29' }).valid, false);
});

test('validateProjectDraft - valid, project 100/101, description 2000/2001, null description', () => {
  assert.strictEqual(validateProjectDraft({ name: 'Project X' }).valid, true);
  assert.strictEqual(validateProjectDraft({ name: '' }).valid, false);
  assert.strictEqual(validateProjectDraft({ name: 'a'.repeat(100) }).valid, true);
  assert.strictEqual(validateProjectDraft({ name: 'a'.repeat(101) }).valid, false);
  assert.strictEqual(validateProjectDraft({ name: 'P', description: 'a'.repeat(2000) }).valid, true);
  assert.strictEqual(validateProjectDraft({ name: 'P', description: 'a'.repeat(2001) }).valid, false);
  assert.strictEqual(validateProjectDraft({ name: 'P', description: null }).valid, false);
});

test('isOverdue - logic, optional date, range errors, and invalid due date even when done/archived', () => {
  const task = { due_date: '2026-10-10', status: 'todo' };
  assert.strictEqual(isOverdue(task, '2026-10-12'), true);
  assert.strictEqual(isOverdue(task, '2026-10-10'), false); // frozen same-day
  assert.strictEqual(isOverdue(task, '2026-10-08'), false);
  assert.strictEqual(isOverdue({ ...task, status: 'done' }, '2026-10-12'), false);
  assert.strictEqual(isOverdue({ ...task, archived_at: '2026-10-11' }, '2026-10-12'), false);
  assert.strictEqual(isOverdue({ status: 'todo' }, '2026-10-12'), false);

  assert.throws(() => isOverdue(task, 'invalid-date'), RangeError);
  assert.throws(() => isOverdue({ due_date: 'bad', status: 'done' }, '2026-10-12'), RangeError);
  assert.throws(() => isOverdue({ due_date: 'bad', archived_at: '2026-10-11' }, '2026-10-12'), RangeError);
});
