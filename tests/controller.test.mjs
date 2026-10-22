import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMockClient, MockApiError } from '../web/data/mock.js';
import * as routes from '../web/routes.js';
import { renderApp } from '../web/views.js';
import { validNewPassword, PASSWORD_MESSAGE } from '../web/password-policy.js';

// Execute the actual controller with a small event boundary. Browser checks cover the real DOM.
const source = (await readFile(new URL('../web/app.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?$/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness(hash = '#/tasks/101/edit', wrap = client => client, { authenticated = true } = {}) {
  const real = createMockClient();
  if (authenticated) await real.login({ username: 'nguyen.van.a', password: 'demo123' });
  const handlers = {}, location = { hash }, focus = { focus() {} }, preference = new Map();
  const domInputs = {};
  let markup = '';
  const root = {
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = value;
      for (const input of Object.values(domInputs)) { input.type = 'password'; input.value = ''; input.disabled = false; }
    },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    querySelector: selector => domInputs[selector.slice(1)] || focus,
    querySelectorAll: () => Object.values(domInputs),
  };
  const context = vm.createContext({
    ...routes, client: { getPreferences: async () => ({ timezone: 'Asia/Ho_Chi_Minh', timezones: ['Asia/Ho_Chi_Minh', 'UTC'] }), ...wrap(real) }, MockApiError, renderApp, validNewPassword, PASSWORD_MESSAGE, location, URLSearchParams,
    localStorage: { getItem: key => preference.get(key), setItem: (key, value) => preference.set(key, value) },
    loadLanguage: storage => storage?.getItem('task-manager.language') || 'vi',
    saveLanguage: (storage, value) => storage?.setItem('task-manager.language', value),
    normalizeLanguage: value => value === 'en' ? 'en' : 'vi',
    document: { getElementById: id => domInputs[id], querySelector: selector => selector === '#app' ? root : { addEventListener() {} } },
    window: { addEventListener() {} }, confirm: () => true,
    FormData: class { constructor(form) { return new Map(Object.entries(form.values)); } },
  });
  vm.runInContext(`${source}\nglobalThis.harness = { load, state: () => ({ model, drafts, epoch }) };`, context);
  await tick();
  const formEvent = (kind, values, elements = []) => ({ preventDefault() {}, target: {
    closest: () => ({ dataset: { form: kind }, values, elements }),
  } });
  return {
    real, location, load: context.harness.load, state: context.harness.state, preference, domInputs, html: () => root.innerHTML,
    changeLanguage: value => handlers.change({ target: { matches: () => true, value } }),
    input: (kind, values) => handlers.input(formEvent(kind, values)),
    submit: (kind, values, elements) => handlers.submit(formEvent(kind, values, elements)),
    click: (dataset, control = {}) => handlers.click({ preventDefault() {}, target: { closest: () => ({ ...control, dataset }) } }),
  };
}
const taskDraft = title => ({ title, description: 'Bản nhập đang giữ', assignee_id: '1', due_date: '', priority: 'medium', status: 'doing' });

const calendarFixture = { month: '2026-10', today: '2026-10-16', selected_date: '2026-10-16', start_weekday: 3,
  previous_month: '2026-09', next_month: '2026-11', days: [], tasks: { items: [], page: 1, page_size: 20, total: 0 } };
const feedFixture = { items: [], page: 1, page_size: 20, total: 0 };

test('notifications load creates daily report before independent calendar/feed reads and refresh', async () => {
  const calls = [];
  const app = await harness('#/notifications?month=2026-10&date=2026-10-16&day_page=2&page=3', real => ({ ...real,
    ensureDailyReport: async () => { calls.push('daily'); return { created: true }; },
    getCalendar: async options => { calls.push(['calendar', { ...options }]); return calendarFixture; },
    listNotifications: async options => { calls.push(['feed', { ...options }]); return feedFixture; },
  }));
  assert.equal(app.state().model.type, 'notifications');
  assert.deepEqual(calls, ['daily', ['calendar', { month: '2026-10', date: '2026-10-16', page: 2, page_size: 20 }], ['feed', { page: 3, page_size: 20 }]]);
  assert.equal(app.state().model.calendar.month, '2026-10');
  assert.match(app.html(), /Lịch deadline/);
  await app.click({ action: 'refresh-notifications' });
  await tick();
  assert.equal(calls.filter(x => x === 'daily').length, 2);
  assert.equal(app.location.hash, '#/notifications?month=2026-10&date=2026-10-16&day_page=2&page=3');
});

test('stale daily response cannot issue feed reads or replace a newer actor/route', async () => {
  const gate = deferred();
  let reads = 0, reports = 0;
  const app = await harness('#/notifications', real => ({ ...real,
    ensureDailyReport: () => { reports++; return gate.promise; },
    getCalendar: async () => { reads++; return calendarFixture; },
    listNotifications: async () => { reads++; return feedFixture; },
  }));
  assert.equal(reports, 1);
  await app.real.login({ username: 'tran.thi.b', password: 'demo123' });
  app.location.hash = '#/settings';
  await app.load();
  gate.resolve({ created: true }); await tick();
  assert.equal(reads, 0);
  assert.equal(app.state().model.type, 'settings');
  assert.equal(app.state().model.user.id, 2);
});

test('invalid notification filters do not create a report; expired report session returns to login', async () => {
  let writes = 0;
  const app = await harness('#/notifications?day_page=0', real => ({ ...real,
    ensureDailyReport: async () => { writes++; throw new MockApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.'); },
  }));
  assert.equal(app.state().model.type, 'error');
  assert.equal(writes, 0);
  app.location.hash = '#/notifications';
  await app.load();
  assert.equal(writes, 1);
  assert.equal(app.location.hash, '#/login');
});

test('required field errors replace native popups and block submission without retaining passwords', async () => {
  let calls = 0;
  const app = await harness('#/register', real => ({ ...real,
    register: async (...args) => { calls++; return real.register(...args); },
  }), { authenticated: false });
  const secret = 'A private registration passphrase';
  await app.submit('register', { username: 'qa.form', display_name: '', password: secret, confirm_password: secret }, [
    { name: 'display_name', willValidate: true, validity: { valid: false, valueMissing: true } },
    { name: 'password', willValidate: true, validity: { valid: true } },
  ]);
  assert.equal(calls, 0);
  assert.equal(app.state().model.errors.display_name, 'Vui lòng điền thông tin này.');
  assert.equal(app.state().model.error.message, 'Vui lòng điền đầy đủ các ô bắt buộc.');
  assert.equal(app.state().model.busy, false);
  assert.equal(JSON.stringify(app.state()).includes(secret), false);
  assert.equal(app.state().model.draft.username, 'qa.form');
});

test('empty login fields show an error box and inline guidance without calling login', async () => {
  for (const values of [{ username: '', password: '' }, { username: 'qa.user', password: '' }, { username: '', password: 'a private password' }]) {
    let calls = 0;
    const app = await harness('#/login', real => ({ ...real, login: async (...args) => { calls++; return real.login(...args); } }), { authenticated: false });
    await app.submit('login', values, Object.entries(values).map(([name, value]) => ({ name, willValidate: true, validity: { valid: Boolean(value), valueMissing: !value } })));
    assert.equal(calls, 0);
    assert.match(app.html(), /class="notice error" role="alert">Vui lòng điền đầy đủ các ô bắt buộc\./);
    assert.match(app.html(), /class="form" novalidate/);
    for (const [name, value] of Object.entries(values)) {
      if (!value) {
        assert.equal(app.state().model.errors[name], 'Vui lòng điền thông tin này.');
        assert.match(app.html(), new RegExp(`id="login-${name}"[^>]*aria-invalid="true"`));
      }
    }
    assert.doesNotMatch(app.html(), /Please fill out this field|a private password/);
  }
});

test('preflight skips disabled unnamed and nonvalidating controls and reports bad values', async () => {
  let calls = 0;
  const app = await harness('#/settings', real => ({ ...real,
    updateProfile: async (...args) => { calls++; return real.updateProfile(...args); },
  }));
  await app.submit('profile', { display_name: 'Valid name' }, [
    { name: 'display_name', willValidate: true, validity: { valid: false, patternMismatch: true } },
  ]);
  assert.equal(calls, 0);
  assert.equal(app.state().model.errors.display_name, 'Kiểm tra giá trị đã nhập.');
  await app.submit('profile', { display_name: 'Valid name' }, [
    { name: '', willValidate: true, validity: { valid: false, valueMissing: true } },
    { name: 'ignored', disabled: true, willValidate: true, validity: { valid: false, valueMissing: true } },
    { name: 'ignored2', willValidate: false, validity: { valid: false, valueMissing: true } },
    { name: 'readonly', readOnly: true, willValidate: true, validity: { valid: false, valueMissing: true } },
  ]);
  assert.equal(calls, 1);
});

test('registration rejects password codepoint boundaries before API and accepts six Unicode codepoints with digit and symbol', async () => {
  let calls = 0;
  const app = await harness('#/register', real => ({ ...real,
    register: async (...args) => { calls++; return real.register(...args); },
  }), { authenticated: false });
  for (const password of ['a1@bc', 'a'.repeat(127) + '1@', 'abcdef1', 'abcde@']) {
    await app.submit('register', { username: 'qa.boundary', display_name: 'QA', password, confirm_password: password });
    assert.equal(calls, 0);
    assert.ok(app.state().model.errors.password);
  }
  await app.submit('register', { username: 'qa.boundary', display_name: 'QA', password: '😀a1@bc', confirm_password: '😀a1@bc' });
  assert.equal(calls, 1);
  assert.equal(app.location.hash, '#/login');
  await app.load();
  assert.equal(app.state().model.noticeTone, 'success');
});

test('notice tone marks completed saves as success and login requirements as information', async () => {
  const gate = deferred();
  let delay = false;
  const app = await harness('#/settings', real => ({ ...real,
    updateProfile: async (...args) => { const result = await real.updateProfile(...args); if (delay) await gate.promise; return result; },
  }));
  await app.submit('profile', { display_name: 'Saved name' });
  await tick();
  assert.equal(app.state().model.noticeTone, 'success');
  assert.match(app.html(), /class="notice success" role="status">Đã cập nhật tên hiển thị\.<\/div>/);
  delay = true;
  const pending = app.submit('profile', { display_name: 'Another save' });
  await tick();
  assert.equal(app.state().model.busy, true);
  assert.equal(app.state().model.notice, '');
  gate.resolve(); await pending; await tick();
  assert.equal(app.state().model.noticeTone, 'success');
  const guest = await harness('#/settings', real => real, { authenticated: false });
  await guest.load();
  assert.equal(guest.state().model.noticeTone, 'info');
});

test('member candidates require a nonblank submitted query before lookup', async () => {
  const calls = [];
  const app = await harness('#/projects/10/members', real => ({ ...real,
    listUsers: async (query, options) => { calls.push(query); return real.listUsers(query, options); },
  }));
  assert.equal(calls.length, 0);
  assert.equal((app.state().model.searchUsers || []).length, 0);
  app.location.hash = '#/projects/10/members?q=%20%20%20';
  await app.load();
  assert.equal(calls.length, 0);
  app.location.hash = '#/projects/10/members?q=%20tran.thi%20';
  await app.load();
  assert.deepEqual(calls, ['tran.thi']);
  assert.equal(app.state().model.searchUsers.length, 1);
  app.location.hash = '#/projects/10/members';
  await app.load();
  assert.equal(calls.length, 1);
  assert.equal((app.state().model.searchUsers || []).length, 0);
});

test('delayed mutation result cannot navigate or overwrite a different signed-in actor', async () => {
  const gate = deferred();
  const app = await harness(undefined, real => ({ ...real, updateTask: async (...args) => {
    const result = await real.updateTask(...args); await gate.promise; return result;
  } }));
  const pending = app.submit('task', taskDraft('Owner save'));
  await tick();
  await app.real.login({ username: 'tran.thi.b', password: 'demo123' });
  await app.load();
  assert.equal(app.state().model.type, 'error');
  assert.equal(app.state().model.user.id, 2);
  gate.resolve(); await pending;
  assert.equal(app.location.hash, '#/tasks/101/edit');
  assert.equal(app.state().model.user.id, 2);
  assert.equal(app.state().model.type, 'error');
});

test('account settings saves only display name and password errors never retain secrets', async () => {
  const app = await harness('#/settings');
  assert.equal(app.state().model.type, 'settings');
  await app.submit('profile', { display_name: 'Updated account' });
  await app.load();
  assert.equal((await app.real.me()).user.display_name, 'Updated account');
  await app.submit('password', { current_password: 'demo123', new_password: 'new password long enough1@', confirm_password: 'mismatch secret' });
  assert.ok(app.state().model.errors.confirm_password);
  const state = JSON.stringify(app.state().model);
  assert.equal(state.includes('demo123'), false);
  assert.equal(state.includes('new password long enough1@'), false);
  assert.equal(state.includes('mismatch secret'), false);
  assert.equal((await app.real.me()).user.id, 1);
  await app.submit('password', { current_password: 'demo123', new_password: 'new password long enough1@', confirm_password: 'new password long enough1@' });
  assert.equal(app.location.hash, '#/login');
  await app.load();
  assert.equal(app.state().drafts.size, 0);
  await assert.rejects(app.real.me(), error => error.status === 401);
});

test('settings language change keeps profile draft and stores only preference without mutations', async () => {
  let writes = 0;
  const app = await harness('#/settings', real => ({ ...real,
    updateProfile: async (...args) => { writes++; return real.updateProfile(...args); },
    changePassword: async (...args) => { writes++; return real.changePassword(...args); },
  }));
  app.input('profile', { display_name: 'Đăng nhập is a display name' });
  app.changeLanguage('en');
  assert.equal(app.location.hash, '#/settings');
  assert.equal(app.state().model.language, 'en');
  assert.equal(app.state().model.draft.display_name, 'Đăng nhập is a display name');
  assert.equal(writes, 0);
  assert.deepEqual([...app.preference], [['task-manager.language', 'en']]);
});

test('settings timezone save persists via API, reloads preference and shows success', async () => {
  const saved = [];
  let zone = 'Asia/Ho_Chi_Minh';
  const app = await harness('#/settings', real => ({ ...real,
    getPreferences: async () => ({ timezone: zone, timezones: ['Asia/Ho_Chi_Minh', 'UTC'] }),
    updatePreferences: async input => { saved.push({ ...input }); zone = input.timezone; return { timezone: zone }; },
  }));
  await app.submit('timezone', { timezone: 'UTC' }); await tick();
  assert.deepEqual(saved, [{ timezone: 'UTC' }]);
  assert.equal(app.state().model.timezone, 'UTC');
  assert.equal(app.state().model.preferences.timezone, 'UTC');
  assert.equal(app.state().model.noticeTone, 'success');
});

test('account fields count Unicode codepoints before sending a mutation', async () => {
  let writes = 0;
  const app = await harness('#/settings', real => ({ ...real,
    updateProfile: async (...args) => { writes++; return real.updateProfile(...args); },
    changePassword: async (...args) => { writes++; return real.changePassword(...args); },
  }));
  await app.submit('profile', { display_name: '😀'.repeat(81) });
  assert.equal(writes, 0);
  assert.ok(app.state().model.errors.display_name);
  await app.submit('password', { current_password: 'demo123', new_password: '😀'.repeat(14), confirm_password: '😀'.repeat(14) });
  assert.equal(writes, 0);
  assert.ok(app.state().model.errors.new_password);
  await app.submit('profile', { display_name: '😀'.repeat(80) });
  assert.equal(writes, 1);
});

test('revisiting a route while save waits preserves the replacement draft', async () => {
  const gate = deferred();
  const app = await harness(undefined, real => ({ ...real, updateTask: async (...args) => {
    const result = await real.updateTask(...args); await gate.promise; return result;
  } }));
  const pending = app.submit('task', taskDraft('First save'));
  await tick(); await app.load();
  app.input('task', taskDraft('Newer unsaved draft'));
  gate.resolve(); await pending;
  assert.equal(app.location.hash, '#/tasks/101/edit');
  await app.load();
  assert.equal(app.state().model.draft.title, 'Newer unsaved draft');
});

test('editing and revisiting a conflict cannot bypass explicit reload', async () => {
  const app = await harness();
  await app.real.updateTask(101, { status: 'done', version: 1 });
  await app.submit('task', taskDraft('Conflicted input'));
  assert.equal(app.state().model.conflict, true);
  app.input('task', taskDraft('Edited conflicted input'));
  await app.load();
  assert.equal(app.state().model.conflict, true);
  assert.equal(app.state().model.task.version, 1);
  await app.click({ action: 'reload-conflict' }); await tick();
  assert.equal(app.state().model.conflict, false);
  assert.equal(app.state().model.task.version, 2);
  assert.equal(app.state().model.draft.title, 'Edited conflicted input');
});

test('archive conflict reload keeps a comment draft without poisoning its cache', async () => {
  const app = await harness('#/tasks/101');
  app.input('comment', { body: 'Bình luận đang nhập\nDòng thứ hai' });
  await app.real.updateTask(101, { status: 'done', version: 1 });
  await app.click({ action: 'archive-task', id: '101' });
  assert.equal(app.state().model.confirmation.action, 'archive-task');
  await app.click({ action: 'confirm-action' });
  assert.equal(app.state().model.conflict, true);
  await app.click({ action: 'reload-conflict' }); await tick();
  assert.equal(app.state().model.conflict, false);
  assert.equal(app.state().model.task.version, 2);
  assert.equal(app.state().model.draft.body, 'Bình luận đang nhập\nDòng thứ hai');
});

test('cancel confirmation keeps task writable, preserves draft, and performs no mutation', async () => {
  const app = await harness('#/tasks/101');
  app.input('comment', { body: 'Bình luận trước xác nhận' });
  await app.click({ action: 'archive-task', id: '101' });
  await app.click({ action: 'cancel-confirm' });
  assert.equal(app.state().model.confirmation, null);
  assert.equal(app.state().model.draft.body, 'Bình luận trước xác nhận');
  assert.equal((await app.real.getTask(101)).archived_at, null);
  await app.click({ action: 'archive-task', id: '101' });
  await app.click({ action: 'confirm-action' });
  assert.ok((await app.real.getTask(101)).archived_at);
});

test('comment and history pagination use independent request options and retain both pages', async () => {
  const calls = [];
  const app = await harness('#/tasks/101?comments_page=2&history_page=3', real => ({ ...real,
    listComments: async (id, options) => { calls.push(['comments', options.page]); return real.listComments(id, options); },
    listHistory: async (id, options) => { calls.push(['history', options.page]); return real.listHistory(id, options); },
  }));
  assert.deepEqual(calls, [['comments', 2], ['history', 3]]);
  await app.click({ action: 'page', list: 'comments', page: '1' });
  assert.equal(app.location.hash, '#/tasks/101?comments_page=1&history_page=3');
});

test('failed provider request retains editable nonsecret draft and can be retried', async () => {
  let offline = true;
  const app = await harness(undefined, real => ({ ...real, updateTask: async (...args) => {
    if (offline) throw new Error('Network disconnected');
    return real.updateTask(...args);
  } }));
  await app.submit('task', taskDraft('Retry draft'));
  assert.equal(app.state().model.busy, false);
  assert.equal(app.state().model.error.code, 'NETWORK_ERROR');
  assert.equal(app.state().model.draft.title, 'Retry draft');
  assert.equal((await app.real.getTask(101)).version, 1);
  offline = false;
  await app.submit('task', taskDraft('Retry draft'));
  assert.equal((await app.real.getTask(101)).title, 'Retry draft');
  assert.equal(app.location.hash, '#/tasks/101');
});

test('session expiry returns to login and restores the draft only for its original actor', async () => {
  let expired = true;
  const app = await harness(undefined, real => ({ ...real, updateTask: async (...args) => {
    if (expired) { await real.logout(); throw new MockApiError(401, 'UNAUTHENTICATED', 'Phiên đã kết thúc.'); }
    return real.updateTask(...args);
  } }));
  await app.submit('task', taskDraft('Session draft'));
  assert.equal(app.location.hash, '#/login');
  await app.load();
  assert.equal(app.state().model.type, 'login');
  expired = false;
  await app.submit('login', { username: 'nguyen.van.a', password: 'demo123' });
  await app.load();
  assert.equal(app.location.hash, '#/tasks/101/edit');
  assert.equal(app.state().model.draft.title, 'Session draft');
  assert.equal('password' in app.state().model.draft, false);
});


test('password toggle preserves DOM value and caret without state, submit or shared visibility', async () => {
  const app = await harness('#/register', real => real, { authenticated: false });
  const input = { id: 'reg-password', type: 'password', value: 'Ab@123', selectionStart: 2, selectionEnd: 4,
    focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  app.domInputs[input.id] = input;
  app.domInputs['reg-confirm-password'] = { ...input, id: 'reg-confirm-password', value: 'Other1@' };
  const attrs = {};
  const control = { setAttribute: (key, value) => { attrs[key] = value; } };
  const dataset = { action: 'toggle-password', target: input.id, showText: 'Hiện', hideText: 'Ẩn', showLabel: 'Hiện mật khẩu', hideLabel: 'Ẩn mật khẩu' };
  await app.click(dataset, control);
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'Ab@123');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 4]);
  assert.equal(attrs['aria-pressed'], 'true');
  assert.equal(app.domInputs['reg-confirm-password'].type, 'password');
  assert.equal(JSON.stringify(app.state()).includes('Ab@123'), false);
  app.changeLanguage('en');
  assert.equal(input.type, 'password');
  assert.equal(input.value, 'Ab@123');
  assert.equal(app.preference.size, 1);
  await app.submit('register', { username: 'qa.toggle', display_name: 'QA', password: 'Ab@123', confirm_password: 'wrong' });
  assert.equal(input.type, 'password');
  assert.equal(input.value, '');
});

