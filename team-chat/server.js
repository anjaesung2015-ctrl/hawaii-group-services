const express = require('express');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = 6020;
const JWT_SECRET = 'hawaii-team-chat-2026';

// Translation API (reuse existing translator)
const TRANSLATE_URL = 'http://localhost:6011/api/translate';

// UB 시간 (UTC+8)
function nowUB() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Handle /chat without trailing slash (nginx proxy)
app.use((req, res, next) => {
  if (req.path === '/chat') return res.redirect('/chat/');
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map(); // userId -> Set<ws>

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch(e) { return null; }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const user = verifyToken(token);
  if (!user) { ws.close(4001, 'Unauthorized'); return; }

  ws.userId = user.id;
  ws.userName = user.name;
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  clients.get(user.id).add(ws);

  // Update last_seen
  db.prepare("UPDATE users SET last_seen = datetime('now','localtime') WHERE id = ?").run(user.id);

  // Broadcast online status
  broadcastPresence();

  ws.on('close', () => {
    clients.get(user.id)?.delete(ws);
    if (clients.get(user.id)?.size === 0) clients.delete(user.id);
    db.prepare("UPDATE users SET last_seen = datetime('now','localtime') WHERE id = ?").run(user.id);
    broadcastPresence();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'typing') {
        broadcastToRoom(msg.room_id, { type: 'typing', user_id: user.id, name: user.name }, user.id);
      } else if (msg.type === 'read') {
        db.prepare("INSERT OR REPLACE INTO read_receipts (user_id, room_id, last_read_msg_id) VALUES (?,?,?)").run(user.id, msg.room_id, msg.msg_id);
      }
    } catch(e) {}
  });
});

function broadcastPresence() {
  const onlineIds = [...clients.keys()];
  const msg = JSON.stringify({ type: 'presence', online: onlineIds });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function broadcastToRoom(roomId, data, excludeUserId) {
  const members = db.prepare("SELECT user_id FROM room_members WHERE room_id = ?").all(roomId);
  const msg = JSON.stringify(data);
  members.forEach(m => {
    if (m.user_id === excludeUserId) return;
    clients.get(m.user_id)?.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
  });
  // Also send to sender
  if (!excludeUserId) return;
  clients.get(excludeUserId)?.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

// Translate helper
async function translateText(text, from, to) {
  try {
    const res = await fetch(TRANSLATE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to })
    });
    const data = await res.json();
    return data.translated || text;
  } catch(e) {
    console.error('Translation error:', e.message);
    return null;
  }
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.chat_token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Session expired' }); }
}

// ====== AUTH ======
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Нэвтрэх нэр эсвэл нууц үг буруу' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role, lang: user.lang }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, lang: user.lang, avatar_color: user.avatar_color } });
});

// ====== 회원가입 (로그인 전) ======
app.post('/api/register', (req, res) => {
  const { username, password, name, business } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Бүх талбарыг бөглөнө үү / 모든 항목을 입력해주세요' });
  if (username.length < 2) return res.status(400).json({ error: 'Нэвтрэх нэр 2-оос дээш тэмдэгт / 아이디 2자 이상' });
  if (password.length < 4) return res.status(400).json({ error: 'Нууц үг 4-өөс дээш тэмдэгт / 비밀번호 4자 이상' });

  const colors = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#a855f7'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  try {
    const r = db.prepare("INSERT INTO users (username, password, name, role, lang, avatar_color, business) VALUES (?,?,?,?,?,?,?)")
      .run(username.toLowerCase().trim(), password, name.trim(), 'staff', 'mn', color, business || 'all');
    const userId = r.lastInsertRowid;
    // 기본 방 자동 가입
    const memberStmt = db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?,?)");
    memberStmt.run(1, userId); // 전체 공지
    memberStmt.run(5, userId); // 자유게시판
    if (business === 'fitness') memberStmt.run(2, userId);
    else if (business === 'center') memberStmt.run(3, userId);
    else if (business === 'shop') memberStmt.run(4, userId);
    else { memberStmt.run(2, userId); memberStmt.run(3, userId); memberStmt.run(4, userId); }

    const token = jwt.sign({ id: userId, name: name.trim(), role: 'staff', lang: 'mn' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, name: name.trim(), role: 'staff', lang: 'mn', avatar_color: color } });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Нэвтрэх нэр бүртгэлтэй байна / 이미 사용 중인 아이디' });
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', auth);

// ====== USER ======
app.get('/api/me', (req, res) => {
  const u = db.prepare("SELECT id, username, name, role, lang, avatar_color, business FROM users WHERE id = ?").get(req.user.id);
  res.json(u);
});

app.put('/api/me/lang', (req, res) => {
  db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(req.body.lang, req.user.id);
  res.json({ ok: true });
});

