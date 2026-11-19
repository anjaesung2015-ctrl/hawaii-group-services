// 나의 가계부 — 사장님 개인용. PIN 하나로 로그인하는 단일 사용자 앱.
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 6070;
const COOKIE_PATH = process.env.COOKIE_PATH || '/';
const SECURE = process.env.SECURE_COOKIE === '1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COOKIE = 'money_s';
const SESSION_DAYS = 180;

fs.mkdirSync(DATA_DIR, { recursive: true });
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const db = new Database(path.join(DATA_DIR, 'ledger.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS entry (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  cat TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  memo TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_date ON entry(date);
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const getSetting = k => { const r = db.prepare('SELECT value FROM setting WHERE key = ?').get(k); return r ? r.value : null; };
const setSetting = (k, v) => db.prepare('INSERT INTO setting(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pin, salt, 32).toString('hex');
}
function checkPin(pin) {
  const h = getSetting('pin_hash');
  if (!h || typeof pin !== 'string') return false;
  const [salt, hex] = h.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pin, salt, 32), Buffer.from(hex, 'hex'));
}
if (!getSetting('pin_hash')) {
  const p = process.env.INITIAL_PIN;
  if (!/^\d{4,6}$/.test(p || '')) { console.error('첫 실행에는 INITIAL_PIN(숫자 4~6자리)이 필요합니다'); process.exit(1); }
  setSetting('pin_hash', hashPin(p));
  setSetting('sess_ver', '1');
}

// 세션 토큰 = <만료ms>.<세션버전>.<서명>. PIN을 바꾸면 세션버전이 올라가 다른 기기는 로그아웃된다.
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken() {
  const p = `${Date.now() + SESSION_DAYS * 864e5}.${getSetting('sess_ver') || '1'}`;
  return p + '.' + sign(p);
}
function validToken(t) {
  if (!t) return false;
  const i = t.lastIndexOf('.');
  if (i < 0) return false;
  const p = t.slice(0, i), s = Buffer.from(t.slice(i + 1)), e = Buffer.from(sign(p));
  if (s.length !== e.length || !crypto.timingSafeEqual(s, e)) return false;
  const [exp, ver] = p.split('.');
  return Number(exp) > Date.now() && ver === (getSetting('sess_ver') || '1');
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSession(res) {
  res.cookie(COOKIE, makeToken(), { httpOnly: true, sameSite: 'lax', secure: SECURE, path: COOKIE_PATH, maxAge: SESSION_DAYS * 864e5 });
}

// PIN 틀림 제한: IP당 10분에 5번
const fails = new Map();
function tooMany(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() > f.until) { fails.delete(ip); return false; }
  return f.n >= 5;
}
function addFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() > f.until) fails.set(ip, { n: 1, until: Date.now() + 10 * 60e3 });
  else f.n++;
}

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'PIN을 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.' });
  if (!checkPin(String(req.body && req.body.pin || ''))) { addFail(ip); return res.status(401).json({ error: 'PIN이 맞지 않아요.' }); }
  fails.delete(ip);
  setSession(res);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!validToken(readCookie(req, COOKIE))) return res.status(401).json({ error: '로그인이 필요해요.' });
  next();
});

app.get('/api/me', (req, res) => res.json({ ok: true }));

const rowOut = r => ({ id: String(r.id), date: r.date, type: r.type, cat: r.cat, amount: r.amount, memo: r.memo, ts: r.ts });
app.get('/api/entries', (req, res) => {
  res.json(db.prepare('SELECT * FROM entry ORDER BY date DESC, ts DESC').all().map(rowOut));
});
app.post('/api/entries', (req, res) => {
  const b = req.body || {};
  const date = String(b.date || ''), type = b.type, cat = String(b.cat || '').trim().slice(0, 20);
  const amount = Math.round(Number(b.amount)), memo = String(b.memo || '').trim().slice(0, 60);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z'))) return res.status(400).json({ error: '날짜를 골라 주세요.' });
  if (type !== 'in' && type !== 'out') return res.status(400).json({ error: '수입/지출을 골라 주세요.' });
  if (!cat) return res.status(400).json({ error: '분류를 골라 주세요.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e13) return res.status(400).json({ error: '금액을 확인해 주세요.' });
  const ts = Date.now();
  const r = db.prepare('INSERT INTO entry (date, type, cat, amount, memo, ts) VALUES (?, ?, ?, ?, ?, ?)').run(date, type, cat, amount, memo, ts);
  res.json(rowOut({ id: r.lastInsertRowid, date, type, cat, amount, memo, ts }));
});
app.delete('/api/entries/:id', (req, res) => {
  db.prepare('DELETE FROM entry WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
app.get('/api/settings', (req, res) => res.json({ currency: getSetting('currency') || '₮' }));
app.put('/api/settings', (req, res) => {
  const c = req.body && req.body.currency;
  if (c !== '₮' && c !== '원') return res.status(400).json({ error: '단위는 ₮ 또는 원만 돼요.' });
  setSetting('currency', c);
  res.json({ currency: c });
});
app.post('/api/pin', (req, res) => {
  const { old: oldPin, pin } = req.body || {};
  if (!checkPin(String(oldPin || ''))) return res.status(400).json({ error: '지금 PIN이 맞지 않아요.' });
  if (!/^\d{4,6}$/.test(String(pin || ''))) return res.status(400).json({ error: '새 PIN은 숫자 4~6자리로 해 주세요.' });
  setSetting('pin_hash', hashPin(String(pin)));
  setSetting('sess_ver', String(Number(getSetting('sess_ver') || '1') + 1));
  setSession(res);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|json)$/.test(file)) res.set('Cache-Control', 'no-cache');
  },
}));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 났어요. 잠시 후 다시 해 주세요.' });
});

app.listen(PORT, '127.0.0.1', () => console.log(`가계부 running on ${PORT}`));
