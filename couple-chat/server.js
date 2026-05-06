const express = require('express');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const PORT = 6021;
const JWT_SECRET = 'couple-love-2026-secret';
const TRANSLATE_URL = 'http://localhost:6011/api/translate';

function nowUB() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

const db = new Database(path.join(__dirname, 'couple.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    lang TEXT DEFAULT 'ko',
    emoji TEXT DEFAULT '❤️',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_text TEXT NOT NULL,
    original_lang TEXT DEFAULT 'ko',
    translated_ko TEXT,
    translated_mn TEXT,
    msg_type TEXT DEFAULT 'text',
    reaction TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    note TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.prepare("INSERT INTO users (username, password, name, lang, emoji) VALUES (?,?,?,?,?)").run('js', 'love0404', '재성', 'ko', '🤴');
  db.prepare("INSERT INTO users (username, password, name, lang, emoji) VALUES (?,?,?,?,?)").run('love', 'love0404', '🥰', 'mn', '👸');
}

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  try {
    const user = jwt.verify(token, JWT_SECRET);
    ws.userId = user.id;
    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);
    broadcastPresence();
    ws.on('close', () => {
      clients.get(user.id)?.delete(ws);
      if (clients.get(user.id)?.size === 0) clients.delete(user.id);
      broadcastPresence();
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'typing') broadcast({ type: 'typing', userId: user.id }, user.id);
        if (msg.type === 'reaction') {
          db.prepare("UPDATE messages SET reaction = ? WHERE id = ?").run(msg.emoji, msg.msgId);
          broadcast({ type: 'reaction', msgId: msg.msgId, emoji: msg.emoji }, null);
        }
      } catch(e) {}
    });
  } catch(e) { ws.close(4001); }
});

function broadcastPresence() {
  const online = [...clients.keys()];
  broadcast({ type: 'presence', online }, null);
}
function broadcast(data, excludeId) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.userId !== excludeId) ws.send(msg);
  });
  // also send to self for some events
  if (excludeId === null) {
    wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
  }
}
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

async function translateText(text, from, to) {
  try {
    const res = await fetch(TRANSLATE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to })
    });
    return (await res.json()).translated || null;
  } catch(e) { return null; }
}

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path === '/couple' || req.path === '/couple/') return res.redirect('/couple-chat/');
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.couple_token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Session expired' }); }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: '비밀번호가 틀렸어요 💔' });
  const token = jwt.sign({ id: user.id, name: user.name, lang: user.lang, emoji: user.emoji }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, user: { id: user.id, name: user.name, lang: user.lang, emoji: user.emoji } });
});

app.use('/api', auth);

app.get('/api/messages', (req, res) => {
  const { before, limit: lim } = req.query;
  let sql = "SELECT m.*, u.name as user_name, u.emoji FROM messages m JOIN users u ON m.user_id = u.id WHERE m.is_deleted = 0";
  const params = [];
  if (before) { sql += " AND m.id < ?"; params.push(before); }
  sql += " ORDER BY m.id DESC LIMIT ?";
  params.push(Math.min(Number(lim) || 50, 100));
  res.json(db.prepare(sql).all(...params).reverse());
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Empty' });
  const userLang = req.user.lang || 'ko';
  const r = db.prepare("INSERT INTO messages (user_id, original_text, original_lang, created_at) VALUES (?,?,?,?)")
    .run(req.user.id, text.trim(), userLang, nowUB());
  const msgId = r.lastInsertRowid;
  const msg = db.prepare("SELECT m.*, u.name as user_name, u.emoji FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?").get(msgId);
  broadcastAll({ type: 'new_message', message: msg });

  // Translate in background
  (async () => {
    let ko = null, mn = null;
    if (userLang === 'ko') { ko = text.trim(); mn = await translateText(text.trim(), 'ko', 'mn'); }
    else { mn = text.trim(); ko = await translateText(text.trim(), 'mn', 'ko'); }
    db.prepare("UPDATE messages SET translated_ko = ?, translated_mn = ? WHERE id = ?").run(ko, mn, msgId);
    const updated = db.prepare("SELECT m.*, u.name as user_name, u.emoji FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?").get(msgId);
    broadcastAll({ type: 'message_update', message: updated });
  })();

  res.json(msg);
});

app.get('/api/partner', (req, res) => {
  const partner = db.prepare("SELECT id, name, emoji, lang FROM users WHERE id != ?").get(req.user.id);
  res.json(partner);
});

// 프로필 수정
app.put('/api/me', (req, res) => {
  const { name, emoji, password } = req.body;
  if (name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  if (emoji) db.prepare("UPDATE users SET emoji = ? WHERE id = ?").run(emoji, req.user.id);
  if (password) db.prepare("UPDATE users SET password = ? WHERE id = ?").run(password, req.user.id);
  const updated = db.prepare("SELECT id, name, emoji, lang FROM users WHERE id = ?").get(req.user.id);
  res.json(updated);
});

// D-day & moments
app.get('/api/moments', (req, res) => {
  res.json(db.prepare("SELECT * FROM moments ORDER BY created_at DESC LIMIT 50").all());
});

app.post('/api/moments', (req, res) => {
  const { title, note } = req.body;
  const r = db.prepare("INSERT INTO moments (title, note, created_by) VALUES (?,?,?)").run(title, note, req.user.id);
  res.json({ id: r.lastInsertRowid });
});

server.listen(PORT, () => console.log(`💕 Couple Chat running on port ${PORT}`));
