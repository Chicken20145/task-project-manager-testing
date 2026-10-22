function escapeHtml(str) {
  return str == null ? '' : String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function renderArchivedProjects(model, translator, helpers = {}) {
  const busy = Boolean(model?.busy || model?.projects?.busy);
  const dis = busy ? ' disabled' : '';
  const q = model?.filters?.q || '';
  const items = model?.projects?.items || [];
  const t = (k, f) => translator?.text ? translator.text(k, f) : f;

  const rows = items.length === 0
    ? `<tr><td colspan="3">${escapeHtml(t('archive.empty', 'Không tìm thấy dự án lưu trữ nào.'))}</td></tr>`
    : items.map(item => {
        const canMutate = item?.role === 'owner' && Boolean(item?.archived_at);
        const name = escapeHtml(item?.name);
        const id = escapeHtml(item?.id);
        const ver = escapeHtml(item?.version);
        const dt = escapeHtml(helpers?.formatDate ? helpers.formatDate(item?.archived_at) : item?.archived_at);

        const actions = canMutate
          ? `<div class="actions">
               <button type="button" class="button secondary" data-action="restore-project" data-id="${id}" data-version="${ver}"${dis}>${escapeHtml(t('actions.restore', 'Khôi phục'))}</button>
               <button type="button" data-action="delete-project" data-id="${id}" data-version="${ver}" class="button danger"${dis}>${escapeHtml(t('actions.delete', 'Xóa'))}</button>
             </div>`
          : '';

        return `<tr>
          <td data-label="${escapeHtml(t('archive.columns.name', 'Tên dự án'))}"><a href="#/projects/${id}">${name}</a></td>
          <td data-label="${escapeHtml(t('archive.columns.archived_at', 'Lưu trữ lúc'))}">${dt}</td>
          <td data-label="${escapeHtml(t('archive.columns.actions', 'Thao tác'))}">${actions}</td>
        </tr>`;
      }).join('');

  const pagination = helpers?.renderPagination ? helpers.renderPagination(model?.projects) : '';

  return `<div class="archive-view">
    <h1 tabindex="-1">${escapeHtml(t('archive.title', 'Lưu trữ dự án'))}</h1>
    <p class="section-hint">${escapeHtml(t('archive.hint', 'Chỉ hiển thị các dự án đã lưu trữ do bạn làm chủ.'))}</p>
    <form data-form="filters" novalidate class="form-row">
      <div class="field">
        <label for="archive-search">${escapeHtml(t('archive.search_label', 'Tìm kiếm dự án'))}</label>
        <input type="search" id="archive-search" name="q" value="${escapeHtml(q)}"${dis} />
        <button class="button secondary" type="submit"${dis}>${escapeHtml(t('actions.search', 'Tìm'))}</button>
      </div>
      <button type="button" class="button subtle" data-action="retry"${dis}>${escapeHtml(t('actions.retry', 'Làm mới'))}</button>
    </form>
    <div class="table-wrap">
      <table class="project-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('archive.columns.name', 'Tên dự án'))}</th>
            <th>${escapeHtml(t('archive.columns.archived_at', 'Lưu trữ lúc'))}</th>
            <th>${escapeHtml(t('archive.columns.actions', 'Thao tác'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${pagination}
  </div>`;
}
