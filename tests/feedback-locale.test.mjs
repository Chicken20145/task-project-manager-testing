import test from 'node:test';
import assert from 'node:assert';
import { createTranslator } from '../web/i18n.js';

test('feedback locale translation and identity', () => {
  const tVi = createTranslator('vi');
  assert.strictEqual(
    tVi.text('Vui lòng điền đầy đủ các ô bắt buộc.'),
    'Vui lòng điền đầy đủ các ô bắt buộc.'
  );
  assert.strictEqual(tVi.text('Unknown user text'), 'Unknown user text');

  const tEn = createTranslator('en');
  assert.strictEqual(
    tEn.text('Vui lòng điền đầy đủ các ô bắt buộc.'),
    'Please fill in all required fields.'
  );
  assert.strictEqual(tEn.text('Unknown user text'), 'Unknown user text');
});
