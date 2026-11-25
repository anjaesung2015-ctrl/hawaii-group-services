const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const createChecklist = require('../checklist');
const Database = require('better-sqlite3');
const { loadApp } = require('./apphost');

// 직무별 일주일 업무표: 모든 파트, 매일/요일/매월로 나눔
test('업무표 데이터: 10개 직무, 업무 전부', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY, name TEXT, pin_hash TEXT, is_active INTEGER DEFAULT 1, role TEXT DEFAULT 'staff')`);
  db.exec(`CREATE TABLE report_items (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, period TEXT, item_date TEXT, title TEXT, memo TEXT, done INTEGER DEFAULT 0, from_boss INTEGER DEFAULT 0)`);
  const tb = createChecklist(db, {}).table();
  assert.strictEqual(tb.length, 10);
  assert.strictEqual(tb.reduce((n, j) => n + j.tasks.length, 0), 118);
  const clean = tb.find(j => j.key === '피트-청소');
  assert.ok(clean.tasks.every(x => x.ko && x.when));
});

test('업무표 화면: 매일·요일별·매월 구역, 몽골어', () => {
  const ctx = loadApp();
  const job = { key: 'x', label_ko: '피트니스 매니저', label_mn: 'Фитнес менежер', tasks: [
    { when: '매일', ko: '체크리스트 확인', mn: 'Шалгах' }, { when: '화', ko: '신규 유치 기획', mn: 'Шинэ', ex: '예시 9' },
    { when: '매월 첫 월', ko: '월간 결산', mn: 'Сарын' }] };
  const html = vm.runInContext('jobTableHtml', ctx)(job);
  assert.ok(html.includes('매일'));
  assert.ok(html.includes('화요일'));
  assert.ok(html.includes('매월'));
  assert.ok(html.includes('data-ex="예시 9"'));
  assert.ok(html.includes('총 3개'));
  vm.runInContext("setLang('mn')", ctx);
  assert.ok(vm.runInContext('jobTableHtml', ctx)(job).includes('Фитнес менежер'));
});
