export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = { code, message, details };
  }
}

// Same-origin cookies stay in the browser. CSRF stays in this closure, never localStorage.
export function createHttpClient({ fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 15000 } = {}) {
  let csrf, generation = 0;
  let authTail = Promise.resolve();
  const transition = action => {
    const result = authTail.then(action);
    authTail = result.catch(() => {}); // a failed transition must not block a later login
    return result;
  };
  const id = value => {
    if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(422, 'VALIDATION_ERROR', 'ID chưa hợp lệ.');
    return value;
  };
  const query = options => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options || {})) {
      if (value !== undefined && value !== '') params.set(key, value === null ? 'unassigned' : String(value));
    }
    return params.size ? '?' + params : '';
  };
  async function request(path, method = 'GET', input, sessionResult = false) {
    const current = generation, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['X-Requested-With'] = 'TaskManager';
      headers['Content-Type'] = 'application/json';
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    try {
      const response = await fetchImpl('/api' + path, {
        method, headers, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: controller.signal, ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      });
      if (response.status === 204) return undefined;
      let result;
      try { result = await response.json(); } catch { /* generic envelope below; never render raw HTTP text */ }
      if (!response.ok) {
        if (response.status === 401 && current === generation) csrf = undefined;
        const error = result?.error;
        throw new ApiError(response.status, typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
          typeof error?.message === 'string' ? error.message : 'Máy chủ chưa xử lý được yêu cầu.',
          error?.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {});
      }
      if (!result || typeof result !== 'object') throw new ApiError(502, 'INVALID_RESPONSE', 'Phản hồi máy chủ chưa hợp lệ.');
      if (sessionResult && current === generation) csrf = result.csrf_token;
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        'Không nhận được phản hồi. Hãy tải lại kiểm tra dữ liệu trước khi gửi lại.');
    } finally { clearTimeout(timer); }
  }
  return {
    getMetadata: () => request('/meta'),
    register: input => request('/auth/register', 'POST', input),
    login: input => transition(() => { generation++; csrf = undefined; return request('/auth/login', 'POST', input, true); }),
    me: async () => { await authTail; return request('/auth/me', 'GET', undefined, true); },
    logout: () => transition(async () => {
      const current = generation;
      await request('/auth/logout', 'POST');
      if (current === generation) { generation++; csrf = undefined; }
    }),
    updateProfile: input => request('/account/profile', 'PATCH', input),
    changePassword: input => transition(async () => {
      const current = generation;
      await request('/account/password', 'POST', input);
      if (current === generation) { generation++; csrf = undefined; }
    }),
    listProjects: options => request('/projects' + query(options)),
    listArchivedProjects: options => request('/projects/archived' + query(options)),
    restoreProject: async (project, input) => request(`/projects/${id(project)}/restore`, 'POST', input),
    deleteProject: async (project, input) => request(`/projects/${id(project)}`, 'DELETE', input),
    getProject: async project => request(`/projects/${id(project)}`),
    createProject: input => request('/projects', 'POST', input),
    updateProject: async (project, input) => request(`/projects/${id(project)}`, 'PATCH', input),
    archiveProject: async (project, input) => request(`/projects/${id(project)}/archive`, 'POST', input),
    listUsers: (q = '', options = {}) => request('/users' + query({ q, ...options })),
    addMember: async (project, member) => request(`/projects/${id(project)}/members`, 'POST', { user_id: id(member) }),
    removeMember: async (project, member) => request(`/projects/${id(project)}/members/${id(member)}`, 'DELETE'),
    listTasks: async (project, options) => request(`/projects/${id(project)}/tasks` + query(options)),
    getTask: async task => request(`/tasks/${id(task)}`),
    createTask: async (project, input) => request(`/projects/${id(project)}/tasks`, 'POST', input),
    updateTask: async (task, input) => request(`/tasks/${id(task)}`, 'PATCH', input),
    archiveTask: async (task, input) => request(`/tasks/${id(task)}/archive`, 'POST', input),
    listComments: async (task, options) => request(`/tasks/${id(task)}/comments` + query(options)),
    addComment: async (task, input) => request(`/tasks/${id(task)}/comments`, 'POST', input),
    listHistory: async (task, options) => request(`/tasks/${id(task)}/history` + query(options)),
    getStats: async project => request(`/projects/${id(project)}/stats`),
    getCalendar: options => request('/calendar' + query(options)),
    ensureDailyReport: () => request('/notifications/daily', 'POST', {}),
    listNotifications: options => request('/notifications' + query(options)),
    getPreferences: () => request('/account/preferences'),
    updatePreferences: input => request('/account/preferences', 'PATCH', input),
  };
}
