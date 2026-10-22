import { client, ApiError as MockApiError } from './data/client.js';
import { renderApp } from './views.js';
import { validNewPassword, PASSWORD_MESSAGE } from './password-policy.js';
import { parseRoute, readFilters, routeHash, publicDraft, readActivityPages, activityHash, readNotificationOptions } from './routes.js';
import { loadLanguage, saveLanguage, normalizeLanguage } from './i18n.js';

const root = document.querySelector('#app');
const drafts = new Map();
let model = { type: 'loading' }, epoch = 0, notice = '', noticeTone = 'info', suggestedUsername = '', returnTo = '#/projects';
let metadata = null;
let language = 'vi';
try { language = loadLanguage(globalThis.localStorage); } catch { /* preference storage may be unavailable */ }
const path = () => location.hash.split('?')[0] || '#/projects';
const query = () => location.hash.split('?')[1] || '';
const key = (kind, user = model.user) => `${user?.id || 0}:${path()}:${kind}`;
const formKind = type => ({ 'task-form': 'task', 'project-form': 'project', task: 'comment', settings: 'profile' }[type]);
const isCurrent = (hash, actor, generation) => location.hash === hash && model.user?.id === actor && epoch === generation;

function paint(next, focus = false) {
  model = { ...next, metadata, language };
  document.documentElement?.setAttribute('lang', language);
  document.title = language === 'en' ? 'Tasks & Projects' : 'Công việc & Dự án';
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.textContent = language === 'en' ? 'Skip to main content' : 'Chuyển đến nội dung chính';
  root.innerHTML = renderApp(model);
  if (model.busy) {
    for (const control of root.querySelectorAll?.('form input, form select, form textarea') || []) control.disabled = true;
  }
  if (model.confirmation) {
    root.querySelector('dialog')?.showModal?.();
    root.querySelector('[data-action="cancel-confirm"]')?.focus();
  }
  if (focus) root.querySelector('h1')?.focus({ preventScroll: true });
}
function navigate(hash, message = '', tone = 'info') {
  notice = message;
  noticeTone = tone;
  if (location.hash === hash) void load();
  else location.hash = hash;
}
function denied(message = 'Bạn không có quyền thực hiện thao tác này.') {
  throw new MockApiError(403, 'FORBIDDEN', message);
}

