// 로그인 버튼 연타가 서버 요청을 여러 번 만들지 않는지 검증한다.
//
// 2026-08-13 미가의 로그인 실패 로그에서 같은 초에 요청이 2건씩 찍혔다.
// 원인은 자동 중복 전송이 아니라 "요청 중 아무 반응이 없어서" 안 눌린 줄 알고 다시 누른 것.
// (nginx 로그의 시도 횟수가 1~3건으로 불규칙했던 게 근거 — 코드 버그면 항상 정확히 배수였을 것)
// 그래서 요청이 나가 있는 동안 버튼을 잠그고 진행 표시를 띄운다.
//
// 브라우저 없이 public/app.js 를 vm 컨텍스트에서 실제로 실행해 검증한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'public');
const tick = (ms) => new Promise(r => setTimeout(r, ms));
const LOGIN_DELAY = 40;   // 서버 응답이 오기까지 걸리는 시간(그 사이가 연타 구간)

function bootApp({ loginOk = false } = {}) {
  const els = new Map();
  const calls = [];

  function el(sel) {
    if (els.has(sel)) return els.get(sel);
    const e = {
      _sel: sel, style: {}, dataset: {}, value: '', textContent: '', placeholder: '',
      disabled: false, tagName: 'DIV', innerHTML: '',
      classList: { add() {}, remove() {}, contains: () => false },
      querySelector: (s) => el(sel + ' ' + s),
      querySelectorAll: () => [],
      insertAdjacentHTML() {}, focus() {}, blur() {}, addEventListener() {},
    };
    els.set(sel, e);
    return e;
  }

  async function fakeFetch(url, opts) {
    calls.push({ url, opts });
    if (url.includes('/login')) {
      await tick(LOGIN_DELAY);
      if (loginOk) return { ok: true, status: 200, json: async () => ({ isBoss: false, staff_id: 1, name: '미가' }) };
      return { ok: false, status: 401, json: async () => ({ error: 'bad_login' }) };
    }
    if (url.includes('/me')) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [] };   // staff-list 등
  }

  const ctx = {
    document: {
      documentElement: {}, title: '', hidden: false, activeElement: null,
      getElementById: (id) => el('#' + id),
      querySelector: el,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: { location: { reload() {} }, addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { language: 'ko-KR', languages: ['ko-KR'] },   // serviceWorker 없음 → 잔재제거 블록은 건너뜀
    localStorage: { getItem: () => null, setItem() {} },
    location: { reload() {} },
    fetch: fakeFetch,
    console, Date, Math, JSON, Intl, URLSearchParams, setTimeout, clearTimeout,
    Number, String, Object, Array, Map, Set, RegExp, Promise, Error,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['i18n.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
  }

  const loginCalls = () => calls.filter(c => c.url.includes('/login'));
  return { el, calls, loginCalls };
}

test('직원 로그인 버튼을 연타해도 요청은 한 번만 나간다', async () => {
  const { el, loginCalls } = bootApp();
  await tick(10);                       // boot() 완료 대기
  el('#nameSel').value = '미가';
  el('#staffPw').value = 'wrong';

  const click = el('#staffLoginBtn').onclick;
  click(); click(); click();            // 응답이 오기 전에 3번 연타

  await tick(LOGIN_DELAY + 40);
  assert.strictEqual(loginCalls().length, 1, `연타 3번에 요청이 ${loginCalls().length}건 나갔다`);
});

test('사장님 로그인 버튼도 연타에 한 번만 나간다', async () => {
  const { el, loginCalls } = bootApp();
  await tick(10);
  el('#bossPw').value = 'wrong';

  const click = el('#bossLoginBtn').onclick;
  click(); click();

  await tick(LOGIN_DELAY + 40);
  assert.strictEqual(loginCalls().length, 1, `연타 2번에 요청이 ${loginCalls().length}건 나갔다`);
});

test('요청 중에는 버튼이 잠기고, 끝나면 다시 눌린다', async () => {
  const { el } = bootApp();
  await tick(10);
  el('#nameSel').value = '미가';
  el('#staffPw').value = 'wrong';
  const btn = el('#staffLoginBtn');

  btn.onclick();
  await tick(10);                       // 아직 응답 전
  assert.strictEqual(btn.disabled, true, '요청 중인데 버튼이 잠기지 않았다');

  await tick(LOGIN_DELAY + 40);
  assert.strictEqual(btn.disabled, false, '응답이 끝났는데 버튼이 잠긴 채로 남았다');
});

test('실패한 뒤 비번을 고쳐 다시 로그인할 수 있다', async () => {
  const { el, loginCalls } = bootApp();
  await tick(10);
  el('#nameSel').value = '미가';
  el('#staffPw').value = 'wrong';
  const click = el('#staffLoginBtn').onclick;

  click();
  await tick(LOGIN_DELAY + 40);         // 1차 실패 완료
  el('#staffPw').value = 'miga1234';
  click();
  await tick(LOGIN_DELAY + 40);

  assert.strictEqual(loginCalls().length, 2, '두 번째 시도가 막혔다 — 버튼이 영구히 잠겼다');
});

test('다시 시도하면 이전 실패 메시지가 먼저 지워진다', async () => {
  const { el } = bootApp();
  await tick(10);
  el('#nameSel').value = '미가';
  el('#staffPw').value = 'wrong';
  const click = el('#staffLoginBtn').onclick;

  click();
  await tick(LOGIN_DELAY + 40);
  assert.notStrictEqual(el('#loginErr').textContent, '', '실패 메시지가 안 떴다');

  click();
  await tick(10);                       // 두 번째 요청 진행 중
  assert.strictEqual(el('#loginErr').textContent, '', '이전 실패 메시지가 남아 있어 반응이 없어 보인다');
});

test('요청 중에는 버튼에 진행 표시가 뜬다', async () => {
  const { el } = bootApp();
  await tick(10);
  el('#nameSel').value = '미가';
  el('#staffPw').value = 'wrong';
  const btn = el('#staffLoginBtn');
  const before = btn.textContent;

  btn.onclick();
  await tick(10);
  assert.notStrictEqual(btn.textContent, before, '요청 중인데 버튼 글자가 그대로다 (반응이 없어 보인다)');

  await tick(LOGIN_DELAY + 40);
  assert.strictEqual(btn.textContent, before, '끝난 뒤 버튼 글자가 원래대로 돌아오지 않았다');
});
