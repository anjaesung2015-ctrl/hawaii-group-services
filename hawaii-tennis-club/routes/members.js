const express = require('express');
const { hashPin, normalizePhone, validPhone, validPin, today, LEVELS, getSettings } = require('../lib/db');

module.exports = function memberRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireMember);

  // 명단 — 일반 회원에게는 이름·레벨만 보여준다 (전화번호는 관리자만)
  router.get('/', (req, res) => {
    const rows = db.prepare(`SELECT id, name, phone, role, title, level, status, joined_at, memo, is_owner, is_coach
                             FROM member ORDER BY is_owner DESC, role='member', is_coach DESC, status='dormant', name`).all();
    if (req.me.role === 'admin' || req.me.is_owner) return res.json(rows);
    res.json(rows.map(m => ({ id: m.id, name: m.name, level: m.level, status: m.status, role: m.role, title: m.title, is_owner: m.is_owner, is_coach: m.is_coach })));
  });

  router.post('/', auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '').trim() || phone.slice(-4);   // 비워두면 번호 뒤 4자리가 첫 PIN
    const level = LEVELS.includes(b.level) ? b.level : 'beginner';
    const joined_at = /^\d{4}-\d{2}-\d{2}$/.test(b.joined_at || '') ? b.joined_at : today();

    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'phone_taken' });

    const r = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, title, level, status, joined_at, memo, is_coach)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(name, phone, hashPin(pin), b.role === 'admin' ? 'admin' : 'member',
           String(b.title || '').trim() || null, level,
           b.status === 'dormant' ? 'dormant' : 'active', joined_at, String(b.memo || '').trim() || null, isOn(b.is_coach));

    // 입회비는 가입한 달의 미납 한 줄로 바로 세워둔다 (받아야 할 돈을 잊지 않도록)
    const { joining_fee } = getSettings(db);
    if (joining_fee > 0) {
      db.prepare(`INSERT INTO due (member_id, kind, period, amount) VALUES (?,'joining',?,?)
                  ON CONFLICT(member_id, kind, period) DO NOTHING`)
        .run(r.lastInsertRowid, joined_at.slice(0, 7), joining_fee);
    }
    res.json({ ok: true, id: r.lastInsertRowid, first_pin: pin });
  });

  router.patch('/:id', auth.requireAdmin, (req, res) => {
    const m = db.prepare('SELECT * FROM member WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const f = [], v = [];

    if ('name' in b) {
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name_required' });
      f.push('name=?'); v.push(name);
    }
    if ('phone' in b) {
      const phone = normalizePhone(b.phone);
      if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
      const dup = db.prepare('SELECT id FROM member WHERE phone=? AND id<>?').get(phone, m.id);
      if (dup) return res.status(409).json({ error: 'phone_taken' });
      f.push('phone=?'); v.push(phone);
    }
    if ('level' in b && LEVELS.includes(b.level)) { f.push('level=?'); v.push(b.level); }
    if ('status' in b) { f.push('status=?'); v.push(b.status === 'dormant' ? 'dormant' : 'active'); }
    if ('title' in b) { f.push('title=?'); v.push(String(b.title || '').trim() || null); }
    if ('is_coach' in b) { f.push('is_coach=?'); v.push(isOn(b.is_coach)); }
    if ('memo' in b) { f.push('memo=?'); v.push(String(b.memo || '').trim() || null); }
    if ('joined_at' in b && /^\d{4}-\d{2}-\d{2}$/.test(b.joined_at)) { f.push('joined_at=?'); v.push(b.joined_at); }
    if ('role' in b) {
      // 운영진 권한을 주고 거두는 것은 오너만 (사장님이 직접 권한을 준 사람만 운영진이 된다)
      if (!req.me.is_owner) return res.status(403).json({ error: 'owner_only' });
      const role = b.role === 'admin' ? 'admin' : 'member';
      // 관리자가 한 명도 없는 상태를 만들 수는 없다 (아무도 못 들어가는 앱이 된다)
      if (role === 'member' && m.role === 'admin' && lastAdmin(db, m.id)) {
        return res.status(409).json({ error: 'last_admin' });
      }
      f.push('role=?'); v.push(role);
    }
    if (!f.length) return res.status(400).json({ error: 'no_changes' });

    v.push(m.id);
    db.prepare(`UPDATE member SET ${f.join(', ')} WHERE id=?`).run(...v);
    res.json({ ok: true });
  });

  // 관리자가 PIN을 새로 정해준다 (잊어버린 회원용)
  router.post('/:id/pin', auth.requireAdmin, (req, res) => {
    const pin = String(req.body?.pin || '');
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    const r = db.prepare('UPDATE member SET pin_hash=? WHERE id=?').run(hashPin(pin), req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 회원 삭제는 오너만 (회칙 제31조 — 제명은 클럽 오너 최종 결정)
  router.delete('/:id', auth.requireOwner, (req, res) => {
    const m = db.prepare('SELECT * FROM member WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    if (m.is_owner) return res.status(409).json({ error: 'cannot_delete_owner' });
    if (m.role === 'admin' && lastAdmin(db, m.id)) return res.status(409).json({ error: 'last_admin' });

    // 지우면 그 사람의 회비·참석 기록도 함께 사라진다. 기록을 남기려면 '휴면'으로 돌린다.
    // 그 사람이 쓴 일정·공지는 남긴다 — 작성자 표시만 지운다.
    // (그냥 지우면 event.created_by·notice.created_by 가 막아서 삭제가 실패한다)
    db.transaction(() => {
      db.prepare('UPDATE event  SET created_by=NULL WHERE created_by=?').run(m.id);
      db.prepare('UPDATE notice SET created_by=NULL WHERE created_by=?').run(m.id);
      db.prepare('UPDATE join_request SET decided_by=NULL WHERE decided_by=?').run(m.id);
      db.prepare('DELETE FROM member WHERE id=?').run(m.id);
    })();
    res.json({ ok: true });
  });

  return router;
};

const lastAdmin = (db, id) =>
  db.prepare("SELECT COUNT(*) c FROM member WHERE role='admin' AND id<>?").get(id).c === 0;

// 화면 select 는 '1'/'0', API 는 true/false — 둘 다 받는다
function isOn(x) { return x === true || x === 1 || x === '1' || x === 'true' ? 1 : 0; }
