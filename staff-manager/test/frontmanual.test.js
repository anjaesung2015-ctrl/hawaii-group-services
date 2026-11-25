const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp } = require('./apphost');

// 설명서 반영 화면: 예시 버튼, 규칙, 주간 KPI, 일일보고 센터 칸
const GUIDE = {
  examples: { '예시 5': { who: '리셉션·카운터', what: '마감 정산표', ko: '현금 450,000₮\n카드', mn: 'Бэлэн 450,000₮' } },
  rules: [{ ko: '일요일 휴무', mn: 'Ням гараг амарна' }],
};
const run = (ctx, code) => vm.runInContext(code, ctx);

test('체크리스트 항목에 예시 버튼, 누르면 보일 예시 내용(한/몽)', () => {
  const ctx = loadApp();
  ctx.state.period = 'today';
  ctx.__G = GUIDE;
  run(ctx, 'GUIDE = __G');
  const html = ctx.renderCheckItem({ id: 1, title: '정산', tpl_key: 'x|정산', tpl_when: '마감', tpl_ex: '예시 5', item_date: ctx.itemDateFor('today') });
  assert.ok(html.includes('data-ex="예시 5"'));
  const ex = run(ctx, "exHtml('예시 5')");
  assert.ok(ex.includes('마감 정산표'));
  assert.ok(ex.includes('450,000'));
  run(ctx, "setLang('mn')");
  assert.ok(run(ctx, "exHtml('예시 5')").includes('Бэлэн'));
  assert.ok(run(ctx, "exBtn('예시 5')").includes('Жишээ 5'));
});

test('규칙은 체크리스트 머리에 접힌 상자로', () => {
  const ctx = loadApp();
  ctx.__G = GUIDE;
  run(ctx, 'GUIDE = __G');
  const head = run(ctx, 'chkHead')([{ id: 1, tpl_key: 'a', done: 0 }]);
  assert.ok(head.includes('<details class="rules">'));
  assert.ok(head.includes('일요일 휴무'));
});

test('주간 KPI 입력칸: 과제 3줄, 센터만 코트 가동률', () => {
  const ctx = loadApp();
  const form = run(ctx, 'kpiForm');
  const fit = form('피트니스', { tasks: [{ t: '이마트 제휴', goal: '10명', done: 1 }] }, '2026-11-30');
  assert.strictEqual((fit.match(/data-ti=/g) || []).length, 3);
  assert.ok(fit.includes('value="이마트 제휴"'));
  assert.ok(!fit.includes('data-k="court_util"'));
  assert.ok(form('센터', null, '2026-11-30').includes('data-k="court_util"'));
  assert.ok(fit.includes('data-wsave="피트니스"'));
});

test('주간 KPI 보기: 대표는 승인 체크, 매니저는 없음', () => {
  const ctx = loadApp();
  const view = run(ctx, 'kpiView');
  const k = { tasks: [{ t: '재등록 6명', done: 0 }], target: 100, boss_ok: 0, by: '구엔' };
  ctx.state.isBoss = true;
  assert.ok(view('피트니스', k).includes('data-bok="피트니스"'));
  ctx.state.isBoss = false;
  assert.ok(!view('피트니스', k).includes('data-bok'));
  assert.ok(view('피트니스', k).includes('재등록 6명'));
});

test('주간KPI 탭은 매니저·대표만, 일일보고 센터엔 가동률 칸', () => {
  const ctx = loadApp();
  const hidden = run(ctx, 'tabHidden');
  ctx.state.isBoss = false; ctx.state.managerSite = null;
  assert.strictEqual(hidden('kpi'), true);
  ctx.state.managerSite = '피트니스';
  assert.strictEqual(hidden('kpi'), false);
  assert.ok(run(ctx, 'repForm')('센터', null, '2026-12-01').includes('data-k="court_util"'));
  assert.ok(run(ctx, 'repTasks')([{ ko: '대관 영업', mn: 'Түрээс', out: '연락처', ex: '예시 13' }]).includes('대관 영업'));
});
