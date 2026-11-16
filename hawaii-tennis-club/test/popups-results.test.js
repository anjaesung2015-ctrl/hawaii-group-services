// 홈 팝업 · 대회 성적(Hall of Fame) · 성적 담당
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';
const up = (app, p) => path.join(app.uploadDir, path.basename(p));
const day = (n) => {   // 오늘(울란바토르)에서 n일
  const d = new Date(Date.now() + 8 * 3600e3 + n * 86400e3);
  return d.toISOString().slice(0, 10);
};

// ---------- 팝업 ----------
test('팝업 — 운영진이 만들고, 게시 기간 안·켜진 것만 회원에게 뜬다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const mk = (body) => a.call('/popups', { method: 'POST', body });
  const now = (await mk({ title: '송년회 안내', body: '12월 20일 저녁 7시', link_tab: 'schedule', photo_data: TINY })).data;
  assert.ok(now.id && /^uploads\//.test(now.photo));
  await mk({ title: '다음 주부터', starts_on: day(3) });
  await mk({ title: '어제 끝남', starts_on: day(-5), ends_on: day(-1) });
  await mk({ title: '꺼둠', active: false });
  await mk({ title: '오늘까지', starts_on: day(-2), ends_on: day(0), link_tab: 'nope' });

  const m = await loginAs(app.base, '88110044', '1111');
  const live = (await m.call('/popups/active?lang=en')).data;
  assert.deepStrictEqual(live.map(p => p.title).sort(), ['송년회 안내', '오늘까지'].sort());
  const p = live.find(x => x.title === '송년회 안내');
  assert.strictEqual(p.link_tab, 'schedule');
  assert.strictEqual(p.title_tr, '[en] 송년회 안내');           // 회원 글처럼 영어 번역이 붙는다
  assert.strictEqual(live.find(x => x.title === '오늘까지').link_tab, null);   // 모르는 화면은 버린다

  // 관리 목록은 운영진만, 지난 것·꺼둔 것까지 전부
  assert.strictEqual((await m.call('/popups')).status, 403);
  assert.strictEqual((await a.call('/popups')).data.rows.length, 5);
  app.close();
});

test('팝업 — 일반 회원은 못 만들고, 제목·날짜를 검사한다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/popups', { method: 'POST', body: { title: 'x' } })).status, 403);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/popups', { method: 'POST', body: { title: '  ' } })).status, 400);
  assert.strictEqual((await a.call('/popups', { method: 'POST', body: { title: 'x', starts_on: '2026-13-01x' } })).data.error, 'bad_date');
  assert.strictEqual((await a.call('/popups', { method: 'POST', body: { title: 'x', starts_on: '2026-12-10', ends_on: '2026-12-01' } })).data.error, 'end_before_start');
  assert.strictEqual((await fetch(app.base + '/popups/active')).status, 401);
  app.close();
});

test('팝업 — 고치기(끄기·사진 바꾸기)·지우기, 지우면 사진 파일도 사라진다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const { id, photo } = (await a.call('/popups', { method: 'POST', body: { title: '공지', photo_data: TINY } })).data;
  const r = await a.call(`/popups/${id}`, { method: 'PATCH', body: { body: '내용 추가', photo_data: TINY } });
  assert.strictEqual(r.status, 200);
  await app.settle();
  assert.ok(!fs.existsSync(up(app, photo)), '옛 사진이 남았다');
  assert.ok(fs.existsSync(up(app, r.data.photo)));

  await a.call(`/popups/${id}`, { method: 'PATCH', body: { active: false } });
  assert.deepStrictEqual((await a.call('/popups/active')).data, []);
  const row = (await a.call('/popups')).data.rows[0];
  assert.strictEqual(row.title, '공지');            // 안 보낸 칸은 그대로
  assert.strictEqual(row.body, '내용 추가');

  assert.strictEqual((await a.call(`/popups/${id}`, { method: 'DELETE' })).status, 200);
  await app.settle();
  assert.ok(!fs.existsSync(up(app, r.data.photo)));
  assert.strictEqual((await a.call(`/popups/${id}`, { method: 'DELETE' })).status, 404);
  app.close();
});

// ---------- 성적 ----------
test('성적 — 운영진이 대회·입상자·사진을 올리고 누구나 본다, 명단에 트로피 수', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/results', { method: 'POST', body: {
    title: '11월 월례대회', held_on: '2026-11-25', kind: 'monthly', division: 'Men doubles',
    entries: [
      { place: 1, member_id: app.memberId }, { place: 1, member_id: app.adminId },
      { place: 2, name: '  Guest Bold  ' }, { place: 3, name: '' },   // 빈 이름 줄은 건너뛴다
      { place: 4, member_id: app.memberId },
    ],
    photos: [TINY, TINY],
  } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  await a.call('/results', { method: 'POST', body: { title: 'UB Open', held_on: '2025-06-01', kind: 'external', entries: [{ place: 2, member_id: app.memberId }] } });

  const m = await loginAs(app.base, '88110044', '1111');
  const d = (await m.call('/results')).data;
  assert.deepStrictEqual(d.rows.map(x => x.title), ['11월 월례대회', 'UB Open']);
  assert.deepStrictEqual(d.years, ['2026', '2025']);
  const t = d.rows[0];
  assert.deepStrictEqual(t.entries.map(e => [e.place, e.name]), [[1, 'Батбаяр'], [1, '대표'], [2, 'Guest Bold'], [4, 'Батбаяр']]);
  assert.strictEqual(t.photos.length, 2);
  assert.strictEqual(t.division, 'Men doubles');

  assert.deepStrictEqual((await m.call('/results?kind=external')).data.rows.map(x => x.title), ['UB Open']);
  assert.deepStrictEqual((await m.call('/results?year=2026')).data.rows.map(x => x.title), ['11월 월례대회']);

  // 트로피 = 3위 안 입상 횟수 (기타 4는 안 센다)
  const me = (await m.call('/members')).data.find(x => x.id === app.memberId);
  assert.strictEqual(me.trophies, 2);
  app.close();
});