test('archive deletion requires confirmation, cancel keeps data, and restore sends displayed version', async () => {
  const calls = [];
  const project = { id: 21, name: 'Archived', role: 'owner', archived_at: '2026-10-21T10:00:00Z', version: 3 };
  const app = await harness('#/projects/archived', real => ({ ...real,
    listArchivedProjects: async () => ({ items: [project], page: 1, page_size: 20, total: 1 }),
    deleteProject: async (...args) => { calls.push(['delete', ...args]); },
    restoreProject: async (...args) => { calls.push(['restore', ...args]); },
  }));
  await app.click({ action: 'delete-project', id: '21', version: '3' });
  assert.equal(calls.length, 0);
  assert.match(app.state().model.confirmation.message, /không thể khôi phục/);
  await app.click({ action: 'cancel-confirm' });
  assert.equal(calls.length, 0);
  await app.click({ action: 'delete-project', id: '21', version: '3' });
  await app.click({ action: 'confirm-action' });
  await tick();
  assert.equal(calls[0][0], 'delete');
  assert.equal(calls[0][1], 21);
  assert.equal(calls[0][2].version, 3);
  await app.load(); // browser hashchange after deleting resets the list/busy state
  await app.click({ action: 'restore-project', id: '21', version: '3' });
  assert.equal(calls[1][0], 'restore');
  assert.equal(app.location.hash, '#/projects');
});

