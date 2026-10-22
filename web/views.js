import { createTranslator, normalizeLanguage } from './i18n.js';
import { renderNotifications } from './notification-view.js';
import { renderPasswordToggle } from './password-toggle.js';
import { renderArchivedProjects } from './archive-view.js';
import { timezoneLabel } from './timezone-label.js';

const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fmtDay(s) {
  if (!s) return '';
  const m = String(s).slice(0, 10).split('-');
  return m.length === 3 ? `${m[2]}/${m[1]}/${m[0]}` : esc(s);
}

const STATUS_LABELS = { todo: 'Chưa làm', doing: 'Đang làm', done: 'Hoàn thành' };
const PRIORITY_LABELS = { low: 'Trung bình', medium: 'Trung bình', high: 'Cao' };
const ACTION_LABELS = { created: 'Đã tạo', updated: 'Đã cập nhật', archived: 'Đã lưu trữ', assignee_removed: 'Đã bỏ người phụ trách' };
const BIZ_KEYS = {
  title: 'Tiêu đề', description: 'Mô tả', status: 'Trạng thái',
  priority: 'Ưu tiên', assignee_id: 'Người phụ trách', due_date: 'Hạn hoàn thành', due_at: 'Hạn hoàn thành',
  archived: 'Lưu trữ', archived_at: 'Lưu trữ'
};

const NOTICE_TONES = new Set(['info', 'success', 'warning', 'error']);

