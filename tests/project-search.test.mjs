import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient, DEMO_PASSWORD } from '../web/data/mock.js';

test('project search filters before pagination and rejects malformed queries', async () => {
  const client = createMockClient();
  await client.login({ username: 'nguyen.van.a', password: DEMO_PASSWORD });
  for (let i = 0; i < 25; i++) await client.createProject({ name: 'Alpha ' + i });
  await client.createProject({ name: 'Beta' });
  const result = await client.listProjects({ q: ' alpha ', page: 2, page_size: 20 });
  assert.equal(result.total, 25);
  assert.equal(result.items.length, 5);
  assert.ok(result.items.every(item => item.name.startsWith('Alpha')));
  await assert.rejects(client.listProjects({ q: 123 }), e => e.status === 422);
});
