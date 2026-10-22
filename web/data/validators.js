const cp = s => [...s].length;
function isValidCalendarDate(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [0,31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo];
}
export function validateTaskDraft(input) {
  const errs = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: { _global: 'Dữ liệu không hợp lệ' }, value: null };
  let title = input.title;
  if (typeof title !== 'string' || cp(title = title.trim()) < 1 || cp(title) > 120) errs.title = 'Tiêu đề không hợp lệ';
  let desc = input.description;
  if (desc === undefined) desc = '';
  else if (typeof desc !== 'string' || cp(desc) > 2000) errs.description = 'Mô tả không hợp lệ';
  let aid = input.assignee_id;
  if (aid === undefined || aid === null) aid = null;
  else if (!Number.isInteger(aid) || aid <= 0) errs.assignee_id = 'ID không hợp lệ';
  let dd = input.due_date;
  if (dd === undefined || dd === null || dd === '') dd = null;
  else if (!isValidCalendarDate(dd)) errs.due_date = 'Ngày không hợp lệ';
  let pri = input.priority;
  if (pri === undefined) pri = 'medium';
  else if (!['low', 'medium', 'high'].includes(pri)) errs.priority = 'Ưu tiên không hợp lệ';
  let st = input.status;
  if (st === undefined) st = 'todo';
  else if (!['todo', 'doing', 'done'].includes(st)) errs.status = 'Trạng thái không hợp lệ';
  if (Object.keys(errs).length) return { valid: false, errors: errs, value: null };
  return { valid: true, errors: {}, value: { title, description: desc, assignee_id: aid, due_date: dd, priority: pri, status: st } };
}
export function validateProjectDraft(input) {
  const errs = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: { _global: 'Dữ liệu không hợp lệ' }, value: null };
  let name = input.name;
  if (typeof name !== 'string' || cp(name = name.trim()) < 1 || cp(name) > 100) errs.name = 'Tên không hợp lệ';
  let desc = input.description;
  if (desc === undefined) desc = '';
  else if (typeof desc !== 'string' || cp(desc) > 2000) errs.description = 'Mô tả không hợp lệ';
  if (Object.keys(errs).length) return { valid: false, errors: errs, value: null };
  return { valid: true, errors: {}, value: { name, description: desc } };
}
export function isOverdue(task, today) {
  if (!isValidCalendarDate(today)) throw new RangeError('Bad today');
  if (!task || typeof task !== 'object') return false;
  if (task.due_date !== undefined && task.due_date !== null && task.due_date !== '') {
    if (!isValidCalendarDate(task.due_date)) throw new RangeError('Bad due_date');
  }
  if ((task.archived_at !== undefined && task.archived_at !== null) || task.status === 'done') return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}
