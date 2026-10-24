// 선수반 공지 — 오너·선수반 코치가 쓰고, 선수가 읽는다. 동호인 공지와 따로.
const express = require('express');
const { savePhoto, removePhoto } = require('../lib/photos');

module.exports = function eliteNoticeRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireElite);

  router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT n.*, m.name AS author FROM elite_notice n LEFT JOIN member m ON m.id = n.created_by
                         ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`).all());
  });

  router.post('/', auth.requireEliteStaff, (req, res) => {
    const b = parse(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = null;
    try { photo = savePhoto(req.body?.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
    const r = db.prepare('INSERT INTO elite_notice (title, body, photo, pinned, created_by) VALUES (?,?,?,?,?)')
      .run(b.title, b.body, photo, b.pinned, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid, photo });
    notify?.toElite({ title: `📣 ${b.title}`, body: b.body.slice(0, 120), url: '#enotices' }, [req.me.id]);
  });

  router.patch('/:id', auth.requireEliteStaff, (req, res) => {
    const n = db.prepare('SELECT * FROM elite_notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    const b = parse({ ...n, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = n.photo;
    if (req.body?.photo_data) {
      try { photo = savePhoto(req.body.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
      removePhoto(n.photo);
    } else if (req.body?.remove_photo) { removePhoto(n.photo); photo = null; }
    db.prepare(`UPDATE elite_notice SET title=?, body=?, photo=?, pinned=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title, b.body, photo, b.pinned, n.id);
    res.json({ ok: true, photo });
  });

  router.delete('/:id', auth.requireEliteStaff, (req, res) => {
    const n = db.prepare('SELECT * FROM elite_notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM elite_notice WHERE id=?').run(n.id);
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
  return { title, body, pinned: b.pinned ? 1 : 0 };
}
