const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp } = require('./apphost');

// 일일보고 화면 조각 — 매니저는 입력칸, 사장님은 읽기 + 확인/코멘트
const REP = { cash: 300000, card: 500000, transfer: null, target: 1000000, sales: 800000, rate: 80,
  headcount: 4, new_members: 1, renewals: 2, decision: '수리 승인', settle_ok: 1, boss_ok: 0, by: '바트' };

test('매니저 입력칸: 숫자 7칸 + 글 4칸 + 정산 체크 + 저장 버튼', () => {
  const ctx = loadApp();
  const html = vm.runInContext('repForm', ctx)('피트니스', REP, '2026-12-01');
  assert.strictEqual((html.match(/inputmode="numeric"/g) || []).length, 7);
  assert.strictEqual((html.match(/<textarea/g) || []).length, 4);
  assert.ok(html.includes('data-k="settle_ok" checked'));
  assert.ok(html.includes('300,000'));
  assert.ok(html.includes('data-save="피트니스"'));
});

test('사장님 보기: 확인 체크와 코멘트 칸, 매니저 보기엔 없음', () => {
  const ctx = loadApp();
  ctx.state.isBoss = true;
  const view = vm.runInContext('repView', ctx);
  const b = view('센터', REP, '2026-12-01');
  assert.ok(b.includes('data-bok="센터"'));
  assert.ok(b.includes('data-bcm="센터"'));
  assert.ok(b.includes('수리 승인'));
  ctx.state.isBoss = false;
  assert.ok(!view('센터', REP, '2026-12-01').includes('data-bok'));
});

test('일일보고 탭은 사장님·매니저만', () => {
  const ctx = loadApp();
  const hidden = vm.runInContext('tabHidden', ctx);
  ctx.state.isBoss = false; ctx.state.managerSite = null;
  assert.strictEqual(hidden('rep'), true);
  ctx.state.managerSite = '센터';
  assert.strictEqual(hidden('rep'), false);
  assert.strictEqual(hidden('score'), true);
  ctx.state.isBoss = true;
  assert.strictEqual(hidden('rep'), false);
});

test('총매출·달성률 요약', () => {
  const ctx = loadApp();
  const html = vm.runInContext('repSummary', ctx)(REP);
  assert.ok(html.includes('800,000'));
  assert.ok(html.includes('80%'));
});
