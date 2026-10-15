// 브라우저가 없으니 DOM만 흉내 내서 app.js를 그대로 실행하고 렌더 함수를 돌려본다.
// 화면 쪽 테스트가 여럿이라 하네스를 여기 한 벌만 둔다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// app.js의 함수들은 const 선언이라 전역 객체에 안 붙는다 — 꺼내서 물려준다.
const EXPORTED = ['state', 'renderCheckItem', 'itemDateFor', 'historyCards', 'overviewCards', 'BOSS_TABS'];

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
    // app.js 는 불러오는 순간 boot() 을 돌린다. 여기선 서버가 없으니 '로그인 안 된 빈 화면'을 흉내 낸다.
    // 목록 요청에 빈 배열을 돌려주지 않으면 boot() 이 테스트가 끝난 뒤에 깨져서
    // 엉뚱한 테스트가 실패한다(처리되지 않은 거부).
    fetch: async () => ({ ok: false, status: 401, json: async () => [] }),
    addEventListener() {}, removeEventListener() {}, alert() {}, scrollTo() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['i18n.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  for (const name of EXPORTED) ctx[name] = vm.runInContext(name, ctx);
  return ctx;
}

module.exports = { loadApp };
