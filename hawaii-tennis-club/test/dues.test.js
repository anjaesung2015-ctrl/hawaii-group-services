// 회비 — 관리자 현황표·체크, 회원은 본인 것만
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { thisMonth } = require('../lib/db');

test('기본 금액은 월회비 200,000₮ · 입회비 300,000₮', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const s = (await a.call('/settings')).data;
  assert.strictEqual(s.monthly_fee, 200000);
  assert.strictEqual(s.joining_fee, 300000);
  app.close();
});

test('관리자가 설정에서 금액을 바꿀 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const s = (await a.call('/settings', { method: 'PUT', body: { monthly_fee: 250000, joining_fee: 350000 } })).data;
  assert.strictEqual(s.monthly_fee, 250000);
  assert.strictEqual((await a.call('/dues/grid')).data.monthly_fee, 250000);
  app.close();
});

test('회원은 금액을 바꿀 수 없다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/settings', { method: 'PUT', body: { monthly_fee: 1 } })).status, 403);
  app.close();
});

test('현황표에 활동 회원 전원이 나오고, 처음엔 미납 — 클럽 오너는 월회비 면제', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const g = (await a.call('/dues/grid')).data;
  assert.strictEqual(g.rows.length, 2);
  const owner = g.rows.find(r => r.member_id === app.adminId);
  assert.deepStrictEqual([owner.monthly.exempt, owner.monthly.reason, owner.monthly.amount], [true, 'owner', 0]);
  assert.strictEqual(g.rows.find(r => r.member_id === app.memberId).monthly.paid, false);
  assert.strictEqual(g.summary.members, 1);
  assert.strictEqual(g.summary.unpaid, 1);
  assert.strictEqual(g.summary.collected, 0);
  assert.strictEqual(g.summary.expected, 200000);
  app.close();
});

test('체크하면 완납 — 납부일과 방법이 남는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/dues/mark', {
    method: 'PUT',
    body: { member_id: app.memberId, kind: 'monthly', period: thisMonth(), paid: true, method: 'transfer', paid_at: '2026-10-07', note: '10월분' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.paid_at, '2026-10-07');
  assert.strictEqual(r.data.method, 'transfer');
  assert.strictEqual(r.data.note, '10월분');

  const g = (await a.call('/dues/grid')).data;
  const row = g.rows.find(x => x.member_id === app.memberId);
  assert.strictEqual(row.monthly.paid, true);
  assert.strictEqual(g.summary.paid, 1);
  assert.strictEqual(g.summary.collected, 200000);
  app.close();
});

test('같은 체크를 두 번 보내도 줄이 하나만 생긴다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const body = { member_id: app.memberId, kind: 'monthly', period: thisMonth(), paid: true, method: 'cash' };
  await a.call('/dues/mark', { method: 'PUT', body });
  await a.call('/dues/mark', { method: 'PUT', body });
  const c = app.db.prepare("SELECT COUNT(*) c FROM due WHERE member_id=? AND kind='monthly'").get(app.memberId).c;
  assert.strictEqual(c, 1);
  app.close();
});

test('미납으로 되돌릴 수 있다 (잘못 체크했을 때)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const base = { member_id: app.memberId, kind: 'monthly', period: thisMonth() };
  await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: true, method: 'cash' } });
  const back = await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: false } });
  assert.strictEqual(back.data.paid_at, null);
  assert.strictEqual((await a.call('/dues/grid')).data.summary.paid, 0);
  app.close();
});

test('이번 달 미납자 목록 — 완납하면 빠진다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  let u = (await a.call('/dues/unpaid')).data;
  assert.strictEqual(u.count, 1, '오너는 빠지고 회원 한 명');
  assert.ok(!u.rows.some(r => r.member_id === app.adminId));

  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'qpay' } });
  u = (await a.call('/dues/unpaid')).data;
  assert.strictEqual(u.count, 0);
  assert.ok(!u.rows.some(r => r.member_id === app.memberId));
  app.close();
});

test('휴면 회원에게는 월회비를 매기지 않는다', async () => {
  const app = makeApp();
  app.db.prepare("UPDATE member SET status='dormant' WHERE id=?").run(app.memberId);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/dues/grid')).data.rows.length, 1);
  assert.strictEqual((await a.call('/dues/unpaid')).data.count, 0, '남은 건 오너뿐(면제)');
  app.close();
});

