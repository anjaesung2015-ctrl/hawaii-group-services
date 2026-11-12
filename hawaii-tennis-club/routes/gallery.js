// 사진첩 — 홈 화면에 최근 사진이 보이고, 누르면 전체 사진첩.
// 회원 누구나 한 번에 여러 장 올린다(설명 한 줄은 그 묶음에 같이 붙는다).
// 지우기는 올린 사람 또는 운영진.
const express = require('express');
const { savePhotos, removePhoto } = require('../lib/photos');

const MAX_PHOTOS = 10;     // 한 번에 올리는 장수
const MAX_CAPTION = 200;
const PAGE = 30;

module.exports = function galleryRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 최신 사진부터. ?before=<id> 로 그보다 오래된 사진을 이어 받는다.
  router.get('/', (req, res) => {
    const before = Number(req.query.before) || 0;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || PAGE));
    const rows = db.prepare(`
      SELECT g.id, g.member_id, g.photo, g.caption, g.created_at, m.name AS author
      FROM gallery_photo g LEFT JOIN member m ON m.id = g.member_id
      ${before ? 'WHERE g.id < ?' : ''}
      ORDER BY g.id DESC LIMIT ?`).all(...(before ? [before, limit] : [limit]));
    const total = db.prepare('SELECT COUNT(*) c FROM gallery_photo').get().c;
    res.json({ rows, has_more: rows.length === limit, total });
  });

  router.post('/', (req, res) => {
    const list = Array.isArray(req.body?.photos) ? req.body.photos.filter(Boolean) : [];
    if (!list.length) return res.status(400).json({ error: 'photo_required' });
    if (list.length > MAX_PHOTOS) return res.status(400).json({ error: 'too_many_photos' });
    const caption = String(req.body?.caption || '').trim().slice(0, MAX_CAPTION) || null;

    let saved;
    try { saved = savePhotos(list, MAX_PHOTOS); } catch (e) { return res.status(400).json({ error: e.message }); }

    const ins = db.prepare('INSERT INTO gallery_photo (member_id, photo, caption) VALUES (?,?,?)');
    const ids = db.transaction(() => saved.map(p => ins.run(req.me.id, p, caption).lastInsertRowid))();
    res.json({ ok: true, ids });
  });

  // 설명 고치기 — 올린 사람 또는 운영진
  router.patch('/:id', (req, res) => {
    const g = db.prepare('SELECT * FROM gallery_photo WHERE id=?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'not_found' });
    if (g.member_id !== req.me.id && !isAdmin(req.me)) return res.status(403).json({ error: 'forbidden' });
    const caption = String(req.body?.caption || '').trim().slice(0, MAX_CAPTION) || null;
    db.prepare('UPDATE gallery_photo SET caption=? WHERE id=?').run(caption, g.id);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const g = db.prepare('SELECT * FROM gallery_photo WHERE id=?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'not_found' });
    if (g.member_id !== req.me.id && !isAdmin(req.me)) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM gallery_photo WHERE id=?').run(g.id);
    removePhoto(g.photo);
    res.json({ ok: true });
  });

  return router;
};

const isAdmin = (me) => me.role === 'admin' || !!me.is_owner;
