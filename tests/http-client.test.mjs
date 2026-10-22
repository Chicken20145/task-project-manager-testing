import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, ApiError } from '../web/data/http.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const session = { user: { id: 1, username: 'owner', display_name: 'Owner' }, csrf_token: 'csrf-one' };

test('edition metadata is fetched without credentials in the body or changing CSRF state', async () => {
  let call;
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    call = { url, ...init };
    return json({ edition: 'testing', build_id: 'baseline-20261019', ai_enabled: false });
  } });
  assert.equal((await client.getMetadata()).edition, 'testing');
  assert.equal(call.url, '/api/meta');
  assert.equal(call.method, 'GET');
  assert.equal(call.body, undefined);
});

test('HTTP methods, body, credentials, CSRF, nullable filters and independent activity pages follow contract', async () => {
  const calls = [];
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    return url === '/api/auth/login' ? json(session) : init.method === 'DELETE' || url === '/api/auth/logout' ? new Response(null, { status: 204 }) : json({ items: [] });
  } });
  await client.login({ username: 'owner', password: 'password input' });
  await client.createProject({ name: 'Project' });
  await client.updateProject(10, { name: 'Edit', version: 1 });
  await client.archiveProject(10, { version: 2 });
  await client.addMember(10, 2);
  await client.removeMember(10, 2);
  await client.listTasks(10, { q: 'Việc %_&', assignee_id: null, overdue: false, page: 2, page_size: 5 });
  await client.createTask(10, { title: 'Work', assignee_id: null });
  await client.updateTask(101, { status: 'done', version: 1 });
  await client.archiveTask(101, { version: 2 });
  await client.addComment(101, { body: '<script>literal</script>' });
  await client.listComments(101, { page: 2, page_size: 20 });
  await client.listHistory(101, { page: 3, page_size: 20 });
  await client.getStats(10);
  await client.listUsers('a&b', { page: 2 });
  assert.equal(calls[1].url, '/api/projects');
  assert.equal(calls[2].method, 'PATCH');
  assert.equal(calls[3].url, '/api/projects/10/archive');
  assert.deepEqual(JSON.parse(calls[4].body), { user_id: 2 });
  assert.equal(calls[5].method, 'DELETE');
  const filters = new URL(calls[6].url, 'http://local').searchParams;
  assert.equal(filters.get('q'), 'Việc %_&');
  assert.equal(filters.get('assignee_id'), 'unassigned');
  assert.equal(filters.get('overdue'), 'false');
  assert.equal(calls[11].url, '/api/tasks/101/comments?page=2&page_size=20');
  assert.equal(calls[12].url, '/api/tasks/101/history?page=3&page_size=20');
  assert.equal(calls[13].url, '/api/projects/10/stats');
  assert.equal(new URL(calls[14].url, 'http://local').searchParams.get('q'), 'a&b');
  for (const call of calls) {
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.redirect, 'error');
    assert.equal(call.cache, 'no-store');
    if (call.method !== 'GET') assert.equal(call.headers['X-Requested-With'], 'TaskManager');
  }
  assert.equal(calls[1].headers['X-CSRF-Token'], 'csrf-one');
  assert.equal(calls[0].headers['X-CSRF-Token'], undefined);
  assert.equal(await client.logout(), undefined);
});

test('safe API errors retain status/details; invalid JSON and network failures never fall back to mock data', async () => {
  const client = createHttpClient({ fetchImpl: async () => json({ error: { code: 'VERSION_CONFLICT', message: 'Reload', details: {} } }, 409) });
  await assert.rejects(client.updateTask(101, { version: 1 }), error => error instanceof ApiError && error.status === 409 && error.error.code === 'VERSION_CONFLICT');
  const broken = createHttpClient({ fetchImpl: async () => new Response('<html>SQL password path leaked</html>', { status: 500 }) });
  await assert.rejects(broken.me(), error => error.status === 500 && !error.message.includes('SQL'));
  const offline = createHttpClient({ fetchImpl: async () => { throw new TypeError('raw private network detail'); } });
  await assert.rejects(offline.listProjects(), error => error.status === 0 && error.error.code === 'NETWORK_ERROR' && !error.message.includes('private'));
});

test('stale me result cannot replace a newer login CSRF and 401 clears the current token', async () => {
  let resolve, delayed = true, expired = false;
  const headers = [];
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    if (url === '/api/auth/me' && delayed) return new Promise(r => { resolve = r; });
    if (url === '/api/auth/login') return json(session);
    headers.push(init.headers);
    return expired ? json({ error: { code: 'UNAUTHENTICATED', message: 'Expired', details: {} } }, 401) : json({});
  } });
  const old = client.me();
  await client.login({ username: 'owner', password: 'password' });
  resolve(json({ ...session, csrf_token: 'stale-token' }));
  await old;
  await client.createProject({ name: 'One' });
  assert.equal(headers.at(-1)['X-CSRF-Token'], 'csrf-one');
  delayed = false; expired = true;
  await assert.rejects(client.me());
  expired = false;
  await client.createProject({ name: 'Two' });
  assert.equal(headers.at(-1)['X-CSRF-Token'], undefined);
});

test('unsafe IDs are rejected before fetch and requests have a bounded timeout', async () => {
  let count = 0;
  const client = createHttpClient({ timeoutMs: 10, fetchImpl: async (_url, init) => {
    count++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  } });
  await assert.rejects(client.getTask('../auth/me'));
  assert.equal(count, 0);
  await assert.rejects(client.me(), error => error.error.code === 'TIMEOUT');
  assert.equal(count, 1);
});

test('session-changing requests are serialized so stale Set-Cookie cannot overwrite a later actor', async () => {
  const gates = [], calls = [];
  let cookie;
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    calls.push(url);
    if (url === '/api/auth/login' || url === '/api/auth/logout') {
      return new Promise(resolve => gates.push(() => {
        const actor = init.body ? JSON.parse(init.body).username : null;
        cookie = actor;
        resolve(actor ? json({ user: { id: actor }, csrf_token: actor }) : new Response(null, { status: 204 }));
      }));
    }
    assert.equal(init.headers['X-CSRF-Token'], cookie);
    return json({});
  } });
  const first = client.login({ username: 'A', password: 'input' });
  const second = client.login({ username: 'B', password: 'input' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'second login must wait for first response including Set-Cookie');
  gates.shift()(); await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  gates.shift()(); await second;
  await client.createProject({ name: 'B project' });
  assert.equal(cookie, 'B');
  const logout = client.logout();
  const third = client.login({ username: 'C', password: 'input' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1), '/api/auth/logout');
  assert.equal(gates.length, 1);
  gates.shift()(); await logout;
  await new Promise(resolve => setImmediate(resolve));
  gates.shift()(); await third;
  await client.createProject({ name: 'C project' });
  assert.equal(cookie, 'C');
});
