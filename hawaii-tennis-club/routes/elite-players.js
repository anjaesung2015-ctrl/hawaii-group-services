// 선수반 선수 명단 — 오너·선수반 코치가 관리한다. 선수(또는 부모)는 이 번호·PIN 으로 로그인해 선수반 화면만 본다.
const express = require('express');
const { hashPin, normalizePhone, validPhone, validPin, today, LEVELS } = require('../lib/db');
const { removePhoto, setMemberPhoto } = require('../lib/photos');
const { isStaffId } = require('../lib/elite');

const PLAYER_COLS = `id, name, phone, level, status, photo, birth_year, parent_name, parent_phone, elite_fee,
                     assigned_coach_id, joined_at, memo`;

module.exports = function elitePlayerRoutes(db, auth) {
  const router = express.Router();

  // 코치로 고를 수 있는 사람 (오너 + 선수반 코치) — 일정·명단의 담당 코치 칸
  router.get('/staff', auth.requireElite, (req, res) => {
    res.json(db.prepare(`SELECT id, name, photo, is_owner, elite_coach FROM member
                         WHERE program='club' AND status='active' AND (is_owner=1 OR elite_coach=1) ORDER BY is_owner DESC, name`).all());
  });

  // 선수반 코치 지정·해제 — 오너만, 동호인 계정에만
  router.put('/coaches/:id', auth.requireOwner, (req, res) => {
    const m = db.prepare("SELECT id, is_owner FROM member WHERE id=? AND program='club'").get(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    db.prepare('UPDATE member SET elite_coach=? WHERE id=?').run(req.body?.on ? 1 : 0, m.id);
    res.json({ ok: true });
  });

  router.use('/players', auth.requireEliteStaff);

  // :id 는 선수만
  router.param('pid', (req, res, next, id) =>
    db.prepare("SELECT 1 FROM member WHERE id=? AND program='elite'").get(id) ? next() : res.status(404).json({ error: 'not_found' }));

  router.get('/players', (req, res) => {
    res.json(db.prepare(`SELECT ${PLAYER_COLS} FROM member WHERE program='elite' ORDER BY status='dormant', name`).all());
  });

  router.post('/players', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40);
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '').trim() || phone.slice(-4);
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'phone_taken' });
    const f = fields(db, b);
    if (f.error) return res.status(400).json({ error: f.error });
    const r = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, program,
                                              birth_year, parent_name, parent_phone, elite_fee, assigned_coach_id, memo)
                          VALUES (?,?,?,'member',?,'active',?,'elite',?,?,?,?,?,?)`)
      .run(name, phone, hashPin(pin), f.level ?? 'beginner', today(),
           f.birth_year ?? null, f.parent_name ?? null, f.parent_phone ?? null, f.elite_fee ?? null, f.assigned_coach_id ?? null, f.memo ?? null);
    res.json({ ok: true, id: r.lastInsertRowid, first_pin: pin });
  });

  router.patch('/players/:pid', (req, res) => {
    const b = req.body || {};
    const f = fields(db, b);
    if (f.error) return res.status(400).json({ error: f.error });
    if ('name' in b) {
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'name_required' });
      f.name = name;
    }
    if ('phone' in b) {
      const phone = normalizePhone(b.phone);
      if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
      if (db.prepare('SELECT id FROM member WHERE phone=? AND id<>?').get(phone, req.params.pid)) return res.status(409).json({ error: 'phone_taken' });
      f.phone = phone;
    }
    if ('status' in b) f.status = b.status === 'dormant' ? 'dormant' : 'active';
    const keys = Object.keys(f);
    if (!keys.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare(`UPDATE member SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => f[k]), req.params.pid);
    res.json({ ok: true });
  });

  router.post('/players/:pid/pin', (req, res) => {
    const pin = String(req.body?.pin || '');
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    db.prepare('UPDATE member SET pin_hash=? WHERE id=?').run(hashPin(pin), req.params.pid);
    res.json({ ok: true });
  });

  router.put('/players/:pid/photo', (req, res) => {
    if (!req.body?.photo_data) return res.status(400).json({ error: 'bad_photo' });
    try { res.json({ ok: true, photo: setMemberPhoto(db, req.params.pid, req.body.photo_data) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // 삭제하면 출석·수강료 기록도 같이 사라진다(CASCADE). 기록을 남기려면 탈퇴(status=dormant)로.
  router.delete('/players/:pid', (req, res) => {
    const m = db.prepare('SELECT photo FROM member WHERE id=?').get(req.params.pid);
    db.prepare('DELETE FROM member WHERE id=?').run(req.params.pid);
    removePhoto(m.photo);
    res.json({ ok: true });
  });

  return router;
};

// 선택 칸들 — 보낸 것만 돌려준다. 빈 값은 NULL 로(선수별 수강료를 비우면 기본값을 쓴다)
function fields(db, b) {
  const f = {};
  if ('level' in b) { if (!LEVELS.includes(b.level)) return { error: 'bad_level' }; f.level = b.level; }
  if ('birth_year' in b) {
    const y = b.birth_year === '' || b.birth_year == null ? null : Number(b.birth_year);
    if (y !== null && !(Number.isInteger(y) && y >= 1940 && y <= 2030)) return { error: 'bad_birth_year' };
    f.birth_year = y;
  }
  for (const k of ['parent_name', 'memo']) if (k in b) f[k] = String(b[k] || '').trim().slice(0, 200) || null;
  if ('parent_phone' in b) f.parent_phone = normalizePhone(b.parent_phone) || null;
  if ('elite_fee' in b) {
    const n = b.elite_fee === '' || b.elite_fee == null ? null : Number(b.elite_fee);
    if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 100000000)) return { error: 'bad_elite_fee' };
    f.elite_fee = n === null ? null : Math.round(n);
  }
  if ('assigned_coach_id' in b) {
    const id = Number(b.assigned_coach_id) || null;
    if (id && !isStaffId(db, id)) return { error: 'bad_coach' };
    f.assigned_coach_id = id;
  }
  return f;
}
