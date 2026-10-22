function parseDate(s) {
  if (typeof s !== 'string') throw new TypeError('Date string required');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new RangeError(`Invalid format: ${s}`);
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw new RangeError(`Invalid date bounds: ${s}`);
  }
  const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const daysInMonths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > daysInMonths[mo]) {
    throw new RangeError(`Invalid calendar day for month: ${s}`);
  }
}

function dateToNum(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return (+m[1] * 10000) + (+m[2] * 100) + +m[3];
}

export function queryTasks(tasks, filters, today) {
  if (!Array.isArray(tasks)) throw new TypeError('Tasks array required');
  parseDate(today);
  if (!filters || typeof filters !== 'object') throw new TypeError('Filters required');
  const { project_id, q, status, priority, assignee_id, overdue } = filters;
  if (!Number.isInteger(project_id) || project_id <= 0) throw new TypeError('project_id positive int required');

  if (status !== undefined) {
    if (status === null || status === false || status === 0 || status === '' || !['todo', 'doing', 'done'].includes(status)) {
      throw new TypeError('status invalid');
    }
  }
  if (priority !== undefined) {
    if (priority === null || priority === false || priority === 0 || priority === '' || !['low', 'medium', 'high'].includes(priority)) {
      throw new TypeError('priority invalid');
    }
  }
  if (assignee_id !== undefined && assignee_id !== null && (!Number.isInteger(assignee_id) || assignee_id <= 0)) {
    throw new TypeError('assignee_id invalid');
  }
  if (q !== undefined && typeof q !== 'string') throw new TypeError('q string required');
  if (overdue !== undefined && typeof overdue !== 'boolean') throw new TypeError('overdue boolean required');

  const page = filters.page;
  const page_size = filters.page_size;
  if (page !== null && page !== undefined && (!Number.isInteger(page) || page < 1)) throw new RangeError('page >= 1');
  if (page === null) throw new TypeError('page cannot be null');
  if (page_size !== null && page_size !== undefined && (!Number.isInteger(page_size) || page_size < 1 || page_size > 100)) throw new RangeError('page_size 1..100');
  if (page_size === null) throw new TypeError('page_size cannot be null');

  const actualPage = page ?? 1;
  const actualPageSize = page_size ?? 20;
  const todayNum = dateToNum(today);

  let list = tasks.filter(t => {
    if (t.project_id !== project_id) return false;
    if (t.archived_at != null) return false;
    if (t.due_date !== undefined && t.due_date !== null && t.due_date !== '') parseDate(t.due_date);
    return true;
  });

  if (status !== undefined) list = list.filter(t => t.status === status);
  if (priority !== undefined) list = list.filter(t => t.priority === priority);
  if (assignee_id !== undefined) list = list.filter(t => t.assignee_id === assignee_id);
  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    list = list.filter(t => (t.title && t.title.toLowerCase().includes(term)) || (t.description && t.description.toLowerCase().includes(term)));
  }
  if (overdue === true) {
    list = list.filter(t => {
      if (!t.due_date) return false;
      return t.status !== 'done' && dateToNum(t.due_date) < todayNum;
    });
  } else if (overdue === false) {
    list = list.filter(t => {
      if (!t.due_date) return true;
      return t.status === 'done' || dateToNum(t.due_date) >= todayNum;
    });
  }

  list.sort((a, b) => b.id - a.id);
  const total = list.length;
  const start = (actualPage - 1) * actualPageSize;
  const items = list.slice(start, start + actualPageSize).map(t => ({ ...t }));
  return { items, page: actualPage, page_size: actualPageSize, total };
}

export function getTaskStats(tasks, projectId, today) {
  if (!Array.isArray(tasks)) throw new TypeError('Tasks array required');
  if (!Number.isInteger(projectId) || projectId <= 0) throw new TypeError('projectId required');
  parseDate(today);
  const todayNum = dateToNum(today);
  const list = tasks.filter(t => {
    if (t.project_id !== projectId) return false;
    if (t.archived_at != null) return false;
    if (t.due_date !== undefined && t.due_date !== null && t.due_date !== '') parseDate(t.due_date);
    return true;
  });
  let stats = { total: list.length, todo: 0, doing: 0, done: 0, overdue: 0 };
  for (const t of list) {
    if (t.status === 'todo') stats.todo++;
    else if (t.status === 'doing') stats.doing++;
    else if (t.status === 'done') stats.done++;
    if (t.due_date && t.status !== 'done' && dateToNum(t.due_date) < todayNum) {
      stats.overdue++;
    }
  }
  return stats;
}