async function load() {
  const generation = ++epoch, hash = location.hash, route = parseRoute(hash), message = notice, messageTone = noticeTone;
  notice = '';
  noticeTone = 'info';
  const priorUser = model.user;
  let user = null;
  paint({ type: 'loading', user: priorUser });
  try {
    const info = await client.getMetadata();
    if (generation !== epoch) return;
    metadata = info;
    try { user = (await client.me()).user; }
    catch (error) { if (error.status !== 401) throw error; }
    if (generation !== epoch) return;
    if (['login', 'register'].includes(route.type)) {
      if (user) return navigate('#/projects');
      return paint({ type: route.type, draft: { username: suggestedUsername }, notice: message, noticeTone: messageTone }, true);
    }
    if (!user) { returnTo = hash || '#/projects'; return navigate('#/login', 'Đăng nhập để tiếp tục.'); }
    const preferences = await client.getPreferences();
    if (generation !== epoch) return;
    const next = { ...route, user, preferences, timezone: preferences.timezone, notice: message, noticeTone: messageTone, errors: {} };
    if (route.type === 'error') throw new MockApiError(404, 'NOT_FOUND', 'Không tìm thấy trang.');
    if (['projects', 'archived-projects'].includes(route.type)) {
      next.filters = readFilters(query());
      next.projects = route.type === 'projects' ? await client.listProjects(next.filters) : await client.listArchivedProjects(next.filters);
    }
    if (route.type === 'notifications') {
      const options = readNotificationOptions(query());
      await client.ensureDailyReport();
      if (generation !== epoch) return;
      [next.calendar, next.notifications] = await Promise.all([
        client.getCalendar(options.calendar), client.listNotifications(options.feed),
      ]);
      next.timezone = next.calendar.timezone || preferences.timezone;
    }
    if (route.taskId) next.task = await client.getTask(route.taskId);
    const projectId = route.projectId || next.task?.project_id;
    if (projectId) { next.project = await client.getProject(projectId); next.people = next.project.members; }
    if (route.type === 'project') {
      next.filters = readFilters(query());
      [next.tasks, next.stats] = await Promise.all([client.listTasks(projectId, next.filters), client.getStats(projectId)]);
    }
    if (['task-form', 'project-form'].includes(route.type) && next.project) {
      if (next.project.role !== 'owner') denied();
      if (next.project.archived_at || next.task?.archived_at) denied('Nội dung đã lưu trữ, chỉ có thể xem.');
    }
    if (route.type === 'task') {
      const pages = readActivityPages(query());
      [next.comments, next.history] = await Promise.all([
        client.listComments(route.taskId, pages.comments), client.listHistory(route.taskId, pages.history),
      ]);
    }
    if (route.type === 'members') {
      next.members = next.project.members;
      next.memberQuery = (new URLSearchParams(query()).get('q') || '').trim();
      if (next.memberQuery && next.project.role === 'owner' && !next.project.archived_at) {
        next.searchUsers = (await client.listUsers(next.memberQuery)).items;
      }
    }
    const kind = formKind(route.type), saved = kind ? drafts.get(key(kind, user)) : null;
    next.draft = saved?.values || (route.type === 'task-form' ? next.task || { priority: 'medium', status: 'todo' } :
      route.type === 'project-form' ? next.project || {} : route.type === 'settings' ? { display_name: user.display_name } : {});
    if (saved && (next.task || next.project)) {
      const current = next.task || next.project;
      if (saved.version === null) { saved.version = current.version; next.notice = 'Đã tải dữ liệu mới. Bản nhập được giữ lại; kiểm tra trước khi lưu.'; next.noticeTone = 'info'; }
      if (saved.version !== undefined) current.version = saved.version;
      next.conflict = saved.conflict || false;
    }
    if (route.type === 'task') {
      const statusDraft = drafts.get(key('status', user));
      if (statusDraft) {
        next.draft = { ...next.draft, ...statusDraft.values };
        if (statusDraft.version === null) statusDraft.version = next.task.version;
        next.task.version = statusDraft.version;
        next.conflict = statusDraft.conflict;
      }
    }
    if (generation === epoch) paint(next, true);
  } catch (error) {
    if (generation !== epoch) return;
    if (user && error.status === 401) {
      returnTo = hash;
      return navigate('#/login', 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.');
    }
    paint({ type: 'error', user, error: error.error || { message: error instanceof RangeError ? error.message : 'Không tải được dữ liệu. Hãy thử lại.' } }, true);
  }
}

function retain(kind, data) {
  const prior = drafts.get(key(kind));
  const saved = { values: publicDraft(data), version: kind === 'comment' ? undefined :
    (prior?.version ?? (model.task || model.project)?.version), conflict: prior?.conflict || false };
  drafts.set(key(kind), saved);
  return saved;
}
function showFailure(error, kind, data, capturedHash, actor, generation) {
  if (!isCurrent(capturedHash, actor, generation)) return;
  const envelope = error.error || { code: 'NETWORK_ERROR', message: 'Không thực hiện được thao tác. Hãy thử lại.' };
  if (error.status === 401 && !['login', 'register'].includes(kind)) {
    returnTo = capturedHash;
    return navigate('#/login', 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.');
  }
  const saved = drafts.get(key(kind));
  if (saved && envelope.code === 'VERSION_CONFLICT') saved.conflict = true;
  if ([403, 404].includes(error.status)) return paint({ type: 'error', user: model.user, error: envelope }, true);
  paint({ ...model, busy: false, error: envelope, notice: '', noticeTone: 'info',
    errors: envelope.details || {}, draft: { ...model.draft, ...publicDraft(data) },
    timezoneConflict: envelope.code === 'TIMEZONE_CHANGED', conflict: envelope.code === 'VERSION_CONFLICT' });
  root.querySelector('[aria-invalid="true"]')?.focus();
}

root.addEventListener('input', event => {
  const form = event.target.closest('form[data-form]');
  if (!form || !model.user) return;
  const kind = form.dataset.form;
  if (['task', 'project', 'comment', 'status', 'profile'].includes(kind)) {
    const data = Object.fromEntries(new FormData(form));
    retain(kind, data);
    model.draft = { ...model.draft, ...publicDraft(data) };
  }
});

root.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (model.busy) return;
  const kind = form.dataset.form, data = Object.fromEntries(new FormData(form));
  if (model.conflict && ['task', 'project', 'status'].includes(kind)) return;
  if (kind === 'filters') {
    return navigate(routeHash(path().slice(1), { ...data, page: model.filters?.page || 1 }));
  }
  if (kind === 'member-search') return navigate(routeHash(path().slice(1), { q: data.q, page: 1 }));
  const hash = location.hash, actor = model.user?.id, snapshot = model, generation = epoch;
  const current = () => isCurrent(hash, actor, generation);
  const capturedKey = key(kind);
  const fieldErrors = Object.create(null);
  let missingRequired = false;
  for (const control of form.elements || []) {
    if (!control.name || control.disabled || control.readOnly || control.willValidate === false || !control.validity || control.validity.valid) continue;
    fieldErrors[control.name] = control.validity.valueMissing ? 'Vui lòng điền thông tin này.' : 'Kiểm tra giá trị đã nhập.';
    if (control.validity.valueMissing) missingRequired = true;
  }
  if (Object.keys(fieldErrors).length) {
    return showFailure(new MockApiError(422, 'VALIDATION_ERROR', missingRequired ? 'Vui lòng điền đầy đủ các ô bắt buộc.' : 'Kiểm tra các thông tin được đánh dấu.', fieldErrors), kind, data, hash, actor, generation);
  }
  if (['task', 'project', 'comment', 'status', 'profile'].includes(kind)) retain(kind, data);
  paint({ ...model, busy: true, notice: '', noticeTone: 'info', draft: { ...model.draft, ...publicDraft(data) }, errors: {}, error: null });
  try {
    if (kind === 'register') {
      if (!validNewPassword(data.password)) throw new MockApiError(422, 'VALIDATION_ERROR', 'Kiểm tra thông tin đăng ký.', { password: PASSWORD_MESSAGE });
      if (data.password !== data.confirm_password) throw new MockApiError(422, 'VALIDATION_ERROR', 'Kiểm tra thông tin đăng ký.', { confirm_password: 'Mật khẩu nhập lại chưa khớp.' });
      const user = await client.register({ username: data.username, display_name: data.display_name, password: data.password });
      if (!current()) return;
      suggestedUsername = user.username;
      return navigate('#/login', 'Đã tạo tài khoản. Bạn có thể đăng nhập.', 'success');
    }
    if (kind === 'login') {
      const result = await client.login({ username: data.username, password: data.password });
      if (!current()) return;
      suggestedUsername = result.user.username;
      return navigate(returnTo || '#/projects');
    }
    if (kind === 'timezone') {
      await client.updatePreferences({ timezone: data.timezone });
      if (!current()) return;
      return navigate(hash, 'Đã cập nhật múi giờ.', 'success');
    }
    if (kind === 'profile') {
      const display = typeof data.display_name === 'string' ? data.display_name.trim() : '';
      if ([...display].length < 1 || [...display].length > 80) throw new MockApiError(422, 'VALIDATION_ERROR', 'Dữ liệu chưa hợp lệ.', { display_name: 'Tên hiển thị cần 1–80 ký tự.' });
      await client.updateProfile({ display_name: data.display_name });
      if (!current()) return;
      drafts.delete(capturedKey);
      return navigate(hash, 'Đã cập nhật tên hiển thị.', 'success');
    }
    if (kind === 'password') {
      if (data.new_password !== data.confirm_password) throw new MockApiError(422, 'VALIDATION_ERROR', 'Kiểm tra mật khẩu mới.', { confirm_password: 'Mật khẩu nhập lại chưa khớp.' });
      if (!validNewPassword(data.new_password)) throw new MockApiError(422, 'VALIDATION_ERROR', 'Kiểm tra mật khẩu mới.', { new_password: PASSWORD_MESSAGE });
      await client.changePassword({ current_password: data.current_password, new_password: data.new_password });
      if (!current()) return;
      drafts.clear(); returnTo = '#/projects';
      return navigate('#/login', 'Mật khẩu đã đổi. Vui lòng đăng nhập lại.', 'success');
    }
    if (kind === 'project') {
      const values = { name: data.name, description: data.description || '' };
      const result = snapshot.project ? await client.updateProject(snapshot.project.id, { ...values, version: snapshot.project.version }) : await client.createProject(values);
      if (!current()) return;
      drafts.delete(capturedKey);
      navigate(`#/projects/${result.id}`, 'Đã lưu dự án.', 'success');
    }
    if (kind === 'task') {
      const values = { title: data.title, description: data.description || '', assignee_id: data.assignee_id ? Number(data.assignee_id) : null,
        priority: data.priority || 'medium' };
      if (Object.hasOwn(data, 'due_local')) {
        if (data.due_local && data.due_timezone && data.due_timezone !== snapshot.timezone) {
          throw new MockApiError(409, 'TIMEZONE_CHANGED', 'Múi giờ đã thay đổi ở phiên khác. Hãy tải lại và kiểm tra deadline.', { due_local: 'Múi giờ đã thay đổi. Hãy tải lại biểu mẫu.' });
        }
        if (!snapshot.task || data.due_local !== (snapshot.task.due_local || '')) {
          values.due_local = data.due_local || null;
          values.due_timezone = data.due_timezone || snapshot.timezone;
        }
      } else values.due_date = data.due_date || null; // date-only compatibility for older clients
      let result;
      if (snapshot.task) result = await client.updateTask(snapshot.task.id, { ...values, status: data.status, version: snapshot.task.version });
      else result = await client.createTask(snapshot.project.id, values);
      if (!current()) return;
      drafts.delete(capturedKey);
      navigate(`#/tasks/${result.id}`, 'Đã lưu công việc.', 'success');
    }
    if (kind === 'comment') {
      await client.addComment(snapshot.task.id, { body: data.body });
      if (!current()) return;
      drafts.delete(capturedKey);
      navigate(hash, 'Đã gửi bình luận.', 'success');
    }
    if (kind === 'status') {
      await client.updateTask(snapshot.task.id, { status: data.status, version: snapshot.task.version });
      if (!current()) return;
      drafts.delete(capturedKey);
      navigate(hash, 'Đã cập nhật trạng thái.', 'success');
    }
  } catch (error) { showFailure(error, kind, data, hash, actor, generation); }
});

