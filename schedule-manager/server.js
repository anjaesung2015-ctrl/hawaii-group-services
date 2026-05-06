const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const os = require('os');
const HOME = process.env.HOME || os.homedir() || '/home/ubuntu';
let GEMINI_API_KEY = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw', 'openclaw.json'), 'utf8'));
  GEMINI_API_KEY = (cfg && cfg.env && cfg.env.vars && cfg.env.vars.GEMINI_API_KEY) || '';
} catch(e) { console.warn('[parse-event] could not load openclaw config:', e.message); }
if (!GEMINI_API_KEY) console.warn('[parse-event] GEMINI_API_KEY not loaded — endpoint will return llm_unconfigured');
else console.log('[parse-event] GEMINI_API_KEY loaded (len=' + GEMINI_API_KEY.length + ')');


const app = express();
const PORT = 6007;
const SECRET = 'schedule-mgr-2026-secret';
const db = new Database(path.join(__dirname, 'schedule.db'));

db.pragma('journal_mode = WAL');
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ====== SCHEMA ======
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'personal',
    start_date TEXT NOT NULL,
    end_date TEXT,
    start_time TEXT,
    end_time TEXT,
    all_day INTEGER DEFAULT 1,
    location TEXT,
    color TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'planned',
    recurring TEXT,
    tags TEXT,
    related_business TEXT,
    reminder_days INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    target_date TEXT NOT NULL,
    category TEXT DEFAULT 'personal',
    status TEXT DEFAULT 'pending',
    description TEXT,
    color TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'personal',
    quarter INTEGER,
    year INTEGER DEFAULT 2026,
    target TEXT,
    current_progress TEXT,
    status TEXT DEFAULT 'in_progress',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS time_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_date TEXT NOT NULL,
    planned TEXT,
    actual TEXT,
    reflection TEXT,
    score INTEGER DEFAULT 0,
    wins TEXT,
    improvements TEXT,
    tomorrow TEXT,
    mood TEXT DEFAULT '😊',
    energy INTEGER DEFAULT 3,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Default admin
const hasAdmin = db.prepare("SELECT id FROM users WHERE username='admin'").get();
if (!hasAdmin) {
  db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run('admin','admin123','재성','admin');
}

