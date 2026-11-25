const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const createReportRoutes = require('../report-simple');
const { mondayOf } = require('../weekly');

// 설명서 반영분: 예시·규칙, 일일보고 추가 칸, 주간 KPI, 대표 리마인드 (실제 jobs.json 사용)
const SECRET = 'test-secret';
const BOSS = 'boss123';
const MON = '2026-11-30';
const TUE = '2026-12-01';

function makeServer(today = TUE) {
  const sent = [];
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_active INTEGER DEFAULT 1)`);
  for (const n of ['구엔', '톨가', '바트']) db.prepare("INSERT INTO report_users (name, pin_hash) VALUES (?,?)").run(n, bcrypt.hashSync('x', 10));
  const state = { today };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const router = createReportRoutes(db, {
    secret: SECRET, bossPw: BOSS, today: () => state.today,
    notify: async (id, text, title) => { sent.push({ id, text, title }); return true; },
  });
  app.use('/api/report', router);
  db.prepare("UPDATE report_users SET job='피트-매니저' WHERE name='구엔'").run();
  db.prepare("UPDATE report_users SET job='센터-매니저' WHERE name='톨가'").run();
  db.prepare("UPDATE report_users SET job='피트-리셉션' WHERE name='바트'").run();
  db.prepare("INSERT INTO report_users (name, pin_hash, role) VALUES ('전아름','!','admin')").run();
  const server = app.listen(0);
  const id = n => db.prepare("SELECT id FROM report_users WHERE name=?").get(n).id;
  return { db, server, sent, id, state, router, base: `http://127.0.0.1:${server.address().port}/api/report` };
}
const req = (base, method, q, c, body) => fetch(`${base}${q}`, { method, headers: { 'Content-Type': 'application/json', cookie: c || '' }, body: body ? JSON.stringify(body) : undefined });
const as = (id, name) => 'report_sess=' + jwt.sign({ staff_id: id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
const boss = () => 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });

test('mondayOf', () => {
  assert.strictEqual(mondayOf('2026-12-01'), MON);
  assert.strictEqual(mondayOf('2026-11-30'), MON);
  assert.strictEqual(mondayOf('2026-12-06'), MON);   // 일요일은 그 주 월요일
  assert.strictEqual(mondayOf('2026-12-07'), '2026-12-07');
});

test('예시 18개·규칙 6개, 체크리스트 항목에 예시 번호', async () => {
  const { server, base, id } = makeServer();
  try {
    const g = await (await req(base, 'GET', '/guide', as(id('바트'), '바트'))).json();
    assert.strictEqual(Object.keys(g.examples).length, 18);
    assert.ok(g.examples['예시 5'].ko.includes('정산'));
    assert.ok(g.examples['예시 5'].mn);
    assert.strictEqual(g.rules.length, 6);
    assert.ok(g.rules.every(r => r.ko && r.mn));
    const items = await (await req(base, 'GET', `/items?period=today&date=${TUE}`, as(id('바트'), '바트'))).json();
    assert.ok(items.some(i => i.tpl_ex === '예시 5'));
  } finally { server.close(); }
});

test('일일보고: 이탈·POS 차이(음수 가능)·가동률·과제 결과·내일 + 오늘 요일 과제', async () => {
  const { server, base, id, sent } = makeServer();
  try {
    const c = as(id('톨가'), '톨가');
    const d0 = await (await req(base, 'GET', `/daily?date=${TUE}`, c)).json();
    assert.ok(d0.sites[0].tasks.some(t => t.ko.includes('대관 영업')), '화요일 센터 과제');
    const r = await req(base, 'PUT', '/daily', c, { date: TUE, cash: 100, churn: 1, pos_diff: '-5,000', court_util: '65%',
      task_result: '3곳 연락, 1곳 견적', tomorrow: '견적 발송' });
    assert.strictEqual(r.status, 200);
    const d = await (await req(base, 'GET', `/daily?date=${TUE}`, c)).json();
    const rep = d.sites[0].report;
    assert.strictEqual(rep.pos_diff, -5000);
    assert.strictEqual(rep.court_util, 65);
    assert.strictEqual(rep.churn, 1);
    assert.strictEqual(rep.task_result, '3곳 연락, 1곳 견적');
    assert.strictEqual(rep.tomorrow, '견적 발송');
    assert.ok(sent[0].text.includes('POS 차이 -5000'));
    assert.strictEqual((await req(base, 'PUT', '/daily', c, { date: TUE, churn: -1 })).status, 400);
  } finally { server.close(); }
});

