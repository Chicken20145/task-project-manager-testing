import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../web/views.js';

const mockUser = { id: 1, username: 'alice', display_name: 'Alice Wonder' };
const mockMetadata = { edition: 'testing', build_id: 'build-20261021', ai_enabled: false };

test('no demo credentials or build banner across auth, projects, and settings', () => {
  const loginHtml = renderApp({ type: 'login', metadata: mockMetadata });
  assert.doesNotMatch(loginHtml, /Tài khoản demo:|demo123|nguyen\.van\.a/);
  assert.doesNotMatch(loginHtml, /Bản kiểm thử|build-20261021/);
  assert.match(loginHtml, /class="brand auth-brand"/);
  assert.match(loginHtml, /class="auth-intro"/);

  const regHtml = renderApp({ type: 'register', metadata: mockMetadata });
  assert.doesNotMatch(regHtml, /Bản kiểm thử|build-20261021/);
  assert.match(regHtml, /class="brand auth-brand"/);
  assert.match(regHtml, /class="auth-intro"/);

  const projHtml = renderApp({ type: 'projects', user: mockUser, projects: { items: [] }, metadata: mockMetadata });
  assert.doesNotMatch(projHtml, /Bản kiểm thử|build-20261021/);

  const settingsHtml = renderApp({ type: 'settings', user: mockUser, metadata: mockMetadata });
  assert.doesNotMatch(settingsHtml, /Bản kiểm thử|build-20261021/);
});

test('language selector: absent from signed-in shell, present once in settings, retained for guests', () => {
  const guestLogin = renderApp({ type: 'login', language: 'vi' });
  assert.match(guestLogin, /id="auth-lang"/);
  assert.match(guestLogin, /data-action="language"/);

  const guestReg = renderApp({ type: 'register', language: 'vi' });
  assert.match(guestReg, /id="auth-lang"/);
  assert.match(guestReg, /data-action="language"/);

  const shellProjects = renderApp({ type: 'projects', user: mockUser, projects: { items: [] } });
  assert.doesNotMatch(shellProjects, /id="header-lang"/);
  assert.doesNotMatch(shellProjects, /data-action="language"/);

  const settingsHtml = renderApp({ type: 'settings', user: mockUser, language: 'vi' });
  const langMatches = settingsHtml.match(/data-action="language"/g) || [];
  assert.equal(langMatches.length, 1, 'Exactly one language picker on settings');
  assert.match(settingsHtml, /id="settings-language"[^>]*data-action="language"/);
  assert.doesNotMatch(settingsHtml, /<form[^>]*>[^<]*id="settings-language"/);
  assert.match(settingsHtml, /Lựa chọn ngôn ngữ được lưu tự động trên trình duyệt này/);
  assert.doesNotMatch(settingsHtml, /<button[^>]*>[^<]*(Lưu ngôn ngữ|Save language)/i);
});

test('settings page layout: intro, 4 flat sections with headings and localized hints in VI and EN', () => {
  const vi = renderApp({ type: 'settings', user: mockUser, language: 'vi' });
  assert.match(vi, /class="[^"]*\bsettings-page\b[^"]*"/);
  assert.match(vi, /class="[^"]*\bsettings-intro\b[^"]*"[^>]*>[^<]*<h1[^>]*>Cài đặt tài khoản<\/h1>/);

  const viSections = vi.match(/<section[^>]*class="[^"]*\bsettings-section(?!\w|-)[^"]*"/g) || [];
  assert.equal(viSections.length, 4, 'Profile, language, timezone and password are separate sections');
  assert.match(vi, /<h2[^>]*>Hồ sơ<\/h2>/);
  assert.match(vi, /<h2[^>]*>Ngôn ngữ<\/h2>/);
  assert.match(vi, /<h2[^>]*>Mật khẩu<\/h2>/);
  assert.match(vi, /class="[^"]*\bsettings-password-row\b[^"]*"/);
  assert.match(vi, /Yêu cầu nhập mật khẩu hiện tại/);
  assert.match(vi, /đăng xuất khỏi tất cả phiên làm việc/);

  const en = renderApp({ type: 'settings', user: mockUser, language: 'en' });
  assert.match(en, /class="[^"]*\bsettings-intro\b[^"]*"[^>]*>[^<]*<h1[^>]*>Account settings<\/h1>/);
  assert.match(en, /<h2[^>]*>Profile<\/h2>/);
  assert.match(en, /<h2[^>]*>Language<\/h2>/);
  assert.match(en, /<h2[^>]*>Password<\/h2>/);
  assert.match(en, /Language choice is saved automatically on this browser/);
  assert.match(en, /Current password is required/);
  assert.match(en, /sign out all sessions/);
});

