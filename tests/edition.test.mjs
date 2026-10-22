import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEditionNotice } from '../web/edition.js';

test('returns empty string for null, undefined, baseline, unknown, or missing metadata', () => {
    assert.equal(renderEditionNotice(null), '');
    assert.equal(renderEditionNotice(undefined), '');
    assert.equal(renderEditionNotice({}), '');
    assert.equal(renderEditionNotice({ edition: 'baseline', build_id: '123', ai_enabled: false }), '');
    assert.equal(renderEditionNotice({ edition: 'other', build_id: '123', ai_enabled: false }), '');
});

test('returns empty string when ai_enabled is not strictly false (true, undefined, null, string, 1)', () => {
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: '123', ai_enabled: true }), '');
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: '123' }), '');
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: '123', ai_enabled: null }), '');
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: '123', ai_enabled: 'false' }), '');
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: '123', ai_enabled: 1 }), '');
});

test('validates build_id type, length (80 codepoints, emoji valid/invalid), and safe characters (no NUL or surrogate range D800-DFFF)', () => {
    const valid80 = '🚀'.repeat(80);
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: valid80, ai_enabled: false }).includes('🚀'), true);

    const invalid81 = '🚀'.repeat(81);
    assert.equal(renderEditionNotice({ edition: 'ai', build_id: invalid81, ai_enabled: false }), '');

    const invalidBuilds = [
        null,
        undefined,
        123,
        '',
        'a'.repeat(81),
        'abc\u0000def',
        'abc\uD800def', // surrogate range
        'abc\uDC00def',
        '\uD800',
        '\uDFFF'
    ];
    for (const build_id of invalidBuilds) {
        assert.equal(renderEditionNotice({ edition: 'ai', build_id, ai_enabled: false }), '');
        assert.equal(renderEditionNotice({ edition: 'testing', build_id, ai_enabled: false }), '');
    }
});

test('renders ai and testing editions correctly with build_id and independent HTML escaping assertions', () => {
    const malicious = '<script>alert(1)</script>&"\'';

    const aiHtml = renderEditionNotice({ edition: 'ai', build_id: malicious, ai_enabled: false });
    // Independent assertions: raw <script> absent, and literal expected escaped entities present
    assert.equal(aiHtml.includes('<script>'), false);
    assert.equal(aiHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#039;'), true);
    assert.equal(
        aiHtml,
        '<div class="demo-banner" role="note">Bản dành cho môn AI · Nền nghiệp vụ — &lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#039;</div>'
    );

    const testingHtml = renderEditionNotice({ edition: 'testing', build_id: 'BUILD-123', ai_enabled: false });
    assert.equal(
        testingHtml,
        '<div class="demo-banner" role="note">Bản kiểm thử · Nền nghiệp vụ đúng — BUILD-123</div>'
    );
});

test('ignores unknown extra keys and does not mutate input object', () => {
    const input = { edition: 'ai', build_id: 'BUILD-1', ai_enabled: false, extraKey: 'should-be-ignored' };
    const inputCopy = { ...input };
    const html = renderEditionNotice(input);
    assert.deepEqual(input, inputCopy);
    assert.equal(html, '<div class="demo-banner" role="note">Bản dành cho môn AI · Nền nghiệp vụ — BUILD-1</div>');
});
