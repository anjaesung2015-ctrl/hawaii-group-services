// 공지 — 관리자가 쓰고 회원은 읽는다. 사진은 폰에서 줄여 보낸 JPEG 한 장을 uploads/ 에 저장.
const express = require('express');
const { savePhoto, removePhoto } = require('../lib/photos');

module.exports = function noticeRoutes(db, auth, notify, tr) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 고정 공지가 먼저, 그다음 최신 순
  router.get('/', async (req, res) => {
    const rows = db.prepare(`SELECT n.*, m.name AS author
                             FROM notice n LEFT JOIN member m ON m.id = n.created_by
                             ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`).all();
    // 화면 언어로 번역한 title_tr·body_tr 을 덧붙인다 (원문은 그대로 둔다)
    if (tr && req.query.lang) await tr.attach(rows, ['title', 'body'], String(req.query.lang));
    res.json(rows);
  });

  router.post('/', auth.requireAdmin, (req, res) => {
    const b = parse(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = null;
    try { photo = savePhoto(b.photo_data); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const r = db.prepare(`INSERT INTO notice (title, body, photo, pinned, created_by) VALUES (?,?,?,?,?)`)
      .run(b.title, b.body, photo, b.pinned, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid, photo });

    // 알림은 응답을 보낸 뒤에 (알림이 늦어도 공지는 이미 올라갔다)
    notify?.toAll({ title: `📣 ${b.title}`, body: b.body.slice(0, 120), url: '#notices' }, [req.me.id]);
  });

  router.patch('/:id', auth.requireAdmin, (req, res) => {
    const n = db.prepare('SELECT * FROM notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    const b = parse({ ...n, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });

    let photo = n.photo;
    if (req.body?.photo_data) {
      try { photo = savePhoto(req.body.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
      removePhoto(n.photo);
    } else if (req.body?.remove_photo) {
      removePhoto(n.photo);
      photo = null;
    }

    db.prepare(`UPDATE notice SET title=?, body=?, photo=?, pinned=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title, b.body, photo, b.pinned, n.id);
    res.json({ ok: true, photo });
  });

  router.delete('/:id', auth.requireAdmin, (req, res) => {
    const n = db.prepare('SELECT * FROM notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM notice WHERE id=?').run(n.id);
    removePhoto(n.photo);
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
