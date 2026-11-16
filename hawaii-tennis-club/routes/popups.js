// 홈 팝업 — 중요한 행사·업데이트를 앱을 열 때 한 번 띄운다.
// 만들기·고치기는 운영진(오너 포함). 회원은 지금 게시 중인 것만 받는다(GET /active).
// '오늘 하루 안 보기'·'다시 안 보기'는 서버가 아니라 각 폰에 남긴다 (views/popup.js).
const express = require('express');
const { savePhoto, removePhoto } = require('../lib/photos');
const { today } = require('../lib/db');

// 팝업 버튼이 열 수 있는 화면 (하단 탭·사진첩·성적)
const LINKS = ['schedule', 'notices', 'board', 'dues', 'members', 'chat', 'gallery', 'results'];
const MAX_TITLE = 100;
const MAX_BODY = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function popupRoutes(db, auth, tr) {
  const router = express.Router();
  router.use(auth.requireClub);

  // 지금 떠야 하는 팝업 — 켜져 있고 오늘이 게시 기간 안. 최신 것부터.
  router.get('/active', async (req, res) => {
    const d = today();
    const rows = db.prepare(`SELECT id, title, body, photo, link_tab, starts_on, ends_on, updated_at, created_at
                             FROM popup WHERE active=1 AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?)
                             ORDER BY starts_on DESC, id DESC`).all(d, d);
    if (tr && req.query.lang) await tr.attach(rows, ['title', 'body'], String(req.query.lang));
    res.json(rows);
  });

  // 관리 목록 — 전부 (지난 것·꺼둔 것 포함)
  router.get('/', auth.requireAdmin, (req, res) => {
    const rows = db.prepare(`SELECT p.*, m.name AS author FROM popup p LEFT JOIN member m ON m.id = p.created_by
                             ORDER BY p.id DESC`).all();
    res.json({ rows, today: today() });
  });

  router.post('/', auth.requireAdmin, (req, res) => {
    const b = parse(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = null;
    try { photo = savePhoto(req.body?.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
    const r = db.prepare(`INSERT INTO popup (title, body, photo, link_tab, starts_on, ends_on, active, created_by)
                          VALUES (?,?,?,?,?,?,?,?)`)
      .run(b.title, b.body, photo, b.link_tab, b.starts_on, b.ends_on, b.active, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid, photo });
  });

  router.patch('/:id', auth.requireAdmin, (req, res) => {
    const p = db.prepare('SELECT * FROM popup WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const b = parse({ ...p, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });

    let photo = p.photo;
    if (req.body?.photo_data) {
      try { photo = savePhoto(req.body.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
      removePhoto(p.photo);
    } else if (req.body?.remove_photo) {
      removePhoto(p.photo);
      photo = null;
    }
    db.prepare(`UPDATE popup SET title=?, body=?, photo=?, link_tab=?, starts_on=?, ends_on=?, active=?,
                updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title, b.body, photo, b.link_tab, b.starts_on, b.ends_on, b.active, p.id);
    res.json({ ok: true, photo });
  });

  router.delete('/:id', auth.requireAdmin, (req, res) => {
    const p = db.prepare('SELECT * FROM popup WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM popup WHERE id=?').run(p.id);
    removePhoto(p.photo);
    res.json({ ok: true });
  });

  return router;
};

function parse(b = {}) {
  const title = String(b.title || '').trim().slice(0, MAX_TITLE);
  const body = String(b.body || '').trim().slice(0, MAX_BODY) || null;
  if (!title) return { error: 'title_required' };
  const starts_on = b.starts_on ? String(b.starts_on) : today();
  const ends_on = b.ends_on ? String(b.ends_on) : null;
  if (!DATE.test(starts_on) || (ends_on && !DATE.test(ends_on))) return { error: 'bad_date' };
  if (ends_on && ends_on < starts_on) return { error: 'end_before_start' };
  const link_tab = LINKS.includes(b.link_tab) ? b.link_tab : null;
  const active = (b.active === false || b.active === 0 || b.active === '0' || b.active === 'false') ? 0 : 1;
  return { title, body, starts_on, ends_on, link_tab, active };
}

module.exports.LINKS = LINKS;
