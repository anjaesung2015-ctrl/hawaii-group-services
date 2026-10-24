// 선수반 훈련 일정·출석 — 관리(오너·선수반 코치), 선수는 다가오는 훈련과 내 출석만 본다.
const express = require('express');
const { today } = require('../lib/db');
const { parseSession, isStaffId, YMD } = require('../lib/elite');
const { expand } = require('./events');

const SELECT = `SELECT s.*, c.name AS coach_name FROM elite_session s LEFT JOIN member c ON c.id = s.coach_id`;
const md = (d) => d.slice(5).replace('-', '/');

module.exports = function eliteSessionRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireElite);

  const checkCoach = (s) => (s.coach_id && !isStaffId(db, s.coach_id) ? 'bad_coach' : null);
  const myStatus = db.prepare('SELECT status FROM elite_attendance WHERE session_id=? AND member_id=?');

  router.get('/', (req, res) => {
    const past = req.query.past === '1';
    const rows = past
      ? db.prepare(`${SELECT} WHERE s.session_date < ? ORDER BY s.session_date DESC, s.start_time DESC LIMIT 60`).all(today())
      : db.prepare(`${SELECT} WHERE s.session_date >= ? ORDER BY s.session_date, s.start_time LIMIT 200`).all(today());
    res.json(rows.map(s => ({ ...s, my_status: myStatus.get(s.id, req.me.id)?.status || null })));
  });

  // 하나 + 출석 명단(활동 선수 전원, 체크 안 했으면 null) — 관리자만
  router.get('/:id', auth.requireEliteStaff, (req, res) => {
    const s = db.prepare(`${SELECT} WHERE s.id=?`).get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const roster = db.prepare(`SELECT m.id, m.name, m.photo, a.status FROM member m
                               LEFT JOIN elite_attendance a ON a.member_id = m.id AND a.session_id = ?
                               WHERE m.program='elite' AND (m.status='active' OR a.status IS NOT NULL)
                               ORDER BY m.name`).all(s.id);
    res.json({ ...s, roster });
  });

  router.post('/', auth.requireEliteStaff, (req, res) => {
    const s = parseSession(req.body);
    if (s.error) return res.status(400).json({ error: s.error });
    const bad = checkCoach(s);
    if (bad) return res.status(400).json({ error: bad });
    const r = db.prepare(`INSERT INTO elite_session (title, session_date, start_time, end_time, court, coach_id, memo, created_by)
                          VALUES (?,?,?,?,?,?,?,?)`)
      .run(s.title, s.session_date, s.start_time, s.end_time, s.court, s.coach_id, s.memo, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid });
    notify?.toElitePlayers({ title: `🎾 ${s.title}`, body: `${md(s.session_date)} ${s.start_time}~${s.end_time}`, url: '#training' });
  });

  // 반복 등록 — 요일 + 기간 (동호인 일정 /events/bulk 와 같은 규칙)
  router.post('/bulk', auth.requireEliteStaff, (req, res) => {
    const b = req.body || {};
    const from = YMD.test(b.from || '') ? b.from : null;
    const to = YMD.test(b.to || '') ? b.to : null;
    if (!from || !to || to < from) return res.status(400).json({ error: 'bad_range' });
    const weekdays = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!weekdays.length) return res.status(400).json({ error: 'weekdays_required' });
    const base = parseSession({ ...b, session_date: from });
    if (base.error) return res.status(400).json({ error: base.error });
    const bad = checkCoach(base);
    if (bad) return res.status(400).json({ error: bad });
    const dates = expand(from, to, weekdays);
    if (!dates.length) return res.status(400).json({ error: 'no_dates' });
    if (dates.length > 120) return res.status(400).json({ error: 'too_many_dates', count: dates.length });

    const dup = db.prepare('SELECT id FROM elite_session WHERE title=? AND session_date=? AND start_time=?');
    const ins = db.prepare(`INSERT INTO elite_session (title, session_date, start_time, end_time, court, coach_id, memo, created_by)
                            VALUES (?,?,?,?,?,?,?,?)`);
    const r = db.transaction(() => {
      const created = [];
      let skipped = 0;
      for (const d of dates) {
        if (dup.get(base.title, d, base.start_time)) { skipped += 1; continue; }
        ins.run(base.title, d, base.start_time, base.end_time, base.court, base.coach_id, base.memo, req.me.id);
        created.push(d);
      }
      return { created, skipped };
    })();
    res.json({ ok: true, count: r.created.length, skipped: r.skipped, dates: r.created });
    if (r.created.length) {
      notify?.toElitePlayers({
        title: `🎾 ${base.title}`,
        body: `${md(r.created[0])} ~ ${md(r.created[r.created.length - 1])} · ${r.created.length} sessions · ${base.start_time}`,
        url: '#training',
      });
    }
  });

  router.patch('/:id', auth.requireEliteStaff, (req, res) => {
    const cur = db.prepare('SELECT * FROM elite_session WHERE id=?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const s = parseSession({ ...cur, ...req.body });
    if (s.error) return res.status(400).json({ error: s.error });
    const bad = checkCoach(s);
    if (bad) return res.status(400).json({ error: bad });
    db.prepare(`UPDATE elite_session SET title=?, session_date=?, start_time=?, end_time=?, court=?, coach_id=?, memo=? WHERE id=?`)
      .run(s.title, s.session_date, s.start_time, s.end_time, s.court, s.coach_id, s.memo, cur.id);
    res.json({ ok: true });
  });

  router.delete('/:id', auth.requireEliteStaff, (req, res) => {
    const r = db.prepare('DELETE FROM elite_session WHERE id=?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 출석 — status: 'present' | 'absent' | null(체크 지우기)
  router.put('/:id/attendance', auth.requireEliteStaff, (req, res) => {
    const s = db.prepare('SELECT id FROM elite_session WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const mid = Number(req.body?.member_id);
    if (!db.prepare("SELECT 1 FROM member WHERE id=? AND program='elite'").get(mid)) return res.status(404).json({ error: 'player_not_found' });
    const st = req.body?.status;
    if (st == null) db.prepare('DELETE FROM elite_attendance WHERE session_id=? AND member_id=?').run(s.id, mid);
    else if (st === 'present' || st === 'absent') {
      db.prepare(`INSERT INTO elite_attendance (session_id, member_id, status, checked_by) VALUES (?,?,?,?)
                  ON CONFLICT(session_id, member_id) DO UPDATE SET status=excluded.status, checked_by=excluded.checked_by,
                  checked_at=datetime('now','localtime')`).run(s.id, mid, st, req.me.id);
    } else return res.status(400).json({ error: 'bad_status' });
    res.json({ ok: true, status: st ?? null });
  });

  return router;
};
