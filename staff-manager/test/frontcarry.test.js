const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 브라우저가 없으니 DOM만 흉내 내서 app.js를 그대로 실행하고 렌더 함수를 돌려본다.
// (이월 항목이 화면에 어떻게 그려지는지 — 날짜 꼬리표·수정 잠금 — 를 지킨다)
function loadApp() {
  const dir = path.join(__dirname, '..', 'public');
  const el = {
    innerHTML: '', value: '', textContent: '', checked: false, readOnly: false, disabled: false,
    dataset: {}, style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, focus() {}, remove() {}, setAttribute() {}, appendChild() {},
    querySelector: () => el, querySelectorAll: () => [],
  };
  const ctx = {
    console, Intl, Date, Math, JSON, URLSearchParams, Promise, setTimeout, clearTimeout,
    document: {
      querySelector: () => el, querySelectorAll: () => [], getElementById: () => el,
      createElement: () => el, addEventListener() {}, body: el, documentElement: el,
    },
    navigator: { language: 'ko' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload() {}, href: '', pathname: '/staff-manager/' },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    addEventListener() {}, removeEventListener() {}, alert() {}, scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['i18n.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  // app.js의 state/renderCheckItem 은 const 선언이라 전역 객체에 안 붙는다 — 꺼내서 물려준다.
  for (const name of ['state', 'renderCheckItem', 'itemDateFor']) {
    ctx[name] = vm.runInContext(name, ctx);
  }
  return ctx;
}

const BIZ = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = (off = 0) => BIZ.format(new Date(Date.now() + off * 86400000));
const tag = iso => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}`; };

test('app.js가 브라우저 없이도 끝까지 실행된다', () => {
  const ctx = loadApp();
  assert.strictEqual(typeof ctx.renderCheckItem, 'function');
  assert.strictEqual(typeof ctx.dayTag, 'function');
});

test('오늘 적은 할 일은 날짜 꼬리표 없이 그대로 고칠 수 있다', () => {
  const ctx = loadApp();
  Object.assign(ctx.state, { period: 'today', dayOffset: 0, isBoss: false, staffId: 1 });
  const html = ctx.renderCheckItem({ id: 1, title: '오늘 일', memo: '', done: 0, item_date: day(0) });
  assert.ok(!html.includes('class="from"'), '꼬리표가 붙으면 안 된다');
  assert.ok(!/class="ti"[^>]*readonly/.test(html), '오늘 것은 고칠 수 있어야 한다');
  assert.ok(html.includes('class="del"'), '오늘 것은 지울 수 있어야 한다');
});

test('이월된 할 일에는 원래 날짜가 붙고 글은 잠긴다 (체크는 열려있다)', () => {
  const ctx = loadApp();
  Object.assign(ctx.state, { period: 'today', dayOffset: 0, isBoss: false, staffId: 1 });
  const html = ctx.renderCheckItem({ id: 2, title: '파라솔 설치하기', memo: '', done: 0, item_date: day(-1) });
  assert.ok(html.includes(`<span class="from">${tag(day(-1))}</span>`), '원래 날짜 꼬리표: ' + html);
  assert.ok(html.includes('item carry') || html.includes(' carry"'), '이월 표시 클래스');
  assert.ok(/class="ti"[^>]*readonly/.test(html), '지난 기록이라 제목은 못 고친다');
  assert.ok(!/type="checkbox"[^>]*disabled/.test(html), '완료 체크는 할 수 있어야 한다');
  assert.ok(!html.includes('class="del"'), '지난 기록은 못 지운다');
});

test('사장님은 이월된 할 일도 고칠 수 있다', () => {
  const ctx = loadApp();
  Object.assign(ctx.state, { period: 'today', dayOffset: 0, isBoss: true, targetStaff: 1 });
  const html = ctx.renderCheckItem({ id: 3, title: '리모콘 찾아보기', memo: '', done: 0, item_date: day(-1) });
  assert.ok(html.includes('class="from"'), '사장님 화면에도 날짜는 보인다');
  assert.ok(!/class="ti"[^>]*readonly/.test(html), '사장님은 고칠 수 있다');
  assert.ok(html.includes('class="del"'));
});

test('dayTag가 앞의 0을 떼고 8/13 형태로 만든다', () => {
  const ctx = loadApp();
  assert.strictEqual(ctx.dayTag('2026-08-13'), '8/13');
  assert.strictEqual(ctx.dayTag('2026-11-05'), '11/5');
});
