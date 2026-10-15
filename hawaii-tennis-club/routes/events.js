const express = require('express');
const { today, EVENT_KINDS, ANSWERS } = require('../lib/db');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function eventRoutes(db, auth, notify, tr) {
  const router = express.Router();
  router.use(auth.requireMember);

  // 다가오는 일정 — 홈 화면이 쓴다 (오늘 것도 포함)
  router.get('/upcoming', async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 3));
    const rows = db.prepare(`SELECT * FROM event WHERE event_date >= ?
                             ORDER BY event_date, start_time LIMIT ?`).all(today(), limit);
    const out = rows.map(e => withCounts(db, e, req.me.id));
    if (tr && req.query.lang) await tr.attach(out, ['title', 'memo'], String(req.query.lang));
    res.json(out);
  });

  // 목록 — 기본은 오늘부터. ?past=1 이면 지난 일정을 최근 것부터.
  router.get('/', async (req, res) => {
    const past = req.query.past === '1';
    const rows = past
      ? db.prepare('SELECT * FROM event WHERE event_date < ? ORDER BY event_date DESC, start_time DESC LIMIT 60').all(today())
      : db.prepare('SELECT * FROM event WHERE event_date >= ? ORDER BY event_date, start_time').all(today());
    const out = rows.map(e => withCounts(db, e, req.me.id));
    if (tr && req.query.lang) await tr.attach(out, ['title', 'memo'], String(req.query.lang));
    res.json(out);
  });

  // 하나 자세히 — 참석/불참/미정 명단까지
  router.get('/:id', async (req, res) => {
    const e = db.prepare('SELECT * FROM event WHERE id=?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const people = db.prepare(`SELECT r.answer, m.id, m.name, m.level
                               FROM rsvp r JOIN member m ON m.id = r.member_id
                               WHERE r.event_id=? ORDER BY r.answer, m.name`).all(e.id);
    const roster = { yes: [], no: [], maybe: [] };
    for (const p of people) roster[p.answer].push({ id: p.id, name: p.name, level: p.level });
    const one = withCounts(db, e, req.me.id);
    if (tr && req.query.lang) await tr.attach([one], ['title', 'memo'], String(req.query.lang));
    res.json({ ...one, roster });
  });

  router.post('/', auth.requireAdmin, (req, res) => {
    const b = parseEvent(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    const r = db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts, memo, created_by)
                          VALUES (?,?,?,?,?,?,?,?)`)
      .run(b.title, b.kind, b.event_date, b.start_time, b.end_time, b.courts, b.memo, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid });

    notify?.toAll({
      title: `🎾 ${b.title}`,
      body: `${b.event_date.slice(5).replace('-', '/')} ${b.start_time}~${b.end_time}`,
      url: '#schedule',
    }, [req.me.id]);
  });

  // 반복 등록 — "매주 화·목 19시" 처럼 요일과 기간을 주면 그 사이 날짜를 한 번에 만든다.
  // 매주 같은 모임을 하나씩 손으로 적지 않기 위한 것.
  router.post('/bulk', auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const from = YMD.test(b.from || '') ? b.from : null;
    const to = YMD.test(b.to || '') ? b.to : null;
    if (!from || !to) return res.status(400).json({ error: 'bad_range' });
    if (to < from) return res.status(400).json({ error: 'bad_range' });

    const weekdays = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))]
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!weekdays.length) return res.status(400).json({ error: 'weekdays_required' });

    // 날짜 하나만 검사에 통과시키려고 from 을 끼워 넣는다 (제목·시간·종류는 모든 날에 같다)
    const base = parseEvent({ ...b, event_date: from });
    if (base.error) return res.status(400).json({ error: base.error });

    const dates = expand(from, to, weekdays);
    if (!dates.length) return res.status(400).json({ error: 'no_dates' });
    // 실수로 몇 년치를 만드는 것을 막는다
    if (dates.length > 120) return res.status(400).json({ error: 'too_many_dates', count: dates.length });

    const dup = db.prepare('SELECT id FROM event WHERE title=? AND event_date=? AND start_time=?');
    const ins = db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts, memo, created_by)
                            VALUES (?,?,?,?,?,?,?,?)`);

    const run = db.transaction(() => {
      const created = [];
      let skipped = 0;
      for (const d of dates) {
        // 같은 제목·날짜·시작시간이 이미 있으면 건너뛴다 (두 번 눌러도 겹쳐 쌓이지 않게)
        if (dup.get(base.title, d, base.start_time)) { skipped += 1; continue; }
        ins.run(base.title, base.kind, d, base.start_time, base.end_time, base.courts, base.memo, req.me.id);
        created.push(d);
      }
      return { created, skipped };
    });

    const r = run();
    res.json({ ok: true, count: r.created.length, skipped: r.skipped, dates: r.created });

    // 여러 개를 한 번에 만들었으니 알림도 한 번만 (폰이 수십 번 울리면 안 된다)
    if (r.created.length) {
      notify?.toAll({
        title: `🎾 ${base.title}`,
        body: `${r.created[0].slice(5).replace('-', '/')} ~ ${r.created[r.created.length - 1].slice(5).replace('-', '/')} · ${r.created.length}회 · ${base.start_time}`,
        url: '#schedule',
      }, [req.me.id]);
    }
  });

  router.patch('/:id', auth.requireAdmin, (req, res) => {
    const e = db.prepare('SELECT * FROM event WHERE id=?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    // 보내준 칸만 바꾼다 — 나머지는 지금 값을 그대로 다시 검사에 통과시킨다
    const b = parseEvent({ ...e, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });
    db.prepare(`UPDATE event SET title=?, kind=?, event_date=?, start_time=?, end_time=?, courts=?, memo=? WHERE id=?`)
      .run(b.title, b.kind, b.event_date, b.start_time, b.end_time, b.courts, b.memo, e.id);
    res.json({ ok: true });
  });

  router.delete('/:id', auth.requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM event WHERE id=?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 참석/불참/미정 — 회원 한 사람당 한 줄, 다시 누르면 덮어쓴다
  router.put('/:id/rsvp', (req, res) => {
    const answer = String(req.body?.answer || '');
    if (!ANSWERS.includes(answer)) return res.status(400).json({ error: 'bad_answer' });
    const e = db.prepare('SELECT id FROM event WHERE id=?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    db.prepare(`INSERT INTO rsvp (event_id, member_id, answer) VALUES (?,?,?)
                ON CONFLICT(event_id, member_id) DO UPDATE
                SET answer=excluded.answer, updated_at=datetime('now','localtime')`)
      .run(e.id, req.me.id, answer);
    res.json({ ok: true, ...counts(db, e.id), my_answer: answer });
  });

  return router;
};

function parseEvent(b = {}) {
  const title = String(b.title || '').trim();
  const kind = EVENT_KINDS.includes(b.kind) ? b.kind : null;
  const event_date = YMD.test(b.event_date || '') ? b.event_date : null;
  const start_time = HHMM.test(b.start_time || '') ? b.start_time : null;
  const end_time = HHMM.test(b.end_time || '') ? b.end_time : null;
  const courts = Math.max(1, Math.min(20, Number(b.courts) || 1));

  if (!title) return { error: 'title_required' };
  if (!kind) return { error: 'bad_kind' };
  if (!event_date) return { error: 'bad_date' };
  if (!start_time || !end_time) return { error: 'bad_time' };
  if (end_time <= start_time) return { error: 'end_before_start' };

  return { title, kind, event_date, start_time, end_time, courts, memo: String(b.memo || '').trim() || null };
}

// from~to 사이에서 고른 요일(0=일 … 6=토)에 해당하는 날짜만 모은다. UTC로만 계산해 시간대에 안 흔들린다.
function expand(from, to, weekdays) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  const want = new Set(weekdays);
  const out = [];
  for (let t = Date.UTC(fy, fm - 1, fd); t <= end; t += 86400000) {
    const d = new Date(t);
    if (want.has(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    if (out.length > 400) break;                  // 터무니없는 기간 방어
  }
  return out;
}

function counts(db, eventId) {
  const rows = db.prepare('SELECT answer, COUNT(*) c FROM rsvp WHERE event_id=? GROUP BY answer').all(eventId);
  const out = { yes: 0, no: 0, maybe: 0 };
  for (const r of rows) out[r.answer] = r.c;
  return { counts: out };
}

function withCounts(db, e, myId) {
  const my = db.prepare('SELECT answer FROM rsvp WHERE event_id=? AND member_id=?').get(e.id, myId);
  return { ...e, ...counts(db, e.id), my_answer: my?.answer || null };
}
