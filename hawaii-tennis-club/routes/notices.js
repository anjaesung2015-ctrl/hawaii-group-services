// 공지 — 관리자가 쓰고 회원은 읽는다. 사진은 폰에서 줄여 보낸 JPEG 를 uploads/ 에 저장 (최대 10장).
// notice.photos = 사진 경로 JSON 배열(첫 장은 notice.photo 에도 — 홈 피드·옛 화면용). 옛 공지는 photo 한 장만 있다.
const express = require('express');
const { savePhoto, savePhotos, removePhoto } = require('../lib/photos');

const MAX_PHOTOS = 10;

// 공지 하나의 사진 경로들
function photosOf(n) {
  try { const a = n.photos ? JSON.parse(n.photos) : null; if (Array.isArray(a) && a.length) return a; } catch { /* 옛 공지 */ }
  return n.photo ? [n.photo] : [];
}
const photoCols = (list) => [list[0] || null, list.length ? JSON.stringify(list) : null];

module.exports = function noticeRoutes(db, auth, notify, tr) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 고정 공지가 먼저, 그다음 최신 순
  router.get('/', async (req, res) => {
    const rows = db.prepare(`SELECT n.*, m.name AS author
                             FROM notice n LEFT JOIN member m ON m.id = n.created_by
                             ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`).all()
      .map(n => ({ ...n, photos: photosOf(n) }));
    // 화면 언어로 번역한 title_tr·body_tr 을 덧붙인다 (원문은 그대로 둔다)
    if (tr && req.query.lang) await tr.attach(rows, ['title', 'body'], String(req.query.lang));
    res.json(rows);
  });

  router.post('/', auth.requireAdmin, (req, res) => {
    const b = parse(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    // 여러 장은 photos_data(배열), 예전 화면은 photo_data 한 장
    const list = Array.isArray(req.body?.photos_data) ? req.body.photos_data : (b.photo_data ? [b.photo_data] : []);
    let saved;
    try { saved = savePhotos(list, MAX_PHOTOS); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const [photo, photos] = photoCols(saved);
    const r = db.prepare(`INSERT INTO notice (title, body, photo, photos, pinned, created_by) VALUES (?,?,?,?,?,?)`)
      .run(b.title, b.body, photo, photos, b.pinned, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid, photo, photos: saved });

    // 알림은 응답을 보낸 뒤에 (알림이 늦어도 공지는 이미 올라갔다)
    notify?.toAll({ title: `📣 ${b.title}`, body: b.body.slice(0, 120), url: '#notices' }, [req.me.id]);
  });

  router.patch('/:id', auth.requireAdmin, (req, res) => {
    const n = db.prepare('SELECT * FROM notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    const b = parse({ ...n, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });

    const old = photosOf(n);
    let next = old;
    if (Array.isArray(req.body?.photos_keep) || Array.isArray(req.body?.photos_data)) {
      // 남길 사진(지금 있는 것 중에서만, 보낸 순서대로) + 새로 고른 사진
      const keep = (Array.isArray(req.body.photos_keep) ? req.body.photos_keep : old).filter(p => old.includes(p));
      const add = Array.isArray(req.body.photos_data) ? req.body.photos_data.filter(Boolean) : [];
      if (keep.length + add.length > MAX_PHOTOS) return res.status(400).json({ error: 'too_many_photos' });
      let saved;
      try { saved = savePhotos(add, MAX_PHOTOS); } catch (e) { return res.status(400).json({ error: e.message }); }
      next = [...keep, ...saved];
    } else if (req.body?.photo_data) {
      // 예전 방식 — 사진 한 장으로 바꾸기
      try { next = [savePhoto(req.body.photo_data)]; } catch (e) { return res.status(400).json({ error: e.message }); }
    } else if (req.body?.remove_photo) {
      next = [];
    }

    const [photo, photos] = photoCols(next);
    db.prepare(`UPDATE notice SET title=?, body=?, photo=?, photos=?, pinned=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title, b.body, photo, photos, b.pinned, n.id);
    for (const p of old) if (!next.includes(p)) removePhoto(p);
    res.json({ ok: true, photo, photos: next });
  });

  router.delete('/:id', auth.requireAdmin, (req, res) => {
    const n = db.prepare('SELECT * FROM notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM notice WHERE id=?').run(n.id);
    for (const p of photosOf(n)) removePhoto(p);
    res.json({ ok: true });
  });

  return router;
};

function parse(b = {}) {
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (!title) return { error: 'title_required' };
  if (!body) return { error: 'body_required' };
  return { title, body, pinned: b.pinned ? 1 : 0, photo_data: b.photo_data };
}
