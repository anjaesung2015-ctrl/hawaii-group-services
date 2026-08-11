// 근태 — 출근/퇴근 버튼, 등록된 근무지 반경 안에서만.
// 반경은 GPS 오차(accuracy)를 빼고 판정한다. 폰 GPS는 실내에서 10~30m씩 흔들리므로
// 이 보정이 없으면 정상 출근도 거부된다.
const express = require('express');
const jwt = require('jsonwebtoken');

const BIZ_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' });
const BIZ_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ulaanbaatar', hour: '2-digit', minute: '2-digit', hour12: false });

function haversine(a, b) {
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

module.exports = function createAttendance(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const now = opts.now || (() => ({ date: BIZ_FMT.format(new Date()), time: BIZ_TIME.format(new Date()) }));

  db.exec(`CREATE TABLE IF NOT EXISTS report_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    check_in TEXT, check_out TEXT,
    in_lat REAL, in_lng REAL, in_acc REAL,
    out_lat REAL, out_lng REAL, out_acc REAL,
    note TEXT, edited INTEGER DEFAULT 0,
    UNIQUE(staff_id, work_date)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_place (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    lat REAL NOT NULL, lng REAL NOT NULL,
    radius_m INTEGER NOT NULL DEFAULT 30,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_config (k TEXT PRIMARY KEY, v TEXT)`);

  const getCfg = (k, dflt) => db.prepare("SELECT v FROM report_config WHERE k=?").get(k)?.v ?? dflt;
  const setCfg = (k, v) => db.prepare("INSERT INTO report_config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
  const workStart = () => getCfg('work_start', '09:00');

  // 등록된 근무지 중 한 곳이라도 반경 안이면 통과. 등록된 곳이 없으면 위치를 따지지 않는다.
  function checkPlace(body) {
    const places = db.prepare("SELECT * FROM report_place").all();
    if (!places.length) return { ok: true };
    const { lat, lng, acc } = body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') return { ok: false, code: 400, error: 'location_required' };
    let best = null;
    for (const p of places) {
      const d = haversine({ lat, lng }, { lat: p.lat, lng: p.lng });
      const eff = d - (Number(acc) || 0);          // GPS 오차만큼 봐준다
      if (!best || eff < best.eff) best = { eff, d, p };
      if (eff <= p.radius_m) return { ok: true, place: p, distance_m: Math.round(d) };
    }
    return {
      ok: false, code: 403, error: 'out_of_range',
      distance_m: Math.round(best.d), accuracy_m: Math.round(Number(acc) || 0),
      radius_m: best.p.radius_m, place: best.p.name,
    };
  }

  const router = express.Router();
  router.use((req, res, next) => {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  });
  const isBoss = (req) => !!req.rsess.isBoss;
  const meId = (req) => Number(req.rsess.staff_id) || null;

  // ---- 근무지 ----
  router.get('/place', (req, res) => res.json(db.prepare("SELECT * FROM report_place ORDER BY id").all()));

  router.post('/place', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    const { name, lat, lng, radius_m } = req.body || {};
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'bad_place' });
    const r = Math.max(5, Math.min(2000, Number(radius_m) || 30));
    db.prepare(`INSERT INTO report_place (name, lat, lng, radius_m) VALUES (?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, radius_m=excluded.radius_m`)
      .run(String(name), lat, lng, r);
    res.json({ ok: true, radius_m: r });
  });

  router.delete('/place/:id', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    db.prepare("DELETE FROM report_place WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---- 설정 ----
  router.get('/config', (req, res) => res.json({ work_start: workStart() }));
  router.post('/config', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    const ws = req.body?.work_start;
    if (ws && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ws)) return res.status(400).json({ error: 'bad_time' });
    if (ws) setCfg('work_start', ws);
    res.json({ ok: true, work_start: workStart() });
  });

  // ---- 출근 / 퇴근 ----
  router.post('/in', (req, res) => {
    const id = meId(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const chk = checkPlace(req.body);
    if (!chk.ok) return res.status(chk.code).json(chk);
    const { date, time } = now();
    const cur = db.prepare("SELECT * FROM report_attendance WHERE staff_id=? AND work_date=?").get(id, date);
    if (cur && cur.check_in) return res.json({ ok: true, already: true, check_in: cur.check_in });
    const { lat, lng, acc } = req.body || {};
    db.prepare(`INSERT INTO report_attendance (staff_id, work_date, check_in, in_lat, in_lng, in_acc) VALUES (?,?,?,?,?,?)
      ON CONFLICT(staff_id, work_date) DO UPDATE SET check_in=excluded.check_in, in_lat=excluded.in_lat, in_lng=excluded.in_lng, in_acc=excluded.in_acc`)
      .run(id, date, time, lat ?? null, lng ?? null, acc ?? null);
    res.json({ ok: true, check_in: time, late: toMin(time) > toMin(workStart()) ? 1 : 0 });
  });

  router.post('/out', (req, res) => {
    const id = meId(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const { date, time } = now();
    const cur = db.prepare("SELECT * FROM report_attendance WHERE staff_id=? AND work_date=?").get(id, date);
    if (!cur || !cur.check_in) return res.status(400).json({ error: 'not_checked_in' });
    const chk = checkPlace(req.body);
    if (!chk.ok) return res.status(chk.code).json(chk);
    const { lat, lng, acc } = req.body || {};
    db.prepare("UPDATE report_attendance SET check_out=?, out_lat=?, out_lng=?, out_acc=? WHERE id=?")
      .run(time, lat ?? null, lng ?? null, acc ?? null, cur.id);
    res.json({ ok: true, check_out: time });
  });

  // ---- 조회 ----
  function peopleFor(req) {
    if (isBoss(req)) return db.prepare("SELECT id, name FROM report_users WHERE is_active=1 AND role='staff' ORDER BY id").all();
    return db.prepare("SELECT id, name FROM report_users WHERE id=?").all(meId(req));
  }

  router.get('/today', (req, res) => {
    const date = req.query.date || now().date;
    const people = peopleFor(req);
    const ws = workStart();
    const rows = people.map(p => {
      const a = db.prepare("SELECT * FROM report_attendance WHERE staff_id=? AND work_date=?").get(p.id, date) || {};
      const worked = (a.check_in && a.check_out) ? toMin(a.check_out) - toMin(a.check_in) : null;
      return {
        id: a.id ?? null, staff_id: p.id, name: p.name,
        check_in: a.check_in ?? null, check_out: a.check_out ?? null,
        minutes: worked, late: a.check_in && toMin(a.check_in) > toMin(ws) ? 1 : 0,
        edited: a.edited ?? 0,
      };
    });
    res.json({ date, work_start: ws, rows });
  });

  router.get('/month', (req, res) => {
    const month = String(req.query.month || now().date.slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'bad_month' });
    const ws = toMin(workStart());
    const rows = peopleFor(req).map(p => {
      const list = db.prepare("SELECT * FROM report_attendance WHERE staff_id=? AND work_date LIKE ? ORDER BY work_date").all(p.id, month + '-%');
      let minutes = 0, late = 0;
      for (const a of list) {
        if (a.check_in && a.check_out) minutes += Math.max(0, toMin(a.check_out) - toMin(a.check_in));
        if (a.check_in && toMin(a.check_in) > ws) late++;
      }
      return { staff_id: p.id, name: p.name, days: list.length, minutes, late, list };
    });
    res.json({ month, work_start: workStart(), rows });
  });

  router.patch('/:id', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    const a = db.prepare("SELECT * FROM report_attendance WHERE id=?").get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not_found' });
    const f = [], v = [];
    for (const k of ['check_in', 'check_out']) {
      if (k in (req.body || {})) {
        const val = req.body[k];
        if (val !== null && val !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) return res.status(400).json({ error: 'bad_time' });
        f.push(k + '=?'); v.push(val || null);
      }
    }
    if ('note' in (req.body || {})) { f.push('note=?'); v.push(String(req.body.note || '')); }
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    f.push('edited=1');
    v.push(req.params.id);
    db.prepare("UPDATE report_attendance SET " + f.join(', ') + " WHERE id=?").run(...v);
    res.json({ ok: true });
  });

  // 사장님이 대신 출근 처리 (직원이 깜빡했을 때)
  router.post('/mark', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    const { staff_id, date, check_out } = req.body || {};
    const d = date || now().date;
    if (!staff_id || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'bad_request' });
    // 시각을 안 주면 지금 시각으로 출근 처리한다 (빈 줄이 만들어지지 않도록)
    const check_in = req.body?.check_in || now().time;
    db.prepare(`INSERT INTO report_attendance (staff_id, work_date, check_in, check_out, edited) VALUES (?,?,?,?,1)
      ON CONFLICT(staff_id, work_date) DO UPDATE SET check_in=COALESCE(excluded.check_in, report_attendance.check_in),
      check_out=COALESCE(excluded.check_out, report_attendance.check_out), edited=1`)
      .run(Number(staff_id), d, check_in || null, check_out || null);
    res.json({ ok: true });
  });

  // ---- 엑셀(CSV) 내려받기 ----
  router.get('/export', (req, res) => {
    if (!isBoss(req)) return res.status(403).json({ error: 'boss_only' });
    const month = String(req.query.month || now().date.slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'bad_month' });
    const ws = toMin(workStart());
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['이름,날짜,출근,퇴근,근무시간,지각,비고'];
    const people = db.prepare("SELECT id, name FROM report_users WHERE is_active=1 AND role='staff' ORDER BY id").all();
    for (const p of people) {
      const list = db.prepare("SELECT * FROM report_attendance WHERE staff_id=? AND work_date LIKE ? ORDER BY work_date").all(p.id, month + '-%');
      for (const a of list) {
        const mins = (a.check_in && a.check_out) ? Math.max(0, toMin(a.check_out) - toMin(a.check_in)) : null;
        const hhmm = mins == null ? '' : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
        lines.push([p.name, a.work_date, a.check_in || '', a.check_out || '', hhmm,
          (a.check_in && toMin(a.check_in) > ws) ? '지각' : '',
          (a.edited ? '수정됨 ' : '') + (a.note || '')].map(esc).join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
    res.send('﻿' + lines.join('\r\n'));    // 엑셀에서 한글이 깨지지 않도록 BOM
  });

  return { router, checkPlace, haversine };
};