test('다른 달은 섞이지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, period: '2026-07', paid: true, method: 'cash' } });
  assert.strictEqual((await a.call('/dues/grid?month=2026-07')).data.summary.paid, 1);
  assert.strictEqual((await a.call('/dues/grid?month=2026-08')).data.summary.paid, 0);
  app.close();
});

test('잘못된 달을 주면 이번 달로 본다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/dues/grid?month=2026-13')).data.month, thisMonth());
  app.close();
});

test('회원은 본인 내역만 본다 (현황표·미납목록은 403)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'cash' } });
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.adminId, paid: true, method: 'cash' } });

  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/dues/grid')).status, 403);
  assert.strictEqual((await m.call('/dues/unpaid')).status, 403);
  assert.strictEqual((await m.call('/dues/mark', { method: 'PUT', body: { member_id: app.adminId, paid: false } })).status, 403);

  const mine = (await m.call('/dues/me')).data;
  assert.strictEqual(mine.length, 1, '남의 줄이 섞였다');
  app.close();
});

test('회원을 새로 넣으면 입회비 미납 한 줄이 선다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const r = await a.call('/members', { method: 'POST', body: { name: 'Сарнай', phone: '95556677', pin: '1111', joined_at: '2026-10-02' } });
  const due = app.db.prepare("SELECT * FROM due WHERE member_id=? AND kind='joining'").get(r.data.id);
  assert.ok(due, '입회비 줄이 없다');
  assert.strictEqual(due.amount, 300000);
  assert.strictEqual(due.paid_at, null);
  assert.strictEqual(due.period, '2026-10');
  app.close();
});

test('금액을 바꿔도 이미 기록한 납부 줄의 금액은 그대로다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'cash' } });
  await a.call('/settings', { method: 'PUT', body: { monthly_fee: 250000 } });
  const row = (await a.call('/dues/grid')).data.rows.find(r => r.member_id === app.memberId);
  assert.strictEqual(row.monthly.amount, 200000, '지난 기록이 바뀌면 안 된다');
  app.close();
});

// 회칙 제10조 (2026-10-16): 첫 달은 입회비 300,000₮ 하나 — 그달 월회비가 들어 있다. 둘째 달부터 200,000₮.
test('가입한 달은 월회비를 따로 매기지 않는다 (입회비에 포함)', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const month = thisMonth();
  const next = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  // 이번 달에 가입한 회원 — 입회비 줄이 생긴다
  const r = await a.call('/members', { method: 'POST', body: { name: 'New', phone: '95001122', pin: '4321' } });
  assert.strictEqual(r.status, 200);
  const id = r.data.id;

  const g = (await a.call(`/dues/grid?month=${month}`)).data;
  const row = g.rows.find(x => x.member_id === id);
  assert.strictEqual(row.monthly.exempt, true);
  assert.strictEqual(row.monthly.amount, 0);
  assert.strictEqual(row.joining.amount, 300000);
  assert.strictEqual(g.summary.members, g.rows.length - 2, '가입한 달 회원과 오너는 월회비 집계에서 빠진다');
  assert.ok(!(await a.call(`/dues/unpaid?month=${month}`)).data.rows.some(x => x.member_id === id));

  // 다음 달부터는 월회비 대상
  const g2 = (await a.call(`/dues/grid?month=${next}`)).data;
  const row2 = g2.rows.find(x => x.member_id === id);
  assert.ok(!row2.monthly.exempt);
  assert.strictEqual(row2.monthly.amount, 200000);
  assert.ok((await a.call(`/dues/unpaid?month=${next}`)).data.rows.some(x => x.member_id === id));
  app.close();
});

