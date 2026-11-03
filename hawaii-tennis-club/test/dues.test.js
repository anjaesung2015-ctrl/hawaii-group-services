// 회비 — 관리자 현황표·체크, 회원은 본인 것만
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { thisMonth } = require('../lib/db');

test('기본 금액은 월회비 200,000₮ · 입회비 100,000₮', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const s = (await a.call('/settings')).data;
  assert.strictEqual(s.monthly_fee, 200000);
  assert.strictEqual(s.joining_fee, 100000);
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

test('현황표에 활동 회원 전원이 나오고, 처음엔 미납 — 클럽 오너도 월회비를 낸다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const g = (await a.call('/dues/grid')).data;
  assert.strictEqual(g.rows.length, 2);
  const owner = g.rows.find(r => r.member_id === app.adminId);
  assert.deepStrictEqual([owner.monthly.exempt, owner.monthly.paid, owner.monthly.amount], [undefined, false, 200000]);
  assert.strictEqual(g.rows.find(r => r.member_id === app.memberId).monthly.paid, false);
  assert.deepStrictEqual([g.summary.members, g.summary.total, g.summary.exempt], [2, 2, 0]);
  assert.strictEqual(g.summary.unpaid, 2);
  assert.strictEqual(g.summary.collected, 0);
  assert.strictEqual(g.summary.expected, 400000);
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
  assert.strictEqual(u.count, 2, '오너도 회원도 미납');
  assert.ok(u.rows.some(r => r.member_id === app.adminId));

  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, paid: true, method: 'qpay' } });
  u = (await a.call('/dues/unpaid')).data;
  assert.strictEqual(u.count, 1);
  assert.ok(!u.rows.some(r => r.member_id === app.memberId));
  app.close();
});

test('휴면 회원에게는 월회비를 매기지 않는다', async () => {
  const app = makeApp();
  app.db.prepare("UPDATE member SET status='dormant' WHERE id=?").run(app.memberId);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/dues/grid')).data.rows.length, 1);
  assert.deepStrictEqual((await a.call('/dues/unpaid')).data.rows.map(r => r.member_id), [app.adminId], '남은 건 오너뿐');
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
  assert.strictEqual(due.amount, 100000);
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

// 회칙 제10·11조 (2026-11-02): 가입한 달 = 입회비 100,000₮ + 그달 월회비 (15일까지 가입 200,000₮, 16일부터 100,000₮). 둘째 달부터 200,000₮.
test('가입한 달도 월회비를 낸다 — 15일까지 전액, 16일부터 반액', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const month = '2026-12';
  const add = async (phone, day) => (await a.call('/members', { method: 'POST', body: { name: 'N' + day, phone, pin: '4321', joined_at: `${month}-${day}` } })).data.id;
  const early = await add('95001122', '15');
  const late = await add('95001123', '16');

  const g = (await a.call(`/dues/grid?month=${month}`)).data;
  const rowOf = (id) => g.rows.find(x => x.member_id === id);
  assert.deepStrictEqual([rowOf(early).monthly.exempt, rowOf(early).monthly.amount, rowOf(early).joining.amount], [undefined, 200000, 100000]);
  assert.deepStrictEqual([rowOf(late).monthly.exempt, rowOf(late).monthly.amount, rowOf(late).joining.amount], [undefined, 100000, 100000]);
  const u = (await a.call(`/dues/unpaid?month=${month}`)).data.rows;
  assert.strictEqual(u.find(x => x.member_id === late).amount, 100000);
  assert.strictEqual(u.find(x => x.member_id === early).amount, 200000);

  // 체크하면 그 금액으로 줄이 선다
  const m = (await a.call('/dues/mark', { method: 'PUT', body: { member_id: late, period: month, paid: true } })).data;
  assert.strictEqual(m.amount, 100000);

  // 다음 달부터는 전액
  const g2 = (await a.call('/dues/grid?month=2027-01')).data;
  assert.strictEqual(g2.rows.find(x => x.member_id === late).monthly.amount, 200000);
  app.close();
});

// 옛 규칙(2026-10까지 가입): 입회비 300,000₮에 그달 월회비 포함 → 그 달은 면제 그대로.
// 2026-10-23: 가입한 달 회원의 월회비를 체크했다 풀어서 빈 줄이 남자 미납으로 떴다 (Miigaa·Ahreumjun)
test('옛 규칙으로 가입한 달은 체크했다 푼 월회비 줄이 남아 있어도 면제 — 현황표·미납자·본인 화면 모두', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const month = '2026-10';
  const id = (await a.call('/members', { method: 'POST', body: { name: 'New', phone: '95001122', pin: '4321', joined_at: '2026-10-20' } })).data.id;
  const base = { member_id: id, kind: 'monthly', period: month };
  await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: true, method: 'cash' } });
  await a.call('/dues/mark', { method: 'PUT', body: { ...base, paid: false } });   // 실수로 체크 → 풀기

  const row = (await a.call(`/dues/grid?month=${month}`)).data.rows.find(x => x.member_id === id);
  assert.deepStrictEqual([row.monthly.exempt, row.monthly.reason], [true, 'joining']);
  assert.ok(!(await a.call(`/dues/unpaid?month=${month}`)).data.rows.some(x => x.member_id === id));
  const me = await loginAs(app.base, '95001122', '4321');
  const mine = (await me.call('/dues/me')).data;
  assert.deepStrictEqual(mine.map(r => r.kind), ['joining'], '본인 화면에는 입회비 한 줄만');
  // 11월부터는 낸다
  assert.ok((await a.call('/dues/unpaid?month=2026-11')).data.rows.some(x => x.member_id === id));
  app.close();
});