// Pre-populate 2026 schedule if empty
const evCount = db.prepare("SELECT COUNT(*) as c FROM events").get();
if (evCount.c === 0) {
  const ins = db.prepare("INSERT INTO events (title,description,category,start_date,end_date,all_day,location,color,priority,status,tags,related_business) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  const insMil = db.prepare("INSERT INTO milestones (title,target_date,category,status,description,color) VALUES (?,?,?,?,?,?)");
  const insGoal = db.prepare("INSERT INTO goals (title,category,quarter,year,target,status,notes) VALUES (?,?,?,?,?,?,?)");

  const batch = db.transaction(() => {
    // ===== 아들 재활 로드맵 =====
    ins.run('아들 팔꿈치 수술','수술 일정 확정 필요','medical','2026-03-15','2026-03-15',1,'울란바토르','#ef4444','high','planned','아들,수술','');
    ins.run('아들 초기 재활 (1~2개월)','수술 후 고정+기초 재활','medical','2026-03-20','2026-05-15',1,'울란바토르','#ef4444','high','planned','아들,재활','');
    ins.run('아들 라켓 잡기 시작','재활 3개월차 — 경량 라켓 훈련','medical','2026-05-15','2026-06-30',1,'울란바토르','#f59e0b','high','planned','아들,재활','');
    ins.run('아들 풀 트레이닝 복귀','4~5개월차 — 본격 훈련 복귀','training','2026-07-01','2026-08-31',1,'울란바토르 3면코트','#22c55e','high','planned','아들,훈련','');
    ins.run('아들 대회 복귀','ITF 주니어 첫 대회','tournament','2026-09-01','2026-09-07',1,'한국','#a855f7','high','planned','아들,대회','');

    // ===== ITF/ATF 대회 일정 =====
    ins.run('ITF J30 인천','주니어 대회 — 딸 참가','tournament','2026-03-15','2026-03-22',1,'인천','#3b82f6','high','planned','대회,ITF,J30','');
    ins.run('ATF 14세 제주','아시아 테니스 — 딸 참가','tournament','2026-03-21','2026-03-27',1,'제주','#3b82f6','normal','planned','대회,ATF','');
    ins.run('ITF J30 대전','주니어 대회','tournament','2026-04-05','2026-04-12',1,'대전','#3b82f6','normal','planned','대회,ITF,J30','');
    ins.run('ITF J60 춘천','J60급 도전','tournament','2026-04-12','2026-04-19',1,'춘천','#3b82f6','normal','planned','대회,ITF,J60','');
    ins.run('ITF J30 인천 (5월)','주니어 대회','tournament','2026-05-31','2026-06-07',1,'인천','#3b82f6','normal','planned','대회,ITF,J30','');
    ins.run('⭐ ITF J200 인천','하이라이트! 시즌 최대 대회','tournament','2026-09-10','2026-09-17',1,'인천','#ef4444','high','planned','대회,ITF,J200','');
    ins.run('⭐ ITF J300 대전','시즌 최대 대회','tournament','2026-09-20','2026-09-27',1,'대전','#ef4444','high','planned','대회,ITF,J300','');
    ins.run('ATF 대회 (가을)','아시아 테니스','tournament','2026-10-10','2026-10-17',1,'경기/제주','#3b82f6','normal','planned','대회,ATF','');
    ins.run('ITF J30 대전 (11월)','시즌 마무리','tournament','2026-11-05','2026-11-12',1,'대전','#3b82f6','normal','planned','대회,ITF,J30','');
    ins.run('ITF J30 인천 (11월)','시즌 마무리','tournament','2026-11-15','2026-11-22',1,'인천','#3b82f6','normal','planned','대회,ITF,J30','');

    // ===== 원정 계획 =====
    ins.run('🛫 1차 원정 (3월)','딸+유망주 — 인천/제주','expedition','2026-03-13','2026-03-28',1,'인천→제주','#f59e0b','high','planned','원정,1차','');
    ins.run('🛫 2차 원정 (4월)','대전/춘천 연속 대회','expedition','2026-04-03','2026-04-20',1,'대전→춘천','#f59e0b','high','planned','원정,2차','');
    ins.run('🛫 3차 원정 (5~6월)','인천 대회 + 프로 관전','expedition','2026-05-29','2026-06-08',1,'인천','#f59e0b','normal','planned','원정,3차','');
    ins.run('🛫 4차 원정 (9월) ⭐','전원 — J200/J300 하이라이트!','expedition','2026-09-08','2026-09-28',1,'인천→대전','#ef4444','high','planned','원정,4차','');
    ins.run('🛫 5차 원정 (11월)','시즌 마무리 원정','expedition','2026-11-03','2026-11-23',1,'대전→인천','#f59e0b','normal','planned','원정,5차','');

    // ===== 몽골 사업 =====
    ins.run('피트니스 회원 모집 시즌','봄 시즌 회원 모집','business','2026-03-01','2026-04-30',1,'울란바토르','#22c55e','normal','planned','피트니스,회원모집','피트니스');
    ins.run('샵 봄 시즌 재고 입고','테니스 용품 + DeWalt 봄 재고','business','2026-03-10','2026-03-20',1,'울란바토르','#22c55e','normal','planned','샵,재고','샵');
    ins.run('체육관 여름 프로그램 준비','여름 방학 프로그램','business','2026-05-15','2026-06-15',1,'울란바토르','#22c55e','normal','planned','체육관,프로그램','체육관');
    ins.run('피트니스 여름 특별반','여름 단기 프로그램','business','2026-06-20','2026-08-31',1,'울란바토르','#22c55e','normal','planned','피트니스,여름','피트니스');
    ins.run('샵 가을 재고 입고','가을 시즌 재고 준비','business','2026-08-15','2026-08-31',1,'울란바토르','#22c55e','normal','planned','샵,재고','샵');
    ins.run('연말 정산','3개 사업장 연말 정산','business','2026-12-01','2026-12-31',1,'울란바토르','#f59e0b','high','planned','정산,연말','');

    // ===== 훈련 블록 =====
    ins.run('동계 훈련 (실내)','겨울 실내 집중 훈련','training','2026-01-06','2026-02-28',1,'울란바토르','#8b5cf6','normal','planned','훈련,동계','');
    ins.run('봄 시즌 훈련 강화','대회 시즌 준비','training','2026-03-01','2026-03-12',1,'울란바토르','#8b5cf6','normal','planned','훈련,시즌준비','');
    ins.run('여름 집중 훈련 캠프','아들 복귀 + 전원 강화 훈련','training','2026-07-01','2026-08-31',1,'울란바토르 3면코트','#8b5cf6','high','planned','훈련,캠프','');
    ins.run('겨울 오프시즌 훈련','체력 강화 + 기술 보강','training','2026-12-01','2026-12-31',1,'울란바토르','#8b5cf6','normal','planned','훈련,오프시즌','');

    // ===== 마일스톤 =====
    insMil.run('아들 수술 완료','2026-03-20','medical','pending','팔꿈치 수술 성공','#ef4444');
    insMil.run('딸 첫 ITF 대회 완료','2026-03-22','tournament','pending','인천 J30 참가','#3b82f6');
    insMil.run('투어링팀 1차 원정 완료','2026-03-28','expedition','pending','첫 원정 성공적 마무리','#f59e0b');
    insMil.run('아들 라켓 복귀','2026-05-15','medical','pending','재활 후 라켓 잡기','#22c55e');
    insMil.run('아들 풀 트레이닝 복귀','2026-07-01','training','pending','본격 훈련 시작','#22c55e');
    insMil.run('J200/J300 참가','2026-09-15','tournament','pending','시즌 하이라이트 대회','#ef4444');
    insMil.run('연간 원정 5회 완료','2026-11-23','expedition','pending','계획대로 5회 원정','#f59e0b');
    insMil.run('몽골 사업 연매출 목표 달성','2026-12-31','business','pending','안정적 원격 운영','#22c55e');

    // ===== 분기별 목표 =====
    insGoal.run('투어링팀 시스템 구축','expedition',1,2026,'팀 구성+시스템+첫 원정','in_progress','선수관리앱 완성, 1차 원정 실행');
    insGoal.run('아들 수술+재활 시작','medical',1,2026,'수술 성공+재활 프로그램','in_progress','');
    insGoal.run('딸 ITF 포인트 획득','tournament',1,2026,'첫 ITF 포인트','in_progress','J30 대회 2~3개 참가');
    insGoal.run('몽골 사업 원격화 완성','business',2,2026,'앱 기반 원격 관리','in_progress','직원 교육+시스템 안정화');
    insGoal.run('아들 훈련 복귀','medical',2,2026,'라켓 잡고 훈련 재개','in_progress','5월 중 복귀 목표');
    insGoal.run('여름 집중 캠프','training',3,2026,'전원 레벨업','in_progress','7~8월 몽골 3면코트 집중');
    insGoal.run('J200/J300 참가','tournament',3,2026,'시즌 최고 등급 대회 경험','in_progress','9월 인천/대전');
    insGoal.run('연간 리뷰+차년도 계획','personal',4,2026,'2026 성과 정리+2027 계획','in_progress','원정 5회 완료, 실적 분석');
  });
  batch();
}

// ====== AUTH ======
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=? AND password=?").get(username, password);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
  res.cookie('schedule_token', token, { httpOnly: false, maxAge: 30*24*60*60*1000, path: '/' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

function auth(req, res, next) {
  const token = req.cookies?.schedule_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({ error: '토큰 만료' }); }
}
app.use('/api', (req, res, next) => { if (req.path === '/login') return next(); auth(req, res, next); });

// ====== EVENTS ======
app.get('/api/events', (req, res) => {
  const { month, year, category } = req.query;
  let sql = "SELECT * FROM events WHERE 1=1";
  const params = [];
  if (year && month) {
    const m = String(month).padStart(2, '0');
    sql += " AND ((start_date <= ? AND end_date >= ?) OR (start_date >= ? AND start_date <= ?))";
    params.push(`${year}-${m}-31`, `${year}-${m}-01`, `${year}-${m}-01`, `${year}-${m}-31`);
  }
  if (category && category !== 'all') { sql += " AND category=?"; params.push(category); }
  sql += " ORDER BY start_date";
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/events/year/:year', (req, res) => {
  res.json(db.prepare("SELECT * FROM events WHERE start_date LIKE ? OR end_date LIKE ? ORDER BY start_date").all(`${req.params.year}%`, `${req.params.year}%`));
});

app.post('/api/events', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO events (title,description,category,start_date,end_date,start_time,end_time,all_day,location,color,priority,status,tags,related_business,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(b.title,b.description,b.category||'personal',b.start_date,b.end_date||b.start_date,b.start_time,b.end_time,b.all_day??1,b.location,b.color,b.priority||'normal',b.status||'planned',b.tags,b.related_business,b.notes);
  res.json({ id: r.lastInsertRowid });
});

function buildParsePrompt(userText, todayStr, weekday) {
  return [
    "당신은 한국어 일정 파서입니다. 사용자 입력을 분석해 JSON으로만 응답하세요. 다른 설명, 코드블록 표시 금지.",
    "",
    "오늘 날짜: " + todayStr + " (" + weekday + ")",
    "타임존: Asia/Ulaanbaatar",
    "",
    "출력 JSON 필드:",
    "{",
    '  "title": "string (필수)",',
    '  "start_date": "YYYY-MM-DD (필수)",',
    '  "end_date": "YYYY-MM-DD",',
    '  "start_time": "HH:MM (24h) 또는 null",',
    '  "end_time": "HH:MM (24h) 또는 null",',
    '  "all_day": true/false,',
    '  "category": "tournament|expedition|business|training|medical|personal",',
    '  "location": "string (없으면 \"\")",',
    '  "recurring": "null|weekly|daily|monthly",',
    '  "confidence": 0.0~1.0',
    "}",
    "",
    "규칙:",
    "- 오늘/내일/모레/글피는 오늘 날짜 기준 계산",
    "- 다음주 X요일은 오늘 이후 가장 가까운 X요일에 7일 더한 날",
    "- 오는 X요일은 오늘 이후 가장 가까운 X요일",
    "- 오전/오후는 12시간제 해석",
    "- 시간 누락 시 all_day=true, start_time/end_time=null",
    "- 모호한 입력은 confidence<0.5",
    "- title은 핵심 명사만 추출",
    "",
    '사용자 입력: "' + userText + '"',
    "",
    "JSON만 출력:"
  ].join("\n");
}

const WEEKDAYS_KO = ['일','월','화','수','목','금','토'];

app.post('/api/parse-event', async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ ok: false, error: 'llm_unconfigured' });
  const text = (req.body && req.body.text || '').toString().trim();
  if (!text) return res.status(400).json({ ok: false, error: 'empty_input' });
  if (text.length > 500) return res.status(400).json({ ok: false, error: 'too_long' });

  const now = new Date(Date.now() + 8*60*60*1000); // UTC+8 Ulaanbaatar
  const todayStr = now.toISOString().slice(0, 10);
  const weekday = WEEKDAYS_KO[now.getUTCDay()];
  const prompt = buildParsePrompt(text, todayStr, weekday);

  try {
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(GEMINI_API_KEY);
    const ctrl = new AbortController();
    const tmo = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 }
        }
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(tmo));

    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('parse-event gemini error:', r.status, errBody.slice(0, 300));
      return res.status(502).json({ ok: false, error: 'llm_failed', status: r.status });
    }
    const data = await r.json();
    const replyText = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
    let parsed;
    try {
      parsed = JSON.parse(replyText);
    } catch (e) {
      const m = replyText.match(/\{[\s\S]*\}/);
      if (!m) {
        console.error('parse-event no JSON in reply:', replyText.slice(0, 300));
        return res.status(502).json({ ok: false, error: 'parse_failed', raw: replyText.slice(0, 300) });
      }
      try { parsed = JSON.parse(m[0]); }
      catch(e2) { return res.status(502).json({ ok: false, error: 'parse_failed', raw: m[0].slice(0, 300) }); }
    }

    if (!parsed.title || !parsed.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.start_date)) {
      return res.status(422).json({ ok: false, error: 'invalid_fields', parsed });
    }
    if (!parsed.end_date) parsed.end_date = parsed.start_date;
    if (typeof parsed.all_day !== 'boolean') parsed.all_day = !parsed.start_time;
    if (!parsed.category) parsed.category = 'personal';
    if (!parsed.location) parsed.location = '';
    if (parsed.recurring === 'null' || parsed.recurring === undefined) parsed.recurring = null;
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.7;

    res.json({ ok: true, parsed });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ ok: false, error: 'timeout' });
    console.error('parse-event error:', err);
    res.status(502).json({ ok: false, error: 'llm_failed', detail: err.message });
  }
});


