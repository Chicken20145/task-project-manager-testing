import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient, DEMO_PASSWORD } from '../web/data/mock.js';

function fixture() {
  return {
    today: '2026-10-13',
    users: [
      { id: 1, username: 'owner_demo', display_name: 'Chủ dự án' },
      { id: 2, username: 'member_demo', display_name: 'Thành viên' },
      { id: 3, username: 'outside_demo', display_name: 'Người ngoài' },
    ],
    projects: [{ id: 10, name: 'Dự án mẫu', description: '', owner_id: 1, version: 1, archived_at: null }],
    project_members: [{ project_id: 10, user_id: 1 }, { project_id: 10, user_id: 2 }],
    tasks: [{ id: 101, project_id: 10, title: 'Công việc mẫu', description: '', assignee_id: 2,
      due_date: '2026-10-12', priority: 'medium', status: 'todo', version: 1, archived_at: null }],
  };
}

async function clientAs(username = 'owner_demo', data = fixture()) {
  const client = createMockClient(data);
  await client.login({ username, password: DEMO_PASSWORD });
  return client;
}

function expectError(status, code) {
  return error => {
    assert.equal(error.status, status);
    assert.equal(error.error.code, code);
    assert.equal(typeof error.error.message, 'string');
    return true;
  };
}

test('mock client requires login and invalidates session on logout', async () => {
  const client = createMockClient(fixture());
  await assert.rejects(client.listProjects(), expectError(401, 'UNAUTHENTICATED'));
  await assert.rejects(client.login({ username: 'owner_demo', password: 'wrong' }), expectError(401, 'INVALID_CREDENTIALS'));
  await assert.rejects(client.login({ username: 123, password: DEMO_PASSWORD }), expectError(401, 'INVALID_CREDENTIALS'));
  const session = await client.login({ username: 'owner_demo', password: DEMO_PASSWORD });
  assert.equal(session.user.id, 1);
  assert.equal(typeof session.csrf_token, 'string');
  assert.equal((await client.me()).user.id, 1);
  await client.logout();
  await assert.rejects(client.me(), expectError(401, 'UNAUTHENTICATED'));
});

test('outsider cannot list or read another project or task', async () => {
  const client = await clientAs('outside_demo');
  assert.equal((await client.listProjects()).total, 0);
  await assert.rejects(client.getProject(10), expectError(404, 'NOT_FOUND'));
  await assert.rejects(client.getTask(101), expectError(404, 'NOT_FOUND'));
});

test('owner creates projects and tasks with normalized values', async () => {
  const client = await clientAs();
  const project = await client.createProject({ name: '  Dự án mới  ', description: '' });
  assert.equal(project.owner_id, 1);
  assert.equal(project.name, 'Dự án mới');
  const task = await client.createTask(project.id, { title: '  Việc mới  ' });
  assert.equal(task.title, 'Việc mới');
  assert.equal(task.status, 'todo');
  assert.equal(task.version, 1);
  assert.equal((await client.listTasks(project.id)).total, 1);
});

test('owner cannot assign to someone outside the project or save invalid fields', async () => {
  const client = await clientAs();
  await assert.rejects(client.createTask(10, { title: 'Việc mới', assignee_id: 3 }), expectError(422, 'VALIDATION_ERROR'));
  await assert.rejects(client.createTask(10, { title: ' ', due_date: '2026-02-30' }), expectError(422, 'VALIDATION_ERROR'));
  assert.equal((await client.listTasks(10)).total, 1);
});

test('member can update only status of their assigned task', async () => {
  const client = await clientAs('member_demo');
  const task = await client.updateTask(101, { status: 'doing', version: 1 });
  assert.equal(task.status, 'doing');
  assert.equal(task.version, 2);
  await assert.rejects(client.updateTask(101, { title: 'Không được sửa', version: 2 }), expectError(403, 'FORBIDDEN'));
  await assert.rejects(client.createTask(10, { title: 'Không được tạo' }), expectError(403, 'FORBIDDEN'));
});

