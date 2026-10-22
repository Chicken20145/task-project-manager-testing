import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient, DEMO_PASSWORD } from '../web/data/mock.js';

const password = 'demo-only-passphrase-2026';
const draft = { username: ' New.User ', display_name: ' Người mới ', password };
const error = (status, code) => e => e.status === status && e.error.code === code;

test('registration normalizes identity without automatically logging in or exposing credentials', async () => {
  const client = createMockClient();
  const user = await client.register(draft);
  assert.deepEqual(user, { id: 4, username: 'new.user', display_name: 'Người mới' });
  assert.deepEqual(draft, { username: ' New.User ', display_name: ' Người mới ', password });
  await assert.rejects(client.me(), error(401, 'UNAUTHENTICATED'));
  const login = await client.login({ username: 'NEW.USER', password });
  assert.deepEqual(login.user, user);
  await assert.rejects(client.getProject(10), error(404, 'NOT_FOUND'));
  const project = await client.createProject({ name: 'Dự án mới' });
  assert.equal((await client.getProject(project.id)).role, 'owner');
});

test('duplicate username and invalid registration do not create partial accounts', async () => {
  const client = createMockClient();
  await assert.rejects(client.register({ ...draft, username: 'NGUYEN.VAN.A' }), error(409, 'DUPLICATE_USERNAME'));
  for (const change of [{ username: 'ab' }, { username: '<script>' }, { display_name: '' },
    { password: 'short' }, { password: 'x'.repeat(129) }, { password: null }, { role: 'owner' }, { confirm_password: password }]) {
    await assert.rejects(client.register({ ...draft, ...change }), error(422, 'VALIDATION_ERROR'));
  }
  assert.equal((await client.register(draft)).id, 4);
});

test('registered passwords are isolated per user/client and are never part of member lookup', async () => {
  const first = createMockClient(), second = createMockClient();
  await first.register(draft);
  await assert.rejects(first.login({ username: 'new.user', password: DEMO_PASSWORD }), error(401, 'INVALID_CREDENTIALS'));
  await assert.rejects(second.login({ username: 'new.user', password }), error(401, 'INVALID_CREDENTIALS'));
  await first.login({ username: 'nguyen.van.a', password: DEMO_PASSWORD });
  const found = await first.listUsers('new.user');
  assert.deepEqual(found.items, [{ id: 4, username: 'new.user', display_name: 'Người mới' }]);
  await first.addMember(10, 4);
  await first.login({ username: 'new.user', password });
  assert.equal((await first.getProject(10)).role, 'member');
  await assert.rejects(first.createTask(10, { title: 'Không có quyền' }), error(403, 'FORBIDDEN'));
});

test('registration retains an existing mock session and accepts spaces/unicode in passphrases', async () => {
  const client = createMockClient();
  await client.login({ username: 'nguyen.van.a', password: DEMO_PASSWORD });
  const unicodePassword = 'Một câu mật khẩu dài có dấu1@';
  await client.register({ ...draft, password: unicodePassword });
  assert.equal((await client.me()).user.id, 1);
  await client.logout();
  await client.login({ username: 'new.user', password: unicodePassword });
  assert.equal((await client.me()).user.id, 4);
});
