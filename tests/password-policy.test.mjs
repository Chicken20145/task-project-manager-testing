import test from 'node:test';
import assert from 'node:assert/strict';
import { validNewPassword } from '../web/password-policy.js';

test('new password policy accepts six and128 codepoints with digit and symbol without trimming', () => {
  for (const value of ['Ab@123', '😀a1@bc', ' 1@   ', 'a'.repeat(126) + '1@']) assert.equal(validNewPassword(value), true);
});

test('new password policy rejects length, missing composition, whitespace and malformed Unicode', () => {
  for (const value of ['a1@bc', 'a'.repeat(127) + '1@', 'abcdef', 'abcdef1', 'abc@de', '      ', 'a1@\u0000bc', 'a1@\ud800bc', null]) {
    assert.equal(validNewPassword(value), false);
  }
});
