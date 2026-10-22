import test from 'node:test';
import assert from 'node:assert';
import { renderArchivedProjects } from '../web/archive-view.js';

const tr = { text: (_, f) => f, html: (_, f) => f };
const enTr = { text: (k, f) => ({ 'archive.title': 'Archived', 'archive.hint': 'Only archived', 'actions.search': 'Search' }[k] || f), html: (_, f) => f };

test('renderArchivedProjects renders base structure, labels and search', () => {
  const html = renderArchivedProjects({ filters: { q: '' }, projects: { items: [], page: 1, page_size: 10, total: 0 } }, tr);
  assert.ok(html.includes('Lưu trữ dự án'));
  assert.ok(html.includes('tabindex="-1"'));
  assert.ok(html.includes('data-form="filters"'));
  assert.ok(html.includes('id="archive-search"'));
  assert.ok(html.includes('for="archive-search"'));
  assert.ok(html.includes('data-action="retry"'));
  assert.ok(html.includes('table-wrap'));
});

test('renderArchivedProjects renders owner archived rows with actions', () => {
  const model = {
    filters: { q: 'test' },
    projects: { items: [{ id: 'p1', name: 'Alpha', archived_at: '2026-10-01', version: 3, role: 'owner' }], page: 1, page_size: 10, total: 1 }
  };
  const html = renderArchivedProjects(model, tr, { formatDate: (d) => `Date: ${d}` });
  assert.ok(html.includes('value="test"'));
  assert.ok(html.includes('href="#/projects/p1"'));
  assert.ok(html.includes('Date: 2026-10-01'));
  assert.ok(html.includes('data-action="restore-project"'));
  assert.ok(html.includes('data-id="p1"'));
  assert.ok(html.includes('data-version="3"'));
  assert.ok(html.includes('data-action="delete-project"'));
  assert.ok(html.includes('danger'));
});

test('renderArchivedProjects suppresses mutations for active owner or non-owner', () => {
  const model = {
    filters: { q: '' },
    projects: { items: [
      { id: 'p1', name: 'Active', archived_at: null, version: 1, role: 'owner' },
      { id: 'p2', name: 'Member', archived_at: '2026-10-02', version: 1, role: 'member' }
    ], page: 1, page_size: 10, total: 2 }
  };
  const html = renderArchivedProjects(model, tr);
  assert.ok(!html.includes('data-action="restore-project"'));
  assert.ok(!html.includes('data-action="delete-project"'));
});

test('renderArchivedProjects escapes formatDate and search against XSS', () => {
  const model = {
    filters: { q: '<script>alert(1)</script>' },
    projects: { items: [{ id: 'p1', name: 'Alpha', archived_at: '2026-10-01', version: 1, role: 'owner' }], page: 1, page_size: 10, total: 1 }
  };
  const html = renderArchivedProjects(model, tr, { formatDate: () => '<script>xss</script>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderArchivedProjects supports English translator and busy state / pagination', () => {
  const model = { busy: true, filters: { q: '' }, projects: { items: [], page: 1, page_size: 10, total: 0 } };
  const html = renderArchivedProjects(model, enTr, { renderPagination: () => '<div class="pag">Pag</div>' });
  assert.ok(html.includes('Archived'));
  assert.ok(html.includes('disabled'));
  assert.ok(html.includes('pag'));
});
