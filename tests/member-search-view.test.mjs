import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../web/views.js';

const ownerUser = { id: 1, username: 'alice', display_name: 'Alice Wonder' };
const memberUser = { id: 2, username: 'bob', display_name: 'Bob Builder' };
const baseProject = {
  id: 10,
  name: 'Alpha Project',
  owner_id: 1,
  role: 'owner',
  archived_at: null,
  members: [ownerUser, memberUser]
};

test('empty, missing, and whitespace query suppresses candidate results and shows helper', () => {
  const staleCandidates = [
    { id: 99, username: 'mallory', display_name: 'Mallory Hacker' }
  ];
  for (const q of ['', '   ', undefined, null]) {
    const html = renderApp({
      type: 'members',
      user: ownerUser,
      project: baseProject,
      memberQuery: q,
      searchUsers: staleCandidates
    });
    assert.doesNotMatch(html, /mallory/, 'Stale candidate username must not render');
    assert.doesNotMatch(html, /Mallory Hacker/, 'Stale candidate display name must not render');
    assert.doesNotMatch(html, /data-action="add-member"/, 'Add-member button must not render');
    assert.doesNotMatch(html, /Không tìm thấy tài khoản phù hợp\./, 'No-results message must not render on blank query');
    assert.match(html, /Nhập tên hiển thị hoặc tên đăng nhập rồi bấm Tìm\./, 'Helper text must render when query is empty');
    assert.match(html, /Thành viên hiện tại/, 'Current members heading must be present');
    assert.match(html, /Alice Wonder/, 'Current members must remain visible');
    assert.match(html, /Bob Builder/, 'Current members must remain visible');
  }
});

test('nonblank query renders matching candidates and already-member marker under heading', () => {
  const searchCandidates = [
    { id: 2, username: 'bob', display_name: 'Bob Builder' },
    { id: 3, username: 'charlie', display_name: 'Charlie Day' }
  ];
  const html = renderApp({
    type: 'members',
    user: ownerUser,
    project: baseProject,
    memberQuery: 'charlie',
    searchUsers: searchCandidates
  });
  assert.match(html, /Kết quả tìm kiếm/, 'Concise search results heading must be present');
  assert.doesNotMatch(html, /Nhập tên hiển thị hoặc tên đăng nhập rồi bấm Tìm\./, 'Helper text must not appear when search is active');
  assert.match(html, /data-action="add-member" data-id="3"/, 'New candidate gets add-member action');
  assert.match(html, /Đã là thành viên/, 'Existing member candidate gets already-member marker');
  assert.doesNotMatch(html, /data-action="add-member" data-id="2"/, 'Existing member must not have add button');
  assert.match(html, /Thành viên hiện tại/, 'Current members heading must be present');
});

test('unmatched query with 0 results renders empty message and no candidate table', () => {
  const html = renderApp({
    type: 'members',
    user: ownerUser,
    project: baseProject,
    memberQuery: 'unknownuser',
    searchUsers: []
  });
  assert.match(html, /Không tìm thấy tài khoản phù hợp\./, 'Must show exact no-results message');
  assert.doesNotMatch(html, /Nhập tên hiển thị hoặc tên đăng nhập rồi bấm Tìm\./, 'Helper text must not appear when search ran');
  assert.doesNotMatch(html, /Kết quả tìm kiếm/, 'No candidate heading when there are 0 matches');
  assert.doesNotMatch(html, /data-action="add-member"/, 'No add button when no matches');
  assert.match(html, /Thành viên hiện tại/, 'Current members list stays visible');
});

test('guest, regular member, and archived project cannot search or see candidate controls', () => {
  const staleCandidates = [{ id: 88, username: 'candidate', display_name: 'Candidate User' }];
  const nonOwnerProject = { ...baseProject, role: 'member' };
  const archivedProject = { ...baseProject, archived_at: '2026-10-20' };

  for (const state of [
    { user: null, project: baseProject },
    { user: memberUser, project: nonOwnerProject },
    { user: ownerUser, project: archivedProject }
  ]) {
    const html = renderApp({
      type: 'members',
      ...state,
      memberQuery: 'candidate',
      searchUsers: staleCandidates
    });
    assert.doesNotMatch(html, /data-form="member-search"/, 'Search form must not render');
    assert.doesNotMatch(html, /Candidate User/, 'Candidate name must not render');
    assert.doesNotMatch(html, /data-action="add-member"/, 'Add member button must not render');
    assert.match(html, /Thành viên hiện tại/, 'Current members heading remains visible');
  }
});

test('hostile query and user text are properly HTML-escaped', () => {
  const xss = '<script>alert(1)</script>"\'<>';
  const html = renderApp({
    type: 'members',
    user: ownerUser,
    project: baseProject,
    memberQuery: xss,
    searchUsers: [{ id: 77, username: xss, display_name: xss }]
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'Hostile script must not be injected unescaped');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'Hostile text must be escaped');
});

test('VI and EN localized hints, placeholders, headings, and labels translate correctly', () => {
  const viHtml = renderApp({
    type: 'members',
    language: 'vi',
    user: ownerUser,
    project: baseProject,
    memberQuery: '',
    searchUsers: []
  });
  assert.match(viHtml, /placeholder="Tìm theo tên hiển thị hoặc tên đăng nhập\.\.\."/, 'VI placeholder');
  assert.match(viHtml, /Nhập tên hiển thị hoặc tên đăng nhập rồi bấm Tìm\./, 'VI helper');
  assert.match(viHtml, /Thành viên hiện tại/, 'VI current members heading');

  const enEmptyHtml = renderApp({
    type: 'members',
    language: 'en',
    user: ownerUser,
    project: baseProject,
    memberQuery: '',
    searchUsers: []
  });
  assert.match(enEmptyHtml, /placeholder="Search by display name or username\.\.\."/, 'EN placeholder');
  assert.match(enEmptyHtml, /Enter display name or username then click Search\./, 'EN helper');
  assert.match(enEmptyHtml, /Current members/, 'EN current members heading');

  const enMatchedHtml = renderApp({
    type: 'members',
    language: 'en',
    user: ownerUser,
    project: baseProject,
    memberQuery: 'bob',
    searchUsers: [
      { id: 2, username: 'bob', display_name: 'Bob Builder' },
      { id: 4, username: 'dave', display_name: 'Dave Smith' }
    ]
  });
  assert.match(enMatchedHtml, /Search results/, 'EN search results heading');
  assert.match(enMatchedHtml, /Already a member/, 'EN already a member marker');
  assert.match(enMatchedHtml, /data-action="add-member"/, 'Add button exists');
  assert.match(enMatchedHtml, />Add<\/button>/, 'EN add button label');

  const enNoMatchHtml = renderApp({
    type: 'members',
    language: 'en',
    user: ownerUser,
    project: baseProject,
    memberQuery: 'none',
    searchUsers: []
  });
  assert.match(enNoMatchHtml, /No matching accounts found\./, 'EN no matching accounts found');
});
