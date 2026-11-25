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

test('휴가·결재 줄, 조직도, 구성원(대표만 급여 칸), 명세서', () => {
  const run = loadHR();
  const lv = run('leaveLine')({ name: '바트', kind: '연차', start_date: '2026-12-05', end_date: '2026-12-08', days: 3, status: 'pending', reason: '가족' });
  assert.ok(lv.includes('12/05~12/08') && lv.includes('승인 대기') && lv.includes('가족'));
  const ap = run('apLine')({ title: '수건', name: '바트', kind: '구매·발주', created_at: '2026-12-02 10:00', amount: 250000, status: 'boss', mgr_by: '구엔' });
  assert.ok(ap.includes('250,000₮') && ap.includes('대표 승인 대기') && ap.includes('① 구엔'));
  const org = run('orgHtml')({ admins: ['전아름'], gm: ['미가'], sites: [{ site: '센터', managers: ['톨가'], staff: [{ name: '잉해', label: '센터 청소' }] }] });
  assert.ok(org.includes('톨가') && org.includes('잉해') && org.includes('미가'));
  const u = { id: 7, name: '바트', label: '피트니스 리셉션', is_active: 1, leave: { left: 12 }, phone: '9911', pay_type: 'hour', pay_rate: 8000 };
  run('state').isBoss = false;
  assert.ok(!run('memberForm')(u).includes('pay_rate'));
  run('state').isBoss = true;
  assert.ok(run('memberForm')(u).includes('data-mf="pay_rate"'));
  const slip = run('slipHtml')({ month: '2026-12', hours: 160, work_days: 22, unpaid_days: 0, base: 1300000, gross: 1300000, tax: 1, si: 149500, pit: 115050, net: 1035450 });
  assert.ok(slip.includes('1,035,450₮') && slip.includes('2026년 12월'));
  run("setLang('mn')");
  assert.ok(run('leaveLine')({ name: 'B', kind: '병가', start_date: '2026-12-05', end_date: '2026-12-05', days: 1, status: 'approved' }).includes('Өвчний'));
});
