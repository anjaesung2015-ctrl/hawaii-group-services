// 자유게시판 — 회원끼리 쓰는 곳. 글 + 사진 여러 장 + 댓글 + 좋아요.
// 내 글·내 댓글은 내가 지우고, 관리자는 아무 것이나 지울 수 있다(클럽 운영상 필요).
const express = require('express');
const { savePhotos, removePhoto } = require('../lib/photos');

const MAX_PHOTOS = 4;
const MAX_BODY = 2000;
const MAX_COMMENT = 500;
const PAGE = 20;

module.exports = function postRoutes(db, auth, notify, tr) {
  const router = express.Router();
  router.use(auth.requireMember);

  // 목록 — 최신 글부터. ?before=<id> 로 그보다 오래된 글을 이어 받는다.
  router.get('/', async (req, res) => {
    const before = Number(req.query.before) || 0;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || PAGE));
    const rows = db.prepare(`
      SELECT p.id, p.member_id, p.body, p.created_at, p.updated_at,
             m.name AS author, m.photo AS author_photo, m.level,
             (SELECT COUNT(*) FROM comment   c WHERE c.post_id = p.id) AS comments,
             (SELECT COUNT(*) FROM post_like l WHERE l.post_id = p.id) AS likes,
             EXISTS(SELECT 1 FROM post_like l WHERE l.post_id = p.id AND l.member_id = ?) AS liked
      FROM post p JOIN member m ON m.id = p.member_id
      ${before ? 'WHERE p.id < ?' : ''}
      ORDER BY p.id DESC LIMIT ?`).all(...(before ? [req.me.id, before, limit] : [req.me.id, limit]));

    const out = withPhotos(db, rows);
    if (tr && req.query.lang) await tr.attach(out, ['body'], String(req.query.lang));
    res.json({ rows: out, has_more: rows.length === limit });
  });

  router.get('/:id', async (req, res) => {
    const p = db.prepare(`
      SELECT p.id, p.member_id, p.body, p.created_at, p.updated_at, m.name AS author, m.photo AS author_photo, m.level,
             (SELECT COUNT(*) FROM post_like l WHERE l.post_id = p.id) AS likes,
             EXISTS(SELECT 1 FROM post_like l WHERE l.post_id = p.id AND l.member_id = ?) AS liked
      FROM post p JOIN member m ON m.id = p.member_id WHERE p.id=?`).get(req.me.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });

    const comments = db.prepare(`
      SELECT c.id, c.member_id, c.body, c.created_at, m.name AS author
      FROM comment c JOIN member m ON m.id = c.member_id
      WHERE c.post_id=? ORDER BY c.id`).all(p.id);

    const one = withPhotos(db, [p])[0];
    if (tr && req.query.lang) {
      const lang = String(req.query.lang);
      await Promise.all([tr.attach([one], ['body'], lang), tr.attach(comments, ['body'], lang)]);
    }
    res.json({ ...one, comments });
  });

  router.post('/', (req, res) => {
    const body = String(req.body?.body || '').trim().slice(0, MAX_BODY);
    const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    // 글도 사진도 없으면 올릴 것이 없다
    if (!body && !photos.length) return res.status(400).json({ error: 'body_required' });

    let saved = [];
    try { saved = savePhotos(photos, MAX_PHOTOS); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const make = db.transaction(() => {
      const r = db.prepare('INSERT INTO post (member_id, body) VALUES (?,?)').run(req.me.id, body);
      saved.forEach((p, i) => db.prepare('INSERT INTO post_photo (post_id, path, sort) VALUES (?,?,?)').run(r.lastInsertRowid, p, i));
      return r.lastInsertRowid;
    });
    const id = make();
    res.json({ ok: true, id, photos: saved });

    notify?.toAll({
      title: `💬 ${req.me.name}`,
      body: body ? body.slice(0, 120) : '📷',
      url: '#board',
    }, [req.me.id]);
  });

  // 글 고치기 — 글쓴이만. 사진은 건드리지 않는다(지우고 새로 올리면 된다).
  router.patch('/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM post WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (p.member_id !== req.me.id) return res.status(403).json({ error: 'not_mine' });
    const body = String(req.body?.body || '').trim().slice(0, MAX_BODY);
    const photoCount = db.prepare('SELECT COUNT(*) c FROM post_photo WHERE post_id=?').get(p.id).c;
    if (!body && !photoCount) return res.status(400).json({ error: 'body_required' });
    db.prepare("UPDATE post SET body=?, updated_at=datetime('now','localtime') WHERE id=?").run(body, p.id);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM post WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (p.member_id !== req.me.id && req.me.role !== 'admin') return res.status(403).json({ error: 'not_mine' });
    const photos = db.prepare('SELECT path FROM post_photo WHERE post_id=?').pluck().all(p.id);
    db.prepare('DELETE FROM post WHERE id=?').run(p.id);   // 댓글·좋아요·사진줄은 CASCADE
    for (const f of photos) removePhoto(f);
    res.json({ ok: true });
  });

  // ---- 좋아요 ----
  router.put('/:id/like', (req, res) => {
    const p = db.prepare('SELECT id FROM post WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const on = !!req.body?.on;
    if (on) db.prepare('INSERT INTO post_like (post_id, member_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(p.id, req.me.id);
    else db.prepare('DELETE FROM post_like WHERE post_id=? AND member_id=?').run(p.id, req.me.id);
    res.json({ ok: true, liked: on, likes: db.prepare('SELECT COUNT(*) c FROM post_like WHERE post_id=?').get(p.id).c });
  });

  // ---- 댓글 ----
  router.post('/:id/comments', (req, res) => {
    const p = db.prepare('SELECT id, member_id FROM post WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const body = String(req.body?.body || '').trim().slice(0, MAX_COMMENT);
    if (!body) return res.status(400).json({ error: 'body_required' });
    const r = db.prepare('INSERT INTO comment (post_id, member_id, body) VALUES (?,?,?)').run(p.id, req.me.id, body);
    res.json({ ok: true, id: r.lastInsertRowid });

    // 댓글은 글쓴이에게만 알린다 (모두에게 보내면 시끄럽다). 내 글에 내가 달면 보내지 않는다.
    if (p.member_id !== req.me.id) {
      notify?.toMembers([p.member_id], {
        title: `💬 ${req.me.name}`,
        body: body.slice(0, 120),
        url: '#board',
      });
    }
  });

  router.delete('/:id/comments/:cid', (req, res) => {
    const c = db.prepare('SELECT * FROM comment WHERE id=? AND post_id=?').get(req.params.cid, req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    if (c.member_id !== req.me.id && req.me.role !== 'admin') return res.status(403).json({ error: 'not_mine' });
    db.prepare('DELETE FROM comment WHERE id=?').run(c.id);
    res.json({ ok: true });
  });

  return router;
};

// 글마다 사진 경로를 붙인다 (쿼리 한 번으로 모아서)
function withPhotos(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const ph = db.prepare(`SELECT post_id, path FROM post_photo
                         WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY post_id, sort, id`).all(...ids);
  const by = new Map(ids.map(id => [id, []]));
  for (const p of ph) by.get(p.post_id)?.push(p.path);
  return rows.map(r => ({ ...r, liked: !!r.liked, photos: by.get(r.id) || [] }));
}
