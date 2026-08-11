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
// ---- 텔레그램 알람 (지시 알림에도 쓰이므로 먼저 만든다) ----
const createAlarm = require('./alarm');
const alarm = createAlarm(db, { secret: SECRET });

app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS_PW, notify: alarm.notify }));
app.use('/api/report/alarm', alarm.router);

// ---- 직원 텔레그램 자동 연결 (업무보고 전용 봇) ----
// REPORT_BOT_TOKEN 이 없으면 조용히 꺼진 상태로 둔다 — 기존 봇은 건드리지 않는다.
const createBotLink = require('./bot-link');
let botLink = null;
(async () => {
  const tk = process.env.REPORT_BOT_TOKEN;
  if (!tk) { console.log('[link] REPORT_BOT_TOKEN 미설정 — 자동 연결 꺼짐'); return; }
  let uname = process.env.REPORT_BOT_USERNAME || '';
  if (!uname) {
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${tk}/getMe`, { signal: AbortSignal.timeout(10000) })).json();
      uname = me?.result?.username || '';
    } catch (e) { console.error('[link] getMe 실패:', e.message); }
  }
  if (!uname) { console.error('[link] 봇 아이디를 못 얻어 자동 연결을 켜지 않습니다'); return; }
  botLink = createBotLink(db, { secret: SECRET, botToken: tk, botUsername: uname });
  app.use('/api/report/alarm', botLink.router);
  await botLink.start();
  console.log(`[link] 자동 연결 켜짐 (@${uname})`);
})();

const cron = require('node-cron');
function nowParts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}
// 5분마다 확인 — 설정 시각이 지났고 그날 아직 안 보낸 사람에게 보낸다 (재시작에도 안전)
cron.schedule('*/5 * * * *', async () => {
  const { date, time } = nowParts();
  try {
    const n = await alarm.tick(date, time);
    if (n) console.log(`[alarm] ${date} ${time} — ${n}건 발송`);
  } catch (e) { console.error('[alarm] tick 오류:', e.message); }
});

// 정적 파일 (index.html = 새 업무보고 앱)
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

app.listen(PORT, () => console.log(`Staff Manager (simple report) on port ${PORT}`));
