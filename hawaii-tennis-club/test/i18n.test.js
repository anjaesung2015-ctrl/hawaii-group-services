// 화면 문구 — 몽골어/한국어 두 사전이 어긋나지 않게 지킨다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('몽골어·한국어 사전의 키가 완전히 같다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const mn = Object.keys(DICT.mn).sort();
  const ko = Object.keys(DICT.ko).sort();
  assert.deepStrictEqual(ko.filter(k => !(k in DICT.mn)), [], '몽골어가 빠진 키');
  assert.deepStrictEqual(mn.filter(k => !(k in DICT.ko)), [], '한국어가 빠진 키');
});

test('빈 문구가 없다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  for (const lang of ['mn', 'ko']) {
    for (const [k, v] of Object.entries(DICT[lang])) {
      if (Array.isArray(v)) { assert.ok(v.length === 7, `${lang}.${k} 요일이 7개가 아니다`); continue; }
      assert.ok(typeof v === 'string' && v.trim(), `${lang}.${k} 가 비어있다`);
    }
  }
});

test('{변수} 자리표시자가 두 언어에서 같다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const k of Object.keys(DICT.ko)) {
    if (Array.isArray(DICT.ko[k])) continue;
    assert.deepStrictEqual(vars(DICT.mn[k]), vars(DICT.ko[k]), `${k} 의 자리표시자가 다르다`);
  }
});

test('기본 언어는 몽골어다', async () => {
  const { LANG } = await import('../public/js/i18n.js');
  assert.strictEqual(LANG, 'mn');
});

test('t() 가 변수를 끼워 넣고, 없는 키는 키를 그대로 돌려준다', async () => {
  const { t } = await import('../public/js/i18n.js');
  assert.strictEqual(t('courtsN', { n: 3 }), '3 корт');
  assert.strictEqual(t('없는키'), '없는키');
});

test('index.html 의 data-i18n 키가 모두 사전에 있다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const keys = [...read('index.html').matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 0);
  assert.deepStrictEqual([...new Set(keys)].filter(k => !(k in DICT.mn)), [], '사전에 없는 키');
});

test('화면 코드에서 쓰는 t() 키가 모두 사전에 있다', async () => {
  const { DICT } = await import('../public/js/i18n.js');
  const files = ['js/app.js', 'js/ui.js', 'js/views/home.js', 'js/views/schedule.js',
                 'js/views/dues.js', 'js/views/notices.js', 'js/views/members.js'];
  const missing = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*[,)]/g)) {
      if (!(m[1] in DICT.mn)) missing.add(`${f}:${m[1]}`);
    }
  }
  assert.deepStrictEqual([...missing], []);
});

test('서비스워커가 캐시하는 파일이 실제로 있다', () => {
  const sw = read('sw.js');
  const list = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const paths = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(p => p !== './');
  assert.ok(paths.length > 5);
  for (const p of paths) {
    assert.ok(fs.existsSync(path.join(PUB, p)), `${p} 가 없다`);
  }
});

test('PWA 아이콘·manifest 가 준비돼 있다', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.strictEqual(m.display, 'standalone');
  for (const icon of m.icons) {
    assert.ok(fs.existsSync(path.join(PUB, icon.src)), `${icon.src} 가 없다`);
  }
});

// /club/ 같은 하위 경로에 올려도 동작해야 한다 — 절대 경로가 하나라도 남으면 거기서 깨진다
test('화면 자원·API 경로가 모두 상대 경로다', () => {
  const html = read('index.html');
  const bad = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(bad, [], 'index.html 에 절대 경로가 남았다');

  const m = JSON.parse(read('manifest.json'));
  assert.ok(!m.start_url.startsWith('/'), 'manifest start_url 이 절대 경로다');
  assert.ok(!m.scope.startsWith('/'), 'manifest scope 가 절대 경로다');
  assert.ok(m.icons.every(i => !i.src.startsWith('/')), 'manifest 아이콘이 절대 경로다');

  assert.match(read('js/ui.js'), /fetch\(`api\$\{path\}`/, 'API 호출이 상대 경로가 아니다');
  assert.match(read('js/app.js'), /register\('sw\.js'/, '서비스워커 등록이 상대 경로가 아니다');
});
