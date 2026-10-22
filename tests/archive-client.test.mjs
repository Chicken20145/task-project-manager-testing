import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../web/data/http.js';

test('archive client encodes search and sends CSRF/version with restore and permanent delete', async () => {
  const calls = [];
  const client = createHttpClient({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (url === '/api/auth/login') return new Response(JSON.stringify({ csrf_token: 'test-csrf', user: { id: 1 } }));
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('{}');
  } });
  await client.login({ username: 'owner', password: 'demo123' });
  await client.listArchivedProjects({ q: 'A & B', page: 2 });
  assert.equal(calls[1].url, '/api/projects/archived?q=A+%26+B&page=2');
  await client.restoreProject(10, { version: 3 });
  await client.deleteProject(10, { version: 4 });
  assert.equal(calls[2].url, '/api/projects/10/restore');
  assert.equal(calls[2].method, 'POST');
  assert.equal(calls[3].url, '/api/projects/10');
  assert.equal(calls[3].method, 'DELETE');
  for (const call of calls.slice(2)) {
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.headers['X-CSRF-Token'], 'test-csrf');
  }
  assert.deepEqual(JSON.parse(calls[3].body), { version: 4 });
  const count = calls.length;
  await assert.rejects(client.deleteProject('../10', { version: 4 }));
  assert.equal(calls.length, count);
});
