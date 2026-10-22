// In-memory UI demo only. These checks are not backend authentication/security.
import { createDemoFixtures } from './fixtures.js';
import { queryTasks, getTaskStats } from './queries.js';
import { validateTaskDraft, validateProjectDraft, isOverdue } from './validators.js';

import { validNewPassword, PASSWORD_MESSAGE } from '../password-policy.js';

export const DEMO_PASSWORD = 'demo123';

export class MockApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'MockApiError';
    this.status = status;
    this.error = { code, message, details };
  }
}

export function createMockClient(initialData = createDemoFixtures()) {
  const data = structuredClone(initialData);
  data.comments ??= [];
  data.task_history ??= [];
  data.project_history ??= [];
  const credentials = new Map(data.users.map(user => [user.id, DEMO_PASSWORD]));
  let userId = null;
  const timestamp = `${data.today}T09:00:00Z`;
  const copy = value => structuredClone(value);
  const nextId = rows => Math.max(0, ...rows.map(row => row.id)) + 1;
  const fail = (status, code, message, details) => { throw new MockApiError(status, code, message, details); };
  const invalid = details => fail(422, 'VALIDATION_ERROR', 'Dữ liệu chưa hợp lệ.', details);
  const forbidden = () => fail(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
  const publicUser = user => ({ id: user.id, username: user.username, display_name: user.display_name });

  function requireObject(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid({ [field]: 'Cần một object hợp lệ.' });
  }
  function requireId(id) {
    if (!Number.isInteger(id) || id < 1) invalid({ id: 'ID phải là số nguyên dương.' });
  }

  function currentUser() {
    const user = data.users.find(item => item.id === userId);
    if (!user) fail(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập tài khoản demo.');
    return user;
  }
  function canView(project) {
    return project.owner_id === userId || data.project_members.some(member => member.project_id === project.id && member.user_id === userId);
  }
  function projectById(id) {
    currentUser();
    requireId(id);
    const project = data.projects.find(item => item.id === id);
    if (!project || !canView(project)) fail(404, 'NOT_FOUND', 'Không tìm thấy dự án.');
    return project;
  }
  function taskById(id) {
    currentUser();
    requireId(id);
    const task = data.tasks.find(item => item.id === id);
    if (!task) { currentUser(); fail(404, 'NOT_FOUND', 'Không tìm thấy công việc.'); }
    projectById(task.project_id);
    return task;
  }
  function requireOwner(project) {
    if (project.owner_id !== userId) forbidden();
  }
  function requireWritable(project, task) {
    if (project.archived_at || task?.archived_at) fail(403, 'ARCHIVED', 'Nội dung đã lưu trữ, chỉ có thể xem.');
  }
  function requireVersion(entity, version) {
    if (!Number.isInteger(version) || version < 1) invalid({ version: 'Cần phiên bản hiện tại.' });
    if (entity.version !== version) fail(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.');
  }
  function validate(result) {
    if (!result.valid) invalid(result.errors);
    return result.value;
  }
  function requireFields(input, fields) {
    requireObject(input, 'input');
    for (const key of Object.keys(input)) if (!fields.includes(key)) invalid({ [key]: 'Trường không được hỗ trợ.' });
  }
  function requireAssignee(projectId, id) {
    if (id !== null && !data.project_members.some(member => member.project_id === projectId && member.user_id === id)) {
      invalid({ assignee_id: 'Người phụ trách phải là thành viên của dự án.' });
    }
  }
  function recordTask(task, before, action) {
    data.task_history.push({ id: nextId(data.task_history), task_id: task.id, actor_id: userId,
      action, before: copy(before), after: copy(task), created_at: timestamp });
  }
  function recordProject(project, before, action) {
    data.project_history.push({ id: nextId(data.project_history), project_id: project.id, actor_id: userId,
      action, before: copy(before), after: copy(project), created_at: timestamp });
  }
  function paginate(rows, options = {}) {
    requireObject(options, 'pagination');
    const { page = 1, page_size = 20 } = options;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(page_size) || page_size < 1 || page_size > 100) {
      invalid({ page: 'Phân trang chưa hợp lệ.' });
    }
    return { items: copy(rows.slice((page - 1) * page_size, page * page_size)), page, page_size, total: rows.length };
  }
  function taskView(task) { return { ...copy(task), is_overdue: isOverdue(task, data.today) }; }

  return {
    async getMetadata() { return { edition: 'baseline', build_id: 'baseline-local', ai_enabled: false }; },
    async register(input) {
      requireFields(input, ['username', 'display_name', 'password']);
      const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
      const display_name = typeof input.display_name === 'string' ? input.display_name.trim() : '';
      const errors = {};
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.username = 'Dùng 3–32 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.';
      if (!display_name || [...display_name].length > 80) errors.display_name = 'Tên hiển thị cần từ 1 đến 80 ký tự.';
      if (!validNewPassword(input.password)) {
        errors.password = PASSWORD_MESSAGE;
      }
      if (Object.keys(errors).length) invalid(errors);
      if (data.users.some(user => user.username.toLowerCase() === username)) {
        fail(409, 'DUPLICATE_USERNAME', 'Tên đăng nhập đã được sử dụng.', { username: 'Chọn tên đăng nhập khác.' });
      }
      const user = { id: nextId(data.users), username, display_name };
      data.users.push(user);
      // Mock-only credentials stay private in memory and reset with this client.
      credentials.set(user.id, input.password);
      return publicUser(user);
    },
    async login(input) {
      userId = null;
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const user = data.users.find(item => item.username.toLowerCase() === username);
      if (!user || input?.password !== credentials.get(user.id)) fail(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu chưa đúng.');
      userId = user.id;
      return { user: publicUser(user), csrf_token: 'mock-csrf-demo-only' };
    },
    async me() { return { user: publicUser(currentUser()), csrf_token: 'mock-csrf-demo-only' }; },
    async logout() { userId = null; },
    async updateProfile(input) {
      const user = currentUser();
      requireObject(input, 'profile');
      if (Object.keys(input).some(key => key !== 'display_name')) invalid({ display_name: 'Dữ liệu chưa hợp lệ.' });
      const display = typeof input.display_name === 'string' ? input.display_name.trim() : '';
      if ([...display].length < 1 || [...display].length > 80 || /[\u0000\uD800-\uDFFF]/u.test(display)) invalid({ display_name: 'Tên hiển thị cần 1–80 ký tự.' });
      user.display_name = display;
      return publicUser(user);
    },
    async changePassword(input) {
      const user = currentUser();
      requireObject(input, 'password');
      if (Object.keys(input).some(key => !['current_password', 'new_password'].includes(key))) invalid({ new_password: 'Dữ liệu chưa hợp lệ.' });
      if (!validNewPassword(input.new_password)) invalid({ new_password: PASSWORD_MESSAGE });
      if (input.current_password !== credentials.get(user.id)) invalid({ current_password: 'Mật khẩu hiện tại chưa đúng.' });
      if (input.current_password === input.new_password) invalid({ new_password: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
      credentials.set(user.id, input.new_password);
      userId = null;
    },
    async listProjects(options = {}) {
      currentUser();
      requireObject(options, 'filters');
      if (options.q !== undefined && typeof options.q !== 'string') invalid({ q: 'Cần chuỗi tìm kiếm.' });
      const q = (options.q || '').trim().toLowerCase();
      return paginate(data.projects.filter(project => !project.archived_at && canView(project) &&
        (!q || project.name.toLowerCase().includes(q))).sort((a, b) => b.id - a.id), options);
    },
    async getProject(id) {
      const project = projectById(id);
      const members = data.project_members.filter(member => member.project_id === id)
        .map(member => publicUser(data.users.find(user => user.id === member.user_id)));
      return { ...copy(project), role: project.owner_id === userId ? 'owner' : 'member', members };
    },
    async createProject(input) {
      currentUser();
      requireFields(input, ['name', 'description']);
      const values = validate(validateProjectDraft(input));
      const project = { id: nextId(data.projects), ...values, owner_id: userId, version: 1,
        archived_at: null, created_at: timestamp, updated_at: timestamp };
      data.projects.push(project);
      data.project_members.push({ project_id: project.id, user_id: userId });
      recordProject(project, null, 'created');
      return copy(project);
    },
    async updateProject(id, input) {
      const project = projectById(id);
      requireOwner(project); requireWritable(project);
      requireFields(input, ['name', 'description', 'version']); requireVersion(project, input.version);
      const values = validate(validateProjectDraft({ ...project, ...input }));
      const before = copy(project);
      Object.assign(project, values, { version: project.version + 1, updated_at: timestamp });
      recordProject(project, before, 'updated');
      return copy(project);
    },
    async archiveProject(id, input) {
      const project = projectById(id);
      requireOwner(project); requireWritable(project); requireVersion(project, input?.version);
      const before = copy(project);
      Object.assign(project, { archived_at: timestamp, updated_at: timestamp, version: project.version + 1 });
      recordProject(project, before, 'archived');
      return copy(project);
    },
    async listUsers(q = '', options = {}) {
      currentUser();
      if (!data.projects.some(project => project.owner_id === userId)) forbidden();
      if (typeof q !== 'string') invalid({ q: 'Cần chuỗi tìm kiếm.' });
      const query = q.trim().toLowerCase();
      const users = data.users.filter(user => query && (user.username.toLowerCase().includes(query)
        || user.display_name.toLowerCase().includes(query)))
        .sort((a, b) => b.id - a.id).map(publicUser);
      return paginate(users, options);
    },
    async addMember(projectId, memberId) {
      const project = projectById(projectId);
      requireOwner(project); requireWritable(project);
      requireId(memberId);
      if (!data.users.some(user => user.id === memberId)) invalid({ user_id: 'Tài khoản không tồn tại.' });
      if (data.project_members.some(member => member.project_id === projectId && member.user_id === memberId)) {
        fail(409, 'DUPLICATE_MEMBER', 'Tài khoản đã là thành viên của dự án.');
      }
      const member = { project_id: projectId, user_id: memberId };
      data.project_members.push(member);
      return copy(member);
    },
    async removeMember(projectId, memberId) {
      const project = projectById(projectId);
      requireOwner(project); requireWritable(project);
      requireId(memberId);
      if (project.owner_id === memberId) invalid({ user_id: 'Không thể loại chủ dự án.' });
      const index = data.project_members.findIndex(member => member.project_id === projectId && member.user_id === memberId);
      if (index < 0) fail(404, 'NOT_FOUND', 'Không tìm thấy thành viên.');
      data.project_members.splice(index, 1);
      for (const task of data.tasks.filter(task => task.project_id === projectId && task.assignee_id === memberId)) {
        const before = copy(task);
        Object.assign(task, { assignee_id: null, version: task.version + 1, updated_at: timestamp });
        recordTask(task, before, 'assignee_removed');
      }
    },
    async listTasks(projectId, filters = {}) {
      projectById(projectId);
      requireObject(filters, 'filters');
      try {
        const result = queryTasks(data.tasks, { ...filters, project_id: projectId }, data.today);
        return { ...result, items: result.items.map(taskView) };
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) invalid({ filters: error.message });
        throw error;
      }
    },
    async getTask(id) { return taskView(taskById(id)); },
    async createTask(projectId, input) {
      const project = projectById(projectId);
      requireOwner(project); requireWritable(project);
      requireFields(input, ['title', 'description', 'assignee_id', 'due_date', 'priority']);
      const values = validate(validateTaskDraft(input)); requireAssignee(projectId, values.assignee_id);
      const task = { id: nextId(data.tasks), project_id: projectId, ...values, status: 'todo', version: 1,
        archived_at: null, created_at: timestamp, updated_at: timestamp };
      data.tasks.push(task); recordTask(task, null, 'created');
      return taskView(task);
    },
    async updateTask(id, input) {
      const task = taskById(id), project = projectById(task.project_id);
      requireWritable(project, task);
      if (project.owner_id !== userId) {
        if (task.assignee_id !== userId || !input || Object.keys(input).some(key => !['status', 'version'].includes(key))) forbidden();
      }
      requireFields(input, ['title', 'description', 'assignee_id', 'due_date', 'priority', 'status', 'version']);
      requireVersion(task, input.version);
      const values = validate(validateTaskDraft({ ...task, ...input })); requireAssignee(project.id, values.assignee_id);
      const before = copy(task);
      Object.assign(task, values, { version: task.version + 1, updated_at: timestamp });
      recordTask(task, before, 'updated');
      return taskView(task);
    },
    async archiveTask(id, input) {
      const task = taskById(id), project = projectById(task.project_id);
      requireOwner(project); requireWritable(project, task); requireVersion(task, input?.version);
      const before = copy(task);
      Object.assign(task, { archived_at: timestamp, updated_at: timestamp, version: task.version + 1 });
      recordTask(task, before, 'archived');
      return taskView(task);
    },
    async listComments(id, options = {}) {
      taskById(id);
      return paginate(data.comments.filter(comment => comment.task_id === id).sort((a, b) => a.id - b.id), options);
    },
    async addComment(id, input) {
      const task = taskById(id), project = projectById(task.project_id);
      requireWritable(project, task); requireFields(input, ['body']);
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      if (!body || [...body].length > 1000) invalid({ body: 'Bình luận cần từ 1 đến 1.000 ký tự.' });
      const comment = { id: nextId(data.comments), task_id: id, author_id: userId, body, created_at: timestamp };
      data.comments.push(comment);
      return copy(comment);
    },
    async listHistory(id, options = {}) {
      taskById(id);
      return paginate(data.task_history.filter(entry => entry.task_id === id).sort((a, b) => a.id - b.id), options);
    },
    async getStats(projectId) { projectById(projectId); return getTaskStats(data.tasks, projectId, data.today); },
  };
}