test('unchanged deadline is omitted and a changed deadline includes its original timezone', async () => {
  const sent = [];
  const task = { id: 101, project_id: 10, title: 'Time', due_local: '2026-10-21T23:59', due_at: '2026-10-21T16:59:59Z', version: 1 };
  const app = await harness('#/tasks/101/edit', real => ({ ...real, getTask: async () => task,
    updateTask: async (id, data) => { sent.push(data); return task; },
  }));
  const fields = { title: 'Time', due_local: task.due_local, due_timezone: 'Asia/Ho_Chi_Minh', status: 'todo' };
  await app.submit('task', fields);
  assert.equal('due_local' in sent[0], false);
  app.location.hash = '#/tasks/101/edit'; await app.load();
  await app.submit('task', { ...fields, due_local: '2026-10-22T00:30' });
  assert.equal(sent[1].due_local, '2026-10-22T00:30');
  assert.equal(sent[1].due_timezone, 'Asia/Ho_Chi_Minh');
});

test('timezone conflict reload replaces stale deadline but keeps other task draft fields', async () => {
  let timezone = 'Asia/Ho_Chi_Minh';
  const app = await harness('#/tasks/101/edit', real => ({ ...real,
    getPreferences: async () => ({ timezone }),
    getTask: async () => ({ id: 101, project_id: 10, version: 1, due_local: timezone === 'UTC' ? '2026-10-21T10:00' : '2026-10-21T17:00' }),
    updateTask: async () => { timezone = 'UTC'; throw new MockApiError(409, 'TIMEZONE_CHANGED', 'Múi giờ đã thay đổi.', { due_local: 'Tải lại' }); },
  }));
  await app.submit('task', { title: 'Keep my title', due_local: '2026-10-22T17:00', due_timezone: 'Asia/Ho_Chi_Minh' });
  await app.click({ action: 'reload-timezone' });
  await tick();
  assert.equal(app.state().model.timezone, 'UTC');
  assert.equal(app.state().model.draft.title, 'Keep my title');
  assert.match(app.html(), /name="due_local"[^>]*value="2026-10-21T10:00"/);
  assert.match(app.html(), /name="due_timezone" value="UTC"/);
});
