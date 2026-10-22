import { timezoneLabel } from './timezone-label.js';
function esc(val) {
  if (val == null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr, locale = 'vi-VN') {
  if (!dateStr || typeof dateStr !== 'string') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}/${dateStr.slice(0, 4)}` : dateStr;
}

function formatDateTime(dateTimeStr, locale = 'vi-VN', timezone = 'Asia/Ho_Chi_Minh') {
  if (!dateTimeStr || typeof dateTimeStr !== 'string') return '';
  try {
    const d = new Date(dateTimeStr);
    if (Number.isNaN(d.getTime())) return dateTimeStr;
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  } catch {
    return dateTimeStr;
  }
}

function buildUrl({ month, date, day_page, page }) {
  const sp = new URLSearchParams();
  if (month) sp.set('month', month);
  if (date) sp.set('date', date);
  if (day_page && Number(day_page) > 1) sp.set('day_page', String(day_page));
  if (page && Number(page) > 1) sp.set('page', String(page));
  const q = sp.toString();
  return q ? `#/notifications?${q}` : '#/notifications';
}

export function renderNotifications(model = {}, translator = { text: s => s || '', html: (s, ...v) => s.join('') }) {
  const language = model?.language === 'en' ? 'en' : 'vi';
  const locale = language === 'en' ? 'en-GB' : 'vi-VN';
  const timezone = model.timezone || 'Asia/Ho_Chi_Minh';
  const deadline = task => task.due_at ? formatDateTime(task.due_at, locale, timezone) : formatDate(task.due_date, locale);
  const cal = model?.calendar || {};
  const notifs = model?.notifications || {};

  const currentMonth = cal.month || '';
  const currentDate = cal.selected_date || '';
  const today = cal.today || '';
  const startWeekday = Number(cal.start_weekday) || 0;
  const days = Array.isArray(cal.days) ? cal.days : [];

  const dayPage = Number(cal.tasks?.page) || 1;
  const daySize = Number(cal.tasks?.size || cal.tasks?.page_size) || 20;
  const dayTotal = Number(cal.tasks?.total) || 0;
  const maxDayPage = Math.max(1, Math.ceil(dayTotal / daySize));
  const taskItems = Array.isArray(cal.tasks?.items) ? cal.tasks.items : [];

  const feedPage = Number(notifs.page) || 1;
  const feedSize = Number(notifs.size || notifs.page_size) || 20;
  const feedTotal = Number(notifs.total) || 0;
  const maxFeedPage = Math.max(1, Math.ceil(feedTotal / feedSize));
  const feedItems = Array.isArray(notifs.items) ? notifs.items : [];

  // Month navigation
  const prevMonthUrl = cal.previous_month ? buildUrl({ month: cal.previous_month, date: `${cal.previous_month}-01`, page: feedPage }) : null;
  const nextMonthUrl = cal.next_month ? buildUrl({ month: cal.next_month, date: `${cal.next_month}-01`, page: feedPage }) : null;
  const todayUrl = today ? buildUrl({ month: today.slice(0, 7), date: today, page: feedPage }) : null;

  const weekdays = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

  let calendarCellsHtml = '';
  for (let i = 0; i < startWeekday; i++) {
    calendarCellsHtml += '<div class="calendar-cell calendar-cell-empty" aria-hidden="true"></div>';
  }
  for (const d of days) {
    const isSelected = (d.date === currentDate);
    const isToday = (d.date === today);
    const dateUrl = buildUrl({ month: currentMonth, date: d.date, page: feedPage });
    const ariaCurr = isSelected ? ' aria-current="date"' : '';
    const titleAttr = isToday ? ` title="${esc(translator.text('Hôm nay'))}"` : '';
    const cls = `calendar-date-link${isSelected ? ' calendar-date-selected' : ''}${isToday ? ' calendar-date-today' : ''}`;
    let countsHtml = '';
    if (d.total > 0) {
      countsHtml = `<span class="calendar-counts" aria-label="${esc(d.total)} ${translator.text('việc')}, ${esc(d.done)} ${translator.text('hoàn thành')}, ${esc(d.overdue)} ${translator.text('quá hạn')}">` +
        `<span class="calendar-count-total">${esc(d.total)}</span>` +
        `<span class="calendar-count-done">${esc(d.done)}</span>` +
        `<span class="calendar-count-overdue">${esc(d.overdue)}</span></span>`;
    }
    calendarCellsHtml += `<div class="calendar-cell"><a class="${cls}" href="${esc(dateUrl)}" aria-label="${esc(formatDate(d.date))}, ${esc(d.total)} ${esc(translator.text('việc'))}, ${esc(d.done)} ${esc(translator.text('hoàn thành'))}, ${esc(d.overdue)} ${esc(translator.text('quá hạn'))}${isToday ? ', ' + esc(translator.text('Hôm nay')) : ''}"${ariaCurr}${titleAttr}>` +
      `<span class="calendar-day-num">${esc(d.day)}</span>` +
      (isToday ? `<span class="calendar-today-badge">${translator.text('Hôm nay')}</span>` : '') +
      countsHtml + '</a></div>';
  }

  // Selected date tasks
  let tasksHtml = '';
  if (taskItems.length === 0) {
    tasksHtml = `<p class="calendar-tasks-empty">${translator.text('Không có công việc nào trong ngày này.')}</p>`;
  } else {
    tasksHtml = '<ul class="calendar-task-list">';
    for (const t of taskItems) {
      const isDone = (t.status === 'done' || t.status === 'Hoàn thành');
      const isOverdue = Boolean(t.overdue || t.is_overdue || t.status === 'overdue' || (!isDone && today && t.due_date && t.due_date < today));
      let statusBadge = '';
      if (isDone) {
        statusBadge = `<span class="calendar-task-status calendar-status-done">${translator.text('Hoàn thành')}</span>`;
      } else if (isOverdue) {
        statusBadge = `<span class="calendar-task-status calendar-status-overdue">${translator.text('Quá hạn')}</span>`;
      } else {
        statusBadge = `<span class="calendar-task-status">${esc(translator.text({ todo: 'Chưa làm', doing: 'Đang làm' }[t.status] || 'Chưa làm'))}</span>`;
      }
      tasksHtml += `<li class="calendar-task-item">` +
        `<a class="calendar-task-title" href="#/tasks/${esc(t.id)}">${esc(t.title)}</a>` +
        (t.project_name ? ` <span class="calendar-task-project">${esc(t.project_name)}</span>` : '') +
        ` <span class="muted">${esc(deadline(t))}</span> ${statusBadge}</li>`;
    }
    tasksHtml += '</ul>';
  }

  // Day pagination
  const prevDayUrl = dayPage > 1 ? buildUrl({ month: currentMonth, date: currentDate, day_page: dayPage - 1, page: feedPage }) : null;
  const nextDayUrl = dayPage < maxDayPage ? buildUrl({ month: currentMonth, date: currentDate, day_page: dayPage + 1, page: feedPage }) : null;
  const dayPaginationHtml = `<div class="calendar-pagination">` +
    (prevDayUrl ? `<a class="calendar-page-prev" href="${esc(prevDayUrl)}">${translator.text('Trước')}</a>` : `<button type="button" disabled class="calendar-btn-disabled">${translator.text('Trước')}</button>`) +
    ` <span class="calendar-page-info">${translator.text('Trang')} ${dayPage}/${maxDayPage}</span> ` +
    (nextDayUrl ? `<a class="calendar-page-next" href="${esc(nextDayUrl)}">${translator.text('Tiếp')}</a>` : `<button type="button" disabled class="calendar-btn-disabled">${translator.text('Tiếp')}</button>`) +
    `</div>`;

  // Feed items
  let feedItemsHtml = '';
  if (feedItems.length === 0) {
    feedItemsHtml = `<p class="notifications-empty">${translator.text('Chưa có thông báo.')}</p>`;
  } else {
    feedItemsHtml = '<ul class="notifications-list">';
    for (const item of feedItems) {
      if (item.kind === 'assigned') {
        feedItemsHtml += `<li class="notifications-item notifications-item-assigned">` +
          `<strong class="notifications-actor">${esc(item.actor_name)}</strong> ${translator.text('đã giao việc')} ` +
          `<a class="notifications-task-link" href="#/tasks/${esc(item.task_id)}">${esc(item.title)}</a>` +
          (item.project_name ? ` <span class="notifications-project">(${esc(item.project_name)})</span>` : '') +
          ` <time datetime="${esc(item.created_at)}">${esc(formatDateTime(item.created_at, locale, timezone))}</time>` +
          ((item.due_at || item.due_date) ? ` · <span class="notifications-due">${translator.text('Hạn')}: ${esc(deadline(item))}</span>` : '') +
          `</li>`;
      } else if (item.kind === 'completed') {
        feedItemsHtml += `<li class="notifications-item notifications-item-completed">` +
          `<strong class="notifications-actor">${esc(item.actor_name)}</strong> ${translator.text('đã hoàn thành việc')} ` +
          `<a class="notifications-task-link" href="#/tasks/${esc(item.task_id)}">${esc(item.title)}</a>` +
          (item.project_name ? ` <span class="notifications-project">(${esc(item.project_name)})</span>` : '') +
          ` <time datetime="${esc(item.created_at)}">${esc(formatDateTime(item.created_at, locale, timezone))}</time>` +
          ((item.due_at || item.due_date) ? ` · <span class="notifications-due">${translator.text('Hạn')}: ${esc(deadline(item))}</span>` : '') +
          `</li>`;
      } else if (item.kind === 'daily') {
        const dTasks = Array.isArray(item.tasks) ? item.tasks : [];
        let dTasksHtml = '';
        if (dTasks.length === 0) {
          dTasksHtml = `<p class="notifications-daily-empty">${translator.text('Không có việc đến hạn hoặc quá hạn cần nhắc.')}</p>`;
        } else {
          dTasksHtml = `<details class="notifications-daily-details">` +
            `<summary class="notifications-daily-summary">${translator.text('Danh sách việc')} (${dTasks.length})</summary>` +
            `<ul class="notifications-daily-tasks">`;
          for (const dt of dTasks) {
            const dl = Number(dt.days_left);
            let badge = '';
            if (dl === 0) {
              badge = `<span class="notifications-days-today">${translator.text('Đến hạn hôm nay')}</span>`;
            } else if (dl < 0) {
              badge = `<span class="notifications-days-overdue">${translator.text('Quá hạn')} ${Math.abs(dl)} ${translator.text('ngày')}</span>`;
            } else {
              badge = `<span class="notifications-days-left">${translator.text('Còn')} ${dl} ${translator.text('ngày')}</span>`;
            }
            dTasksHtml += `<li><a class="notifications-task-link" href="#/tasks/${esc(dt.id)}">${esc(dt.title)}</a>` +
              (dt.project_name ? ` <span class="notifications-project">(${esc(dt.project_name)})</span>` : '') +
              ` · <span class="notifications-due">${esc(deadline(dt))}</span> ${badge}</li>`;
          }
          dTasksHtml += `</ul></details>`;
        }
        feedItemsHtml += `<li class="notifications-item notifications-item-daily">` +
          `<div class="notifications-daily-header">` +
          `<strong class="notifications-daily-title">${translator.text('Báo cáo nhắc hạn')}</strong>` +
          ` <span class="notifications-daily-date">${esc(formatDate(item.report_date, locale))} · ${esc(timezoneLabel(item.timezone || timezone, language, new Date(item.created_at)))}</span>` +
          `</div>${dTasksHtml}</li>`;
      }
    }
    feedItemsHtml += '</ul>';
  }

  // Feed pagination
  const prevFeedUrl = feedPage > 1 ? buildUrl({ month: currentMonth, date: currentDate, day_page: dayPage, page: feedPage - 1 }) : null;
  const nextFeedUrl = feedPage < maxFeedPage ? buildUrl({ month: currentMonth, date: currentDate, day_page: dayPage, page: feedPage + 1 }) : null;
  const feedPaginationHtml = `<div class="notifications-pagination">` +
    (prevFeedUrl ? `<a class="notifications-page-prev" href="${esc(prevFeedUrl)}">${translator.text('Trước')}</a>` : `<button type="button" disabled class="notifications-btn-disabled">${translator.text('Trước')}</button>`) +
    ` <span class="notifications-page-info">${translator.text('Trang')} ${feedPage}/${maxFeedPage}</span> ` +
    (nextFeedUrl ? `<a class="notifications-page-next" href="${esc(nextFeedUrl)}">${translator.text('Tiếp')}</a>` : `<button type="button" disabled class="notifications-btn-disabled">${translator.text('Tiếp')}</button>`) +
    `</div>`;

  return `<div class="notifications-page">` +
    `<header class="notifications-header">` +
    `<h1 tabindex="-1">${translator.text('Thông báo')}</h1>` +
    `<p class="notifications-intro">${translator.text('Theo dõi lịch hạn công việc và hoạt động mới nhất.')}</p>` +
    `</header>` +
    `<div class="notifications-layout">` +
    `<section class="calendar-panel" aria-label="${esc(translator.text('Lịch deadline'))}">` +
    `<div class="calendar-header">` +
    `<h2>${translator.text('Lịch deadline')}</h2>` +
    `<div class="calendar-month-controls">` +
    (prevMonthUrl ? `<a class="calendar-month-prev" href="${esc(prevMonthUrl)}">${translator.text('Tháng trước')}</a>` : `<button type="button" disabled class="calendar-btn-disabled">${translator.text('Tháng trước')}</button>`) +
    ` <span class="calendar-month-heading">${esc(currentMonth)}</span> ` +
    (nextMonthUrl ? `<a class="calendar-month-next" href="${esc(nextMonthUrl)}">${translator.text('Tháng sau')}</a>` : `<button type="button" disabled class="calendar-btn-disabled">${translator.text('Tháng sau')}</button>`) +
    (todayUrl ? ` · <a class="calendar-today-link" href="${esc(todayUrl)}">${translator.text('Hôm nay')}</a>` : '') +
    `</div></div>` +
    `<div class="calendar-weekdays" aria-hidden="true">` +
    weekdays.map(w => `<div class="calendar-weekday">${translator.text(w)}</div>`).join('') +
    `</div>` +
    `<div class="calendar-grid">${calendarCellsHtml}</div>` +
    `<div class="calendar-legend" aria-label="${esc(translator.text('Chú thích'))}">` +
    `<span>${translator.text('Tổng số')}</span> · ` +
    `<span class="calendar-legend-done">${translator.text('Hoàn thành')}</span> · ` +
    `<span class="calendar-legend-overdue">${translator.text('Quá hạn')}</span>` +
    `</div>` +
    `<div class="calendar-day-tasks">` +
    `<h3>${translator.text('Công việc ngày')} ${esc(formatDate(currentDate, locale))}</h3>` +
    tasksHtml + dayPaginationHtml +
    `</div></section>` +
    `<section class="notifications-feed-panel" aria-label="${esc(translator.text('Hoạt động gần đây'))}">` +
    `<div class="notifications-feed-header">` +
    `<h2>${translator.text('Hoạt động gần đây')}</h2>` +
    `<button type="button" class="notifications-refresh-btn" data-action="refresh-notifications">${translator.text('Làm mới')}</button>` +
    `</div>` +
    feedItemsHtml + feedPaginationHtml +
    `</section></div></div>`;
}
