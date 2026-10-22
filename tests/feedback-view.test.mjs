import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../web/views.js';
import { createTranslator } from '../web/i18n.js';

const mockUser = { id: 1, username: 'testuser', display_name: 'Test User' };

test('shared notices have proper variant and role, escape unsafe text, and sanitize tone', () => {
  const tones = [
    ['info', 'notice info', 'status'],
    ['success', 'notice success', 'status'],
    ['warning', 'notice warning', 'status'],
    ['error', 'notice error', 'alert']
  ];
  for (const [tone, expectedClass, expectedRole] of tones) {
    const html = renderApp({ type: 'projects', user: mockUser, notice: 'Saved', noticeTone: tone });
    assert.match(html, new RegExp(`<div class="${expectedClass}" role="${expectedRole}">Saved</div>`));
  }
  assert.match(renderApp({ type: 'projects', user: mockUser, notice: 'Default tone' }), /<div class="notice info" role="status">Default tone<\/div>/);
  assert.match(renderApp({ type: 'login', notice: 'Login note', noticeTone: 'warning' }), /<div class="notice warning" role="status">Login note<\/div>/);
  assert.match(renderApp({ type: 'register', notice: 'Reg note', noticeTone: 'success' }), /<div class="notice success" role="status">Reg note<\/div>/);
  const unsafe = renderApp({ type: 'login', notice: '<script>alert(1)</script>', noticeTone: 'evil" onclick="alert(2)' });
  assert.match(unsafe, /<div class="notice info" role="status">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/);
  assert.doesNotMatch(unsafe, /<script>|evil/);
  assert.doesNotMatch(renderApp({ type: 'login' }), /class="notice (info|success|warning|error)"/);
});

test('error box uses role alert and error tone on API error', () => {
  const shellErr = renderApp({ type: 'projects', user: mockUser, error: { message: 'Server down' } });
  assert.match(shellErr, /<div class="notice error" role="alert">Server down<\/div>/);
  const loginErr = renderApp({ type: 'login', error: 'Invalid creds' });
  assert.match(loginErr, /<div class="notice error" role="alert">Invalid creds<\/div>/);
  const regErr = renderApp({ type: 'register', error: { message: 'Username exists' } });
  assert.match(regErr, /<div class="notice error" role="alert">Username exists<\/div>/);
});

test('forms add novalidate while preserving required, autocomplete, ids, and passwords never render', () => {
  const loginHtml = renderApp({ type: 'login', draft: { username: 'alice', password: 'secretpassword123' } });
  assert.match(loginHtml, /<form data-form="login" class="form" novalidate>/);
  assert.match(loginHtml, /id="login-username"[^>]*autocomplete="username"[^>]*required/);
  assert.match(loginHtml, /id="login-password"[^>]*autocomplete="current-password"[^>]*required/);
  assert.doesNotMatch(loginHtml, /secretpassword123/);

  const regHtml = renderApp({ type: 'register', draft: { username: 'alice', password: 'secretpassword123', confirm_password: 'secretpassword123' } });
  assert.match(regHtml, /<form data-form="register" class="form" novalidate>/);
  assert.match(regHtml, /id="reg-username"[^>]*autocomplete="username"[^>]*required/);
  assert.doesNotMatch(regHtml, /secretpassword123/);

  const settingsHtml = renderApp({ type: 'settings', user: mockUser });
  assert.match(settingsHtml, /<form data-form="profile" class="form" novalidate>/);
  assert.match(settingsHtml, /<form data-form="password" class="form" novalidate>/);
  assert.match(settingsHtml, /id="settings-current-password"[^>]*autocomplete="current-password"[^>]*required/);

  const projFormHtml = renderApp({ type: 'project-form', user: mockUser, project: { id: 10, owner_id: 1, role: 'owner' } });
  assert.match(projFormHtml, /<form data-form="project"[^>]*novalidate>/);
  assert.match(projFormHtml, /id="proj-name"[^>]*required/);

  const taskFormHtml = renderApp({ type: 'task-form', user: mockUser, project: { id: 10, owner_id: 1, role: 'owner' } });
  assert.match(taskFormHtml, /<form data-form="task"[^>]*novalidate>/);
  assert.match(taskFormHtml, /id="task-title"[^>]*required/);

  const taskHtml = renderApp({ type: 'task', user: mockUser, project: { id: 10, owner_id: 1 }, task: { id: 5 } });
  assert.match(taskHtml, /<form data-form="comment" class="form" novalidate>/);
  assert.match(taskHtml, /id="new-comment"[^>]*required/);
});

test('VI and EN translations work for root messages and leave dynamic content unchanged', () => {
  const vi = createTranslator('vi');
  const en = createTranslator('en');
  const msgs = [
    ['Vui lòng điền thông tin này.', 'Please fill in this field.'],
    ['Kiểm tra giá trị đã nhập.', 'Check the entered value.'],
    ['Kiểm tra các thông tin được đánh dấu.', 'Check the highlighted fields.']
  ];
  for (const [k, v] of msgs) {
    assert.equal(vi.text(k), k);
    assert.equal(en.text(k), v);
  }
  const dynamic = 'Custom dynamic content 12345';
  assert.equal(vi.text(dynamic), dynamic);
  assert.equal(en.text(dynamic), dynamic);
});
