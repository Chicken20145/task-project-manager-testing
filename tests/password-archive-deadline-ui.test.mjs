import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../web/views.js';
import { parseRoute, publicDraft } from '../web/routes.js';

test('all six password inputs have independent non-submit accessible toggles', () => {
  for (const [type, count] of [['login', 1], ['register', 2], ['settings', 3]]) {
    const html = renderApp({ type, user: { id: 1 }, draft: { password: 'SECRET1@', new_password: 'SECRET2@' } });
    assert.equal((html.match(/data-action="toggle-password"/g) || []).length, count);
    assert.equal((html.match(/aria-pressed="false"/g) || []).length, count);
    assert.doesNotMatch(html, /SECRET/);
  }
});

test('archive nav route and date-time deadline control are wired', () => {
  assert.equal(parseRoute('#/projects/archived').type, 'archived-projects');
  const html = renderApp({ type: 'task-form', user: { id: 1 }, timezone: 'Asia/Ho_Chi_Minh',
    project: { id: 10, role: 'owner' }, draft: { due_local: '2026-10-21T17:00' } });
  assert.match(html, /href="#\/projects\/archived"/);
  assert.match(html, /type="datetime-local"[^>]*name="due_local"[^>]*value="2026-10-21T17:00"/);
  assert.deepEqual(publicDraft({ due_local: '2026-10-21T17:00', password: 'SECRET' }), { due_local: '2026-10-21T17:00' });
});
