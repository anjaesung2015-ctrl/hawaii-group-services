const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { I18N, t } = require('../public/i18n.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('ko/mn 사전 키가 완전히 일치한다', () => {
  const ko = Object.keys(I18N.ko).sort();
  const mn = Object.keys(I18N.mn).sort();
  const missingMn = ko.filter(k => !I18N.mn[k]);
  const extraMn = mn.filter(k => !I18N.ko[k]);
  assert.deepStrictEqual(missingMn, [], '몽골어 번역이 빠진 키: ' + missingMn.join(', '));
  assert.deepStrictEqual(extraMn, [], '한국어에 없는 몽골어 키: ' + extraMn.join(', '));
});

test('빈 번역이 없다', () => {
  for (const lang of ['ko', 'mn']) {
    for (const [k, v] of Object.entries(I18N[lang])) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang}.${k} 가 비어있음`);
    }
  }
});

test('index.html의 data-i18n 키가 모두 사전에 있다', () => {
  const html = read('index.html');
  const keys = [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 0, 'index.html에 data-i18n 표시가 하나도 없음');
  const missing = [...new Set(keys)].filter(k => !I18N.ko[k]);
  assert.deepStrictEqual(missing, [], '사전에 없는 키: ' + missing.join(', '));
});

test('app.js에서 쓰는 t() 키가 모두 사전에 있다', () => {
  const js = read('app.js');
  // 완전한 t('키') 호출만 검사 (t('freeHint_' + period) 같은 조합형은 제외)
  const keys = [...js.matchAll(/\bt\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*[,)]/g)].map(m => m[1]);
  assert.ok(keys.length > 0, 'app.js에 t() 호출이 하나도 없음');
  const missing = [...new Set(keys)].filter(k => !I18N.ko[k]);
  assert.deepStrictEqual(missing, [], '사전에 없는 키: ' + missing.join(', '));
});

test('{변수} 자리표시자가 ko/mn 양쪽에서 같다', () => {
  for (const k of Object.keys(I18N.ko)) {
    const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepStrictEqual(vars(I18N.mn[k]), vars(I18N.ko[k]), `${k} 의 자리표시자가 다름`);
  }
});

test('t()가 변수를 치환한다', () => {
  assert.strictEqual(t('doneCount', { done: 3, total: 5 }), '3/5 완료');
  assert.strictEqual(t('pwSetFor', { name: '미가' }), '미가 님 새 비밀번호 설정');
});

test('없는 키는 키 이름을 그대로 돌려준다', () => {
  assert.strictEqual(t('없는키'), '없는키');
});
