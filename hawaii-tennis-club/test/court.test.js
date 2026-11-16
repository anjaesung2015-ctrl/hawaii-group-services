// 코트 예약·상황 일정 — 회원이 캘린더에서 보기만 한다 (참석 버튼·하루 전 알림·전광판 없음)
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { today } = require('../lib/db');

test('코트 예약 — 운영진이 court 로 적으면 모두 보고, 참석 답은 받지 않는다', async () => {
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await a.call('/events', { method: 'POST', body: { title: '코트 2면 예약 (A·B)', kind: 'court', event_date: today(), start_time: '18:00', end_time: '20:00', courts: 2 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const ev = (await m.call(`/events?month=${today().slice(0, 7)}`)).data.find(e => e.title.startsWith('코트 2면'));
  assert.strictEqual(ev.kind, 'court');
  assert.strictEqual((await m.call(`/events/${ev.id}/rsvp`, { method: 'PUT', body: { answer: 'yes' } })).data.error, 'no_rsvp');
  assert.strictEqual((await m.call('/ticker')).data.events.length, 0);       // 전광판 D-day 에도 안 나온다
  assert.strictEqual((await a.call('/events', { method: 'POST', body: { title: 'x', kind: 'nope', event_date: today(), start_time: '18:00', end_time: '20:00' } })).data.error, 'bad_kind');
  app.close();
});

test('옛 DB(court 없던 표)를 열면 표를 옮기고, 일정·참석 기록은 그대로다', () => {
  const Database = require('better-sqlite3');
  const os = require('os'); const path = require('path'); const fs = require('fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'htc-court-')), 'old.db');
  const { migrate } = require('../lib/db');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  migrate(db);
  // court 가 없던 때의 event 표로 되돌려 놓는다
  db.pragma('foreign_keys = OFF');
  db.exec(`DROP TABLE event;
    CREATE TABLE event (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('regular','event','tournament')), event_date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, courts INTEGER NOT NULL DEFAULT 1, memo TEXT,
      created_by INTEGER REFERENCES member(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), reminded_at TEXT);
    INSERT INTO member (id, name, phone, pin_hash, role, level, status, joined_at) VALUES (501, 't', '00000501', 'x', 'member', 'beginner', 'active', '2026-01-01');
    INSERT INTO event (id, title, kind, event_date, start_time, end_time) VALUES (7, '정기', 'regular', '2026-11-18', '19:00', '21:00');
    INSERT INTO rsvp (event_id, member_id, answer) VALUES (7, 501, 'yes');`);
  db.pragma('foreign_keys = ON');
  migrate(db);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='event'").pluck().get(), /'court'/);
  assert.strictEqual(db.prepare('SELECT title FROM event WHERE id=7').pluck().get(), '정기');
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM rsvp').pluck().get(), 1);
  db.prepare("INSERT INTO event (title, kind, event_date, start_time, end_time) VALUES ('c','court','2026-11-19','18:00','20:00')").run();
  db.prepare('DELETE FROM event WHERE id=7').run();                         // 외래키(지우면 참석도 같이)가 다시 살아 있다
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM rsvp').pluck().get(), 0);
  db.close();
});