// ====== ROOMS ======
app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, 
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND is_deleted = 0) as msg_count,
      (SELECT MAX(created_at) FROM messages WHERE room_id = r.id) as last_msg_time,
      (SELECT original_text FROM messages WHERE room_id = r.id AND is_deleted = 0 ORDER BY id DESC LIMIT 1) as last_msg,
      (SELECT original_lang FROM messages WHERE room_id = r.id AND is_deleted = 0 ORDER BY id DESC LIMIT 1) as last_msg_lang,
      (SELECT u.name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = r.id AND m.is_deleted = 0 ORDER BY m.id DESC LIMIT 1) as last_msg_user,
      COALESCE((SELECT last_read_msg_id FROM read_receipts WHERE user_id = ? AND room_id = r.id), 0) as my_last_read,
      (SELECT MAX(id) FROM messages WHERE room_id = r.id AND is_deleted = 0) as max_msg_id
    FROM rooms r
    JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
    ORDER BY last_msg_time DESC NULLS LAST
  `).all(req.user.id, req.user.id);

  // Compute unread
  rooms.forEach(r => { r.unread = Math.max(0, (r.max_msg_id || 0) - (r.my_last_read || 0)); });
  res.json(rooms);
});

app.post('/api/rooms', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, icon, business, member_ids } = req.body;
  const r = db.prepare("INSERT INTO rooms (name, type, icon, business, created_by) VALUES (?,?,?,?,?)")
    .run(name, 'group', icon || '💬', business || 'all', req.user.id);
  const roomId = r.lastInsertRowid;
  const stmt = db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?,?)");
  stmt.run(roomId, req.user.id);
  (member_ids || []).forEach(uid => stmt.run(roomId, uid));
  res.json({ id: roomId });
});

// DM room
app.post('/api/rooms/dm', (req, res) => {
  const { target_user_id } = req.body;
  const myId = req.user.id;
  // Check existing DM
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = ?
    JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = ?
    WHERE r.type = 'dm'
  `).get(myId, target_user_id);
  if (existing) return res.json({ id: existing.id });

  const target = db.prepare("SELECT name FROM users WHERE id = ?").get(target_user_id);
  const r = db.prepare("INSERT INTO rooms (name, type, icon, created_by) VALUES (?,?,?,?)")
    .run(`DM`, 'dm', '💬', myId);
  const roomId = r.lastInsertRowid;
  db.prepare("INSERT INTO room_members (room_id, user_id) VALUES (?,?)").run(roomId, myId);
  db.prepare("INSERT INTO room_members (room_id, user_id) VALUES (?,?)").run(roomId, target_user_id);
  res.json({ id: roomId });
});

// ====== MESSAGES ======
app.get('/api/rooms/:id/messages', (req, res) => {
  const { before, limit: lim } = req.query;
  const maxRows = Math.min(Number(lim) || 50, 100);
  let sql = `SELECT m.*, u.name as user_name, u.avatar_color, u.lang as user_lang,
    ru.name as reply_user_name, rm.original_text as reply_text
    FROM messages m JOIN users u ON m.user_id = u.id
    LEFT JOIN messages rm ON m.reply_to = rm.id
    LEFT JOIN users ru ON rm.user_id = ru.id
    WHERE m.room_id = ? AND m.is_deleted = 0`;
  const params = [req.params.id];
  if (before) { sql += " AND m.id < ?"; params.push(before); }
  sql += " ORDER BY m.id DESC LIMIT ?";
  params.push(maxRows);
  const msgs = db.prepare(sql).all(...params);
  res.json(msgs.reverse());
});

app.post('/api/rooms/:id/messages', async (req, res) => {
  const { text, reply_to } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Empty message' });

  const roomId = Number(req.params.id);
  const userLang = req.user.lang || 'ko';

  // Save original (UB 시간)
  const r = db.prepare("INSERT INTO messages (room_id, user_id, original_text, original_lang, reply_to, created_at) VALUES (?,?,?,?,?,?)")
    .run(roomId, req.user.id, text.trim(), userLang, reply_to || null, nowUB());
  const msgId = r.lastInsertRowid;

  // Translate in background
  (async () => {
    try {
      let translated_ko = null, translated_mn = null;
      if (userLang === 'ko') {
        translated_mn = await translateText(text.trim(), 'ko', 'mn');
        translated_ko = text.trim();
      } else {
        translated_ko = await translateText(text.trim(), 'mn', 'ko');
        translated_mn = text.trim();
      }
      db.prepare("UPDATE messages SET translated_ko = ?, translated_mn = ? WHERE id = ?")
        .run(translated_ko, translated_mn, msgId);

      // Broadcast updated message with translation
      const fullMsg = db.prepare(`SELECT m.*, u.name as user_name, u.avatar_color, u.lang as user_lang,
        ru.name as reply_user_name, rm.original_text as reply_text
        FROM messages m JOIN users u ON m.user_id = u.id
        LEFT JOIN messages rm ON m.reply_to = rm.id LEFT JOIN users ru ON rm.user_id = ru.id
        WHERE m.id = ?`).get(msgId);
      broadcastToRoom(roomId, { type: 'message_update', message: fullMsg }, null);
    } catch(e) { console.error('Translation bg error:', e); }
  })();

  // Get basic message for immediate broadcast
  const msg = db.prepare(`SELECT m.*, u.name as user_name, u.avatar_color, u.lang as user_lang
    FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?`).get(msgId);
  broadcastToRoom(roomId, { type: 'new_message', message: msg }, null);

  res.json(msg);
});

// ====== USERS LIST ======
app.get('/api/users', (req, res) => {
  const users = db.prepare("SELECT id, name, role, lang, avatar_color, business, last_seen FROM users WHERE is_active = 1 ORDER BY role DESC, name").all();
  res.json(users);
});

// ====== ADMIN: manage users ======
app.post('/api/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { username, password, name, role, lang, business } = req.body;
  const colors = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  try {
    const r = db.prepare("INSERT INTO users (username, password, name, role, lang, avatar_color, business) VALUES (?,?,?,?,?,?,?)")
      .run(username, password || 'staff123', name, role || 'staff', lang || 'mn', color, business || 'all');
    // Auto-join common rooms
    const userId = r.lastInsertRowid;
    db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (1,?)").run(userId); // 전체 공지
    db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (5,?)").run(userId); // 자유게시판
    res.json({ id: userId });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username exists' });
    throw e;
  }
});

server.listen(PORT, () => console.log(`💬 Team Chat running on port ${PORT}`));
