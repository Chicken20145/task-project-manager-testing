import test from 'node:test';
import assert from 'node:assert';
import { createHttpClient, ApiError } from '../web/data/http.js';

test('notification client methods: getCalendar, ensureDailyReport, listNotifications', async () => {
  let requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/auth/login' || url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ csrf_token: 'fake-csrf-token', user: { id: 1 } })
      };
    }
    if (url.startsWith('/api/calendar') || url.startsWith('/api/notifications')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] })
      };
    }
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'FORBIDDEN', message: 'No access' } })
    };
  };

  const client = createHttpClient({ fetchImpl });

  // Login first to get CSRF (using username as required)
  await client.login({ username: 'testuser', password: 'password' });

  // Test getCalendar with options including page_size
  requests = [];
  await client.getCalendar({ month: '2026-10', date: '2026-10-21', page_size: 10 });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, '/api/calendar?month=2026-10&date=2026-10-21&page_size=10');
  assert.strictEqual(requests[0].options.method, 'GET');
  assert.strictEqual(requests[0].options.credentials, 'same-origin');

  // Test ensureDailyReport (POST /notifications/daily with empty JSON body)
  requests = [];
  await client.ensureDailyReport();
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, '/api/notifications/daily');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.headers['X-CSRF-Token'], 'fake-csrf-token');
  assert.strictEqual(requests[0].options.body, '{}');
  assert.strictEqual(requests[0].options.credentials, 'same-origin');

  // Test listNotifications with pagination options
  requests = [];
  await client.listNotifications({ page: 2, page_size: 20 });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, '/api/notifications?page=2&page_size=20');
  assert.strictEqual(requests[0].options.method, 'GET');
  assert.strictEqual(requests[0].options.credentials, 'same-origin');
});

test('notification client error handling without fallback', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 'FORBIDDEN', message: 'Forbidden access' } })
  });

  const client = createHttpClient({ fetchImpl });
  await assert.rejects(async () => {
    await client.ensureDailyReport();
  }, (err) => {
    assert(err instanceof ApiError);
    assert.strictEqual(err.status, 403);
    assert.strictEqual(err.error.code, 'FORBIDDEN');
    assert.strictEqual(err.error.message, 'Forbidden access');
    return true;
  });
});

test('timezone preferences use authenticated API and CSRF for save', async () => {
  const requests = [];
  const client = createHttpClient({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ timezone: 'UTC', csrf_token: 'preference-csrf' }) };
  } });
  await client.me();
  assert.strictEqual((await client.getPreferences()).timezone, 'UTC');
  await client.updatePreferences({ timezone: 'UTC' });
  assert.strictEqual(requests[1].url, '/api/account/preferences');
  assert.strictEqual(requests[1].options.method, 'GET');
  assert.strictEqual(requests[2].url, '/api/account/preferences');
  assert.strictEqual(requests[2].options.method, 'PATCH');
  assert.strictEqual(requests[2].options.headers['X-CSRF-Token'], 'preference-csrf');
  assert.strictEqual(requests[2].options.body, '{"timezone":"UTC"}');
});
