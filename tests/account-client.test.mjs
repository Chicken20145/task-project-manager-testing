import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../web/data/http.js';
import { createMockClient } from '../web/data/mock.js';

const json = value => new Response(JSON.stringify(value), { status: 200 });
test('account provider uses CSRF, serializes password transition and discards old CSRF', async () => {
  const calls = [];
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if (url === '/api/auth/login') return json({ user: { id: 1 }, csrf_token: 'csrf-one' });
    if (url === '/api/account/password') return new Response(null, { status: 204 });
    return json({ id: 1, username: 'owner', display_name: 'New name' });
  } });
  await client.login({ username: 'owner', password: 'old password' });
  await client.updateProfile({ display_name: 'New name' });
  await client.changePassword({ current_password: 'old password', new_password: 'new password long enough1@' });
  await client.createProject({ name: 'Needs login' });
  assert.equal(calls[1].url, '/api/account/profile');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].headers['X-CSRF-Token'], 'csrf-one');
  assert.equal(calls[2].url, '/api/account/password');
  assert.deepEqual(JSON.parse(calls[2].body), { current_password: 'old password', new_password: 'new password long enough1@' });
  assert.equal(calls[3].headers['X-CSRF-Token'], undefined);
});

test('failed password field validation keeps CSRF for retry', async () => {
  const calls = [];
  let failed = false;
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if (url === '/api/auth/login') return json({ user: { id: 1 }, csrf_token: 'csrf-one' });
    if (!failed) { failed = true; return new Response(JSON.stringify({ error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Invalid', details: { current_password: 'Invalid' } } }), { status: 422 }); }
    return new Response(null, { status: 204 });
  } });
  await client.login({ username: 'owner', password: 'old password' });
  await assert.rejects(client.changePassword({ current_password: 'wrong', new_password: 'new password long enough1@' }), error => error.status === 422);
  await client.changePassword({ current_password: 'old password', new_password: 'new password long enough1@' });
  assert.equal(calls[2].headers['X-CSRF-Token'], 'csrf-one');
});

test('new login waits for password revocation so its session cannot be cleared by the older response', async () => {
  let release, passwordStarted;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { passwordStarted = resolve; });
  let loginCount = 0, lastCsrf;
  const client = createHttpClient({ fetchImpl: async (url, init) => {
    if (url === '/api/auth/login') return json({ user: { id: ++loginCount }, csrf_token: `csrf-${loginCount}` });
    if (url === '/api/account/password') { passwordStarted(); await blocked; return new Response(null, { status: 204 }); }
    lastCsrf = init.headers['X-CSRF-Token'];
    return json({ id: 2 });
  } });
  await client.login({ username: 'first', password: 'first password' });
  const change = client.changePassword({ current_password: 'first password', new_password: 'new password long enough1@' });
  await started;
  const nextLogin = client.login({ username: 'second', password: 'second password' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loginCount, 1);
  release();
  await change;
  await nextLogin;
  await client.updateProfile({ display_name: 'Second account' });
  assert.equal(lastCsrf, 'csrf-2');
});

test('mock profile/password parity preserves invalid session inputs and never exposes credentials', async () => {
  const client = createMockClient();
  await assert.rejects(client.updateProfile({ display_name: 'New' }), error => error.status === 401);
  await client.login({ username: 'nguyen.van.a', password: 'demo123' });
  assert.equal((await client.updateProfile({ display_name: ' New 😀 ' })).display_name, 'New 😀');
  await assert.rejects(client.changePassword({ current_password: 'wrong', new_password: 'new password long enough1@' }), error => error.status === 422);
  assert.equal((await client.me()).user.display_name, 'New 😀');
  await client.changePassword({ current_password: 'demo123', new_password: 'new password long enough1@' });
  await assert.rejects(client.me(), error => error.status === 401);
  await assert.rejects(client.login({ username: 'nguyen.van.a', password: 'demo123' }), error => error.status === 401);
  const result = await client.login({ username: 'nguyen.van.a', password: 'new password long enough1@' });
  assert.deepEqual(Object.keys(result.user).sort(), ['display_name', 'id', 'username']);
});