function makeRenderer(translator, timezone = 'Asia/Ho_Chi_Minh', language = 'vi') {
  const { html, text } = translator;

  function fmtDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fmtDay(value);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return esc(value);
    try {
      return esc(new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'vi-VN', { timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(parsed));
    } catch { return esc(value); }
  }

  function renderNotice(message, tone = 'info') {
    if (!message) return '';
    const msg = typeof message === 'object' && message.message ? message.message : message;
    if (!msg) return '';
    const t = NOTICE_TONES.has(tone) ? tone : 'info';
    const role = t === 'error' ? 'alert' : 'status';
    return `<div class="notice ${t}" role="${role}">${esc(text(msg))}</div>`;
  }

  function renderStatusBadge(status) {
    const s = status || 'todo';
    return `<span class="badge ${esc(s)}">${esc(text(STATUS_LABELS[s] || s))}</span>`;
  }

  function getPersonName(id, people = [], fallback = 'Chưa giao') {
    if (!id) return text(fallback);
    const p = people.find(u => String(u.id) === String(id));
    return p ? (p.display_name || p.username) : text(fallback);
  }

  function isOwner(user, project) {
    if (!user || !project) return false;
    return project.role === 'owner' || String(project.owner_id) === String(user.id);
  }

  function fieldAttrs(errors, field) {
    return errors && errors[field] ? ` aria-invalid="true" aria-describedby="${esc(field)}-error"` : '';
  }

  function renderFieldError(errors, field) {
    return errors && errors[field] ? `<div class="field-error" id="${esc(field)}-error">${esc(text(errors[field]))}</div>` : '';
  }

  function fmtHistObj(obj, people, other) {
    if (!obj || typeof obj !== 'object') return esc(obj);
    return Object.entries(obj).filter(([k, v]) => Object.hasOwn(BIZ_KEYS, k) && !(k === 'due_date' && obj.due_at) && (!other || v !== other[k])).map(([k, v]) => {
      let lbl = text(BIZ_KEYS[k]), val = v;
      if (k === 'status') val = text(STATUS_LABELS[v] || v);
      else if (k === 'priority') val = text(PRIORITY_LABELS[v] || v);
      else if (k === 'assignee_id') val = getPersonName(v, people);
      else if (['due_date', 'due_at'].includes(k)) val = v ? fmtDate(k === 'due_date' ? v + 'T16:59:59Z' : v) : text('Không có');
      else if (k === 'archived_at') val = v ? text('Đã lưu trữ') : text('Chưa lưu trữ');
      return `${esc(lbl)}: ${esc(val)}`;
    }).join(', ');
  }

  function renderPagination(p, listType) {
    if (!p) return '';
    const page = p.page || 1, size = p.page_size || 20, tot = p.total || 0, max = Math.max(1, Math.ceil(tot / size));
    const s = tot === 0 ? 0 : Math.min((page - 1) * size + 1, tot);
    const e = Math.min(page * size, tot);
    const listAttr = listType ? ` data-list="${esc(listType)}"` : '';
    const listName = listType ? (listType === 'comments' ? text('bình luận') : text('lịch sử')) : '';
    const navLabel = listType ? `${text('Phân trang')} ${listName}` : text('Phân trang');
    return html`<nav class="pagination" aria-label="${esc(navLabel)}"><p class="muted">${s} - ${e} / ${tot} ${text('dòng')} (${text('Trang')} ${page}/${max})</p><div class="actions"><button type="button" class="button secondary" data-action="page"${listAttr} data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${text('Trước')}</button><button type="button" class="button secondary" data-action="page"${listAttr} data-page="${page + 1}" ${page >= max ? 'disabled' : ''}>${text('Tiếp')}</button></div></nav>`;
  }

  function renderLangControl(currentLang, id = 'lang-select') {
    const isEn = currentLang === 'en';
    return html`<div class="form-row language-picker"><label for="${esc(id)}">Ngôn ngữ</label><select id="${esc(id)}" data-action="language" data-language-control=""><option value="vi"${!isEn ? ' selected' : ''}>Tiếng Việt</option><option value="en"${isEn ? ' selected' : ''}>English</option></select></div>`;
  }

  function renderShell(model, content) {
    const user = model.user || { username: text('Khách'), display_name: text('Khách') };
    const notice = renderNotice(model.notice, model.noticeTone);
    const err = model.error && model.type !== 'error' ? renderNotice(model.error.message || model.error, 'error') : '';
    const conflict = model.conflict ? html`<div class="conflict warning"><p>Dữ liệu đã bị sửa đổi ở phiên bản khác. Bản nháp của bạn được giữ nguyên.</p><button type="button" class="button primary" data-action="reload-conflict">Tải lại</button></div>` : '';
    const timezoneConflict = model.timezoneConflict ? html`<div class="actions"><button type="button" class="button secondary" data-action="reload-timezone">Tải lại deadline theo múi giờ mới</button></div>` : '';
    const isSettings = model.type === 'settings';
    const isNotifications = model.type === 'notifications';
    const isArchive = model.type === 'archived-projects';
    const isProjects = !isSettings && !isNotifications && !isArchive;

    return html`<header class="app-header"><a href="#/projects" class="brand">Công việc &amp; Dự án</a><div class="actions"><span class="user-name">${esc(user.display_name || user.username)}</span><button type="button" class="button subtle header-link" data-action="logout">Đăng xuất</button></div></header><div class="app-shell"><aside class="sidebar"><nav class="sidebar-nav" aria-label="${esc(text('Điều hướng chính'))}"><a href="#/projects" class="nav-link${isProjects ? ' is-current' : ''}"${isProjects ? ' aria-current="page"' : ''}>${text('Dự án')}</a><a href="#/projects/archived" class="nav-link${isArchive ? ' is-current' : ''}"${isArchive ? ' aria-current="page"' : ''}>${text('Lưu trữ dự án')}</a><a href="#/notifications" class="nav-link${isNotifications ? ' is-current' : ''}"${isNotifications ? ' aria-current="page"' : ''}>${text('Thông báo')}</a><a href="#/settings" class="nav-link${isSettings ? ' is-current' : ''}"${isSettings ? ' aria-current="page"' : ''}>${text('Cài đặt tài khoản')}</a></nav></aside><main class="main" id="main">${notice}${err}${conflict}${timezoneConflict}${content}</main></div>`;
  }

  function renderLogin(model) {
    const draft = model.draft || {}, errors = model.errors || {}, lang = normalizeLanguage(model.language);
    return html`<div class="auth-shell"><main class="auth-card" id="main"><div class="actions form-row">${renderLangControl(lang, 'auth-lang')}</div><p class="brand auth-brand">Công việc &amp; Dự án</p><div class="auth-intro"><h1 tabindex="-1">Đăng nhập</h1><p class="muted">Đăng nhập vào hệ thống quản lý công việc.</p></div>${renderNotice(model.notice, model.noticeTone)}${renderNotice(model.error?.message || model.error, 'error')}<form data-form="login" class="form" novalidate><div class="field"><label for="login-username">Tên đăng nhập</label><input type="text" id="login-username" name="username" value="${esc(draft.username || '')}" autocomplete="username" required${fieldAttrs(errors, 'username')}>${renderFieldError(errors, 'username')}</div><div class="field"><label for="login-password">Mật khẩu</label><div class="password-control"><input type="password" id="login-password" name="password" autocomplete="current-password" required${fieldAttrs(errors, 'password')}>${renderPasswordToggle('login-password', { language, disabled: model.busy })}</div>${renderFieldError(errors, 'password')}</div><button type="submit" class="button primary" ${model.busy ? 'disabled' : ''}>Đăng nhập</button></form><p class="muted">Chưa có tài khoản? <a href="#/register">Đăng ký</a></p></main></div>`;
  }

  function renderRegister(model) {
    const draft = model.draft || {}, errors = model.errors || {}, lang = normalizeLanguage(model.language);
    return html`<div class="auth-shell"><main class="auth-card" id="main"><div class="actions form-row">${renderLangControl(lang, 'auth-lang')}</div><p class="brand auth-brand">Công việc &amp; Dự án</p><div class="auth-intro"><h1 tabindex="-1">Đăng ký tài khoản</h1><p class="muted">Tạo tài khoản mới để bắt đầu quản lý công việc.</p></div>${renderNotice(model.notice, model.noticeTone)}${renderNotice(model.error?.message || model.error, 'error')}<form data-form="register" class="form" novalidate><div class="field"><label for="reg-username">Tên đăng nhập</label><input type="text" id="reg-username" name="username" value="${esc(draft.username || '')}" autocomplete="username" required${fieldAttrs(errors, 'username')}><p class="muted">3–32 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.</p>${renderFieldError(errors, 'username')}</div><div class="field"><label for="reg-display-name">Tên hiển thị</label><input type="text" id="reg-display-name" name="display_name" value="${esc(draft.display_name || '')}" autocomplete="name" required${fieldAttrs(errors, 'display_name')}>${renderFieldError(errors, 'display_name')}</div><div class="field"><label for="reg-password">Mật khẩu</label><div class="password-control"><input type="password" id="reg-password" name="password" autocomplete="new-password" required${fieldAttrs(errors, 'password')}>${renderPasswordToggle('reg-password', { language, disabled: model.busy })}</div><p class="muted">Mật khẩu từ 6–128 ký tự, có số và ký tự đặc biệt (ví dụ @).</p>${renderFieldError(errors, 'password')}</div><div class="field"><label for="reg-confirm-password">Xác nhận mật khẩu</label><div class="password-control"><input type="password" id="reg-confirm-password" name="confirm_password" autocomplete="new-password" required${fieldAttrs(errors, 'confirm_password')}>${renderPasswordToggle('reg-confirm-password', { language, disabled: model.busy })}</div>${renderFieldError(errors, 'confirm_password')}</div><button type="submit" class="button primary" ${model.busy ? 'disabled' : ''}>Đăng ký</button></form><p class="muted">Đã có tài khoản? <a href="#/login">Đăng nhập</a></p></main></div>`;
  }

  function renderProjects(model) {
    const projects = model.projects?.items || [];
    const q = model.filters?.q || model.projectQuery || '';
    const rows = projects.map(p => {
      const role = p.role || (model.user && String(p.owner_id) === String(model.user.id) ? 'owner' : 'member');
      const roleLabel = role === 'owner' ? text('Chủ dự án') : text('Thành viên');
      return html`<tr><td data-label="Tên dự án"><a href="#/projects/${p.id}">${esc(p.name)}</a></td><td data-label="Vai trò">${esc(roleLabel)}</td><td data-label="Trạng thái">${p.archived_at ? html`<span class="badge warning">${text('Đã lưu trữ')}</span>` : html`<span class="badge done">${text('Hoạt động')}</span>`}</td><td data-label="Thao tác"><a href="#/projects/${p.id}" class="button subtle">Chi tiết</a></td></tr>`;
    }).join('');
    return html`<div class="page-heading"><h1 tabindex="-1">Danh sách dự án</h1><div class="actions"><a href="#/projects/new" class="button primary">Tạo dự án</a></div></div><form data-form="filters" class="form-row" novalidate><div class="field"><label for="proj-search">Tìm dự án</label><input type="text" id="proj-search" name="q" value="${esc(q)}" placeholder="Tìm kiếm dự án..."></div><button type="submit" class="button secondary" ${model.busy ? 'disabled' : ''}>Tìm</button></form><div class="table-wrap"><table class="project-table"><thead><tr><th>Tên dự án</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows || html`<tr><td colspan="4" class="empty">Chưa có dự án nào.</td></tr>`}</tbody></table></div>${renderPagination(model.projects)}`;
  }

  function renderProject(model) {
    const p = model.project || {}, owner = isOwner(model.user, p), archived = Boolean(p.archived_at);
    const stats = model.stats || { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 };
    const filters = model.filters || {}, people = model.people || p.members || [], tasks = model.tasks?.items || [];
    const isUnassigned = filters.assignee_id === null || filters.assignee_id === 'unassigned';
    const taskRows = tasks.map(t => {
      const isOverdue = Boolean(t.is_overdue);
      return html`<tr><td data-label="Công việc"><a href="#/tasks/${t.id}">${esc(t.title)}</a></td><td data-label="Trạng thái">${renderStatusBadge(t.status)}</td><td data-label="Phụ trách">${esc(getPersonName(t.assignee_id, people))}</td><td data-label="Hạn">${(t.due_at || t.due_date) ? fmtDate(t.due_at || t.due_date) : text('Không có')} ${isOverdue ? html`<span class="badge overdue">Quá hạn</span>` : ''}</td><td data-label="Ưu tiên">${esc(text(PRIORITY_LABELS[t.priority] || t.priority || ''))}</td></tr>`;
    }).join('');

    return html`<div class="breadcrumbs muted"><a href="#/projects">Dự án</a> / ${esc(p.name || '')}</div><div class="page-heading"><div class="title"><h1 tabindex="-1">${esc(p.name || '')}</h1><p class="muted">${esc(p.description || '')} · ${text('Chủ dự án')}: ${esc(getPersonName(p.owner_id, people, 'Chủ dự án'))}</p></div><div class="actions">${owner && !archived ? html`<a href="#/projects/${p.id}/edit" class="button secondary">${text('Chỉnh sửa')}</a><button type="button" class="button danger" data-action="archive-project" data-id="${p.id}" data-version="${p.version || 1}">Lưu trữ dự án</button>` : ''}${archived ? html`<span class="badge warning">${text('Dự án đã lưu trữ')}</span>` : ''}</div></div><nav class="tabs"><a href="#/projects/${p.id}" class="button secondary">Công việc</a><a href="#/projects/${p.id}/members" class="button subtle">Thành viên</a></nav><div class="stats"><span>${stats.total} công việc</span><span>${stats.todo} chưa làm</span><span>${stats.doing} đang làm</span><span>${stats.done} hoàn thành</span><span>${stats.overdue} quá hạn</span></div><form data-form="filters" class="filters form-row" novalidate><div class="field"><label for="filter-q">Tìm công việc</label><input type="text" id="filter-q" name="q" value="${esc(filters.q || '')}" placeholder="Nhập tiêu đề hoặc mô tả"></div><div class="field"><label for="filter-status">Trạng thái</label><select id="filter-status" name="status"><option value="">${text('Tất cả')}</option><option value="todo" ${filters.status === 'todo' ? 'selected' : ''}>${text('Chưa làm')}</option><option value="doing" ${filters.status === 'doing' ? 'selected' : ''}>${text('Đang làm')}</option><option value="done" ${filters.status === 'done' ? 'selected' : ''}>${text('Hoàn thành')}</option></select></div><div class="field"><label for="filter-priority">Ưu tiên</label><select id="filter-priority" name="priority"><option value="">${text('Tất cả')}</option><option value="low" ${filters.priority === 'low' ? 'selected' : ''}>${text('Thấp')}</option><option value="medium" ${filters.priority === 'medium' ? 'selected' : ''}>${text('Trung bình')}</option><option value="high" ${filters.priority === 'high' ? 'selected' : ''}>${text('Cao')}</option></select></div><div class="field"><label for="filter-assignee">Người phụ trách</label><select id="filter-assignee" name="assignee_id"><option value="">${text('Tất cả')}</option><option value="unassigned" ${isUnassigned ? 'selected' : ''}>${text('Chưa giao')}</option>${people.map(u => `<option value="${u.id}" ${String(filters.assignee_id) === String(u.id) ? 'selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')}</select></div><div class="field"><label for="filter-overdue">Hạn</label><select id="filter-overdue" name="overdue"><option value="">${text('Tất cả')}</option><option value="true" ${String(filters.overdue) === 'true' ? 'selected' : ''}>${text('Quá hạn')}</option><option value="false" ${String(filters.overdue) === 'false' ? 'selected' : ''}>${text('Trong hạn')}</option></select></div><div class="actions"><button type="submit" class="button secondary" ${model.busy ? 'disabled' : ''}>Lọc</button><button type="button" class="button subtle" data-action="reset-filters">Đặt lại</button>${owner && !archived ? html`<a href="#/projects/${p.id}/tasks/new" class="button primary">Tạo việc</a>` : ''}</div></form><div class="table-wrap"><table class="task-table"><thead><tr><th>Công việc</th><th>Trạng thái</th><th>Phụ trách</th><th>Hạn</th><th>Ưu tiên</th></tr></thead><tbody>${taskRows || html`<tr><td colspan="5" class="empty">Chưa có công việc nào.</td></tr>`}</tbody></table></div>${renderPagination(model.tasks)}`;
  }

  function renderMembers(model) {
    const p = model.project || {}, owner = isOwner(model.user, p), archived = Boolean(p.archived_at);
    const members = p.members || model.people || [], searchUsers = model.searchUsers || [];
    const hasMemberQuery = Boolean(String(model.memberQuery || '').trim());
    const memberRows = members.map(m => {
      const isOwnerMember = String(m.id) === String(p.owner_id);
      return html`<tr><td data-label="Tên">${esc(m.display_name || m.username)}</td><td data-label="Tài khoản">${esc(m.username)}</td><td data-label="Vai trò">${esc(isOwnerMember ? text('Chủ dự án') : text('Thành viên'))}</td><td data-label="Thao tác">${owner && !archived && !isOwnerMember ? html`<button type="button" class="button danger subtle" data-action="remove-member" data-id="${m.id}">Xóa</button>` : ''}</td></tr>`;
    }).join('');

    let candidateSection = '';
    if (owner && !archived) {
      const searchForm = html`<form data-form="member-search" class="form-row" novalidate><div class="field"><label for="member-query">Thêm thành viên</label><input type="text" id="member-query" name="q" value="${esc(model.memberQuery || '')}" placeholder="Tìm theo tên hiển thị hoặc tên đăng nhập..."></div><button type="submit" class="button secondary" ${model.busy ? 'disabled' : ''}>Tìm</button></form>`;
      let candidateBody = '';
      if (!hasMemberQuery) {
        candidateBody = html`<p class="muted">Nhập tên hiển thị hoặc tên đăng nhập rồi bấm Tìm.</p>`;
      } else if (searchUsers.length === 0) {
        candidateBody = html`<p class="empty muted">Không tìm thấy tài khoản phù hợp.</p>`;
      } else {
        const candidateRows = searchUsers.map(u => {
          const isAlreadyMember = members.some(m => String(m.id) === String(u.id));
          return html`<tr><td data-label="Tên">${esc(u.display_name || u.username)}</td><td data-label="Tài khoản">${esc(u.username)}</td><td data-label="Thao tác">${isAlreadyMember ? html`<span class="muted">Đã là thành viên</span>` : html`<button type="button" class="button primary subtle" data-action="add-member" data-id="${u.id}">Thêm</button>`}</td></tr>`;
        }).join('');
        candidateBody = html`<h2>Kết quả tìm kiếm</h2><div class="table-wrap"><table class="member-table"><thead><tr><th>Tên</th><th>Tài khoản</th><th>Thao tác</th></tr></thead><tbody>${candidateRows}</tbody></table></div>`;
      }
      candidateSection = searchForm + candidateBody;
    }

    return html`<div class="breadcrumbs muted"><a href="#/projects">Dự án</a> / <a href="#/projects/${p.id}">${esc(p.name || '')}</a> / Thành viên</div><div class="page-heading"><h1 tabindex="-1">Thành viên dự án</h1></div><nav class="tabs"><a href="#/projects/${p.id}" class="button subtle">Công việc</a><a href="#/projects/${p.id}/members" class="button secondary">Thành viên</a></nav>${candidateSection}<h2>Thành viên hiện tại</h2><div class="table-wrap"><table class="member-table"><thead><tr><th>Tên</th><th>Tài khoản</th><th>Vai trò</th><th>Thao tác</th></tr></thead><tbody>${memberRows || html`<tr><td colspan="4" class="empty">Chưa có thành viên nào.</td></tr>`}</tbody></table></div>`;
  }

  function renderProjectForm(model) {
    const p = model.project || {}, owner = !p.id || isOwner(model.user, p), archived = Boolean(p.archived_at);
    if (!owner || archived) return html`<div class="notice" role="status">${esc(text('Bạn không có quyền chỉnh sửa dự án này.'))}</div>`;
    const draft = model.draft || {}, errors = model.errors || {}, isEdit = Boolean(p.id);
    const nameVal = draft.name !== undefined ? draft.name : (p.name || '');
    const descVal = draft.description !== undefined ? draft.description : (p.description || '');
    const dis = (model.busy || model.conflict) ? 'disabled' : '';

    return html`<div class="page-heading"><h1 tabindex="-1">${text(isEdit ? 'Chỉnh sửa dự án' : 'Tạo dự án mới')}</h1></div><form data-form="project" class="form"${isEdit ? ` data-id="${p.id}" data-version="${p.version || 1}"` : ''} novalidate><div class="field"><label for="proj-name">Tên dự án *</label><input type="text" id="proj-name" name="name" value="${esc(nameVal)}" required${fieldAttrs(errors, 'name')}>${renderFieldError(errors, 'name')}</div><div class="field"><label for="proj-desc">Mô tả</label><textarea id="proj-desc" name="description"${fieldAttrs(errors, 'description')}>${esc(descVal)}</textarea>${renderFieldError(errors, 'description')}</div><div class="actions"><button type="submit" class="button primary" ${dis}>${text(isEdit ? 'Lưu thay đổi' : 'Tạo dự án')}</button><a href="${isEdit ? `#/projects/${p.id}` : '#/projects'}" class="button secondary">${text('Hủy')}</a></div></form>`;
  }

  function renderTaskForm(model) {
    const p = model.project || {}, t = model.task || {}, owner = isOwner(model.user, p);
    const archived = Boolean(p.archived_at || t.archived_at);
    if (!owner || archived) return html`<div class="notice" role="status">${esc(text('Bạn không có quyền chỉnh sửa công việc này.'))}</div>`;
    const draft = model.draft || {}, errors = model.errors || {}, isEdit = Boolean(t.id);
    const people = model.people || p.members || [];
    const titleVal = draft.title !== undefined ? draft.title : (t.title || '');
    const descVal = draft.description !== undefined ? draft.description : (t.description || '');
    const assigneeVal = draft.assignee_id !== undefined ? draft.assignee_id : (t.assignee_id || '');
    const priorityVal = draft.priority !== undefined ? draft.priority : (t.priority || 'medium');
    const dueDateVal = draft.due_local !== undefined ? draft.due_local : (t.due_local || '');
    const statusVal = draft.status !== undefined ? draft.status : (t.status || 'todo');
    const dis = (model.busy || model.conflict) ? 'disabled' : '';

    return html`<div class="breadcrumbs muted"><a href="#/projects">Dự án</a> / <a href="#/projects/${p.id}">${esc(p.name || '')}</a> / ${text(isEdit ? 'Chỉnh sửa công việc' : 'Tạo công việc')}</div><div class="page-heading"><div class="title"><h1 tabindex="-1">${text(isEdit ? 'Chỉnh sửa công việc' : 'Tạo công việc')}</h1><p class="muted">${isEdit ? '' : text('Công việc mới bắt đầu ở trạng thái Chưa làm.')}</p></div></div><form data-form="task" class="form"${isEdit ? ` data-id="${t.id}" data-version="${t.version || 1}"` : ''} novalidate><div class="field"><label for="task-title">Tiêu đề *</label><input type="text" id="task-title" name="title" value="${esc(titleVal)}" required${fieldAttrs(errors, 'title')}>${renderFieldError(errors, 'title')}</div><div class="field"><label for="task-desc">Mô tả</label><textarea id="task-desc" name="description"${fieldAttrs(errors, 'description')}>${esc(descVal)}</textarea>${renderFieldError(errors, 'description')}</div><div class="form-row"><div class="field"><label for="task-assignee">Người phụ trách</label><select id="task-assignee" name="assignee_id"${fieldAttrs(errors, 'assignee_id')}><option value="">${text('Chưa giao')}</option>${people.map(u => `<option value="${u.id}" ${String(assigneeVal) === String(u.id) ? 'selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')}</select>${renderFieldError(errors, 'assignee_id')}</div><div class="field"><label for="task-priority">Ưu tiên</label><select id="task-priority" name="priority"${fieldAttrs(errors, 'priority')}><option value="low" ${priorityVal === 'low' ? 'selected' : ''}>${text('Thấp')}</option><option value="medium" ${priorityVal === 'medium' ? 'selected' : ''}>${text('Trung bình')}</option><option value="high" ${priorityVal === 'high' ? 'selected' : ''}>${text('Cao')}</option></select>${renderFieldError(errors, 'priority')}</div></div><div class="field"><label for="task-due-date">Hạn hoàn thành (không bắt buộc)</label><input type="datetime-local" id="task-due-date" name="due_local" min="0001-01-01T00:00" max="9999-12-31T23:59" value="${esc(dueDateVal)}"${fieldAttrs(errors, 'due_local')}>${renderFieldError(errors, 'due_local')}<input type="hidden" name="due_timezone" value="${esc(draft.due_timezone || timezone)}"><p class="muted">${esc(timezoneLabel(draft.due_timezone || timezone, language))}</p></div>${isEdit ? html`<div class="field"><label for="task-status">Trạng thái</label><select id="task-status" name="status"${fieldAttrs(errors, 'status')}><option value="todo" ${statusVal === 'todo' ? 'selected' : ''}>${text('Chưa làm')}</option><option value="doing" ${statusVal === 'doing' ? 'selected' : ''}>${text('Đang làm')}</option><option value="done" ${statusVal === 'done' ? 'selected' : ''}>${text('Hoàn thành')}</option></select>${renderFieldError(errors, 'status')}</div>` : ''}<div class="actions"><button type="submit" class="button primary" ${dis}>${text(isEdit ? 'Lưu thay đổi' : 'Tạo công việc')}</button><a href="${isEdit ? `#/tasks/${t.id}` : `#/projects/${p.id}`}" class="button secondary">${text('Hủy')}</a></div></form>`;
  }

  function renderTask(model) {
    const p = model.project || {}, t = model.task || {}, user = model.user;
    const people = model.people || p.members || [], owner = isOwner(user, p);
    const archived = Boolean(t.archived_at || p.archived_at);
    const isAssigned = user && String(t.assignee_id) === String(user.id);
    const isOverdue = Boolean(t.is_overdue);
    const comments = model.comments?.items || [], history = model.history?.items || [];
    const commentDraft = model.draft?.body !== undefined ? model.draft.body : '';
    const draftStatus = model.draft?.status !== undefined ? model.draft.status : (t.status || 'todo');
    const dis = (model.busy || model.conflict) ? 'disabled' : '';

    return html`<div class="breadcrumbs muted"><a href="#/projects">Dự án</a> / <a href="#/projects/${p.id}">${esc(p.name || '')}</a> / Công việc #${t.id}</div><div class="page-heading"><div class="title"><h1 tabindex="-1">${esc(t.title || '')}</h1><p class="muted">${text('Phiên bản')} ${t.version || 1} ${t.updated_at ? `· ${text('Cập nhật')} ${fmtDate(t.updated_at)}` : ''}</p></div><div class="actions">${owner && !archived ? html`<a href="#/tasks/${t.id}/edit" class="button primary">${text('Chỉnh sửa')}</a>` : ''}${archived ? html`<span class="badge warning">${text(t.archived_at ? 'Công việc đã lưu trữ' : 'Dự án đã lưu trữ')} · ${text('Chỉ đọc')}</span>` : ''}</div></div><div class="detail-grid"><div class="main-col">${renderStatusBadge(t.status)}${!owner && isAssigned && !archived ? html`<form data-form="status" class="form-row" novalidate><div class="field"><label for="member-status-select">Cập nhật trạng thái</label><select id="member-status-select" name="status"${fieldAttrs(model.errors, 'status')}><option value="todo" ${draftStatus === 'todo' ? 'selected' : ''}>${text('Chưa làm')}</option><option value="doing" ${draftStatus === 'doing' ? 'selected' : ''}>${text('Đang làm')}</option><option value="done" ${draftStatus === 'done' ? 'selected' : ''}>${text('Hoàn thành')}</option></select>${renderFieldError(model.errors, 'status')}</div><button type="submit" class="button secondary" ${dis}>Cập nhật trạng thái</button></form>` : ''}<h3>Mô tả</h3><p class="description">${esc(t.description || text('Chưa có mô tả.'))}</p><hr class="divider"><h3>Bình luận</h3><div class="comments-list">${comments.length > 0 ? comments.map(c => `<div class="comment"><p class="muted">${esc(getPersonName(c.author_id, people, 'Thành viên'))} · ${fmtDate(c.created_at)}</p><p>${esc(c.body)}</p></div>`).join('') : html`<p class="muted">Chưa có bình luận. Trao đổi về công việc tại đây.</p>`}</div>${renderPagination(model.comments, 'comments')}${!archived ? html`<form data-form="comment" class="form" novalidate><div class="field"><label for="new-comment">Bình luận mới</label><textarea id="new-comment" name="body" placeholder="Tối đa 1.000 ký tự" required${fieldAttrs(model.errors, 'body')}>${esc(commentDraft)}</textarea>${renderFieldError(model.errors, 'body')}</div><button type="submit" class="button secondary" ${dis}>Gửi bình luận</button></form>` : ''}<hr class="divider"><h3>Lịch sử</h3><div class="history-list">${history.length > 0 ? history.map(h => {
      const act = text(ACTION_LABELS[h.action] || h.action || 'Thay đổi');
      const b = fmtHistObj(h.before, people, h.after), a = fmtHistObj(h.after, people, h.before);
      const diff = b || a ? `: ${b}${b && a ? ' &rarr; ' : ''}${a}` : '';
      return `<div class="history"><p class="muted">${esc(getPersonName(h.actor_id, people, 'Thành viên đã rời dự án'))} · ${fmtDate(h.created_at)}</p><p><strong>${esc(act)}</strong>${diff}</p></div>`;
    }).join('') : html`<p class="muted">Chưa có thay đổi sau khi tạo công việc.</p>`}</div>${renderPagination(model.history, 'history')}</div><aside class="metadata"><h3>Thông tin công việc</h3><p><strong>Người phụ trách:</strong> ${esc(getPersonName(t.assignee_id, people))}</p><p><strong>Ưu tiên:</strong> ${esc(text(PRIORITY_LABELS[t.priority] || t.priority || 'Không'))}</p><p><strong>Hạn hoàn thành:</strong> ${(t.due_at || t.due_date) ? fmtDate(t.due_at || t.due_date) : text('Không có')} ${isOverdue ? html`<span class="badge overdue">Quá hạn</span>` : ''}</p>${owner && !archived ? html`<button type="button" class="button danger subtle" data-action="archive-task" data-id="${t.id}" data-version="${t.version || 1}">Lưu trữ công việc</button>` : ''}</aside></div>`;
  }

  function renderLoading() {
    return html`<div class="loading"><p class="skeleton">Đang tải dữ liệu...</p></div>`;
  }

  function renderError(model) {
    return html`<div class="notice error" role="alert"><h1 tabindex="-1">Đã có lỗi xảy ra</h1><p>${esc(text(model.error?.message || model.error || 'Không thể tải dữ liệu.'))}</p><div class="actions"><a href="#/projects" class="button secondary">Quay lại danh sách</a><button type="button" class="button primary" data-action="retry">Thử lại</button></div></div>`;
  }

  function renderSettings(model) {
    const user = model.user || {}, draft = model.draft || {}, errors = model.errors || {};
    const displayNameVal = draft.display_name !== undefined ? draft.display_name : (user.display_name ?? '');
    const dis = model.busy ? 'disabled' : '';
    const lang = normalizeLanguage(model.language);

    return html`<div class="settings-page"><header class="settings-intro page-heading"><h1 tabindex="-1">Cài đặt tài khoản</h1><p class="muted">Quản lý hồ sơ cá nhân, ngôn ngữ hiển thị và bảo mật tài khoản.</p></header><section class="settings-section" aria-labelledby="settings-profile-heading"><div class="settings-section-heading"><h2 id="settings-profile-heading">Hồ sơ</h2><p class="muted">Thông tin tài khoản và tên hiển thị trong hệ thống.</p></div><div class="settings-section-body"><form data-form="profile" class="form" novalidate><div class="field"><label for="settings-username">Tên đăng nhập</label><input type="text" id="settings-username" value="${esc(user.username || '')}" readonly></div><div class="field"><label for="settings-display-name">Tên hiển thị</label><input type="text" id="settings-display-name" name="display_name" value="${esc(displayNameVal)}" required${fieldAttrs(errors, 'display_name')}>${renderFieldError(errors, 'display_name')}</div><div class="actions"><button type="submit" class="button primary" ${dis}>Lưu tên hiển thị</button></div></form></div></section><section class="settings-section" aria-labelledby="settings-language-heading"><div class="settings-section-heading"><h2 id="settings-language-heading">Ngôn ngữ</h2><p class="muted">Tùy chọn ngôn ngữ hiển thị giao diện.</p></div><div class="settings-section-body">${renderLangControl(lang, 'settings-language')}<p class="muted">Lựa chọn ngôn ngữ được lưu tự động trên trình duyệt này.</p></div></section><section class="settings-section" aria-labelledby="settings-timezone-heading"><div class="settings-section-heading"><h2 id="settings-timezone-heading">Múi giờ</h2><p class="muted">Thời gian thông báo và báo cáo ngày theo múi giờ của bạn.</p></div><div class="settings-section-body"><form data-form="timezone" class="form" novalidate><div class="field"><label for="settings-timezone">Múi giờ</label><select id="settings-timezone" name="timezone" required${fieldAttrs(errors, 'timezone')}>${(model.preferences?.timezones || ['Asia/Ho_Chi_Minh']).map(zone => `<option value="${esc(zone)}"${zone === (model.preferences?.timezone || model.timezone || 'Asia/Ho_Chi_Minh') ? ' selected' : ''}>${esc(timezoneLabel(zone, language))}</option>`).join('')}</select>${renderFieldError(errors, 'timezone')}<p class="muted">Ngày và giờ deadline tự chuyển theo múi giờ đã chọn. Thay đổi được lưu cho tài khoản này.</p></div><div class="actions"><button type="submit" class="button primary" ${dis}>Lưu múi giờ</button></div></form></div></section><section class="settings-section" aria-labelledby="settings-password-heading"><div class="settings-section-heading"><h2 id="settings-password-heading">Mật khẩu</h2><p class="muted">Cập nhật mật khẩu bảo vệ tài khoản.</p></div><div class="settings-section-body"><form data-form="password" class="form" novalidate><p class="muted">Yêu cầu nhập mật khẩu hiện tại. Đổi mật khẩu thành công sẽ đăng xuất khỏi tất cả phiên làm việc.</p><div class="field"><label for="settings-current-password">Mật khẩu hiện tại</label><div class="password-control"><input type="password" id="settings-current-password" name="current_password" autocomplete="current-password" required${fieldAttrs(errors, 'current_password')}>${renderPasswordToggle('settings-current-password', { language, disabled: model.busy })}</div>${renderFieldError(errors, 'current_password')}</div><div class="settings-password-row form-row"><div class="field"><label for="settings-new-password">Mật khẩu mới</label><div class="password-control"><input type="password" id="settings-new-password" name="new_password" autocomplete="new-password" required${fieldAttrs(errors, 'new_password')}>${renderPasswordToggle('settings-new-password', { language, disabled: model.busy })}</div><p class="muted">Mật khẩu từ 6–128 ký tự, có số và ký tự đặc biệt (ví dụ @).</p>${renderFieldError(errors, 'new_password')}</div><div class="field"><label for="settings-confirm-password">Xác nhận mật khẩu</label><div class="password-control"><input type="password" id="settings-confirm-password" name="confirm_password" autocomplete="new-password" required${fieldAttrs(errors, 'confirm_password')}>${renderPasswordToggle('settings-confirm-password', { language, disabled: model.busy })}</div>${renderFieldError(errors, 'confirm_password')}</div></div><div class="actions"><button type="submit" class="button primary" ${dis}>Đổi mật khẩu</button></div></form></div></section></div>`;
  }

  return function render(model = {}) {
    const type = model.type;
    if (type === 'login') return renderLogin(model);
    if (type === 'register') return renderRegister(model);

    let content = '';
    switch (type) {
      case 'projects': content = renderProjects(model); break;
      case 'archived-projects': content = renderArchivedProjects(model, { text: (key, fallback) => text(fallback || key) }, { formatDate: value => fmtDate(value), renderPagination }); break;
      case 'project': content = renderProject(model); break;
      case 'project-form': content = renderProjectForm(model); break;
      case 'task-form': content = renderTaskForm(model); break;
      case 'task': content = renderTask(model); break;
      case 'members': content = renderMembers(model); break;
      case 'settings': content = renderSettings(model); break;
      case 'notifications': content = renderNotifications(model, translator); break;
      case 'loading': content = renderLoading(); break;
      case 'error': content = renderError(model); break;
      default: content = html`<div class="empty">Nội dung không tồn tại.</div>`; break;
    }

    const confirmation = model.confirmation ? html`<dialog class="confirmation" aria-labelledby="confirmation-title" aria-describedby="confirmation-message"><h2 id="confirmation-title">Xác nhận thao tác</h2><p id="confirmation-message">${esc(text(model.confirmation.message))}</p><div class="actions"><button type="button" class="button secondary" data-action="cancel-confirm">Hủy</button><button type="button" class="button danger" data-action="confirm-action">Xác nhận</button></div></dialog>` : '';
    return renderShell(model, content) + confirmation;
  };
}

const translators = {
  vi: createTranslator('vi'),
  en: createTranslator('en')
};

export function renderApp(model = {}) {
  const lang = normalizeLanguage(model.language);
  return makeRenderer(translators[lang], model.timezone || 'Asia/Ho_Chi_Minh', lang)(model);
}
