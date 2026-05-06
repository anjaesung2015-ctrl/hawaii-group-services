// pin-auth.js — PIN 인증 + JWT 세션
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const SECRET = process.env.PIN_JWT_SECRET || 'staff-reports-secret-change-me';
const SESSION_HOURS = 8;
const MAX_FAIL = 5;
const LOCK_MINUTES = 15;

function isLocked(staff) {
  if (!staff.pin_locked_until) return false;
  return new Date(staff.pin_locked_until) > new Date();
}

function verifyPin(db, staff, pin) {
  if (isLocked(staff)) {
    return { ok: false, reason: 'locked', until: staff.pin_locked_until };
  }
  if (!staff.pin_hash) {
    return { ok: false, reason: 'no_pin' };
  }
  const matched = bcrypt.compareSync(pin, staff.pin_hash);
  if (matched) {
    db.prepare("UPDATE staff SET pin_fail_count=0, pin_locked_until=NULL WHERE id=?").run(staff.id);
    return { ok: true };
  }
  const newCount = (staff.pin_fail_count || 0) + 1;
  if (newCount >= MAX_FAIL) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
    db.prepare("UPDATE staff SET pin_fail_count=?, pin_locked_until=? WHERE id=?").run(newCount, until, staff.id);
    db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)").run(staff.id, 'pin_locked', `${newCount}회 실패`);
    return { ok: false, reason: 'locked', until };
  } else {
    db.prepare("UPDATE staff SET pin_fail_count=? WHERE id=?").run(newCount, staff.id);
    db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)").run(staff.id, 'login_fail', `${newCount}/5`);
    return { ok: false, reason: 'wrong', remaining: MAX_FAIL - newCount };
  }
}

function issueToken(staffId) {
  return jwt.sign({ sid: staffId, kind: 'staff' }, SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

function requireStaff(req, res, next) {
  const token = req.cookies && req.cookies.staff_token;
  const data = token ? verifyToken(token) : null;
  if (!data || data.kind !== 'staff') return res.status(401).json({ error: 'login_required' });
  req.staffId = data.sid;
  next();
}

module.exports = { verifyPin, issueToken, verifyToken, requireStaff };
