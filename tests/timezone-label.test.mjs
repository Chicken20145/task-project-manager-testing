import test from 'node:test';
import assert from 'node:assert';
import { timezoneLabel } from '../web/timezone-label.js';

test('Asia/Ho_Chi_Minh default (vi) returns Việt Nam with correct offset', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const label = timezoneLabel('Asia/Ho_Chi_Minh', 'vi', now);
  assert.strictEqual(label, 'UTC+07:00 — Việt Nam');
});

test('Asia/Ho_Chi_Minh english (en) returns Vietnam', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const label = timezoneLabel('Asia/Ho_Chi_Minh', 'en', now);
  assert.strictEqual(label, 'UTC+07:00 — Vietnam');
});

test('Asia/Kolkata half-hour offset with vi and en', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  assert.strictEqual(timezoneLabel('Asia/Kolkata', 'vi', now), 'UTC+05:30 — Ấn Độ');
  assert.strictEqual(timezoneLabel('Asia/Kolkata', 'en', now), 'UTC+05:30 — India');
});

test('UTC timezone formatting', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  assert.strictEqual(timezoneLabel('UTC', 'en', now), 'UTC+00:00 — UTC');
});

test('Europe/London DST awareness (winter vs summer)', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.strictEqual(timezoneLabel('Europe/London', 'en', winter), 'UTC+00:00 — London');
  assert.strictEqual(timezoneLabel('Europe/London', 'en', summer), 'UTC+01:00 — London');
});

test('America/New_York DST awareness (winter vs summer)', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.strictEqual(timezoneLabel('America/New_York', 'en', winter), 'UTC-05:00 — New York');
  assert.strictEqual(timezoneLabel('America/New_York', 'en', summer), 'UTC-04:00 — New York');
});

test('Unknown or malformed zone does not throw', () => {
  const label = timezoneLabel('Invalid/Zone', 'en', new Date());
  assert.ok(typeof label === 'string');
  assert.ok(label.length > 0);
});
