const express = require('express');
const jwt = require('jsonwebtoken');

const PERIODS = ['today', 'tomorrow', 'week', 'month', 'year'];

module.exports = function createReportRoutes(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const bossPw = opts.bossPw || '';
  const MANAGER_ROLES = opts.managerRoles || ['매니저', '총매니저', '코치'];
  const roleIn = MANAGER_ROLES.map(() => '?').join(',');
  const router = express.Router();

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

  const COOKIE = { path: '/staff-manager', maxAge: 2592000000, sameSite: 'Lax', httpOnly: true };

  router.get('/staff-list', (req, res) => {
    res.json(db.prepare(`SELECT id, name FROM staff WHERE is_active=1 AND role IN (${roleIn}) ORDER BY name`).all(...MANAGER_ROLES));
  });

  router.post('/login', (req, res) => {
    const { name, boss_pw } = req.body || {};
    if (boss_pw !== undefined) {
      if (!bossPw || boss_pw !== bossPw) return res.status(401).json({ error: 'bad_password' });
      const token = jwt.sign({ isBoss: true }, secret, { expiresIn: '30d' });
      res.cookie('report_sess', token, COOKIE);
      return res.json({ ok: true, isBoss: true });
    }
    const st = db.prepare(`SELECT id, name FROM staff WHERE name=? AND is_active=1 AND role IN (${roleIn})`).get(name, ...MANAGER_ROLES);
    if (!st) return res.status(401).json({ error: 'unknown_staff' });
    const token = jwt.sign({ staff_id: st.id, name: st.name, isBoss: false }, secret, { expiresIn: '30d' });
    res.cookie('report_sess', token, COOKIE);
    res.json({ ok: true, isBoss: false, staff_id: st.id, name: st.name });
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

  // items routes added in Task 3

  return router;
};