app.put('/api/events/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE events SET title=?,description=?,category=?,start_date=?,end_date=?,start_time=?,end_time=?,all_day=?,location=?,color=?,priority=?,status=?,tags=?,related_business=?,notes=? WHERE id=?")
    .run(b.title,b.description,b.category,b.start_date,b.end_date,b.start_time,b.end_time,b.all_day,b.location,b.color,b.priority,b.status,b.tags,b.related_business,b.notes,req.params.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/events/:id', (req, res) => {
  db.prepare("DELETE FROM events WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== MILESTONES ======
app.get('/api/milestones', (req, res) => res.json(db.prepare("SELECT * FROM milestones ORDER BY target_date").all()));
app.post('/api/milestones', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO milestones (title,target_date,category,status,description,color) VALUES (?,?,?,?,?,?)").run(b.title,b.target_date,b.category,b.status||'pending',b.description,b.color);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/milestones/:id', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE milestones SET title=?,target_date=?,category=?,status=?,description=?,color=? WHERE id=?").run(b.title,b.target_date,b.category,b.status,b.description,b.color,req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/milestones/:id', (req, res) => {
  db.prepare("DELETE FROM milestones WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== GOALS ======
app.get('/api/goals', (req, res) => res.json(db.prepare("SELECT * FROM goals ORDER BY quarter, category").all()));
app.post('/api/goals', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO goals (title,category,quarter,year,target,status,notes) VALUES (?,?,?,?,?,?,?)").run(b.title,b.category,b.quarter,b.year||2026,b.target,b.status||'in_progress',b.notes);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/goals/:id', auth, (req, res) => {
  const b = req.body;
  const existing = db.prepare("SELECT * FROM goals WHERE id=?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE goals SET title=?,category=?,quarter=?,year=?,target=?,current_progress=?,status=?,notes=? WHERE id=?")
    .run(b.title||existing.title, b.category||existing.category, b.quarter||existing.quarter, b.year||existing.year, b.target!==undefined?b.target:existing.target, b.current_progress!==undefined?b.current_progress:existing.current_progress, b.status||existing.status, b.notes!==undefined?b.notes:existing.notes, req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/goals/:id', (req, res) => {
  db.prepare("DELETE FROM goals WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const upcoming = db.prepare("SELECT * FROM events WHERE start_date >= ? ORDER BY start_date LIMIT 8").all(today);
  const active = db.prepare("SELECT * FROM events WHERE start_date <= ? AND end_date >= ? ORDER BY start_date").all(today, today);
  const milestones = db.prepare("SELECT * FROM milestones WHERE status='pending' ORDER BY target_date").all();
  const byCategory = db.prepare("SELECT category, COUNT(*) as count FROM events GROUP BY category").all();
  const byMonth = db.prepare("SELECT substr(start_date,6,2) as month, COUNT(*) as count FROM events WHERE start_date LIKE '2026%' GROUP BY month ORDER BY month").all();
  res.json({ upcoming, active, milestones, byCategory, byMonth, today });
});

// ====== TIME NOTES API ======
app.get('/api/time-notes', auth, (req, res) => {
  const { month, date } = req.query;
  if (date) {
    const note = db.prepare("SELECT * FROM time_notes WHERE note_date=?").get(date);
    return res.json(note || null);
  }
  if (month) {
    return res.json(db.prepare("SELECT * FROM time_notes WHERE note_date LIKE ? ORDER BY note_date DESC").all(month + '%'));
  }
  res.json(db.prepare("SELECT * FROM time_notes ORDER BY note_date DESC LIMIT 30").all());
});

app.post('/api/time-notes', auth, (req, res) => {
  console.log('POST /api/time-notes body:', JSON.stringify(req.body).substring(0,200));
  const b = req.body;
  const existing = db.prepare("SELECT id FROM time_notes WHERE note_date=?").get(b.note_date);
  if (existing) {
    db.prepare("UPDATE time_notes SET planned=?,actual=?,reflection=?,score=?,wins=?,improvements=?,tomorrow=?,mood=?,energy=? WHERE id=?")
      .run(b.planned, b.actual, b.reflection, b.score||0, b.wins, b.improvements, b.tomorrow, b.mood||'😊', b.energy||3, existing.id);
    return res.json({ id: existing.id, message: 'Updated' });
  }
  const r = db.prepare("INSERT INTO time_notes (note_date,planned,actual,reflection,score,wins,improvements,tomorrow,mood,energy) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(b.note_date, b.planned, b.actual, b.reflection, b.score||0, b.wins, b.improvements, b.tomorrow, b.mood||'😊', b.energy||3);
  res.json({ id: r.lastInsertRowid, message: 'Created' });
});

app.delete('/api/time-notes/:id', auth, (req, res) => {
  db.prepare("DELETE FROM time_notes WHERE id=?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// Timeblock API
const tbPath = path.join(__dirname, '..', 'weekly-timeblocks.json');
app.get('/api/timeblocks', auth, (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(tbPath, 'utf8'))); }
  catch(e) { res.json({}); }
});
app.put('/api/timeblocks', auth, (req, res) => {
  fs.writeFileSync(tbPath, JSON.stringify(req.body, null, 2));
  res.json({ message: 'Saved' });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Schedule Manager on port ${PORT}`));
