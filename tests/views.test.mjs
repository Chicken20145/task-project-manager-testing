import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../web/views.js';

const mockUser = { id: 1, username: 'alice', display_name: 'Alice Wonder' };
const mockMember = { id: 2, username: 'bob', display_name: 'Bob Builder' };
const mockProject = {
  id: 10,
  name: 'Alpha Project',
  description: 'Project Alpha details',
  owner_id: 1,
  role: 'owner',
  version: 1,
  archived_at: null,
  members: [mockUser, mockMember]
};
const mockPeople = [mockUser, mockMember];

test('application screens keep build diagnostics out of the everyday interface', () => {
  const metadata = { edition: 'testing', build_id: 'baseline-20261019', ai_enabled: false };
  for (const model of [{ type: 'login' }, { type: 'projects', user: mockUser, projects: { items: [] } }]) {
    const html = renderApp({ ...model, metadata });
    assert.doesNotMatch(html, /Bản kiểm thử · Nền nghiệp vụ đúng/);
    assert.doesNotMatch(html, /baseline-20261019/);
  }
  assert.doesNotMatch(renderApp({ type: 'login' }), /Bản kiểm thử/);
});

test('real web does not describe data as memory-only or reset on reload', () => {
  for (const html of [renderApp({ type: 'login' }), renderApp({ type: 'projects', user: mockUser, projects: { items: [] } })]) {
    assert.doesNotMatch(html, /Dữ liệu mô phỏng|Đặt lại khi tải trang|Dữ liệu đặt lại khi tải lại trang/);
  }
});

test('XSS escaping across names, text, comments, textarea, attributes', () => {
  const xss = '<script>alert("xss")</script>" onmouseover="alert(1)';
  const model = {
    type: 'task', user: mockUser, project: mockProject, people: mockPeople,
    task: {
      id: 100, project_id: 10, title: xss, description: xss, assignee_id: 1,
      status: 'doing', priority: 'high', due_date: '2026-10-20', version: 1, archived_at: null
    },
    comments: {
      items: [{ author_id: 1, body: xss, created_at: '2026-10-13T08:00:00Z' }],
      page: 1, page_size: 10, total: 1
    },
    history: {
      items: [{ actor_id: 1, action: xss, before: { title: xss }, after: { title: xss }, created_at: '2026-10-13T08:00:00Z' }],
      page: 1, page_size: 10, total: 1
    }
  };
  const html = renderApp(model);
  assert.ok(!html.includes('<script>alert'), 'Raw script tags must not appear in HTML');
  assert.ok(!html.includes('" onmouseover="'), 'Attributes must be safely escaped');
  assert.ok(html.includes('&lt;script&gt;alert'), 'Text must be HTML-escaped');
});

test('Password safety: never serializes secrets or public demo credentials and keeps autocomplete', () => {
  const loginHtml = renderApp({
    type: 'login',
    draft: { username: 'alice', password: 'SuperSecretPassword123' },
    errors: { password: 'Wrong password' }
  });
  assert.ok(!loginHtml.includes('SuperSecretPassword123'), 'Login must not serialize password value');
  assert.ok(loginHtml.includes('type="password"'), 'Password field exists');
  assert.ok(loginHtml.includes('autocomplete="current-password"'), 'Login password has current-password autocomplete');
  assert.doesNotMatch(loginHtml, /nguyen\.van\.a|demo123|Tài khoản demo/, 'Demo credentials stay out of the sign-in page');
  assert.ok(loginHtml.includes('id="main"'), 'Auth card has main id');
  assert.ok(!loginHtml.includes('class="skip-link"'), 'No duplicate skip link in auth view');

  const regHtml = renderApp({
    type: 'register',
    draft: { username: 'bob', display_name: 'Bob', password: 'SecretPassword!', confirm_password: 'SecretPassword!' }
  });
  assert.ok(!regHtml.includes('SecretPassword!'), 'Register must not serialize password value');
  assert.ok(regHtml.includes('autocomplete="new-password"'), 'Register passwords have new-password autocomplete');
  assert.ok(regHtml.includes('6–128 ký tự'), 'Register password length hint present');
});

