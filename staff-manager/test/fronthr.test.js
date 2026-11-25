const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadApp } = require('./apphost');

// 인사 탭 화면 조각 (hr.js 는 app.js 다음에 불러온다)
function loadHR() {
  const ctx = loadApp();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'hr.js'), 'utf8'), ctx, { filename: 'hr.js' });
  return (code) => vm.runInContext(code, ctx);
}

test('근무표 칸: 근무·휴가·지각·결근, 편집 가능한 칸만 누를 수 있음', () => {
  const run = loadHR();
  const r = { staff_id: 5, editable: true, cells: { '2026-11-30': { start: '09:00', end: '18:00', note: '' }, '2026-12-01': { start: '09:00', end: '18:00' } },
    leave: { '2026-12-02': '연차' }, att: { '2026-11-30': { in: '09:12', late: 12 }, '2026-12-01': { absent: true } } };
  const cell = run('shiftCell');
  assert.ok(cell(r, '2026-11-30', '2026-12-02').includes('지각 +12분'));
  assert.ok(cell(r, '2026-12-01', '2026-12-02').includes('결근'));
  assert.ok(cell(r, '2026-12-02', '2026-12-02').includes('🌴 연차'));
  assert.ok(cell(r, '2026-12-03', '2026-12-02').includes('휴무'));
  assert.ok(cell(r, '2026-11-30', '').includes('data-cell="5|2026-11-30"'));
  assert.ok(!cell({ ...r, editable: false }, '2026-11-30', '').includes('data-cell'));
});

test('조직도, 구성원', () => {
  const run = loadHR();
  const org = run('orgHtml')({ admins: ['전아름'], gm: ['미가'], sites: [{ site: '센터', managers: ['톨가'], staff: [{ name: '잉해', label: '센터 청소' }] }] });
  assert.ok(org.includes('톨가') && org.includes('잉해') && org.includes('미가'));
  const u = { id: 7, name: '바트', label: '피트니스 리셉션', is_active: 1, phone: '9911' };
  const mf = run('memberForm')(u);
  assert.ok(mf.includes('9911') && !mf.includes('pay_rate'));
});
