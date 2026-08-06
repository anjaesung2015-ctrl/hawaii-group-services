const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const PERIODS = ['today', 'tomorrow', 'week', 'month', 'year'];

module.exports = function createReportRoutes(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const bossPw = opts.bossPw || '';
  const router = express.Router();

  db.exec(`CREATE TABLE IF NOT EXISTS report_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    pin_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    item_date TEXT NOT NULL,
    title TEXT,
    memo TEXT,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);

  const COOKIE = { path: '/staff-manager', maxAge: 2592000000, sameSite: 'Lax', httpOnly: true, secure: true };

  router.get('/staff-list', (req, res) => {
    res.json(db.prepare("SELECT id, name FROM report_users WHERE is_active=1 ORDER BY id").all());
  });

  router.post('/login', (req, res) => {
    const { name, password, boss_pw } = req.body || {};
    if (boss_pw !== undefined) {
      if (!bossPw || boss_pw !== bossPw) return res.status(401).json({ error: 'bad_password' });
      const token = jwt.sign({ isBoss: true }, secret, { expiresIn: '30d' });
      res.cookie('report_sess', token, COOKIE);
      return res.json({ ok: true, isBoss: true });
    }
    const u = db.prepare("SELECT id, name, pin_hash FROM report_users WHERE name=? AND is_active=1").get(name);
    if (!u || !bcrypt.compareSync(password || '', u.pin_hash)) return res.status(401).json({ error: 'bad_login' });
    const token = jwt.sign({ staff_id: u.id, name: u.name, isBoss: false }, secret, { expiresIn: '30d' });
    res.cookie('report_sess', token, COOKIE);
    res.json({ ok: true, isBoss: false, staff_id: u.id, name: u.name });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('report_sess', { path: '/staff-manager' });
    res.json({ ok: true });
  });

  function requireSess(req, res, next) {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  }

  function targetStaffId(req, provided) {
    if (req.rsess.isBoss) return provided ? Number(provided) : null;
    return req.rsess.staff_id;
  }

  router.use(requireSess);

  router.get('/items', (req, res) => {
    const { period, date } = req.query;
    if (period && !PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    const sid = targetStaffId(req, req.query.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    let sql = "SELECT * FROM report_items WHERE staff_id=?"; const p = [sid];
    if (period) { sql += " AND period=?"; p.push(period); }
    if (date) { sql += " AND item_date=?"; p.push(date); }
    sql += " ORDER BY id";
    res.json(db.prepare(sql).all(...p));
  });

  router.post('/items', (req, res) => {
    const { period, item_date, title, memo } = req.body || {};
    if (!PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    if (!item_date) return res.status(400).json({ error: 'item_date_required' });
    const sid = targetStaffId(req, req.body.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    const r = db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,?,?)")
      .run(sid, period, item_date, title || '', memo || '');
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== Number(req.rsess.staff_id)) return res.status(403).json({ error: 'forbidden' });
    const fields = []; const vals = [];
    const body = req.body || {};
    for (const k of ['title', 'memo', 'done']) if (k in body) { fields.push(k + '=?'); vals.push(k === 'done' ? (body[k] ? 1 : 0) : body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'no_changes' });
    fields.push("updated_at=datetime('now','localtime')");
    vals.push(req.params.id);
    db.prepare("UPDATE report_items SET " + fields.join(', ') + " WHERE id=?").run(...vals);
    res.json({ ok: true });
  });

  router.delete('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== Number(req.rsess.staff_id)) return res.status(403).json({ error: 'forbidden' });
    db.prepare("DELETE FROM report_items WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  return router;
};
