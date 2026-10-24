// 가입 신청 — 로그인 화면에서 누구나 신청하고, 관리자가 승인하면 그때 회원이 된다.
// 신청만으로는 아무것도 볼 수 없다(로그인 불가).
// 동호인반(program='club')은 임원이, 엘리트선수반(program='elite')은 오너만 보고 승인한다.
const express = require('express');
const { hashPin, normalizePhone, validPhone, validPin, today, LEVELS, getSettings } = require('../lib/db');
const { savePhoto, removePhoto } = require('../lib/photos');

const WINDOW_MS = 60 * 60 * 1000;   // 한 시간에
const MAX_PER_IP = 5;               // 한 아이피에서 5건까지 (장난 신청 막기)
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

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
    if (b.program === 'elite') return applyElite(req, res);
    const name = String(b.name || '').trim().slice(0, 40);
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '');
    const level = LEVELS.includes(b.level) ? b.level : 'beginner';
    const memo = String(b.memo || '').trim().slice(0, 200) || null;
    const nameEn = String(b.name_en || '').trim().slice(0, 60) || null;
    const shirt = SIZES.includes(b.shirt_size) ? b.shirt_size : null;
    const recommenders = String(b.recommenders || '').trim().slice(0, 200) || null;
    const isCoach = b.is_coach === true || b.is_coach === '1' ? 1 : 0;   // 코치로 신청

    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    // 회칙 동의 + 개인정보 수집·이용 동의 둘 다 있어야 신청된다 (회칙 동의서)
    if (!b.agree) return res.status(400).json({ error: 'agree_required' });
    if (!b.privacy) return res.status(400).json({ error: 'privacy_required' });
    if (tooMany(req)) return res.status(429).json({ error: 'too_many_requests' });

    // 이미 회원인 번호 / 이미 신청해 둔 번호
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'already_member' });
    if (db.prepare("SELECT id FROM join_request WHERE phone=? AND status='pending'").get(phone)) {
      return res.status(409).json({ error: 'already_requested' });
    }

    // 얼굴 사진(선택) — 다른 검사를 다 통과한 뒤에야 파일로 쓴다 (거절될 신청이 파일을 남기지 않게)
    let photo = null;
    if (b.photo_data) {
      try { photo = savePhoto(b.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
    }

    const rulesVersion = db.prepare("SELECT version FROM doc WHERE key='rules' AND lang='ko'").get()?.version || 1;
    let r;
    try {
      r = db.prepare(`INSERT INTO join_request (name, phone, pin_hash, level, memo, agreed_at, agreed_version,
                                                name_en, shirt_size, recommenders, privacy_agreed_at, is_coach, photo)
                      VALUES (?,?,?,?,?, datetime('now','localtime'), ?, ?,?,?, datetime('now','localtime'), ?, ?)`)
        .run(name, phone, hashPin(pin), level, memo, rulesVersion, nameEn, shirt, recommenders, isCoach, photo);
    } catch (e) { removePhoto(photo); throw e; }
    res.json({ ok: true, id: r.lastInsertRowid });

    // 두 동의를 다 받은 신청만 여기까지 온다 → 승인해 줄 사람(오너·임원)에게 알린다
    notify?.toAdmins({
      title: '🎾 가입 신청 (회칙·개인정보 동의 완료)',
      body: [name + (nameEn ? ` (${nameEn})` : ''), phone, shirt && `티셔츠 ${shirt}`, recommenders && `추천 ${recommenders}`].filter(Boolean).join(' · '),
      url: '#members',
    });
  });

  // ---- 선수반 신청 (로그인 필요 없음) — 회칙 대신 개인정보 동의만, 입회비 없음 ----
  function applyElite(req, res) {
    const b = req.body;
    const name = String(b.name || '').trim().slice(0, 40);
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '');
    const level = LEVELS.includes(b.level) ? b.level : 'beginner';
    const memo = String(b.memo || '').trim().slice(0, 200) || null;
    const by = b.birth_year === '' || b.birth_year == null ? null : Number(b.birth_year);
    const parentName = String(b.parent_name || '').trim().slice(0, 40) || null;
    const parentPhone = normalizePhone(b.parent_phone) || null;

    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    if (by !== null && !(Number.isInteger(by) && by >= 1940 && by <= 2030)) return res.status(400).json({ error: 'bad_birth_year' });
    if (!b.privacy) return res.status(400).json({ error: 'privacy_required' });
    if (tooMany(req)) return res.status(429).json({ error: 'too_many_requests' });
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'already_member' });
    if (db.prepare("SELECT id FROM join_request WHERE phone=? AND status='pending'").get(phone)) {
      return res.status(409).json({ error: 'already_requested' });
    }

    let photo = null;
    if (b.photo_data) {
      try { photo = savePhoto(b.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    let r;
    try {
      r = db.prepare(`INSERT INTO join_request (program, name, phone, pin_hash, level, memo, birth_year, parent_name, parent_phone,
                                                privacy_agreed_at, photo)
                      VALUES ('elite',?,?,?,?,?,?,?,?, datetime('now','localtime'), ?)`)
        .run(name, phone, hashPin(pin), level, memo, by, parentName, parentPhone, photo);
    } catch (e) { removePhoto(photo); throw e; }
    res.json({ ok: true, id: r.lastInsertRowid });

    // 선수반 신청은 오너에게만 알린다 (주니어 정보 — 동호인 임원·선수반 코치에게는 안 보인다)
    const owners = db.prepare("SELECT id FROM member WHERE is_owner=1 AND status='active'").pluck().all();
    notify?.toMembers(owners, {
      title: '⭐ 엘리트선수반 가입 신청',
      body: [name, by, phone, parentName && `부모 ${parentName}`].filter(Boolean).join(' · '),
      url: '#elite',
    });
  }

  // ---- 여기서부터는 관리자만 ----
  // ?program=elite 는 오너만 — 동호인 임원 화면(Members 탭)에는 동호인 신청만 나온다
  router.get('/', auth.requireAdmin, (req, res) => {
    const program = req.query.program === 'elite' ? 'elite' : 'club';
    if (program === 'elite' && !req.me.is_owner) return res.status(403).json({ error: 'owner_only' });
    const rows = db.prepare(`SELECT id, program, name, name_en, phone, level, shirt_size, recommenders, memo, created_at, is_coach, photo,
                                    agreed_at, agreed_version, privacy_agreed_at, birth_year, parent_name, parent_phone
                             FROM join_request WHERE status='pending' AND program=? ORDER BY id`).all(program);
    res.json({ count: rows.length, rows });
  });

  // 지난 신청 내역 (승인·거절한 것) — 선수반 신청은 오너에게만
  router.get('/history', auth.requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT id, program, name, phone, level, status, created_at, decided_at
                         FROM join_request WHERE status<>'pending' AND (program='club' OR ?) ORDER BY id DESC LIMIT 50`)
      .all(req.me.is_owner ? 1 : 0));
  });

  // 선수반 신청을 오너가 아닌 사람이 건드리면 403 (동호인 신청은 기존처럼 임원 누구나)
  const pendingFor = (req, res) => {
    const q = db.prepare("SELECT * FROM join_request WHERE id=? AND status='pending'").get(req.params.id);
    if (!q) { res.status(404).json({ error: 'not_found' }); return null; }
    if (q.program === 'elite' && !req.me.is_owner) { res.status(403).json({ error: 'owner_only' }); return null; }
    return q;
  };

  router.post('/:id/approve', auth.requireAdmin, (req, res) => {
    const q = pendingFor(req, res);
    if (!q) return;
    // 기다리는 동안 관리자가 같은 번호를 손으로 넣었을 수도 있다
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(q.phone)) {
      db.prepare("UPDATE join_request SET status='approved', decided_at=datetime('now','localtime'), decided_by=?, photo=NULL WHERE id=?")
        .run(req.me.id, q.id);
      removePhoto(q.photo);
      return res.status(409).json({ error: 'already_member' });
    }

    if (q.program === 'elite') {
      // 선수 계정 — 회칙 동의·입회비 없음. 수강료는 선수반 Fees 에서 (기본값을 따른다)
      const m = db.transaction(() => {
        const r = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, memo, photo, program,
                                                  birth_year, parent_name, parent_phone)
                              VALUES (?,?,?,'member',?,'active',?,?,?,'elite',?,?,?)`)
          .run(q.name, q.phone, q.pin_hash, q.level, today(), q.memo, q.photo || null, q.birth_year, q.parent_name, q.parent_phone);
        db.prepare("UPDATE join_request SET status='approved', decided_at=datetime('now','localtime'), decided_by=?, photo=NULL WHERE id=?")
          .run(req.me.id, q.id);
        return r.lastInsertRowid;
      })();
      return res.json({ ok: true, member_id: m, name: q.name, program: 'elite' });
    }

    const { joining_fee } = getSettings(db);
    const approve = db.transaction(() => {
      // 신청서 사진은 그대로 회원 사진이 된다 (파일은 옮기지 않고 경로만 넘긴다)
      const m = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, memo, rules_agreed_at, rules_version, is_coach, photo)
                            VALUES (?,?,?,'member',?,'active',?,?,?,?,?,?)`)
        .run(q.name, q.phone, q.pin_hash, q.level, today(), formMemo(q), q.agreed_at, q.agreed_version, q.is_coach ? 1 : 0, q.photo || null);
      // 입회비 미납 한 줄을 세워 둔다 (손으로 넣은 회원과 같은 처리)
      if (joining_fee > 0) {
        db.prepare(`INSERT INTO due (member_id, kind, period, amount) VALUES (?,'joining',?,?)
                    ON CONFLICT(member_id, kind, period) DO NOTHING`)
          .run(m.lastInsertRowid, today().slice(0, 7), joining_fee);
      }
      db.prepare("UPDATE join_request SET status='approved', decided_at=datetime('now','localtime'), decided_by=?, photo=NULL WHERE id=?")
        .run(req.me.id, q.id);
      return m.lastInsertRowid;
    });

    res.json({ ok: true, member_id: approve(), name: q.name });
  });

  router.post('/:id/reject', auth.requireAdmin, (req, res) => {
    const q = pendingFor(req, res);
    if (!q) return;
    // 거절하면 사진은 지운다 (회원이 아닌 사람의 얼굴을 남겨 두지 않는다)
    db.prepare(`UPDATE join_request SET status='rejected', decided_at=datetime('now','localtime'), decided_by=?, photo=NULL
                WHERE id=?`).run(req.me.id, req.params.id);
    removePhoto(q.photo);
    res.json({ ok: true });
  });

  return router;
};

// 신청서 칸을 회원 메모 한 줄로 — 회원 명단에서 관리자가 본다
function formMemo(q) {
  return [
    q.name_en && `EN: ${q.name_en}`,
    q.shirt_size && `T-shirt: ${q.shirt_size}`,
    q.recommenders && `Recommended by: ${q.recommenders}`,
    q.memo,
  ].filter(Boolean).join(' · ') || null;
}
