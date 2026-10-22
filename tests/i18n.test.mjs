import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let renderApp;
let normalizeLanguage, loadLanguage, saveLanguage, createTranslator;

const localEditionPath = new URL('../web/edition.js', import.meta.url);
if (fs.existsSync(localEditionPath)) {
  const viewsMod = await import('../web/views.js');
  renderApp = viewsMod.renderApp;
  const i18nMod = await import('../web/i18n.js');
  ({ normalizeLanguage, loadLanguage, saveLanguage, createTranslator } = i18nMod);
} else {
  const refRoot = process.env.SOURCE_REFERENCE_ROOT;
  if (!refRoot) {
    throw new Error('SOURCE_REFERENCE_ROOT is required for isolated validation when edition.js is absent');
  }
  const editionUrl = pathToFileURL(path.resolve(refRoot, 'web/edition.js')).href;
  const i18nUrl = pathToFileURL(path.resolve('web/i18n.js')).href;
  const i18nMod = await import(i18nUrl);
  ({ normalizeLanguage, loadLanguage, saveLanguage, createTranslator } = i18nMod);

  let viewsCode = fs.readFileSync(path.resolve('web/views.js'), 'utf8');
  viewsCode = viewsCode
    .replace(/['"]\.\/edition\.js['"]/g, JSON.stringify(editionUrl))
    .replace(/['"]\.\/i18n\.js['"]/g, JSON.stringify(i18nUrl));
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(viewsCode)}`;
  const viewsMod = await import(dataUrl);
  renderApp = viewsMod.renderApp;
}

const mockUser = { id: 1, username: 'alice', display_name: 'Alice Wonder' };
const mockProject = { id: 10, name: 'Alpha Project', owner_id: 1, role: 'owner', version: 1 };

test('normalizeLanguage strictly accepts exact vi/en and rejects arbitrary startsWith', () => {
  assert.equal(normalizeLanguage('vi'), 'vi');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('EN'), 'en');
  assert.equal(normalizeLanguage('  en  '), 'en');
  assert.equal(normalizeLanguage('VI'), 'vi');
  assert.equal(normalizeLanguage('english'), 'vi');
  assert.equal(normalizeLanguage('en-evil'), 'vi');
  assert.equal(normalizeLanguage('en-US'), 'vi');
  assert.equal(normalizeLanguage(''), 'vi');
  assert.equal(normalizeLanguage(null), 'vi');
  assert.equal(normalizeLanguage(undefined), 'vi');
});

test('storage handles invalid, throwing, default, and persistence', () => {
  const store = {};
  const mockStorage = {
    getItem: k => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); }
  };
  assert.equal(loadLanguage(mockStorage), 'vi');
  assert.equal(saveLanguage(mockStorage, 'en'), 'en');
  assert.equal(store['task-manager.language'], 'en');
  assert.equal(loadLanguage(mockStorage), 'en');

  store['task-manager.language'] = 'invalid_lang';
  assert.equal(loadLanguage(mockStorage), 'vi');

  const throwingStorage = {
    getItem: () => { throw new Error('storage denied'); },
    setItem: () => { throw new Error('storage denied'); }
  };
  assert.equal(loadLanguage(throwingStorage), 'vi');
  assert.equal(saveLanguage(throwingStorage, 'en'), 'en');
  assert.equal(loadLanguage(null), 'vi');
});

test('createTranslator translates static chunks and preserves dynamic values and unknown errors', () => {
  const vi = createTranslator('vi');
  const en = createTranslator('en');
  const dynamicUiMatch = 'Đăng nhập';
  const hostile = '<script>alert(1)</script>';

  assert.equal(vi.text('Chưa làm'), 'Chưa làm');
  assert.equal(en.text('Chưa làm'), 'To do');
  assert.equal(en.text('Unknown server text unchanged'), 'Unknown server text unchanged');

  assert.equal(vi.html`<p>Đăng nhập: ${dynamicUiMatch} ${hostile}</p>`, `<p>Đăng nhập: ${dynamicUiMatch} ${hostile}</p>`);
  assert.equal(en.html`<p>Đăng nhập: ${dynamicUiMatch} ${hostile}</p>`, `<p>Sign in: ${dynamicUiMatch} ${hostile}</p>`);
  assert.equal(en.html`<h1>Đăng ký tài khoản</h1><button>Đăng ký</button>`, `<h1>Register account</h1><button>Register</button>`);
});

test('translator text preserves prototype property names as literal strings without object lookup', () => {
  const en = createTranslator('en');
  for (const prop of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const res = en.text(prop);
    assert.equal(typeof res, 'string');
    assert.equal(res, prop);
  }
});

test('language control and settings navigation for guests and signed-in users', () => {
  const loginVi = renderApp({ type: 'login', language: 'vi' });
  assert.match(loginVi, /data-action="language"/);
  assert.match(loginVi, /value="vi" selected/);
  assert.match(loginVi, /Ngôn ngữ/);
  assert.doesNotMatch(loginVi, /#\/settings/);

  const loginEn = renderApp({ type: 'login', language: 'en' });
  assert.match(loginEn, /value="en" selected/);
  assert.match(loginEn, /Language/);
  assert.match(loginEn, /<h1[^>]*>Sign in<\/h1>/);
  assert.doesNotMatch(loginEn, /#\/settings/);

  const shellEn = renderApp({ type: 'projects', language: 'en', user: mockUser, projects: { items: [] } });
  assert.match(shellEn, /<a href="#\/settings"[^>]*>Account settings<\/a>/);
});

test('views render user content containing UI phrases without translating them', () => {
  const specialUser = { id: 2, username: 'dangnhap', display_name: 'Đăng nhập' };
  const projectsHtml = renderApp({
    type: 'projects', language: 'en', user: specialUser,
    projects: { items: [{ id: 1, name: 'Đăng nhập', owner_id: 2, role: 'owner' }] }
  });
  assert.match(projectsHtml, /<span class="user-name">Đăng nhập<\/span>/);
  assert.match(projectsHtml, />Đăng nhập<\/a><\/td>/);
  assert.match(projectsHtml, /Project owner/);
  assert.match(projectsHtml, /Search projects/);

  const taskHtml = renderApp({
    type: 'task', language: 'en', user: specialUser, project: mockProject, people: [specialUser],
    task: { id: 20, title: 'Đăng nhập', description: 'Chưa làm', status: 'todo', priority: 'high', assignee_id: 2 },
    comments: { items: [{ author_id: 2, body: 'Đăng ký tài khoản', created_at: '2026-10-21' }] },
    history: { items: [] }
  });
  assert.match(taskHtml, /<h1[^>]*>Đăng nhập<\/h1>/);
  assert.match(taskHtml, /<p class="description">Chưa làm<\/p>/);
  assert.match(taskHtml, /<p>Đăng ký tài khoản<\/p>/);
  assert.match(taskHtml, /<span class="badge todo">To do<\/span>/);
  assert.match(taskHtml, /<strong>Assignee:<\/strong> Đăng nhập/);
});

test('settings view contract: readonly username, codepoints emoji, password safety and errors', () => {
  const emoji80 = '🌟'.repeat(80);
  const model = {
    type: 'settings', language: 'en', user: mockUser,
    draft: { display_name: emoji80, current_password: 'SecretCurrent123', new_password: 'SecretNew456', password: 'Bad' },
    errors: { display_name: 'Dữ liệu chưa hợp lệ.', current_password: 'Mật khẩu hiện tại chưa đúng.' }
  };
  const html = renderApp(model);

  assert.match(html, /<h1[^>]*>Account settings<\/h1>/);
  assert.match(html, /data-form="profile"/);
  assert.match(html, /id="settings-username"[^>]*value="alice"[^>]*readonly/);
  assert.doesNotMatch(html, /name="username"/);
  assert.match(html, /name="display_name"/);
  assert.doesNotMatch(html, /name="display_name"[^>]*maxlength=/);
  assert.ok(html.includes(emoji80), 'Allows valid 80 codepoint emoji without truncation');
  assert.match(html, /Invalid data\./);
  assert.match(html, /Save display name/);

  assert.match(html, /data-form="password"/);
  assert.match(html, /name="current_password"[^>]*autocomplete="current-password"/);
  assert.doesNotMatch(html, /name="new_password"[^>]*minlength=/);
  assert.doesNotMatch(html, /name="new_password"[^>]*maxlength=/);
  assert.doesNotMatch(html, /name="confirm_password"[^>]*minlength=/);
  assert.match(html, /Current password is incorrect\./);
  assert.match(html, /Change password/);
  assert.match(html, /Changing password will sign out all sessions/);

  assert.doesNotMatch(html, /SecretCurrent123/);
  assert.doesNotMatch(html, /SecretNew456/);
  assert.doesNotMatch(html, /Bad/);
});

test('regression: notice, error, confirmations, form ternaries, and history labels in EN', () => {
  const settingsNotice = renderApp({ type: 'settings', language: 'en', user: mockUser, notice: 'Đã cập nhật tên hiển thị.' });
  assert.match(settingsNotice, /Display name updated\./);

  const loginNotice = renderApp({ type: 'login', language: 'en', notice: 'Mật khẩu đã đổi. Vui lòng đăng nhập lại.' });
  assert.match(loginNotice, /Password changed\. Please sign in again\./);

  const pwdErrors = renderApp({
    type: 'settings', language: 'en', user: mockUser,
    errors: {
      new_password: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      confirm_password: 'Mật khẩu nhập lại chưa khớp.'
    }
  });
  assert.match(pwdErrors, /New password must be different from current password\./);
  assert.match(pwdErrors, /Password confirmation does not match\./);

  const projCreate = renderApp({ type: 'project-form', language: 'en', user: mockUser });
  assert.match(projCreate, /<h1[^>]*>Create new project<\/h1>/);
  assert.match(projCreate, />Create project<\/button>/);

  const projEdit = renderApp({ type: 'project-form', language: 'en', user: mockUser, project: mockProject });
  assert.match(projEdit, /<h1[^>]*>Edit project<\/h1>/);
  assert.match(projEdit, />Save changes<\/button>/);

  const taskCreate = renderApp({ type: 'task-form', language: 'en', user: mockUser, project: mockProject });
  assert.match(taskCreate, /<h1[^>]*>Create task<\/h1>/);
  assert.match(taskCreate, />Create task<\/button>/);

  const taskEdit = renderApp({ type: 'task-form', language: 'en', user: mockUser, project: mockProject, task: { id: 7, title: 'T7' } });
  assert.match(taskEdit, /<h1[^>]*>Edit task<\/h1>/);
  assert.match(taskEdit, />Save changes<\/button>/);

  const taskView = renderApp({
    type: 'task', language: 'en', user: mockUser, project: mockProject, people: [mockUser],
    task: { id: 7, title: 'Task 7', status: 'done', priority: 'high', updated_at: '2026-10-21', version: 3 },
    history: {
      items: [{
        actor_id: 999, action: 'updated', created_at: '2026-10-21',
        before: { status: 'todo', priority: 'low' },
        after: { status: 'done', priority: 'high' }
      }],
      page: 1, page_size: 20, total: 1
    },
    confirmation: { action: 'archive-project', message: 'Lưu trữ dự án? Nội dung sẽ chỉ đọc và ẩn khỏi danh sách. Bản này chưa có khôi phục.' }
  });
  assert.match(taskView, /Edit<\/a>/);
  assert.match(taskView, /Version 3 · Updated 21\/10\/2026/);
  assert.match(taskView, /Former member/);
  assert.match(taskView, /Status: To do.*&rarr;.*Status: Done/);
  assert.match(taskView, /Priority: Low.*&rarr;.*Priority: High/);
  assert.match(taskView, /aria-label="Pagination history"/);
  assert.match(taskView, /Archive project\? Content will be read-only and hidden from list\. Restoring is not supported in this version\./);
});

test('escaping and independent vi -> en -> vi renders', () => {
  const xss = '<script>alert("xss")</script>';
  const taskModel = {
    type: 'task', user: mockUser, project: mockProject, people: [mockUser],
    task: { id: 30, title: 'XSS ' + xss, status: 'doing', priority: 'medium' }
  };

  const vi1 = renderApp({ ...taskModel, language: 'vi' });
  assert.match(vi1, /Đang làm/);
  assert.match(vi1, /&lt;script&gt;alert/);
  assert.doesNotMatch(vi1, /<script>alert/);
  assert.match(vi1, /Cài đặt tài khoản/);

  const en = renderApp({ ...taskModel, language: 'en' });
  assert.match(en, /In progress/);
  assert.match(en, /Medium/);
  assert.match(en, /&lt;script&gt;alert/);
  assert.doesNotMatch(en, /<script>alert/);
  assert.match(en, /Account settings/);

  const vi2 = renderApp({ ...taskModel, language: 'vi' });
  assert.match(vi2, /Đang làm/);
  assert.match(vi2, /Cài đặt tài khoản/);
  assert.doesNotMatch(vi2, /In progress/);
  assert.doesNotMatch(vi2, /Language/);
});
