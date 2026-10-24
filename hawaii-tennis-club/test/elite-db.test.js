// 선수반 DB — 새 칸·테이블·기본 수강료
const test = require('node:test');
const assert = require('node:assert');
const { makeApp } = require('./helper');

test('기존 회원은 program=club, 선수반 칸과 테이블이 생긴다', async () => {
  const app = makeApp();
  const cols = app.db.prepare('PRAGMA table_info(member)').all().map(c => c.name);
  for (const c of ['program', 'elite_coach', 'birth_year', 'parent_name', 'parent_phone', 'elite_fee', 'assigned_coach_id']) {
    assert.ok(cols.includes(c), c);
  }
  assert.strictEqual(app.db.prepare('SELECT program FROM member WHERE id=?').get(app.memberId).program, 'club');
  for (const t of ['elite_session', 'elite_attendance', 'elite_due', 'elite_notice']) {
    assert.ok(app.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
  }
  assert.throws(() => app.db.prepare("UPDATE member SET program='pro' WHERE id=?").run(app.memberId));
  app.close();
});

test('기본 선수반 수강료는 800,000₮', async () => {
  const app = makeApp();
  assert.strictEqual(app.dbmod.getSettings(app.db).elite_fee, 800000);
  app.close();
});
