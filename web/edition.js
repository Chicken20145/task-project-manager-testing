/**
 * Pure edition notice renderer helper.
 * No network, DOM, storage, or permissions.
 */

function isValidBuildId(buildId) {
    if (typeof buildId !== 'string') {
        return false;
    }
    let codepointCount = 0;
    for (const char of buildId) {
        const code = char.codePointAt(0);
        if (code === 0) {
            return false;
        }
        // Check for lone surrogates or surrogate code points in range 0xD800 to 0xDFFF
        if (code >= 0xD800 && code <= 0xDFFF) {
            return false;
        }
        codepointCount++;
    }
    return codepointCount >= 1 && codepointCount <= 80;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function renderEditionNotice(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return '';
    }
    const { edition, build_id, ai_enabled } = metadata;

    // malformed metadata must hide, so require ai_enabled === false (undefined/null/string/1 also hidden)
    if (ai_enabled !== false) {
        return '';
    }

    if (!isValidBuildId(build_id)) {
        return '';
    }

    let label = '';
    if (edition === 'ai') {
        label = 'Bản dành cho môn AI · Nền nghiệp vụ';
    } else if (edition === 'testing') {
        label = 'Bản kiểm thử · Nền nghiệp vụ đúng';
    } else {
        return '';
    }

    const escapedBuild = escapeHtml(build_id);
    return `<div class="demo-banner" role="note">${label} — ${escapedBuild}</div>`;
}
