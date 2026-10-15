// 가입 신청 — 로그인 화면에서 누구나 신청하고, 관리자가 승인하면 그때 회원이 된다.
// 신청만으로는 아무것도 볼 수 없다(로그인 불가).
const express = require('express');
const { hashPin, normalizePhone, validPhone, validPin, today, LEVELS, getSettings } = require('../lib/db');

const WINDOW_MS = 60 * 60 * 1000;   // 한 시간에
const MAX_PER_IP = 5;               // 한 아이피에서 5건까지 (장난 신청 막기)

module.exports = function joinRoutes(db, auth, notify) {
  const router = express.Router();
  const hits = new Map();   // ip → [시각, …]

  function tooMany(req) {
    const ip = req.headers['x-real-ip'] || req.ip || 'unknown';
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
    list.push(now);
    hits.set(ip, list);
    return list.length > MAX_PER_IP;
  }

  // ---- 신청 (로그인 필요 없음) ----
  router.post('/', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40);
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '');
    const level = LEVELS.includes(b.level) ? b.level : 'beginner';
    const memo = String(b.memo || '').trim().slice(0, 200) || null;

    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    if (tooMany(req)) return res.status(429).json({ error: 'too_many_requests' });

    // 이미 회원인 번호 / 이미 신청해 둔 번호
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'already_member' });
    if (db.prepare("SELECT id FROM join_request WHERE phone=? AND status='pending'").get(phone)) {
      return res.status(409).json({ error: 'already_requested' });
    }

    const r = db.prepare(`INSERT INTO join_request (name, phone, pin_hash, level, memo) VALUES (?,?,?,?,?)`)
      .run(name, phone, hashPin(pin), level, memo);
    res.json({ ok: true, id: r.lastInsertRowid });

    // 승인해 줄 사람(관리자)에게만 알린다
    notify?.toAdmins({ title: '🎾 가입 신청', body: `${name} · ${phone}`, url: '#members' });
  });

  // ---- 여기서부터는 관리자만 ----
  router.get('/', auth.requireAdmin, (req, res) => {
    const rows = db.prepare(`SELECT id, name, phone, level, memo, created_at
                             FROM join_request WHERE status='pending' ORDER BY id`).all();
    res.json({ count: rows.length, rows });
  });

  // 지난 신청 내역 (승인·거절한 것)
  router.get('/history', auth.requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT id, name, phone, level, status, created_at, decided_at
                         FROM join_request WHERE status<>'pending' ORDER BY id DESC LIMIT 50`).all());
  });

  router.post('/:id/approve', auth.requireAdmin, (req, res) => {
    const q = db.prepare("SELECT * FROM join_request WHERE id=? AND status='pending'").get(req.params.id);
    if (!q) return res.status(404).json({ error: 'not_found' });
    // 기다리는 동안 관리자가 같은 번호를 손으로 넣었을 수도 있다
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(q.phone)) {
      db.prepare("UPDATE join_request SET status='approved', decided_at=datetime('now','localtime'), decided_by=? WHERE id=?")
        .run(req.me.id, q.id);
      return res.status(409).json({ error: 'already_member' });
    }

    const { joining_fee } = getSettings(db);
    const approve = db.transaction(() => {
      const m = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, memo)
                            VALUES (?,?,?,'member',?,'active',?,?)`)
        .run(q.name, q.phone, q.pin_hash, q.level, today(), q.memo);
      // 입회비 미납 한 줄을 세워 둔다 (손으로 넣은 회원과 같은 처리)
      if (joining_fee > 0) {
        db.prepare(`INSERT INTO due (member_id, kind, period, amount) VALUES (?,'joining',?,?)
                    ON CONFLICT(member_id, kind, period) DO NOTHING`)
          .run(m.lastInsertRowid, today().slice(0, 7), joining_fee);
      }
      db.prepare("UPDATE join_request SET status='approved', decided_at=datetime('now','localtime'), decided_by=? WHERE id=?")
        .run(req.me.id, q.id);
      return m.lastInsertRowid;
    });

    res.json({ ok: true, member_id: approve(), name: q.name });
  });

  router.post('/:id/reject', auth.requireAdmin, (req, res) => {
    const r = db.prepare(`UPDATE join_request SET status='rejected', decided_at=datetime('now','localtime'), decided_by=?
                          WHERE id=? AND status='pending'`).run(req.me.id, req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  return router;
};