// 2026-10-23: 가입한 달 회원의 월회비를 체크했다 풀어서 빈 줄이 남자 미납으로 떴다 (Miigaa·Ahreumjun)
test('가입한 달은 체크했다 푼 월회비 줄이 남아 있어도 면제 — 현황표·미납자·본인 화면 모두', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const month = thisMonth();
  const id = (await a.call('/members', { method: 'POST', body: { name: 'New', phone: '95001122', pin: '4321' } })).data.id;
  const base = { member_id: id, kind: 'monthly', period: month };
  await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: true, method: 'cash' } });
  await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: false } });   // 실수로 체크 → 풀기

  const row = (await a.call(`/dues/grid?month=${month}`)).data.rows.find(x => x.member_id === id);
  assert.deepStrictEqual([row.monthly.exempt, row.monthly.reason], [true, 'joining']);
  assert.ok(!(await a.call(`/dues/unpaid?month=${month}`)).data.rows.some(x => x.member_id === id));
  const me = await loginAs(app.base, '95001122', '4321');
  const mine = (await me.call('/dues/me')).data;
  assert.deepStrictEqual(mine.map(r => r.kind), ['joining'], '본인 화면에는 입회비 한 줄만');
  app.close();
});

test('면제 달이라도 실제로 낸 기록은 낸 걸로 보인다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.adminId, kind: 'monthly', paid: true, method: 'cash' } });
  const g = (await a.call('/dues/grid')).data;
  const owner = g.rows.find(r => r.member_id === app.adminId);
  assert.strictEqual(owner.monthly.exempt, undefined);
  assert.strictEqual(owner.monthly.paid, true);
  assert.strictEqual(g.summary.collected, 200000);
  app.close();
});

test('회비 계좌 — 기본은 Khan Bank, 오너만 바꾸고 비울 수 있다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  const s = (await m.call('/settings')).data;
  assert.deepStrictEqual([s.bank_name, s.bank_account, s.bank_holder], ['Khan Bank', '850005005123042515', 'Egchjargal']);
  assert.strictEqual((await m.call('/settings', { method: 'PUT', body: { bank_account: '1' } })).status, 403);
  assert.strictEqual((await a.call('/settings', { method: 'PUT', body: { bank_account: 'abc' } })).status, 400);
  const s2 = (await a.call('/settings', { method: 'PUT', body: { bank_name: ' Golomt ', bank_account: '1234 5678' } })).data;
  assert.deepStrictEqual([s2.bank_name, s2.bank_account, s2.monthly_fee], ['Golomt', '1234 5678', 200000]);
  const s3 = (await a.call('/settings', { method: 'PUT', body: { bank_account: '' } })).data;
  assert.strictEqual(s3.bank_account, '');
  app.close();
});

test('코치(선생님)와 총무는 월회비 면제 — 현황표·미납자·내 내역 모두', async () => {
  const app = makeApp();
  const add = (name, phone, coach) => app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, is_coach)
                                                     VALUES (?,?,?,'member','beginner','active','2026-01-05',?)`)
    .run(name, phone, app.dbmod.hashPin('2222'), coach).lastInsertRowid;
  const coach = add('Coach', '95550101', 1);
  const sec = add('Secretary', '95550102', 0);
  app.db.prepare("INSERT INTO officer (role, member_id, sort) VALUES ('manager1', ?, 4) ON CONFLICT(role) DO UPDATE SET member_id=excluded.member_id").run(sec);
  const a = await loginAs(app.base, '99000000', '1234');

  const g = (await a.call('/dues/grid')).data;
  const reasonOf = (id) => g.rows.find(r => r.member_id === id).monthly;
  assert.deepStrictEqual([reasonOf(coach).exempt, reasonOf(coach).reason], [true, 'coach']);
  assert.deepStrictEqual([reasonOf(sec).exempt, reasonOf(sec).reason], [true, 'secretary']);
  assert.strictEqual(reasonOf(app.memberId).exempt, undefined);
  assert.strictEqual(g.summary.members, 1);   // 일반 회원 한 명만 대상

  const u = (await a.call('/dues/unpaid')).data.rows.map(r => r.member_id);
  assert.deepStrictEqual(u, [app.memberId]);

  // 체크했다 푼 줄이 남아도 본인 내역에 미납으로 안 보인다
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: coach, paid: true } });
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: coach, paid: false } });
  const c = await loginAs(app.base, '95550101', '2222');
  assert.deepStrictEqual((await c.call('/dues/me')).data, []);

  // 코치를 그만두면 다시 낸다
  app.db.prepare('UPDATE member SET is_coach=0 WHERE id=?').run(coach);
  assert.ok((await a.call('/dues/unpaid')).data.rows.some(r => r.member_id === coach));
  app.close();
});
