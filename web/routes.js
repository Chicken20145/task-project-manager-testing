const resourceId = value => /^\d+$/.test(value) && Number.isSafeInteger(+value) && +value > 0 ? +value : null;

export function parseRoute(hash = '') {
  const path = hash.replace(/^#/, '').split('?')[0] || '/projects';
  if (['/login', '/register', '/projects', '/settings', '/notifications'].includes(path)) return { type: path.slice(1) };
  if (path === '/projects/new') return { type: 'project-form' };
  if (path === '/projects/archived') return { type: 'archived-projects' };
  const match = path.match(/^\/(projects|tasks)\/([^/]+)(.*)$/);
  if (match) {
    const id = resourceId(match[2]), suffix = match[3];
    if (id && match[1] === 'projects') {
      const types = { '': 'project', '/edit': 'project-form', '/members': 'members', '/tasks/new': 'task-form' };
      if (types[suffix]) return { type: types[suffix], projectId: id };
    }
    if (id && match[1] === 'tasks' && ['', '/edit'].includes(suffix)) {
      return { type: suffix ? 'task-form' : 'task', taskId: id };
    }
  }
  return { type: 'error' };
}

export function readFilters(query = '') {
  const params = new URLSearchParams(query), filters = { page: 1, page_size: 20 };
  for (const field of ['page', 'page_size']) {
    if (params.has(field)) {
      const value = resourceId(params.get(field));
      if (!value || (field === 'page_size' && value > 100)) throw new RangeError('Phân trang chưa hợp lệ.');
      filters[field] = value;
    }
  }
  if (params.get('q')?.trim()) filters.q = params.get('q').trim();
  for (const [field, allowed] of [['status', ['todo', 'doing', 'done']], ['priority', ['low', 'medium', 'high']]]) {
    const value = params.get(field);
    if (value) { if (!allowed.includes(value)) throw new RangeError('Bộ lọc chưa hợp lệ.'); filters[field] = value; }
  }
  const assignee = params.get('assignee_id');
  if (assignee) {
    if (['unassigned', 'null'].includes(assignee)) filters.assignee_id = null;
    else { const id = resourceId(assignee); if (!id) throw new RangeError('Người phụ trách chưa hợp lệ.'); filters.assignee_id = id; }
  }
  const overdue = params.get('overdue');
  if (overdue) { if (!['true', 'false'].includes(overdue)) throw new RangeError('Bộ lọc quá hạn chưa hợp lệ.'); filters.overdue = overdue === 'true'; }
  return filters;
}

export function readNotificationOptions(query = '') {
  const params = new URLSearchParams(query), seen = new Set();
  for (const [key] of params) {
    if (!['month', 'date', 'day_page', 'page'].includes(key) || seen.has(key)) throw new RangeError('Bộ lọc chưa hợp lệ.');
    seen.add(key);
  }
  const calendar = { page: 1, page_size: 20 }, feed = { page: 1, page_size: 20 };
  for (const [key, target] of [['day_page', calendar], ['page', feed]]) {
    if (params.has(key)) {
      const value = resourceId(params.get(key));
      if (!value) throw new RangeError('Phân trang chưa hợp lệ.');
      target.page = value;
    }
  }
  for (const key of ['month', 'date']) {
    if (params.has(key)) calendar[key] = params.get(key);
  }
  return { calendar, feed };
}

export function routeHash(path, filters = {}) {
  const query = new URLSearchParams();
  for (const field of ['q', 'status', 'priority', 'assignee_id', 'overdue', 'page', 'page_size']) {
    const value = filters[field];
    if (value !== undefined && value !== '') query.set(field, value === null ? 'unassigned' : String(value));
  }
  return '#' + path + (query.size ? '?' + query : '');
}

export function publicDraft(input) {
  return Object.fromEntries(['username', 'display_name', 'name', 'title', 'description', 'assignee_id', 'due_date', 'due_local', 'due_timezone', 'priority', 'status', 'body']
    .filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
}

export function readActivityPages(query = '') {
  const params = new URLSearchParams(query);
  return Object.fromEntries(['comments', 'history'].map(list => {
    const page = resourceId(params.get(`${list}_page`) || '1');
    if (!page) throw new RangeError('Phân trang chưa hợp lệ.');
    return [list, { page, page_size: 20 }];
  }));
}

export function activityHash(hash, list, page) {
  if (!['comments', 'history'].includes(list) || !resourceId(String(page))) throw new RangeError('Phân trang chưa hợp lệ.');
  const [path, query] = hash.split('?'), params = new URLSearchParams(query);
  params.set(`${list}_page`, String(page));
  return `${path}?${params}`;
}