test('Owner vs Member permissions and archived readonly state', () => {
  const ownerProjectModel = {
    type: 'project', user: mockUser, project: mockProject, people: mockPeople,
    stats: { total: 10, todo: 4, doing: 3, done: 3, overdue: 1 },
    tasks: { items: [], page: 1, page_size: 20, total: 0 }
  };
  const ownerHtml = renderApp(ownerProjectModel);
  assert.ok(ownerHtml.includes('#/projects/10/edit'), 'Owner can edit project');
  assert.ok(ownerHtml.includes('data-action="archive-project"'), 'Owner can archive project');
  assert.ok(ownerHtml.includes('#/projects/10/tasks/new'), 'Owner can create tasks');

  const memberProjectModel = { ...ownerProjectModel, user: mockMember, project: { ...mockProject, role: 'member' } };
  const memberHtml = renderApp(memberProjectModel);
  assert.ok(!memberHtml.includes('#/projects/10/edit'), 'Member cannot edit project');
  assert.ok(!memberHtml.includes('data-action="archive-project"'), 'Member cannot archive project');
  assert.ok(!memberHtml.includes('#/projects/10/tasks/new'), 'Member cannot create task');

  const assignedTaskModel = {
    type: 'task', user: mockMember, project: { ...mockProject, role: 'member' }, people: mockPeople,
    task: { id: 55, project_id: 10, title: 'Fix Bug', assignee_id: 2, status: 'doing', priority: 'medium', version: 1, archived_at: null },
    draft: { status: 'done' },
    comments: { items: [], page: 1, page_size: 10, total: 0 },
    history: { items: [], page: 1, page_size: 10, total: 0 }
  };
  const assignedHtml = renderApp(assignedTaskModel);
  assert.ok(assignedHtml.includes('data-form="status"'), 'Assigned member has status update form');
  assert.ok(!assignedHtml.includes('data-action="status"'), 'Status form submit has no data-action="status"');
  assert.ok(assignedHtml.includes('value="done" selected'), 'Member status form retains draft status');
  assert.ok(!assignedHtml.includes('#/tasks/55/edit'), 'Member cannot edit entire task');

  const archivedTaskModel = {
    type: 'task', user: mockUser, project: mockProject, people: mockPeople,
    task: { ...assignedTaskModel.task, archived_at: '2026-10-12T00:00:00Z' },
    comments: { items: [], page: 1, page_size: 10, total: 0 },
    history: { items: [], page: 1, page_size: 10, total: 0 }
  };
  const archivedHtml = renderApp(archivedTaskModel);
  assert.ok(!archivedHtml.includes('#/tasks/55/edit'), 'Archived task has no edit link');
  assert.ok(!archivedHtml.includes('data-action="archive-task"'), 'Archived task has no archive button');
  assert.ok(!archivedHtml.includes('data-form="comment"'), 'Archived task has no comment form');
});

test('Create task has NO status selector; Edit task includes status selector', () => {
  const createHtml = renderApp({
    type: 'task-form', user: mockUser, project: mockProject, people: mockPeople, draft: { title: 'New Task' }
  });
  assert.ok(!createHtml.includes('name="status"'), 'Create task form must not have status selector');

  const editHtml = renderApp({
    type: 'task-form', user: mockUser, project: mockProject, people: mockPeople,
    task: { id: 77, title: 'Existing Task', status: 'doing', priority: 'low' },
    draft: { title: 'Existing Task', status: 'doing' }
  });
  assert.ok(editHtml.includes('name="status"'), 'Edit task form must include status selector');
});

test('Dynamic stats from model instead of static demo values', () => {
  const html = renderApp({
    type: 'project', user: mockUser, project: mockProject, people: mockPeople,
    stats: { total: 42, todo: 15, doing: 12, done: 15, overdue: 9 },
    tasks: { items: [], page: 1, page_size: 20, total: 0 }
  });
  assert.ok(html.includes('42 công việc'), 'Total stats matches model');
  assert.ok(html.includes('15 chưa làm'), 'Todo stats matches model');
  assert.ok(html.includes('12 đang làm'), 'Doing stats matches model');
  assert.ok(html.includes('15 hoàn thành'), 'Done stats matches model');
  assert.ok(html.includes('9 quá hạn'), 'Overdue stats matches model');
});

test('Filter retention, pagination links, and form errors associations', () => {
  const html = renderApp({
    type: 'project', user: mockUser, project: mockProject, people: mockPeople,
    stats: { total: 100, todo: 40, doing: 30, done: 30, overdue: 5 },
    filters: { q: 'search query', status: 'doing', priority: 'high', assignee_id: null, overdue: 'false' },
    tasks: {
      items: [{ id: 1, title: 'Task 1', status: 'doing', priority: 'high', assignee_id: null, is_overdue: false }],
      page: 2, page_size: 20, total: 100
    }
  });
  assert.ok(html.includes('value="search query"'), 'Filter q is retained');
  assert.ok(html.includes('value="unassigned" selected'), 'Typed null selects unassigned');
  assert.ok(html.includes('value="false" selected'), 'Filter overdue false is selected');
  assert.ok(html.includes('data-action="page"'), 'Pagination action present');
  assert.ok(html.includes('data-page="1"'), 'Previous page button has data-page="1"');
  assert.ok(html.includes('data-page="3"'), 'Next page button has data-page="3"');
  assert.ok(html.includes('data-label="Công việc"'), 'Mobile data-label attribute present');

  const formHtml = renderApp({
    type: 'project-form', user: mockUser, busy: true,
    draft: { name: '', description: 'Draft desc' },
    errors: { name: 'Tên dự án là bắt buộc' }
  });
  assert.ok(formHtml.includes('aria-invalid="true"'), 'Invalid field marked with aria-invalid');
  assert.ok(formHtml.includes('aria-describedby="name-error"'), 'aria-describedby linked to error');
  assert.ok(formHtml.includes('id="name-error"'), 'Error element has expected id');
  assert.ok(formHtml.includes('disabled'), 'Busy state disables submit button');
});

