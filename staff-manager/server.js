require("dotenv").config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 6010;
const SECRET = process.env.STAFF_MGR_SECRET || 'staff-mgr-2026-secret';
const BOSS_PW = process.env.BOSS_REPORT_PW || '';
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// ===== SSO 로그인 (보존 — court-booking/POS 의존) =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const pwMatch = user.password.startsWith('$2') ? bcrypt.compareSync(password, user.password) : (user.password === password);
  if (!pwMatch) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, staff_id: user.staff_id }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, staff_id: user.staff_id } });
});

// court-booking 리다이렉트 대상 /staff-manager/login → SSO 로그인 폼
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ===== 새 업무보고 API =====
const createReportRoutes = require('./report-simple');
app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS_PW }));

// 정적 파일 (index.html = 새 업무보고 앱)
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

app.listen(PORT, () => console.log(`Staff Manager (simple report) on port ${PORT}`));