test('notifications navigation sits between projects/settings and only its entry is active', () => {
  const html = renderApp({ type: 'notifications', user: mockUser, language: 'en' });
  const sidebar = html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)?.[1] || '';
  assert.match(sidebar, /href="#\/projects"[\s\S]*href="#\/notifications"[\s\S]*href="#\/settings"/);
  assert.match(sidebar, /href="#\/notifications"[^>]*aria-current="page"/);
  assert.equal((sidebar.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /Deadline calendar/);
  const header = html.match(/<header class="app-header">([\s\S]*?)<\/header>/)?.[1] || '';
  assert.doesNotMatch(header, /href="#\/notifications"/);
});

test('timezone settings use saved preference and timestamp formatting leaves deadlines unchanged', () => {
  const settings = renderApp({ type: 'settings', user: mockUser, language: 'vi', timezone: 'UTC',
    preferences: { timezone: 'UTC', timezones: ['Asia/Ho_Chi_Minh', 'UTC'] } });
  assert.match(settings, /data-form="timezone"[^>]*novalidate/);
  assert.match(settings, /id="settings-timezone"[^>]*name="timezone"/);
  assert.match(settings, /value="UTC" selected/);
  assert.match(settings, /Lưu múi giờ/);
  const task = { type: 'task', language: 'vi', user: mockUser, project: { id: 1 },
    task: { id: 1, title: 'Deadline', due_date: '2026-10-16', updated_at: '2026-10-15T18:00:00Z' } };
  const tokyo = renderApp({ ...task, timezone: 'Asia/Tokyo' });
  const utc = renderApp({ ...task, timezone: 'UTC' });
  assert.match(tokyo, /03:00/);
  assert.match(utc, /18:00/);
  assert.match(tokyo, /16\/10\/2026/);
  assert.match(utc, /16\/10\/2026/);
});

test('profile and password form safety: identifiers, readonly, autocomplete, errors, busy, and no secrets', () => {
  const model = {
    type: 'settings', user: mockUser, language: 'vi', busy: true,
    draft: {
      display_name: 'Alice In Chains',
      current_password: 'SuperSecretCurrent123',
      new_password: 'SuperSecretNew456',
      confirm_password: 'SuperSecretConfirm789'
    },
    errors: {
      display_name: 'Dữ liệu chưa hợp lệ.',
      current_password: 'Mật khẩu hiện tại chưa đúng.'
    }
  };
  const html = renderApp(model);

  assert.match(html, /data-form="profile"/);
  assert.match(html, /id="settings-username"[^>]*value="alice"[^>]*readonly/);
  assert.doesNotMatch(html, /name="username"/);
  assert.match(html, /id="settings-display-name"[^>]*name="display_name"/);
  assert.doesNotMatch(html, /name="display_name"[^>]*maxlength=/);
  assert.match(html, /aria-describedby="display_name-error"/);

  assert.match(html, /data-form="password"/);
  assert.match(html, /id="settings-current-password"[^>]*name="current_password"[^>]*autocomplete="current-password"/);
  assert.match(html, /id="settings-new-password"[^>]*name="new_password"[^>]*autocomplete="new-password"/);
  assert.match(html, /id="settings-confirm-password"[^>]*name="confirm_password"[^>]*autocomplete="new-password"/);
  assert.match(html, /aria-describedby="current_password-error"/);

  assert.doesNotMatch(html, /SuperSecretCurrent123/);
  assert.doesNotMatch(html, /SuperSecretNew456/);
  assert.doesNotMatch(html, /SuperSecretConfirm789/);

  assert.match(html, /<button[^>]*type="submit"[^>]*disabled[^>]*>Lưu tên hiển thị<\/button>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled[^>]*>Đổi mật khẩu<\/button>/);
});