root.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  if (control.dataset.action === 'language') return;
  event.preventDefault();
  let action = control.dataset.action, actionData = control.dataset, approved = false;
  if (action === 'toggle-password') {
    if (model.busy) return;
    const input = document.getElementById?.(control.dataset.target);
    if (!input || input.disabled || !['password', 'text'].includes(input.type)) return;
    const start = input.selectionStart, end = input.selectionEnd, show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    control.textContent = show ? control.dataset.hideText : control.dataset.showText;
    control.setAttribute('aria-pressed', String(show));
    control.setAttribute('aria-label', show ? control.dataset.hideLabel : control.dataset.showLabel);
    input.focus();
    if (start !== null) input.setSelectionRange?.(start, end);
    return;
  }
  if (action === 'cancel-confirm') return cancelConfirmation();
  if (action === 'confirm-action') {
    if (!model.confirmation || model.busy) return;
    ({ action, dataset: actionData } = model.confirmation);
    approved = true;
    paint({ ...model, confirmation: null });
  }
  if (action === 'page') return navigate(control.dataset.list ? activityHash(location.hash, control.dataset.list, Number(control.dataset.page)) :
    routeHash(path().slice(1), { ...(model.filters || {}), page: Number(control.dataset.page) }));
  if (action === 'reset-filters') return navigate(path());
  if (action === 'retry') return void load();
  if (action === 'refresh-notifications' && model.type === 'notifications' && !model.busy) return load();
  if (action === 'reload-conflict') {
    const saved = drafts.get(key(model.type === 'task' ? 'status' : formKind(model.type)));
    if (saved) { saved.version = null; saved.conflict = false; }
    return void load();
  }
  if (action === 'reload-timezone' && model.timezoneConflict && !model.busy) {
    const saved = drafts.get(key('task'));
    if (saved) {
      delete saved.values.due_local;
      delete saved.values.due_timezone;
      saved.version = null;
      saved.conflict = false;
    }
    return void load();
  }
  if (!['logout', 'archive-project', 'restore-project', 'delete-project', 'archive-task', 'add-member', 'remove-member'].includes(action)) return;
  if (model.busy) return;
  const hash = location.hash, actor = model.user?.id, snapshot = model, generation = epoch;
  const current = () => isCurrent(hash, actor, generation);
  const confirmations = {
    'archive-project': 'Lưu trữ dự án? Nội dung sẽ chỉ đọc và chuyển vào Lưu trữ dự án. Chủ dự án có thể khôi phục sau.',
    'delete-project': 'Xóa vĩnh viễn dự án cùng công việc, bình luận và lịch sử? Thao tác này không thể khôi phục.',
    'archive-task': 'Lưu trữ công việc? Công việc sẽ ẩn khỏi danh sách; chi tiết và lịch sử vẫn đọc được.',
    'remove-member': 'Loại thành viên? Người này mất quyền truy cập và các công việc được giao chuyển thành Chưa giao.',
  };
  if (confirmations[action] && !approved) {
    return paint({ ...model, confirmation: { action, dataset: { ...actionData }, message: confirmations[action] } });
  }
  paint({ ...model, busy: true, error: null, notice: '', noticeTone: 'info' });
  try {
    if (['restore-project', 'delete-project'].includes(action)) {
      const project = snapshot.type === 'archived-projects' && snapshot.projects?.items.find(p => p.id === Number(actionData.id));
      if (!project || project.role !== 'owner' || !project.archived_at || project.version !== Number(actionData.version)) denied();
      await client[action === 'restore-project' ? 'restoreProject' : 'deleteProject'](project.id, { version: project.version });
      if (current()) return navigate(action === 'restore-project' ? '#/projects' : routeHash('/projects/archived', { ...snapshot.filters, page: 1 }),
        action === 'restore-project' ? 'Đã khôi phục dự án.' : 'Đã xóa vĩnh viễn dự án.', 'success');
      return;
    }
    if (action === 'logout') {
      await client.logout();
      if (!current()) return;
      drafts.clear(); returnTo = '#/projects';
      return navigate('#/login');
    }
    if (action === 'archive-project') {
      await client.archiveProject(snapshot.project.id, { version: snapshot.project.version });
      if (current()) return navigate('#/projects', 'Đã lưu trữ dự án.', 'success');
    }
    if (action === 'archive-task') {
      await client.archiveTask(snapshot.task.id, { version: snapshot.task.version });
      if (current()) return navigate(hash, 'Công việc đã được lưu trữ.', 'success');
    }
    if (action === 'add-member') await client.addMember(snapshot.project.id, Number(actionData.id));
    if (action === 'remove-member') await client.removeMember(snapshot.project.id, Number(actionData.id));
    if (['add-member', 'remove-member'].includes(action) && current()) navigate(hash, 'Đã cập nhật thành viên.', 'success');
  } catch (error) {
    if (['restore-project', 'delete-project'].includes(action) && error.status === 409 && current()) {
      return paint({ ...model, busy: false, conflict: false, error: { message: 'Dữ liệu đã thay đổi. Hãy làm mới danh sách trước khi thao tác.' } });
    }
    showFailure(error, action, snapshot.draft || {}, hash, actor, generation);
  }
});

