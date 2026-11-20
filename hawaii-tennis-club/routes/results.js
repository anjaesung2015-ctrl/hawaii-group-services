// 대회 성적 (Hall of Fame) — 월례대회·외부대회 입상 기록.
// 보기는 동호인 누구나, 올리기·고치기·지우기는 운영진 + 오너가 지정한 성적 담당(member.results_manager).
// 입상자 = 클럽 회원(member_id) 또는 회원이 아닌 사람(이름만). 이름은 올릴 때 것을 남긴다.
const express = require('express');
const { savePhotos, removePhoto } = require('../lib/photos');

const KINDS = ['monthly', 'external'];
const MAX_PHOTOS = 10;
const MAX_ENTRIES = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function resultRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 최근 대회부터. ?kind=monthly|external, ?year=2026, ?limit=
  router.get('/', (req, res) => {
    const where = [], args = [];
    if (KINDS.includes(req.query.kind)) { where.push('r.kind=?'); args.push(req.query.kind); }
    if (/^\d{4}$/.test(req.query.year || '')) { where.push("substr(r.held_on,1,4)=?"); args.push(req.query.year); }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const rows = db.prepare(`SELECT r.* FROM result r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                             ORDER BY r.held_on DESC, r.id DESC LIMIT ?`).all(...args, limit);
    attach(db, rows);
    const years = db.prepare("SELECT DISTINCT substr(held_on,1,4) y FROM result ORDER BY y DESC").pluck().all();
    res.json({ rows, years });
  });

  router.post('/', auth.requireResults, (req, res) => {
    const b = parse(db, req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    let photos;
    try { photos = savePhotos(req.body?.photos, MAX_PHOTOS); } catch (e) { return res.status(400).json({ error: e.message }); }

    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO result (title, held_on, kind, division, note, created_by) VALUES (?,?,?,?,?,?)')
        .run(b.title, b.held_on, b.kind, b.division, b.note, req.me.id);
      putEntries(db, r.lastInsertRowid, b.entries);
      const ins = db.prepare('INSERT INTO result_photo (result_id, photo) VALUES (?,?)');
      for (const p of photos) ins.run(r.lastInsertRowid, p);
      return r.lastInsertRowid;
    })();
    res.json({ ok: true, id });
  });

  // 고치기 — 입상자 목록은 통째로 바꾼다. 사진은 remove_photos(id 목록)로 빼고 photos 로 더한다.
  router.patch('/:id', auth.requireResults, (req, res) => {
    const r = db.prepare('SELECT * FROM result WHERE id=?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const b = parse(db, { ...r, ...req.body, entries: req.body?.entries ?? null });
    if (b.error) return res.status(400).json({ error: b.error });

    const old = db.prepare('SELECT id, photo FROM result_photo WHERE result_id=?').all(r.id);
    const drop = new Set((Array.isArray(req.body?.remove_photos) ? req.body.remove_photos : []).map(Number));
    const gone = old.filter(p => drop.has(p.id));
    const room = MAX_PHOTOS - (old.length - gone.length);
    const adds = Array.isArray(req.body?.photos) ? req.body.photos.filter(Boolean) : [];
    if (adds.length > room) return res.status(400).json({ error: 'too_many_photos' });
    let photos;
    try { photos = savePhotos(adds, MAX_PHOTOS); } catch (e) { return res.status(400).json({ error: e.message }); }

    db.transaction(() => {
      db.prepare(`UPDATE result SET title=?, held_on=?, kind=?, division=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(b.title, b.held_on, b.kind, b.division, b.note, r.id);
      if (b.entries) {
        db.prepare('DELETE FROM result_entry WHERE result_id=?').run(r.id);
        putEntries(db, r.id, b.entries);
      }
      const del = db.prepare('DELETE FROM result_photo WHERE id=?');
      for (const p of gone) del.run(p.id);
      const ins = db.prepare('INSERT INTO result_photo (result_id, photo) VALUES (?,?)');
      for (const p of photos) ins.run(r.id, p);
    })();
    for (const p of gone) removePhoto(p.photo);
    res.json({ ok: true });
  });

  router.delete('/:id', auth.requireResults, (req, res) => {
    const r = db.prepare('SELECT id FROM result WHERE id=?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const photos = db.prepare('SELECT photo FROM result_photo WHERE result_id=?').pluck().all(r.id);
    db.prepare('DELETE FROM result WHERE id=?').run(r.id);   // 입상자·사진 줄은 CASCADE
    for (const p of photos) removePhoto(p);
    res.json({ ok: true });
  });

  return router;
};

// 입상자·사진을 대회마다 붙인다. 회원이면 지금 이름·사진으로 보여준다(이름을 바꿔도 따라간다).
function attach(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const q = ids.map(() => '?').join(',');
  const entries = db.prepare(`SELECT e.result_id, e.place, e.member_id, COALESCE(m.name, e.person_name) AS name, m.photo
                              FROM result_entry e LEFT JOIN member m ON m.id = e.member_id
                              WHERE e.result_id IN (${q}) ORDER BY e.place, e.sort, e.id`).all(...ids);
  const photos = db.prepare(`SELECT id, result_id, photo FROM result_photo WHERE result_id IN (${q}) ORDER BY id`).all(...ids);
  const by = new Map(rows.map(r => [r.id, Object.assign(r, { entries: [], photos: [] })]));
  for (const e of entries) by.get(e.result_id).entries.push({ place: e.place, member_id: e.member_id, name: e.name, photo: e.photo });
  for (const p of photos) by.get(p.result_id).photos.push({ id: p.id, photo: p.photo });
  return rows;
}

function putEntries(db, resultId, entries) {
  const ins = db.prepare('INSERT INTO result_entry (result_id, place, member_id, person_name, sort) VALUES (?,?,?,?,?)');
  entries.forEach((e, i) => ins.run(resultId, e.place, e.member_id, e.person_name, i));
}

function parse(db, b = {}) {
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return { error: 'title_required' };
  const held_on = String(b.held_on || '');
  if (!DATE.test(held_on)) return { error: 'bad_date' };
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'bad_kind' };
  const division = String(b.division || '').trim().slice(0, 60) || null;
  const note = String(b.note || '').trim().slice(0, 1000) || null;

  // entries 가 null 이면 (고칠 때 안 보냄) 입상자는 그대로 둔다
  if (b.entries == null) return { title, held_on, kind, division, note, entries: null };
  if (!Array.isArray(b.entries)) return { error: 'entries_required' };
  const nameOf = db.prepare("SELECT name FROM member WHERE id=? AND program='club'");
  const entries = [];
  for (const e of b.entries.slice(0, MAX_ENTRIES + 1)) {
    const place = Number(e?.place);
    if (![1, 2, 3, 4].includes(place)) return { error: 'bad_place' };
    if (e.member_id) {
      const m = nameOf.get(Number(e.member_id));
      if (!m) return { error: 'bad_member' };
      entries.push({ place, member_id: Number(e.member_id), person_name: m.name });
    } else {
      const name = String(e?.name || '').trim().slice(0, 60);
      if (!name) continue;          // 빈 줄은 건너뛴다
      entries.push({ place, member_id: null, person_name: name });
    }
  }
  if (!entries.length) return { error: 'entries_required' };
  if (entries.length > MAX_ENTRIES) return { error: 'too_many_entries' };
  return { title, held_on, kind, division, note, entries };
}
