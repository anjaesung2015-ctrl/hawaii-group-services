// 화면 문구 — 2026-10-16부터 영어 하나만 쓴다 (한국어/몽골어 쌍은 걷어냈다).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('사전은 영어 하나뿐이다', async () => {
  const { DICT, LANG } = await import('../public/js/i18n.js');
  assert.deepStrictEqual(Object.keys(DICT), ['en']);
  assert.strictEqual(LANG, 'en');
});

test('빈 문구가 없고 요일·달 이름이 갖춰져 있다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  for (const [k, v] of Object.entries(DICT.en)) {
    if (Array.isArray(v)) { assert.ok(v.length === 7 || v.length === 12, `${k} 길이`); continue; }
    assert.ok(typeof v === 'string' && v.trim(), `${k} 가 비어있다`);
  }
  assert.strictEqual(DICT.en.dow.length, 7);
  assert.strictEqual(DICT.en.months.length, 12);
});

// 화면 문구에 한글·키릴이 남아 있으면 영어 전환이 덜 된 것이다.
// 다만 회칙 문서의 언어 이름('한국어', 'Монгол')은 그 언어로 보여야 맞다.
test('화면 문구는 영어다 (회칙 언어 이름만 예외)', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const OK = new Set(['rulesLangKo', 'rulesLangMn']);
  const bad = [];
  for (const [k, v] of Object.entries(DICT.en)) {
    if (Array.isArray(v) || OK.has(k)) continue;
    if (/[가-힣]|[Ѐ-ӿ]/.test(v)) bad.push(`${k} = ${v}`);
  }
  assert.deepStrictEqual(bad, [], '영어가 아닌 문구');
});

test('{변수} 자리표시자가 쓰이는 곳에 그대로 있다', async () => {
  const { t } = await import('../public/js/i18n.js');
  assert.strictEqual(t('courtsN', { n: 3 }), '3 courts');
  assert.strictEqual(t('membersN', { n: 12 }), '12 members');
  assert.strictEqual(t('없는키'), '없는키');
});

test('날짜·달·상대시간 표시', async () => {
  const { fmtDate, fmtMonth, fmtMoney } = await import('../public/js/i18n.js');
  assert.strictEqual(fmtDate('2026-11-04'), 'Nov 4 (Wed)');
  assert.strictEqual(fmtMonth('2026-11'), 'November 2026');
  assert.strictEqual(fmtMoney(200000), '200,000');
});

test('index.html 의 data-i18n 키가 모두 사전에 있다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const keys = [...read('index.html').matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 0);
  assert.deepStrictEqual([...new Set(keys)].filter(k => !(k in DICT.en)), [], '사전에 없는 키');
});

test('화면 코드에서 쓰는 t() 키가 모두 사전에 있다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const files = ['js/app.js', 'js/ui.js', 'js/views/home.js', 'js/views/schedule.js',
                 'js/views/dues.js', 'js/views/notices.js', 'js/views/members.js',
                 'js/views/board.js', 'js/views/rules.js', 'js/views/org.js', 'js/views/push.js',
                 'js/views/install.js', 'js/views/join.js', 'js/views/elite.js', 'js/views/elite-me.js'];
  const missing = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*[,)]/g)) {
      if (!(m[1] in DICT.en)) missing.add(`${f}:${m[1]}`);
    }
  }
  assert.deepStrictEqual([...missing], []);
});

test('언어 전환 버튼은 사라졌다 (영어 하나)', () => {
  const html = read('index.html');
  assert.ok(!/data-lang-set|data-lang-toggle/.test(html), '언어 버튼이 남아있다');
  assert.ok(!/setLang/.test(read('js/app.js')), 'setLang 호출이 남아있다');
});

test('서비스워커가 캐시하는 파일이 실제로 있다', () => {
  const sw = read('sw.js');
  const list = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const paths = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(p => p !== './');
  assert.ok(paths.length > 5);
  for (const p of paths) assert.ok(fs.existsSync(path.join(PUB, p)), `${p} 가 없다`);
});

test('PWA 아이콘·manifest 가 준비돼 있다', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.strictEqual(m.display, 'standalone');
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(PUB, icon.src)), `${icon.src} 가 없다`);
});

// /booking/ 같은 하위 경로에 올려도 동작해야 한다 — 절대 경로가 하나라도 남으면 거기서 깨진다
test('화면 자원·API 경로가 모두 상대 경로다', () => {
  const html = read('index.html');
  assert.deepStrictEqual([...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(m => m[1]), [], 'index.html 절대 경로');
  const m = JSON.parse(read('manifest.json'));
  assert.ok(!m.start_url.startsWith('/') && !m.scope.startsWith('/'));
  assert.ok(m.icons.every(i => !i.src.startsWith('/')));
  assert.match(read('js/ui.js'), /fetch\(`api\$\{path\}`/, 'API 호출이 상대 경로가 아니다');
  assert.match(read('js/app.js'), /register\('sw\.js'/, '서비스워커 등록이 상대 경로가 아니다');
});

test('회원이 쓴 글은 lang=en 으로 요청한다 (자동 번역)', () => {
  assert.match(read('js/views/notices.js'), /notices\?lang=en/);
  assert.match(read('js/views/board.js'), /posts\?lang=en/);
  assert.match(read('js/views/schedule.js'), /events\?lang=en/);
  assert.match(read('js/views/home.js'), /upcoming\?limit=3&lang=en/);
  // 번역문 옆에 원문을 함께 보여준다
  for (const f of ['js/views/notices.js', 'js/views/board.js', 'js/views/schedule.js']) {
    assert.match(read(f), /origHtml/, `${f} 에 원문 표시가 없다`);
  }
});