test('주간 KPI: 매니저 작성 → 대표 승인, 실적은 일일보고 합계', async () => {
  const { server, base, id, sent } = makeServer();
  try {
    const g = as(id('구엔'), '구엔');
    await req(base, 'PUT', '/daily', g, { date: MON, cash: 1000000, card: 500000 });
    await req(base, 'PUT', '/daily', g, { date: TUE, transfer: 300000 });
    const body = { week: TUE, target: 2000000, new_members: 5, renewal_rate: 40, churn: 2,
      tasks: [{ t: '이마트 제휴', goal: '10명', due: '12/5' }, { t: '재등록 6명' }, { t: '누락 0' }, { t: '넷째는 버림' }],
      last_result: '지난주 95%' };
    const r = await (await req(base, 'PUT', '/weekly', g, body)).json();
    assert.strictEqual(r.created, true);
    assert.strictEqual(sent.at(-1).title, '주간 KPI');
    assert.ok(sent.at(-1).text.includes('① 이마트 제휴 (10명)'));

    const w = await (await req(base, 'GET', `/weekly?week=${MON}`, boss())).json();
    const fit = w.sites.find(s => s.site === '피트니스');
    assert.strictEqual(fit.actual, 1800000);
    assert.strictEqual(fit.rate, 90);
    assert.strictEqual(fit.kpi.tasks.length, 3);
    assert.strictEqual(fit.kpi.by, '구엔');
    assert.strictEqual(w.sites.find(s => s.site === '센터').kpi, null);
    assert.deepStrictEqual(w.editable, []);

    assert.strictEqual((await req(base, 'PATCH', '/weekly/boss', g, { site: '피트니스', week: MON, boss_ok: 1 })).status, 403);
    assert.strictEqual((await req(base, 'PATCH', '/weekly/boss', boss(), { site: '피트니스', week: MON, boss_ok: 1, boss_comment: '승인' })).status, 200);
    const w2 = await (await req(base, 'GET', `/weekly?week=${MON}`, g)).json();
    assert.strictEqual(w2.sites[0].kpi.boss_ok, 1);
    assert.deepStrictEqual(w2.editable, ['피트니스']);
    // 직원은 못 봄, 2주 전은 못 씀
    assert.strictEqual((await req(base, 'GET', `/weekly`, as(id('바트'), '바트'))).status, 403);
    assert.strictEqual((await req(base, 'PUT', '/weekly', g, { week: '2026-11-16', target: 1 })).status, 403);
  } finally { server.close(); }
});

test('리마인드: 09:40 지시문(대표·사장님·매니저), 21:30 확인 목록 + 미보고 독촉, 하루 한 번', async () => {
  const { server, base, id, sent, router } = makeServer();
  try {
    const rm = router.reminders;
    assert.strictEqual(await rm.tick(TUE, '09:30'), 0);
    const n = await rm.tick(TUE, '09:40');
    assert.ok(n >= 4);   // 대표 + 전아름 + 매니저 2
    const toBoss = sent.find(s => s.title === '오늘 매니저 지시');
    assert.ok(toBoss.text.includes('대관 영업'));
    assert.ok(toBoss.text.includes('신규 유치'));
    const toGuen = sent.find(s => s.id === id('구엔'));
    assert.ok(/Шинэ гишүүн/.test(toGuen.text), '구엔에게 몽골어 피트니스 지시');
    assert.ok(sent.some(s => s.id === id('전아름')));
    assert.strictEqual(await rm.tick(TUE, '09:45'), 0, '같은 날 두 번 안 보냄');

    await req(base, 'PUT', '/daily', as(id('구엔'), '구엔'), { date: TUE, cash: 100, target: 200, decision: '할인율 15%' });
    sent.length = 0;
    await rm.tick(TUE, '21:35');
    const ev = sent.find(s => s.title === '보고 확인');
    assert.ok(ev.text.includes('피트니스: ✅'));
    assert.ok(ev.text.includes('센터: ❌ 미보고'));
    assert.ok(ev.text.includes('할인율 15%'));
    const nudge = sent.filter(s => s.title === 'Тайлан');
    assert.deepStrictEqual(nudge.map(s => s.id), [id('톨가')]);
  } finally { server.close(); }
});

test('리마인드: 일요일·너무 늦은 시각엔 안 보냄, 월요일엔 KPI 안내', async () => {
  const { server, sent, router } = makeServer('2026-12-06');
  try {
    assert.strictEqual(await router.reminders.tick('2026-12-06', '09:40'), 0);
    assert.strictEqual(await router.reminders.tick(TUE, '12:00'), 0);   // 09:40 + 2시간 넘음
    assert.ok(router.reminders.morning(MON).includes('주간 KPI'));
    assert.ok(router.reminders.directiveMn('센터', MON).includes('KPI'));
    assert.strictEqual(sent.length, 0);
  } finally { server.close(); }
});