test('Conflict, Loading, and Error views with retry', () => {
  const conflictHtml = renderApp({
    type: 'task-form', user: mockUser, project: mockProject, people: mockPeople,
    task: { id: 77, title: 'Server Title', version: 2 },
    draft: { title: 'My Conflicted Draft' },
    conflict: true
  });
  assert.ok(/class="[^"]*\bconflict\b[^"]*"/.test(conflictHtml), 'Conflict container class token matched');
  assert.ok(conflictHtml.includes('My Conflicted Draft'), 'Conflict retains draft');
  assert.ok(conflictHtml.includes('data-action="reload-conflict"'), 'Reload conflict action present');
  assert.ok(conflictHtml.includes('disabled'), 'Conflict state disables submit button');

  const loadingHtml = renderApp({ type: 'loading', user: mockUser });
  assert.ok(loadingHtml.includes('loading') || loadingHtml.includes('skeleton'), 'Loading rendered');

  const errorHtml = renderApp({
    type: 'error', user: mockUser, error: { code: 'NOT_FOUND', message: 'Dự án không tồn tại' }
  });
  assert.ok(errorHtml.includes('Dự án không tồn tại'), 'Error message rendered');
  assert.ok(errorHtml.includes('data-action="retry"'), 'Error view includes retry action');
});

test('Focused regressions: overdue false, date split, object history, comment draft, and row roles', () => {
  const taskHtml = renderApp({
    type: 'task', user: mockUser, project: mockProject, people: mockPeople,
    task: { id: 88, title: 'Test Task', due_date: '2026-10-15', is_overdue: false, status: 'doing' },
    draft: { body: 'Unsaved comment draft' },
    errors: { body: 'Bình luận không được trống' },
    comments: { items: [{ author_id: 1, body: 'C1', created_at: '2026-10-13' }], page: 1, page_size: 10, total: 15 },
    history: {
      items: [{
        actor_id: 1, action: 'updated',
        before: { id: 9, version: 1, status: 'todo' },
        after: { id: 9, version: 2, status: 'doing' },
        created_at: '2026-10-13'
      }],
      page: 1, page_size: 10, total: 12
    }
  });
  assert.ok(!taskHtml.includes('<span class="badge overdue">Quá hạn</span>'), 'is_overdue false must not render overdue badge');
  assert.ok(taskHtml.includes('15/10/2026'), 'Date split formatted to DD/MM/YYYY without TZ offset');
  assert.ok(!taskHtml.includes('[object Object]'), 'History before/after objects never output [object Object]');
  assert.ok(!taskHtml.includes('version:'), 'History filters out technical fields like version or id');
  assert.ok(taskHtml.includes('Đã cập nhật'), 'History action is localized');
  assert.ok(taskHtml.includes('Trạng thái: Chưa làm'), 'History shows human readable change labels');
  assert.ok(taskHtml.includes('data-list="comments"'), 'Comments pagination has data-list="comments"');
  assert.ok(taskHtml.includes('data-list="history"'), 'History pagination has data-list="history"');
  assert.ok(taskHtml.includes('Unsaved comment draft'), 'Comment textarea retains draft body');
  assert.ok(taskHtml.includes('id="body-error"'), 'Comment error has accessible field error id');

  const projectsHtml = renderApp({
    type: 'projects', user: mockUser,
    projects: { items: [{ id: 20, name: 'Derived Project', owner_id: 1 }], page: 1, page_size: 10, total: 1 }
  });
  assert.ok(projectsHtml.includes('Chủ dự án'), 'Row role derived from owner_id matching current user');
  assert.ok(projectsHtml.includes('data-form="filters"'), 'Project search uses data-form="filters"');

  const membersHtml = renderApp({
    type: 'members', user: mockUser, project: mockProject, people: mockPeople,
    memberQuery: 'bob',
    searchUsers: [{ id: 2, username: 'bob', display_name: 'Bob Builder' }]
  });
  assert.ok(membersHtml.includes('Đã là thành viên'), 'Existing member in search shows Đã là thành viên');
  assert.ok(membersHtml.includes('Tìm theo tên hiển thị hoặc tên đăng nhập...'), 'Member search describes both supported identity fields');
});

test('history displays changed business fields only and preserves plain user content safely', () => {
  const html = renderApp({ type: 'task', user: mockUser, project: mockProject,
    task: { id: 55, title: 'Current task', status: 'done' },
    history: { items: [{ actor_id: 1, action: 'updated', created_at: '2026-10-13',
      before: { title: 'Unchanged', status: 'todo', version: 1 },
      after: { title: 'Unchanged', status: 'done', version: 2 },
    }] },
  });
  assert.ok(!html.includes('Tiêu đề: Unchanged'));
  assert.ok(html.includes('Trạng thái: Chưa làm'));
  assert.ok(html.includes('Trạng thái: Hoàn thành'));
  assert.ok(!html.includes('version:'));
});
