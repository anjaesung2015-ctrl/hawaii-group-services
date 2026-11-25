'use strict';
// 오픈·마감 인증 사진
//  - 체크리스트 중 photo 표시가 있는 줄(오픈 셋팅·마감 끄기)은 체크 대신 앱 카메라로 찍는다
//  - 찍은 시각은 서버 시각으로 남긴다. 오픈 사진은 그날 출근 시각과 비교해 15분 안인지 본다
//  - 갤러리의 옛 사진은 받지 않는다 (찍은 지 10분 넘으면 거절)
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_ITEM = 4;
const OPEN_LIMIT_MIN = 15;
const STALE_MS = 10 * 60 * 1000;

const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

module.exports = function createPhotos(db, opts = {}) {
  const dir = opts.dir || path.join(__dirname, 'photos');
  const now = opts.now || (() => new Date());
  const clock = opts.clock;   // () => 'HH:MM' (업무 기준 시간대)
  db.exec(`CREATE TABLE IF NOT EXISTS report_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    rdate TEXT NOT NULL,
    kind TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    file TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_item ON report_photos(item_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_staff ON report_photos(staff_id, rdate)`);

  const checkIn = (sid, date) => {
    try { return db.prepare("SELECT check_in FROM report_attendance WHERE staff_id=? AND work_date=?").get(sid, date)?.check_in || null; }
    catch (e) { return null; }   // 근태 표가 없는 환경
  };
  // 오픈 사진이 출근 후 몇 분에 찍혔나
  function openTiming(sid, date, at) {
    const ci = checkIn(sid, date);
    const a = toMin(ci), b = toMin(at);
    if (a == null || b == null) return { check_in: ci, minutes: null, ok: null };
    const m = b - a;
    return { check_in: ci, minutes: m, ok: m <= OPEN_LIMIT_MIN };
  }

  // 목록에 사진 붙이기 — photo 줄(tpl_photo)이 있는 항목만
  function attach(items) {
    const want = (items || []).filter(i => i && i.tpl_photo);
    if (!want.length) return items;
    const q = db.prepare("SELECT id, taken_at FROM report_photos WHERE item_id=? ORDER BY id");
    for (const it of want) {
      it.photos = q.all(it.id).map(p => ({ id: p.id, at: p.taken_at.slice(11, 16) }));
      if (it.tpl_photo === 'open' && it.photos.length) Object.assign(it, { open: openTiming(it.staff_id, it.item_date, it.photos[0].at) });
    }
    return items;
  }

  // 일일보고용: 그 사람의 그날 오픈·마감 인증
  function summary(sid, date) {
    const rows = db.prepare("SELECT id, kind, taken_at FROM report_photos WHERE staff_id=? AND rdate=? ORDER BY id").all(sid, date);
    const open = rows.filter(r => r.kind === 'open'), close = rows.filter(r => r.kind === 'close');
    const out = { open_at: open[0]?.taken_at.slice(11, 16) || null, close_at: close.at(-1)?.taken_at.slice(11, 16) || null,
      photos: rows.map(r => ({ id: r.id, kind: r.kind, at: r.taken_at.slice(11, 16) })) };
    const t = open.length ? openTiming(sid, date, out.open_at) : { check_in: checkIn(sid, date), minutes: null, ok: null };
    return { ...out, check_in: t.check_in, open_min: t.minutes, open_ok: t.ok };
  }

  // 사진 저장. item 은 이미 권한 확인된 report_items 행 + tpl_photo
  function save(item, body) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.data || ''));
    if (!m) return { code: 400, error: 'bad_image' };
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_BYTES) return { code: 413, error: 'too_big' };
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return { code: 400, error: 'bad_image' };
    const shot = Number(body?.shot_at);
    if (shot && now().getTime() - shot > STALE_MS) return { code: 400, error: 'old_photo' };
    const n = db.prepare("SELECT COUNT(*) n FROM report_photos WHERE item_id=?").get(item.id).n;
    if (n >= MAX_PER_ITEM) return { code: 400, error: 'too_many' };

    const hhmm = clock ? clock() : now().toTimeString().slice(0, 5);
    const takenAt = `${item.item_date} ${hhmm}`;
    const sub = path.join(dir, item.item_date);
    fs.mkdirSync(sub, { recursive: true });
    const r = db.prepare("INSERT INTO report_photos (item_id, staff_id, rdate, kind, taken_at, file) VALUES (?,?,?,?,?,'')")
      .run(item.id, item.staff_id, item.item_date, item.tpl_photo, takenAt);
    const file = path.join(item.item_date, `${r.lastInsertRowid}.jpg`);
    fs.writeFileSync(path.join(dir, file), buf);
    db.prepare("UPDATE report_photos SET file=? WHERE id=?").run(file, r.lastInsertRowid);
    db.prepare("UPDATE report_items SET done=1, updated_at=datetime('now','localtime') WHERE id=?").run(item.id);
    return { ok: true, id: r.lastInsertRowid, at: hhmm,
      open: item.tpl_photo === 'open' ? openTiming(item.staff_id, item.item_date, hhmm) : undefined };
  }

  const get = (id) => db.prepare("SELECT * FROM report_photos WHERE id=?").get(id);
  const fileOf = (p) => path.join(dir, p.file);
  const count = (itemId) => db.prepare("SELECT COUNT(*) n FROM report_photos WHERE item_id=?").get(itemId).n;

  return { attach, summary, save, get, fileOf, count, OPEN_LIMIT_MIN };
};
