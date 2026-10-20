// 채팅 — 클럽 전체방 하나 + 회원끼리 1:1.
// 화면은 방을 열어 둔 동안 3초마다 ?after=<마지막 id> 로 새 메시지만 받아 간다(웹소켓 없이 nginx 하위 경로 그대로).
// 새 메시지는 폰 알림으로도 간다 — 단, 그 방을 지금 보고 있는 사람(최근 20초 안에 불러감)에게는 보내지 않는다.
const path = require('path');
const express = require('express');
const { writePhoto, chatPhotoDir, removeChatPhoto } = require('../lib/photos');

const MAX_BODY = 1000;
const PAGE = 50;
const WATCHING_SEC = 20;

module.exports = function chatRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireMember);

  // 내가 들어갈 수 있는 방만 — 1:1 방은 두 사람만
  function roomFor(me, id) {
    const r = db.prepare('SELECT * FROM chat_room WHERE id=?').get(id);
    if (!r) return null;
    if (r.kind === 'dm' && r.a_id !== me.id && r.b_id !== me.id) return null;
    return r;
  }

  const otherOf = (r, me) => {
    if (r.kind !== 'dm') return null;
    const oid = r.a_id === me.id ? r.b_id : r.a_id;
    return db.prepare('SELECT id, name, level, is_coach, status FROM member WHERE id=?').get(oid) || null;
  };

  const unreadIn = (roomId, meId) => db.prepare(`
    SELECT COUNT(*) FROM chat_msg
    WHERE room_id=? AND (member_id IS NULL OR member_id<>?)
      AND id > COALESCE((SELECT last_id FROM chat_read WHERE room_id=? AND member_id=?), 0)`)
    .pluck().get(roomId, meId, roomId, meId);

  // 읽음 표시 + '지금 보고 있음' 시각
  const markRead = (roomId, meId, lastId) => db.prepare(`
    INSERT INTO chat_read (room_id, member_id, last_id, seen_at) VALUES (?,?,?, strftime('%s','now'))
    ON CONFLICT(room_id, member_id) DO UPDATE SET last_id=MAX(last_id, excluded.last_id), seen_at=excluded.seen_at`)
    .run(roomId, meId, lastId || 0);

  const msgRow = (m, meId) => ({
    id: m.id, member_id: m.member_id, name: m.name, is_coach: !!m.is_coach,
    body: m.body, photo: m.photo ? `api/chat/photo/${m.id}` : null, created_at: m.created_at, mine: m.member_id === meId,
  });
  const SELECT_MSG = `SELECT c.id, c.member_id, c.body, c.photo, c.created_at, m.name, m.is_coach
                      FROM chat_msg c LEFT JOIN member m ON m.id = c.member_id`;

  // 방 목록 — 전체방이 맨 위, 나머지는 최근 대화 순
  router.get('/rooms', (req, res) => {
    const me = req.me;
    const rooms = db.prepare(`SELECT * FROM chat_room WHERE kind='club' OR a_id=? OR b_id=?`).all(me.id, me.id);
    const out = rooms.map(r => {
      const last = db.prepare(`${SELECT_MSG} WHERE c.room_id=? ORDER BY c.id DESC LIMIT 1`).get(r.id);
      return {
        id: r.id, kind: r.kind, other: otherOf(r, me),
        last: last ? msgRow(last, me.id) : null,
        unread: unreadIn(r.id, me.id),
      };
    })
      // 말을 한 번도 안 건 1:1 방은 목록에 띄우지 않는다
      .filter(r => r.kind === 'club' || r.last)
      .sort((a, b) => (a.kind === 'club' ? -1 : b.kind === 'club' ? 1 : (b.last?.id || 0) - (a.last?.id || 0)));
    res.json(out);
  });

  // 상단 💬 숫자 — 내 방 전부의 안 읽은 메시지
  router.get('/unread', (req, res) => {
    const ids = db.prepare(`SELECT id FROM chat_room WHERE kind='club' OR a_id=? OR b_id=?`).pluck().all(req.me.id, req.me.id);
    res.json({ count: ids.reduce((n, id) => n + unreadIn(id, req.me.id), 0) });
  });

  // 1:1 방 열기 — 이미 있으면 그 방 (누가 먼저 걸었든 같은 방)
  router.post('/dm', (req, res) => {
    const oid = Number(req.body?.member_id);
    if (!oid || oid === req.me.id) return res.status(400).json({ error: 'bad_member' });
    const o = db.prepare("SELECT id FROM member WHERE id=? AND status='active'").get(oid);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const [a, b] = req.me.id < oid ? [req.me.id, oid] : [oid, req.me.id];
    db.prepare("INSERT OR IGNORE INTO chat_room (kind, a_id, b_id) VALUES ('dm',?,?)").run(a, b);
    res.json({ id: db.prepare("SELECT id FROM chat_room WHERE kind='dm' AND a_id=? AND b_id=?").pluck().get(a, b) });
  });

  // 메시지 — 기본은 최근 50개, ?after=N 은 그 뒤 새 것(3초 폴링), ?before=N 은 더 옛날 것
  router.get('/rooms/:id/messages', (req, res) => {
    const r = roomFor(req.me, req.params.id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const after = Number(req.query.after) || 0;
    const before = Number(req.query.before) || 0;
    let rows;
    if (after) {
      rows = db.prepare(`${SELECT_MSG} WHERE c.room_id=? AND c.id>? ORDER BY c.id LIMIT 200`).all(r.id, after);
    } else {
      rows = db.prepare(`${SELECT_MSG} WHERE c.room_id=? ${before ? 'AND c.id<?' : ''} ORDER BY c.id DESC LIMIT ${PAGE}`)
        .all(...(before ? [r.id, before] : [r.id])).reverse();
    }
    const newest = db.prepare('SELECT MAX(id) FROM chat_msg WHERE room_id=?').pluck().get(r.id) || 0;
    markRead(r.id, req.me.id, newest);
    res.json({
      room: { id: r.id, kind: r.kind, other: otherOf(r, req.me) },
      messages: rows.map(m => msgRow(m, req.me.id)),
      has_more: !after && rows.length === PAGE,
    });
  });

  router.post('/rooms/:id/messages', (req, res) => {
    const r = roomFor(req.me, req.params.id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const body = String(req.body?.body || '').trim();
    const hasPhoto = !!req.body?.photo;
    if (!body && !hasPhoto) return res.status(400).json({ error: 'body_required' });
    if (body.length > MAX_BODY) return res.status(400).json({ error: 'too_long' });
    const other = otherOf(r, req.me);
    if (r.kind === 'dm' && (!other || other.status !== 'active')) return res.status(409).json({ error: 'member_gone' });

    // 사진은 폰에서 줄인 JPEG(data:URL) 한 장 — 공개 폴더가 아니라 chat-photos/ 에 (DB 에는 파일 이름만)
    let photo = null;
    if (hasPhoto) {
      try { photo = writePhoto(req.body.photo, chatPhotoDir(db)); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    const id = db.prepare('INSERT INTO chat_msg (room_id, member_id, body, photo) VALUES (?,?,?,?)')
      .run(r.id, req.me.id, body, photo).lastInsertRowid;
    markRead(r.id, req.me.id, id);
    const m = db.prepare(`${SELECT_MSG} WHERE c.id=?`).get(id);
    res.json(msgRow(m, req.me.id));

    // 알림 — 지금 이 방을 보고 있는 사람은 빼고
    const watching = db.prepare(`SELECT member_id FROM chat_read
                                 WHERE room_id=? AND seen_at >= strftime('%s','now') - ?`).pluck().all(r.id, WATCHING_SEC);
    const payload = {
      title: r.kind === 'club' ? `💬 Club chat · ${req.me.name}` : `💬 ${req.me.name}`,
      body: body ? body.slice(0, 120) : '📷 Photo',
      url: `#chat-${r.id}`,
    };
    if (r.kind === 'dm') {
      if (!watching.includes(other.id)) notify?.toMembers([other.id], payload);
    } else {
      notify?.toAll(payload, [req.me.id, ...watching]);
    }
  });

  // 지우기 — 쓴 사람, 또는 전체방에서는 임원
  router.delete('/messages/:id', (req, res) => {
    const m = db.prepare('SELECT c.*, r.kind FROM chat_msg c JOIN chat_room r ON r.id=c.room_id WHERE c.id=?').get(req.params.id);
    if (!m || !roomFor(req.me, m.room_id)) return res.status(404).json({ error: 'not_found' });
    const officer = req.me.role === 'admin' || req.me.is_owner;
    if (m.member_id !== req.me.id && !(m.kind === 'club' && officer)) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM chat_msg WHERE id=?').run(m.id);
    removeChatPhoto(db, m.photo);
    res.json({ ok: true });
  });

  // 사진 — 그 방에 들어갈 수 있는 사람만 (1:1 사진은 두 사람만). 남에게는 있는지조차 알리지 않는다(404)
  router.get('/photo/:id', (req, res) => {
    const m = db.prepare('SELECT room_id, photo FROM chat_msg WHERE id=?').get(req.params.id);
    if (!m?.photo || !roomFor(req.me, m.room_id)) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'private, max-age=604800');
    res.sendFile(path.join(chatPhotoDir(db), path.basename(m.photo)), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not_found' });
    });
  });

  return router;
};