test('오너가 낸 기록은 낸 걸로 보인다', async () => {
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

test('코치(선생님)와 총무는 월회비 면제, 오너는 낸다 — 현황표·미납자·내 내역 모두', async () => {
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
  assert.strictEqual(reasonOf(app.adminId).exempt, undefined, '오너는 낸다');
  assert.strictEqual(reasonOf(app.memberId).exempt, undefined);
  assert.deepStrictEqual([g.summary.members, g.summary.exempt], [2, 2]);

  const u = (await a.call('/dues/unpaid')).data.rows.map(r => r.member_id).sort((x, y) => x - y);
  assert.deepStrictEqual(u, [app.adminId, app.memberId].sort((x, y) => x - y));

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

test('정산 — 그 달에 받은 돈(받은 날 기준): 월회비(몇 월치든) + 입회비 + 찬조금', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const mark = (body) => a.call('/dues/mark', { method: 'PUT', body: { paid: true, method: 'transfer', ...body } });
  await mark({ member_id: app.memberId, kind: 'monthly', period: '2026-11', paid_at: '2026-10-30' });   // 미리 낸 11월분 → 10월 정산
  await mark({ member_id: app.adminId, kind: 'monthly', period: '2026-11', paid_at: '2026-11-03' });
  await mark({ member_id: app.adminId, kind: 'monthly', period: '2026-12', paid_at: '2026-11-03' });    // 12월분 선납 → 11월 정산
  await mark({ member_id: app.memberId, kind: 'joining', period: '2026-10', paid_at: '2026-11-02', amount: 100000 });

  const d1 = await a.call('/dues/donations', { method: 'POST', body: { donor_name: 'Sponsor LLC', amount: 500000, given_at: '2026-11-04', method: 'transfer', note: 'Balls' } });
  assert.strictEqual(d1.status, 200);
  assert.strictEqual(d1.data.donor_name, 'Sponsor LLC');
  const d2 = (await a.call('/dues/donations', { method: 'POST', body: { member_id: app.memberId, amount: 50000, given_at: '2026-11-05' } })).data;
  assert.ok(d2.donor_name, '회원을 고르면 이름이 자동으로 들어간다');
  await a.call('/dues/donations', { method: 'POST', body: { donor_name: 'Old', amount: 70000, given_at: '2026-10-01' } });

  const nov = (await a.call('/dues/grid?month=2026-11')).data.settlement;
  assert.deepStrictEqual(nov, { monthly: 400000, monthly_n: 2, joining: 100000, joining_n: 1, donation: 550000, donation_n: 2, total: 1050000 });
  const oct = (await a.call('/dues/grid?month=2026-10')).data.settlement;
  assert.deepStrictEqual([oct.monthly, oct.donation, oct.total], [200000, 70000, 270000]);

  const list = (await a.call('/dues/donations?month=2026-11')).data;
  assert.deepStrictEqual(list.map(x => x.amount), [50000, 500000]);

  // 수정·삭제
  const up = await a.call(`/dues/donations/${d1.data.id}`, { method: 'PUT', body: { donor_name: 'Sponsor LLC', amount: 600000, given_at: '2026-11-04' } });
  assert.strictEqual(up.data.amount, 600000);
  assert.strictEqual((await a.call(`/dues/donations/${d2.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await a.call('/dues/grid?month=2026-11')).data.settlement.donation, 600000);
  app.close();
});

test('찬조금 — 이름·금액은 필수, 일반 회원은 못 본다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call('/dues/donations', { method: 'POST', body: { amount: 1000 } })).status, 400);
  assert.strictEqual((await a.call('/dues/donations', { method: 'POST', body: { donor_name: 'X', amount: 0 } })).status, 400);
  assert.strictEqual((await a.call('/dues/donations/999', { method: 'DELETE' })).status, 404);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/dues/donations')).status, 403);
  assert.strictEqual((await m.call('/dues/donations', { method: 'POST', body: { donor_name: 'X', amount: 1000 } })).status, 403);
  app.close();
});

test('정산 — 코치(선생님)·총무가 낸 돈은 금액에서 뺀다, 미납 입회비도 안 띄운다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const month = thisMonth();
  const day = `${month}-02`;
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.memberId, kind: 'joining', period: month, paid: true, paid_at: day, amount: 100000 } });
  await a.call('/dues/mark', { method: 'PUT', body: { member_id: app.adminId, kind: 'monthly', period: month, paid: true, paid_at: day } });
  assert.strictEqual((await a.call(`/dues/grid?month=${month}`)).data.settlement.total, 300000);

  assert.strictEqual((await a.call(`/members/${app.memberId}`, { method: 'PATCH', body: { is_coach: true } })).status, 200);
  const g = (await a.call(`/dues/grid?month=${month}`)).data;
  assert.deepStrictEqual([g.settlement.joining, g.settlement.joining_n, g.settlement.total], [0, 0, 200000]);
  assert.strictEqual(g.rows.find(r => r.member_id === app.memberId).joining, null);
  app.close();
});
