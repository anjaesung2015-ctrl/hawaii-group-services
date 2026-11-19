// 홈 팝업 — 오늘 아직 안 본 팝업을 전부 차례로, 닫은 것은 그날 다시 안 뜬다
const test = require('node:test');
const assert = require('node:assert');

function setup(list) {
  const store = {};
  const root = { innerHTML: '', firstElementChild: {} };
  global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  global.document = { getElementById: id => (id === 'modalRoot' ? root : { hidden: true }), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } };
  global.window = global.window || { addEventListener() {} };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => list });
  return { store, root, setList: (l) => { list = l; } };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let n = 0;
const fresh = () => import(`../public/js/views/popup.js?x=${n++}`);   // 앱을 새로 연 것처럼
const state = { me: { id: 1 }, rules_agreed: true, tab: 'home' };

test('팝업 — 안 본 것 전부 차례로, 같은 날 다시 열면 안 뜨고, 새 팝업은 바로 뜬다', async () => {
  const { store, root, setList } = setup([{ id: 2, title: 'A' }, { id: 1, title: 'B' }]);
  const { today } = await import('../public/js/ui.js');
  const click = (sel) => root.firstElementChild.onclick({ target: { closest: (s) => (s === sel ? {} : null) } });

  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>A<\/h3>/);
  assert.match(root.innerHTML, /1 \/ 2/);                           // 두 개면 1/2

  // 닫기 전에 앱이 꺼지면(새로 열면) 다시 뜬다 — 아직 '봤다'가 아니다
  assert.strictEqual(store.htc_popup_seen, undefined);
  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>A<\/h3>/);
  click('[data-close]');                                              // 다음
  assert.match(root.innerHTML, /<h3>B<\/h3>/);
  click('[data-close]');                                              // 닫기
  assert.strictEqual(root.innerHTML, '');
  assert.deepStrictEqual(JSON.parse(store.htc_popup_seen), { date: today(), ids: [2, 1] });

  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.strictEqual(root.innerHTML, '');                             // 같은 날 또 열면 안 뜬다

  setList([{ id: 3, title: 'C' }, { id: 2, title: 'A' }, { id: 1, title: 'B' }]);   // 오늘 새 팝업
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>C<\/h3>/);
  assert.doesNotMatch(root.innerHTML, /popup-count/);                 // 새 것 하나만
  click('[data-close]');
  assert.deepStrictEqual(JSON.parse(store.htc_popup_seen).ids, [2, 1, 3]);

  // 옛 저장 형식 { date: 오늘, id } — 그 하나만 본 것으로
  store.htc_popup_seen = JSON.stringify({ date: today(), id: 2 });
  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /<h3>C<\/h3>/);
  assert.match(root.innerHTML, /1 \/ 2/);                           // C, B

  store.htc_popup_seen = JSON.stringify({ date: '2000-01-01', ids: [3, 2, 1] });   // 다음 날 — 다시 전부
  root.innerHTML = '';
  (await fresh()).maybeShowPopups(state); await wait(800);
  assert.match(root.innerHTML, /1 \/ 3/);
});
