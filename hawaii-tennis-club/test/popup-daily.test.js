// 홈 팝업은 하루에 한 번, 한 개만 — 여러 개면 날마다 돌아가며
const test = require('node:test');
const assert = require('node:assert');

function setup(list) {
  const store = {};
  const root = { innerHTML: '', firstElementChild: {} };
  global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  global.document = { getElementById: id => (id === 'modalRoot' ? root : { hidden: true }), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } };
  global.window = global.window || { addEventListener() {} };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => list });
  return { store, root };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let n = 0;
const fresh = () => import(`../public/js/views/popup.js?x=${n++}`);   // 앱을 새로 연 것처럼
const state = { me: { id: 1 }, rules_agreed: true, tab: 'home' };

test('팝업 — 하루에 한 개, 같은 날 다시 열어도 안 뜨고, 다음 날엔 다음 팝업', async () => {
  const { store, root } = setup([{ id: 2, title: 'A' }, { id: 1, title: 'B' }]);
  const { today } = await import('../public/js/ui.js');

  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>A<\/h3>/);
  assert.doesNotMatch(root.innerHTML, /popup-count|<h3>B/);          // 한 개만 (1/2 없음)

  // 닫기 전에 앱이 꺼지면(새로 열면) 다시 뜬다 — 아직 '봤다'가 아니다
  assert.strictEqual(store.htc_popup_seen, undefined);
  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>A<\/h3>/);
  const closeIt = () => root.firstElementChild.onclick({ target: { closest: (s) => (s === '[data-close]' ? {} : null) } });
  closeIt();                                                          // 닫으면 오늘은 끝
  assert.strictEqual(JSON.parse(store.htc_popup_seen).id, 2);

  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.strictEqual(root.innerHTML, '');                             // 같은 날 또 열면 안 뜬다

  store.htc_popup_seen = JSON.stringify({ date: '2000-01-01', id: 2 });   // 다음 날
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>B<\/h3>/);
  closeIt();
  assert.strictEqual(JSON.parse(store.htc_popup_seen).date, today());

  store.htc_popup_seen = JSON.stringify({ date: '2000-01-02', id: 1 });   // 그 다음 날 — 처음으로
  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>A<\/h3>/);
});
