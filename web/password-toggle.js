function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderPasswordToggle(id, { language = 'vi', disabled = false } = {}) {
  const lang = language === 'en' ? 'en' : 'vi';

  const texts = {
    vi: {
      show: 'Hiện',
      hide: 'Ẩn',
      showLabel: 'Hiện mật khẩu',
      hideLabel: 'Ẩn mật khẩu'
    },
    en: {
      show: 'Show',
      hide: 'Hide',
      showLabel: 'Show password',
      hideLabel: 'Hide password'
    }
  };

  const t = texts[lang];
  const escapedId = escapeHtml(id);
  const disabledAttr = disabled ? ' disabled' : '';

  return `<button type="button" class="password-toggle" data-action="toggle-password" data-target="${escapedId}" aria-controls="${escapedId}" aria-pressed="false" aria-label="${escapeHtml(t.showLabel)}" data-show-text="${escapeHtml(t.show)}" data-hide-text="${escapeHtml(t.hide)}" data-show-label="${escapeHtml(t.showLabel)}" data-hide-label="${escapeHtml(t.hideLabel)}"${disabledAttr}>${escapeHtml(t.show)}</button>`;
}
