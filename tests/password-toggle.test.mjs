import test from 'node:test';
import assert from 'node:assert';
import { renderPasswordToggle } from '../web/password-toggle.js';

test('renderPasswordToggle returns Vietnamese toggle by default', () => {
  const html = renderPasswordToggle('password123');
  assert.match(html, /type="button"/);
  assert.match(html, /class="password-toggle"/);
  assert.match(html, /data-action="toggle-password"/);
  assert.match(html, /data-target="password123"/);
  assert.match(html, /aria-controls="password123"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="Hiện mật khẩu"/);
  assert.match(html, />Hiện<\/button>/);
  assert.match(html, /data-show-text="Hiện"/);
  assert.match(html, /data-hide-text="Ẩn"/);
  assert.match(html, /data-show-label="Hiện mật khẩu"/);
  assert.match(html, /data-hide-label="Ẩn mật khẩu"/);
});

test('renderPasswordToggle supports English language', () => {
  const html = renderPasswordToggle('pwd', { language: 'en' });
  assert.match(html, /aria-label="Show password"/);
  assert.match(html, />Show<\/button>/);
  assert.match(html, /data-show-text="Show"/);
  assert.match(html, /data-hide-text="Hide"/);
  assert.match(html, /data-show-label="Show password"/);
  assert.match(html, /data-hide-label="Hide password"/);
});

test('renderPasswordToggle falls back to Vietnamese for unknown language', () => {
  const html = renderPasswordToggle('pwd', { language: 'fr' });
  assert.match(html, /aria-label="Hiện mật khẩu"/);
  assert.match(html, />Hiện<\/button>/);
});

test('renderPasswordToggle escapes malicious id', () => {
  const maliciousId = '"><script>alert(1)</script>';
  const html = renderPasswordToggle(maliciousId);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-target="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});

test('renderPasswordToggle supports disabled state', () => {
  const html = renderPasswordToggle('pwd', { disabled: true });
  assert.match(html, /disabled/);
});