test('성적 — 일반 회원은 못 올리고, 오너가 성적 담당으로 지정하면 올리고 고친다', async () => {
  const app = makeApp();
  const body = { title: '월례대회', held_on: '2026-11-25', kind: 'monthly', entries: [{ place: 1, name: 'A' }] };
  let m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/results', { method: 'POST', body })).status, 403);

  // 운영진(오너 아님)은 성적 담당을 못 정한다
  const a = await loginAs(app.base, '99000000', '1234');
  const officer = app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at)
                                  VALUES ('임원','99887766',?, 'admin','beginner','active','2026-01-01')`).run(app.dbmod.hashPin('2222')).lastInsertRowid;
  const o = await loginAs(app.base, '99887766', '2222');
  assert.strictEqual((await o.call(`/members/${app.memberId}`, { method: 'PATCH', body: { results_manager: '1' } })).status, 403);
  assert.strictEqual((await o.call('/results', { method: 'POST', body })).status, 200);   // 운영진은 올린다
  assert.ok(officer);

  assert.strictEqual((await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { results_manager: '1' } })).status, 200);
  m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/auth/me')).data.me.results_manager, true);
  const id = (await m.call('/results', { method: 'POST', body })).data.id;
  assert.ok(id);
  const list = (await m.call('/members')).data.find(x => x.id === app.memberId);
  assert.strictEqual(list.results_manager, 1);

  // 입상자만 바꾸기 — 나머지 칸은 그대로
  assert.strictEqual((await m.call(`/results/${id}`, { method: 'PATCH', body: { entries: [{ place: 2, member_id: app.adminId }] } })).status, 200);
  const r = (await m.call('/results')).data.rows.find(x => x.id === id);
  assert.strictEqual(r.title, '월례대회');
  assert.deepStrictEqual(r.entries.map(e => [e.place, e.name]), [[2, '대표']]);
  app.close();
});

test('성적 — 잘못된 값 거절, 사진 4장 제한, 지우면 사진도 사라진다, 회원을 지워도 기록은 남는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const ok = { title: 'T', held_on: '2026-11-01', kind: 'external', entries: [{ place: 1, member_id: app.memberId }] };
  const bad = async (b, err) => assert.strictEqual((await a.call('/results', { method: 'POST', body: { ...ok, ...b } })).data.error, err);
  await bad({ title: '' }, 'title_required');
  await bad({ held_on: '11/01' }, 'bad_date');
  await bad({ kind: 'x' }, 'bad_kind');
  await bad({ entries: [] }, 'entries_required');
  await bad({ entries: [{ place: 5, name: 'x' }] }, 'bad_place');
  await bad({ entries: [{ place: 1, member_id: 9999 }] }, 'bad_member');
  await bad({ photos: Array(5).fill(TINY) }, 'too_many_photos');

  const id = (await a.call('/results', { method: 'POST', body: { ...ok, photos: [TINY, TINY, TINY] } })).data.id;
  const ph = (await a.call('/results')).data.rows[0].photos;
  // 남은 자리는 1장 — 2장 더하면 거절, 1장 빼고 2장 더하면 통과
  assert.strictEqual((await a.call(`/results/${id}`, { method: 'PATCH', body: { photos: [TINY, TINY] } })).data.error, 'too_many_photos');
  assert.strictEqual((await a.call(`/results/${id}`, { method: 'PATCH', body: { photos: [TINY, TINY], remove_photos: [ph[0].id] } })).status, 200);
  await app.settle();
  assert.ok(!fs.existsSync(up(app, ph[0].photo)));
  const now = (await a.call('/results')).data.rows[0].photos;
  assert.strictEqual(now.length, 4);

  // 회원을 지워도 입상 기록은 이름으로 남는다
  assert.strictEqual((await a.call(`/members/${app.memberId}`, { method: 'DELETE' })).status, 200);
  const r = (await a.call('/results')).data.rows[0];
  assert.deepStrictEqual(r.entries.map(e => [e.member_id, e.name]), [[null, 'Батбаяр']]);

  assert.strictEqual((await a.call(`/results/${id}`, { method: 'DELETE' })).status, 200);
  await app.settle();
  for (const p of now) assert.ok(!fs.existsSync(up(app, p.photo)));
  assert.deepStrictEqual((await a.call('/results')).data.rows, []);
  app.close();
});