test('active navigation state and single settings link below projects in sidebar across all types and languages', () => {
  // Guest has zero settings links
  for (const lang of ['vi', 'en']) {
    const guestLogin = renderApp({ type: 'login', language: lang });
    assert.equal((guestLogin.match(/href="#\/settings"/g) || []).length, 0);
    const guestReg = renderApp({ type: 'register', language: lang });
    assert.equal((guestReg.match(/href="#\/settings"/g) || []).length, 0);
  }

  // One navigation entry remains reachable in the sidebar, including its mobile layout.
  for (const lang of ['vi', 'en']) {
    for (const type of ['projects', 'project', 'task', 'settings']) {
      let model = { type, user: mockUser, language: lang };
      if (type === 'project') {
        model.project = { id: 10, name: 'P10' };
      } else if (type === 'task') {
        model.project = { id: 10, name: 'P10' };
        model.task = { id: 1, title: 'Task 1', status: 'todo' };
        model.comments = { items: [] };
        model.history = { items: [] };
      } else if (type === 'projects') {
        model.projects = { items: [] };
      }
      const html = renderApp(model);
      const settingsLinks = html.match(/href="#\/settings"/g) || [];
      assert.equal(settingsLinks.length, 1, `Exactly one settings link for type ${type} in ${lang}`);

      const sidebarMatch = html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)?.[1] || '';
      assert.match(sidebarMatch, /href="#\/projects"[\s\S]*href="#\/settings"/, `Settings follows projects for ${type} in ${lang}`);
      const header = html.match(/<header class="app-header">([\s\S]*?)<\/header>/)?.[1] || '';
      assert.doesNotMatch(header, /href="#\/settings"/);
    }
  }

  const projectsHtml = renderApp({ type: 'projects', user: mockUser, projects: { items: [] } });
  assert.doesNotMatch(projectsHtml, /KHÔNG GIAN/);
  assert.doesNotMatch(projectsHtml, /class="metadata"/);
  assert.match(projectsHtml, /<a href="#\/projects"[^>]*class="brand">/);
  assert.doesNotMatch(projectsHtml, /<a href="#\/projects"[^>]*class="[^"]*\bheader-link\b[^"]*"/);
  assert.match(projectsHtml, /<nav class="[^"]*\bsidebar-nav\b[^"]*"[^>]*aria-label=/);
  const navHtml = projectsHtml.match(/<nav class="[^"]*\bsidebar-nav\b[^"]*"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  assert.doesNotMatch(navHtml, /class="[^"]*\b(button|secondary|subtle)\b[^"]*"/);
  assert.match(projectsHtml, /<a href="#\/projects"[^>]*class="nav-link is-current"[^>]*aria-current="page"/);
  assert.doesNotMatch(projectsHtml, /<a href="#\/settings"[^>]*aria-current="page"/);
  assert.match(projectsHtml, /<a href="#\/settings"[^>]*class="nav-link"/);
  assert.match(projectsHtml, /<header[^>]*>[\s\S]*<button[^>]*class="[^"]*\bheader-link\b[^"]*"[^>]*data-action="logout"/);

  const taskHtml = renderApp({
    type: 'task', user: mockUser, project: { id: 10, name: 'P10' },
    task: { id: 1, title: 'Task 1', status: 'todo' }, comments: { items: [] }, history: { items: [] }
  });
  assert.match(taskHtml, /<a href="#\/projects"[^>]*class="nav-link is-current"[^>]*aria-current="page"/);
  assert.doesNotMatch(taskHtml, /<a href="#\/settings"[^>]*aria-current="page"/);

  const settingsHtml = renderApp({ type: 'settings', user: mockUser });
  assert.match(settingsHtml, /<a href="#\/projects"[^>]*class="nav-link"/);
  assert.doesNotMatch(settingsHtml, /<a href="#\/projects"[^>]*aria-current="page"/);
  assert.match(settingsHtml, /<a href="#\/settings"[^>]*class="nav-link is-current"[^>]*aria-current="page"/);
});

test('hostile user content remains safely escaped in shell and settings', () => {
  const evil = '<script>alert("xss")</script>" onfocus="alert(1)';
  const evilUser = { id: 66, username: evil, display_name: evil };
  const html = renderApp({ type: 'settings', user: evilUser, draft: { display_name: evil } });

  assert.ok(!html.includes('<script>alert'), 'No raw script tag in HTML');
  assert.ok(!html.includes('" onfocus="'), 'No unescaped quote attribute injection');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Username/display name escaped');
});