test('stale update conflicts and does not create extra history', async () => {
  const client = await clientAs();
  await client.updateTask(101, { title: 'Bản mới', version: 1 });
  await assert.rejects(client.updateTask(101, { title: 'Bản cũ', version: 1 }), expectError(409, 'VERSION_CONFLICT'));
  assert.equal((await client.getTask(101)).title, 'Bản mới');
  assert.equal((await client.listHistory(101)).total, 1);
});

test('same-version concurrent updates have one winner', async () => {
  const client = await clientAs();
  const results = await Promise.allSettled([
    client.updateTask(101, { title: 'A', version: 1 }),
    client.updateTask(101, { title: 'B', version: 1 }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected');
  assert.equal(failure.reason.status, 409);
});

test('archive hides task from lists/stats but keeps read-only comments/history', async () => {
  const client = await clientAs();
  await client.addComment(101, { body: 'Nội dung trước lưu trữ' });
  await client.archiveTask(101, { version: 1 });
  assert.equal((await client.listTasks(10)).total, 0);
  assert.equal((await client.getStats(10)).total, 0);
  assert.ok((await client.getTask(101)).archived_at);
  assert.equal((await client.listComments(101)).total, 1);
  await assert.rejects(client.addComment(101, { body: 'Không được thêm' }), expectError(403, 'ARCHIVED'));
  await assert.rejects(client.updateTask(101, { title: 'Không được sửa', version: 2 }), expectError(403, 'ARCHIVED'));
});

test('archived project makes every task mutation read-only', async () => {
  const client = await clientAs();
  await client.archiveProject(10, { version: 1 });
  assert.equal((await client.listProjects()).total, 0);
  assert.ok((await client.getProject(10)).archived_at);
  await assert.rejects(client.createTask(10, { title: 'Không được tạo' }), expectError(403, 'ARCHIVED'));
  await assert.rejects(client.updateTask(101, { status: 'done', version: 1 }), expectError(403, 'ARCHIVED'));
});

test('removing member clears assignments, increments version and revokes access', async () => {
  const client = await clientAs();
  await client.removeMember(10, 2);
  const task = await client.getTask(101);
  assert.equal(task.assignee_id, null);
  assert.equal(task.version, 2);
  assert.equal((await client.listHistory(101)).total, 1);
  await client.login({ username: 'member_demo', password: DEMO_PASSWORD });
  await assert.rejects(client.getProject(10), expectError(404, 'NOT_FOUND'));
});

test('owner membership cannot be removed; duplicate and unknown members rejected', async () => {
  const client = await clientAs();
  await assert.rejects(client.removeMember(10, 1), expectError(422, 'VALIDATION_ERROR'));
  await assert.rejects(client.addMember(10, 2), expectError(409, 'DUPLICATE_MEMBER'));
  await assert.rejects(client.addMember(10, 999), expectError(422, 'VALIDATION_ERROR'));
  await client.addMember(10, 3);
  assert.equal((await client.getProject(10)).members.length, 3);
});

test('member cannot archive project, change membership or update another assignee task', async () => {
  const data = fixture();
  data.tasks[0].assignee_id = 1;
  const client = await clientAs('member_demo', data);
  await assert.rejects(client.updateTask(101, { status: 'done', version: 1 }), expectError(403, 'FORBIDDEN'));
  await assert.rejects(client.archiveProject(10, { version: 1 }), expectError(403, 'FORBIDDEN'));
  await assert.rejects(client.addMember(10, 3), expectError(403, 'FORBIDDEN'));
});

test('invalid comments and wrong task pages are rejected', async () => {
  const client = await clientAs();
  await assert.rejects(client.addComment(101, { body: '  ' }), expectError(422, 'VALIDATION_ERROR'));
  await assert.rejects(client.listTasks(10, { page: 0 }), expectError(422, 'VALIDATION_ERROR'));
  assert.equal((await client.listComments(101)).total, 0);
});

test('caller cannot override task project filter', async () => {
  const data = fixture();
  data.projects.push({ id: 20, owner_id: 3, name: 'Riêng', version: 1, archived_at: null });
  data.project_members.push({ project_id: 20, user_id: 3 });
  data.tasks.push({ ...data.tasks[0], id: 200, project_id: 20, assignee_id: 3 });
  const client = await clientAs('owner_demo', data);
  const result = await client.listTasks(10, { project_id: 20 });
  assert.deepEqual(result.items.map(task => task.id), [101]);
  await assert.rejects(client.listTasks(20), expectError(404, 'NOT_FOUND'));
});

test('separate clients and returned values do not leak mutable state', async () => {
  const data = fixture();
  const original = structuredClone(data);
  const one = await clientAs('owner_demo', data);
  const two = await clientAs('owner_demo', data);
  const task = await one.getTask(101);
  task.title = 'Sửa object trả về';
  assert.equal((await one.getTask(101)).title, 'Công việc mẫu');
  await one.updateTask(101, { title: 'Chỉ client một', version: 1 });
  assert.equal((await two.getTask(101)).title, 'Công việc mẫu');
  assert.deepEqual(data, original);
});

test('malformed pagination and filters produce the documented error envelope', async () => {
  const client = await clientAs();
  for (const options of [null, [], 'bad', 3]) {
    await assert.rejects(client.listProjects(options), expectError(422, 'VALIDATION_ERROR'));
    await assert.rejects(client.listComments(101, options), expectError(422, 'VALIDATION_ERROR'));
    await assert.rejects(client.listHistory(101, options), expectError(422, 'VALIDATION_ERROR'));
    await assert.rejects(client.listTasks(10, options), expectError(422, 'VALIDATION_ERROR'));
  }
});

test('user lookup follows the paginated list contract and keeps only public fields', async () => {
  const client = await clientAs();
  const result = await client.listUsers('demo', { page: 1, page_size: 2 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map(user => user.id), [3, 2]);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['display_name', 'id', 'username']);
  for (const query of ['', '   ']) assert.equal((await client.listUsers(query)).total, 0);
  const named = await client.listUsers('  THÀNH VIÊN  ');
  assert.deepEqual(named.items.map(user => user.id), [2]);
  assert.equal((await client.listUsers('no such name')).total, 0);
  await client.login({ username: 'member_demo', password: DEMO_PASSWORD });
  await assert.rejects(client.listUsers(''), expectError(403, 'FORBIDDEN'));
});

test('malformed resource IDs reject while valid inaccessible IDs remain hidden', async () => {
  const client = await clientAs();
  for (const id of [0, -1, 1.5, '10', null]) {
    await assert.rejects(client.getProject(id), expectError(422, 'VALIDATION_ERROR'));
    await assert.rejects(client.getTask(id), expectError(422, 'VALIDATION_ERROR'));
  }
  await assert.rejects(client.getProject(999), expectError(404, 'NOT_FOUND'));
});

test('project and archive stale versions preserve current values', async () => {
  const client = await clientAs();
  const project = await client.updateProject(10, { name: 'Tên mới', version: 1 });
  assert.equal(project.version, 2);
  await assert.rejects(client.updateProject(10, { name: 'Tên cũ', version: 1 }), expectError(409, 'VERSION_CONFLICT'));
  await assert.rejects(client.archiveProject(10, { version: 1 }), expectError(409, 'VERSION_CONFLICT'));
  assert.equal((await client.getProject(10)).name, 'Tên mới');
  assert.equal((await client.getProject(10)).archived_at, null);
  await client.updateTask(101, { title: 'Việc mới', version: 1 });
  await assert.rejects(client.archiveTask(101, { version: 1 }), expectError(409, 'VERSION_CONFLICT'));
  assert.equal((await client.getTask(101)).archived_at, null);
  assert.equal((await client.listHistory(101)).total, 1);
});

test('revocation is enforced across task data and mutation operations', async () => {
  const client = await clientAs();
  await client.removeMember(10, 2);
  await client.login({ username: 'member_demo', password: DEMO_PASSWORD });
  for (const action of [
    () => client.getTask(101), () => client.listTasks(10), () => client.listComments(101),
    () => client.listHistory(101), () => client.getStats(10),
    () => client.updateTask(101, { status: 'done', version: 2 }),
    () => client.addComment(101, { body: 'Không được thêm' }),
  ]) await assert.rejects(action(), expectError(404, 'NOT_FOUND'));
});
