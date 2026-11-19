// 사진첩 — 사진·동영상. 홈 피드와 Photos 화면에 보인다.
// 회원 누구나 한 번에 여러 장 올린다(설명 한 줄은 그 묶음에 같이 붙는다). 동영상은 한 개씩 POST /video (1분·50MB).
// 지우기는 올린 사람 또는 운영진.
const express = require('express');
const { savePhoto, savePhotos, removePhoto } = require('../lib/photos');
const { receiveVideo, MAX_SECONDS } = require('../lib/video');

const MAX_PHOTOS = 10;     // 한 번에 올리는 장수
const MAX_CAPTION = 200;
const PAGE = 30;

module.exports = function galleryRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 최신 사진부터. ?before=<id> 로 그보다 오래된 사진을 이어 받는다.
  router.get('/', (req, res) => {
    // ?group=<사진 id> — 그 사진과 한 번에 올린 묶음 전부 (홈 피드 콜라주를 눌렀을 때)
    if (req.query.group) {
      const rows = db.prepare(`
        SELECT g.id, g.member_id, g.photo, g.video, g.duration, g.caption, g.created_at, m.name AS author
        FROM gallery_photo g LEFT JOIN member m ON m.id = g.member_id
        WHERE g.batch = (SELECT batch FROM gallery_photo WHERE id = ?) ORDER BY g.id`).all(Number(req.query.group) || 0);
      return res.json({ rows, has_more: false, total: rows.length });
    }
    const before = Number(req.query.before) || 0;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || PAGE));
    const rows = db.prepare(`
      SELECT g.id, g.member_id, g.photo, g.video, g.duration, g.caption, g.created_at, m.name AS author
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
    const ids = db.transaction(() => {
      const got = saved.map(p => ins.run(req.me.id, p, caption).lastInsertRowid);
      db.prepare(`UPDATE gallery_photo SET batch=? WHERE id IN (${got.map(() => '?').join(',')})`).run(got[0], ...got);
      return got;
    })();
    res.json({ ok: true, ids });
  });

  // 동영상 한 개 — multipart: video(파일) + poster(첫 장면 JPEG) + duration(초) + caption
  router.post('/video', async (req, res) => {
    let got;
    try { got = await receiveVideo(req); }
    catch (e) { return res.status(e.message === 'video_too_big' ? 413 : 400).json({ error: e.message }); }
    const drop = (code, status = 400) => { removePhoto(got.file); res.status(status).json({ error: code }); };

    const duration = Number(got.fields.duration);
    if (!(duration > 0)) return drop('bad_video');
    if (duration > MAX_SECONDS) return drop('video_too_long');
    let poster;
    try { poster = savePhoto(got.fields.poster); } catch (e) { return drop(e.message); }
    if (!poster) return drop('poster_required');
    const caption = String(got.fields.caption || '').trim().slice(0, MAX_CAPTION) || null;

    const r = db.prepare('INSERT INTO gallery_photo (member_id, photo, video, duration, caption) VALUES (?,?,?,?,?)')
      .run(req.me.id, poster, got.file, Math.round(duration * 10) / 10, caption);
    db.prepare('UPDATE gallery_photo SET batch=id WHERE id=?').run(r.lastInsertRowid);
    res.json({ ok: true, id: r.lastInsertRowid, video: got.file, photo: poster });
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
    removePhoto(g.video);       // 동영상이면 영상 파일도
    res.json({ ok: true });
  });

  return router;
};

const isAdmin = (me) => me.role === 'admin' || !!me.is_owner;