function cancelConfirmation() {
  const target = model.confirmation;
  if (!target || model.busy) return;
  paint({ ...model, confirmation: null });
  root.querySelector(`[data-action="${target.action}"]${target.dataset.id ? `[data-id="${Number(target.dataset.id)}"]` : ''}`)?.focus();
}
root.addEventListener('cancel', event => { event.preventDefault(); cancelConfirmation(); }, true);

root.addEventListener('change', event => {
  if (!event.target.matches('[data-action="language"], [data-language-control]')) return;
  const next = normalizeLanguage(event.target.value);
  if (next === language) return;
  // Only this synchronous render keeps values in the DOM; secrets never enter drafts/storage.
  const values = [...(root.querySelectorAll?.('form input, form select, form textarea') || [])]
    .filter(input => input.id).map(input => ({ id: input.id, value: input.value,
      start: input.selectionStart, end: input.selectionEnd }));
  const focused = document.activeElement?.id;
  language = next;
  try { saveLanguage(globalThis.localStorage, language); } catch { /* UI still switches without persistence */ }
  paint(model);
  for (const saved of values) {
    const input = root.querySelector(`#${saved.id}`);
    if (!input) continue;
    input.value = saved.value;
    if (saved.id === focused) {
      input.focus();
      if (saved.start !== null) input.setSelectionRange?.(saved.start, saved.end);
    }
  }
});

window.addEventListener('hashchange', () => void load());
document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  const main = root.querySelector('#main');
  if (main) { main.tabIndex = -1; main.focus(); }
});
void load();
