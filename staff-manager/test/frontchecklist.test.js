const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadApp } = require('./apphost');

// 체크리스트 항목 화면 — 문구는 못 고치고(입력칸이 아님), 직원에겐 삭제 버튼이 없다.
const TPL = { id: 9, title: '유니폼 착용', memo: '', done: 0, tpl_key: '피트-리셉션|유니폼 착용',
  tpl_when: '출근 15분 내', tpl_when_mn: 'Ирснээс 15 мин', tpl_mn: 'Дүрэмт хувцас' };

test('체크리스트 항목: 언제 꼬리표 + 문구, 제목 입력칸 없음, 직원은 삭제 버튼 없음', () => {
  const ctx = loadApp();
  ctx.state.period = 'today';
  const html = ctx.renderCheckItem({ ...TPL, item_date: ctx.itemDateFor('today') });
  assert.ok(html.includes('출근 15분 내'));
  assert.ok(html.includes('유니폼 착용'));
  assert.ok(!html.includes('class="ti"'));
  assert.ok(!html.includes('class="del"'));
  assert.ok(html.includes('class="memo"'));
});

test('몽골어 화면에서는 몽골어 문구', () => {
  const ctx = loadApp();
  vm.runInContext("setLang('mn')", ctx);
  ctx.state.period = 'today';
  const html = ctx.renderCheckItem({ ...TPL, item_date: ctx.itemDateFor('today') });
  assert.ok(html.includes('Дүрэмт хувцас'));
  assert.ok(html.includes('Ирснээс 15 мин'));
});

test('완료율 머리줄은 체크리스트만 센다', () => {
  const ctx = loadApp();
  const chkHead = vm.runInContext('chkHead', ctx);
  const html = chkHead([{ ...TPL, done: 1 }, { ...TPL, id: 10 }, { id: 11, title: '내 일', done: 1 }]);
  assert.ok(html.includes('1/2'));
  assert.strictEqual(chkHead([{ id: 11, title: '내 일' }]), '');
});

test('대표 직원 현황: 체크리스트 줄에도 지우기 버튼, 직원이 적은 줄엔 없음', () => {
  const { loadApp } = require('./apphost');
  const ctx = loadApp();
  ctx.state.isBoss = true;
  ctx.state.period = 'today';
  const html = ctx.overviewCards([{ staff_id: 1, name: '잉해', items: [
    { id: 11, title: '바닥 청소', tpl_key: '센터-청소|바닥 청소', tpl_when: '출근 15분 내', done: 0 },
    { id: 12, title: '내가 적은 것', done: 0 }] }], true);
  assert.ok(html.includes('data-del="11"'));
  assert.ok(!html.includes('data-del="12"'));
});
