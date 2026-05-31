// Hawaii Group Coach App
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { PHASE_PROGRAMS, DRILLS, GROUP_PRESETS } = require('./seed');
const { regenerateWeeklyPrograms } = require('./auto-program');
const cron = require('node-cron');
const telegram = require('./telegram-client');

const app = express();
const PORT = 6060;
const SECRET = 'coach-hawaii-2026';
const COACH_PASSWORD = 'coach1234'; // 코치 공통 비밀번호

const db = new Database(path.join(__dirname, 'coach.db'));
db.pragma('journal_mode = WAL');

// === 스키마 (coach + player-training 통합) ===
db.exec(`
CREATE TABLE IF NOT EXISTS phase_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT, day_of_week INTEGER, title TEXT, blocks TEXT
);
CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT, name TEXT, detail TEXT, duration INTEGER, level TEXT,
  sets INTEGER, reps INTEGER, notes TEXT, sort_idx INTEGER DEFAULT 0, archived INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS group_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, description TEXT, duration INTEGER, blocks TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, phase TEXT, group_name TEXT, title TEXT, blocks TEXT,
  attendance TEXT, notes TEXT, feedback TEXT, athlete_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, level TEXT, birth_year INTEGER, age INTEGER,
  photo_url TEXT, share_token TEXT UNIQUE, archived INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
-- 선수별 일자 프로그램 (player-training 흡수)
CREATE TABLE IF NOT EXISTS athlete_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL, program_date TEXT NOT NULL,
  title TEXT, coach_note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(athlete_id, program_date)
);
CREATE TABLE IF NOT EXISTS athlete_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  category TEXT NOT NULL, name TEXT NOT NULL,
  sets INTEGER, reps INTEGER, duration_min INTEGER, notes TEXT,
  order_idx INTEGER DEFAULT 0, done INTEGER DEFAULT 0
);
-- 외국 아카데미 메소드 템플릿
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT,
  methodology TEXT, is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS template_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  category TEXT NOT NULL, name TEXT NOT NULL,
  sets INTEGER, reps INTEGER, duration_min INTEGER, notes TEXT,
  order_idx INTEGER DEFAULT 0
);

-- admin (수강생 관리/결제/출석/메모/진행도/레슨일정)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  date TEXT, amount INTEGER, note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  date TEXT, status TEXT,
  UNIQUE(athlete_id, date)
);
CREATE TABLE IF NOT EXISTS student_memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  date TEXT, text TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS curriculum_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  level TEXT, fundamental_key TEXT,
  checked INTEGER DEFAULT 1,
  UNIQUE(athlete_id, level, fundamental_key)
);
CREATE TABLE IF NOT EXISTS lesson_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, time TEXT, court TEXT, focus TEXT,
  student_ids TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// players 확장 컬럼
['phone TEXT','start_date TEXT','end_date TEXT','total_sessions INTEGER DEFAULT 0','used_sessions INTEGER DEFAULT 0','note TEXT'].forEach(c=>{
  try { db.exec("ALTER TABLE players ADD COLUMN " + c); } catch(e){}
});

// lesson_schedule 확장
['blocks TEXT','drill_ids TEXT','group_preset_id INTEGER','recurring_parent INTEGER'].forEach(c=>{
  try { db.exec("ALTER TABLE lesson_schedule ADD COLUMN " + c); } catch(e){}
});

// 기존 컬럼 누락 시 추가 (idempotent)
['sets','reps','notes','sort_idx','archived'].forEach(col => {
  try { db.exec("ALTER TABLE drills ADD COLUMN " + col + " " + (col==='archived'||col==='sort_idx'?'INTEGER DEFAULT 0':col==='sets'||col==='reps'?'INTEGER':'TEXT')); } catch(e){}
});
['age','photo_url','share_token','archived','created_at'].forEach(col => {
  try { db.exec("ALTER TABLE players ADD COLUMN " + col + " TEXT"); } catch(e){}
});
try { db.exec("ALTER TABLE sessions ADD COLUMN athlete_id INTEGER"); } catch(e){}

// === 시드 (DB 비어있을 때 1회) ===
function seedIfEmpty() {
  // phase_programs
  const phaseCount = db.prepare("SELECT COUNT(*) as c FROM phase_programs").get();
  if (phaseCount.c === 0) {
    const ins = db.prepare("INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)");
    Object.keys(PHASE_PROGRAMS).forEach(phase => {
      const days = PHASE_PROGRAMS[phase].days;
      Object.keys(days).forEach(dow => {
        ins.run(phase, +dow, days[dow].title, JSON.stringify(days[dow].blocks));
      });
    });
    console.log('[Coach] phase_programs seeded');
  }
  // drills
  const drillCount = db.prepare("SELECT COUNT(*) as c FROM drills").get();
  if (drillCount.c === 0) {
    const ins = db.prepare("INSERT INTO drills (category, name, detail, duration, level) VALUES (?,?,?,?,?)");
    DRILLS.forEach(d => ins.run(d.category, d.name, d.detail || '', d.duration, d.level));
    console.log('[Coach] drills seeded:', DRILLS.length);
  }
  // group_presets
  const grpCount = db.prepare("SELECT COUNT(*) as c FROM group_presets").get();
  if (grpCount.c === 0) {
    const ins = db.prepare("INSERT INTO group_presets (name, description, duration, blocks) VALUES (?,?,?,?)");
    GROUP_PRESETS.forEach(g => ins.run(g.name, g.description, g.duration, JSON.stringify(g.blocks)));
    console.log('[Coach] group_presets seeded:', GROUP_PRESETS.length);
  }
  // 기본 설정
  const cur = db.prepare("SELECT value FROM settings WHERE key='current_phase'").get();
  if (!cur) db.prepare("INSERT INTO settings (key, value) VALUES ('current_phase', 'practice')").run();
}
seedIfEmpty();

// === player-training → coach 마이그레이션 (1회) ===
function migrateFromPlayerTraining() {
  const TRAIN_DB = '/home/ubuntu/.openclaw/workspace/player-training/training.db';
  if (!fs.existsSync(TRAIN_DB)) { console.log('[Migrate] training.db 없음 — 스킵'); return; }
  const flagged = db.prepare("SELECT value FROM settings WHERE key='migrated_from_training'").get();
  if (flagged && flagged.value === 'done') { console.log('[Migrate] 이미 완료'); return; }

  console.log('[Migrate] 시작...');
  const src = new Database(TRAIN_DB, {readonly:true});
  try {
    // 1) athletes → players
    const athletes = src.prepare("SELECT * FROM athletes").all();
    const insP = db.prepare("INSERT OR IGNORE INTO players (id, name, age, level, photo_url, share_token, archived, active, created_at) VALUES (?,?,?,?,?,?,?,1,?)");
    athletes.forEach(a => insP.run(a.id, a.name, a.age, a.level, a.photo_url, a.share_token, a.archived||0, a.created_at));
    console.log('[Migrate] athletes →', athletes.length);

    // 2) library_items → drills (기존 드릴은 유지, 추가만)
    const libs = src.prepare("SELECT * FROM library_items WHERE archived=0").all();
    const insD = db.prepare("INSERT INTO drills (category, name, detail, duration, level, sets, reps, notes, sort_idx, archived) VALUES (?,?,?,?,?,?,?,?,?,0)");
    let added = 0;
    libs.forEach(l => {
      // 중복 회피: 같은 이름의 drill 있으면 skip
      const dup = db.prepare("SELECT id FROM drills WHERE name=?").get(l.name);
      if (dup) return;
      insD.run(l.category, l.name, l.notes||'', l.duration_min||0, 'medium', l.sets, l.reps, l.notes, l.sort_idx||0);
      added++;
    });
    console.log('[Migrate] library_items →', libs.length, ' 추가됨:', added);

    // 3) templates → templates
    const tmpls = src.prepare("SELECT * FROM templates").all();
    const insT = db.prepare("INSERT OR IGNORE INTO templates (id, name, description, methodology, is_system, created_at) VALUES (?,?,?,?,?,?)");
    tmpls.forEach(t => insT.run(t.id, t.name, t.description, t.methodology, t.is_system||0, t.created_at));
    console.log('[Migrate] templates →', tmpls.length);

    // 4) template_exercises → template_exercises
    const texs = src.prepare("SELECT * FROM template_exercises").all();
    const insTE = db.prepare("INSERT OR IGNORE INTO template_exercises (id, template_id, category, name, sets, reps, duration_min, notes, order_idx) VALUES (?,?,?,?,?,?,?,?,?)");
    texs.forEach(e => insTE.run(e.id, e.template_id, e.category, e.name, e.sets, e.reps, e.duration_min, e.notes, e.order_idx||0));
    console.log('[Migrate] template_exercises →', texs.length);

    // 5) programs → athlete_programs
    const prgs = src.prepare("SELECT * FROM programs").all();
    const insAP = db.prepare("INSERT OR IGNORE INTO athlete_programs (id, athlete_id, program_date, title, coach_note, created_at) VALUES (?,?,?,?,?,?)");
    prgs.forEach(p => insAP.run(p.id, p.athlete_id, p.program_date, p.title, p.coach_note, p.created_at));
    console.log('[Migrate] programs →', prgs.length);

    // 6) exercises → athlete_exercises
    const exs = src.prepare("SELECT * FROM exercises").all();
    const insAE = db.prepare("INSERT OR IGNORE INTO athlete_exercises (id, program_id, category, name, sets, reps, duration_min, notes, order_idx, done) VALUES (?,?,?,?,?,?,?,?,?,?)");
    exs.forEach(e => insAE.run(e.id, e.program_id, e.category, e.name, e.sets, e.reps, e.duration_min, e.notes, e.order_idx||0, e.done||0));
    console.log('[Migrate] exercises →', exs.length);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_from_training', 'done')").run();
    console.log('[Migrate] 완료 ✓');
  } catch(err) {
    console.error('[Migrate] 오류:', err.message);
  } finally {
    src.close();
  }
}
migrateFromPlayerTraining();

// === 미들웨어 ===
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.cookies.coach_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({error:'Login required'});
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch(e) { return res.status(401).json({error:'Invalid token'}); }
}

// === 라우트 ===
app.post('/api/login', (req, res) => {
  if (req.body.password !== COACH_PASSWORD) return res.status(401).json({error:'비밀번호 오류'});
  const token = jwt.sign({role:'coach'}, SECRET, {expiresIn:'30d'});
  res.cookie('coach_token', token, {httpOnly:false, maxAge:30*24*60*60*1000, path:'/', sameSite:'lax'});
  res.json({token});
});

// 현재 단계
app.get('/api/settings/phase', auth, (req, res) => {
  const r = db.prepare("SELECT value FROM settings WHERE key='current_phase'").get();
  res.json({phase: r ? r.value : 'practice'});
});
app.put('/api/settings/phase', auth, (req, res) => {
  const phase = req.body.phase || 'practice';
  if (!PHASE_PROGRAMS[phase]) return res.status(400).json({error:'Invalid phase'});
  db.prepare("UPDATE settings SET value=? WHERE key='current_phase'").run(phase);
  res.json({ok:true, phase});
});

// 단계 정보 (라벨, 색상, 모든 요일 프로그램)
app.get('/api/phases', auth, (req, res) => {
  const out = {};
  Object.keys(PHASE_PROGRAMS).forEach(p => {
    out[p] = {label: PHASE_PROGRAMS[p].label, color: PHASE_PROGRAMS[p].color};
  });
  res.json(out);
});

app.get('/api/phases/:phase/programs', auth, (req, res) => {
  const phase = req.params.phase;
  const rows = db.prepare("SELECT day_of_week, title, blocks FROM phase_programs WHERE phase=? ORDER BY day_of_week").all(phase);
  res.json(rows.map(r => ({day_of_week: r.day_of_week, title: r.title, blocks: JSON.parse(r.blocks)})));
});

// 단일 일자 프로그램 수정 (마스터 phase_programs 업데이트)
app.put('/api/programs/:phase/:dow', auth, (req, res) => {
  const phase = req.params.phase;
  const dow = +req.params.dow;
  const { title, blocks } = req.body;
  if (!PHASE_PROGRAMS[phase]) return res.status(400).json({error:'Invalid phase'});
  if (dow < 1 || dow > 7) return res.status(400).json({error:'Invalid day'});
  const existing = db.prepare("SELECT id FROM phase_programs WHERE phase=? AND day_of_week=?").get(phase, dow);
  if (existing) {
    db.prepare("UPDATE phase_programs SET title=?, blocks=? WHERE id=?").run(title||'', JSON.stringify(blocks||[]), existing.id);
  } else {
    db.prepare("INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)").run(phase, dow, title||'', JSON.stringify(blocks||[]));
  }
  res.json({ok:true});
});

// 마스터 시드로 리셋 (실수했을 때 복구용)
app.post('/api/programs/:phase/:dow/reset', auth, (req, res) => {
  const phase = req.params.phase;
  const dow = +req.params.dow;
  const seed = PHASE_PROGRAMS[phase] && PHASE_PROGRAMS[phase].days[dow];
  if (!seed) return res.status(404).json({error:'시드 없음'});
  const existing = db.prepare("SELECT id FROM phase_programs WHERE phase=? AND day_of_week=?").get(phase, dow);
  if (existing) {
    db.prepare("UPDATE phase_programs SET title=?, blocks=? WHERE id=?").run(seed.title, JSON.stringify(seed.blocks), existing.id);
  } else {
    db.prepare("INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)").run(phase, dow, seed.title, JSON.stringify(seed.blocks));
  }
  res.json({ok:true});
});

// 오늘 훈련 (현재 단계 + 오늘 요일)
app.get('/api/today', auth, (req, res) => {
  const cur = db.prepare("SELECT value FROM settings WHERE key='current_phase'").get();
  const phase = cur ? cur.value : 'practice';
  // Asia/Ulaanbaatar 기준 요일 (1=월~7=일)
  const local = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Ulaanbaatar'}));
  let dow = local.getDay(); // 0=일,1=월,...
  if (dow === 0) dow = 7; // 일요일
  const date = local.toISOString().slice(0,10);

  const program = db.prepare("SELECT day_of_week, title, blocks FROM phase_programs WHERE phase=? AND day_of_week=?").get(phase, dow);
  const phaseInfo = PHASE_PROGRAMS[phase] || {};
  const dayNames = ['','월','화','수','목','금','토','일'];

  res.json({
    date, phase,
    phase_label: phaseInfo.label || phase,
    phase_color: phaseInfo.color || '#3b82f6',
    day_of_week: dow,
    day_name: dayNames[dow],
    program: program ? {title: program.title, blocks: JSON.parse(program.blocks)} : null
  });
});

// 드릴 라이브러리
app.get('/api/drills', auth, (req, res) => {
  let q = "SELECT * FROM drills WHERE 1=1"; const p = [];
  if (req.query.category) { q += " AND category=?"; p.push(req.query.category); }
  if (req.query.level) { q += " AND level=?"; p.push(req.query.level); }
  if (req.query.search) { q += " AND (name LIKE ? OR detail LIKE ?)"; p.push('%'+req.query.search+'%','%'+req.query.search+'%'); }
  res.json(db.prepare(q + " ORDER BY category, name").all(...p));
});

app.get('/api/drills/categories', auth, (req, res) => {
  res.json(db.prepare("SELECT category, COUNT(*) as c FROM drills GROUP BY category ORDER BY category").all());
});

// 그룹 프리셋
app.get('/api/groups', auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM group_presets ORDER BY id").all();
  res.json(rows.map(r => ({...r, blocks: JSON.parse(r.blocks)})));
});

app.post('/api/groups', auth, (req, res) => {
  const { name, description, duration, blocks } = req.body;
  const r = db.prepare("INSERT INTO group_presets (name, description, duration, blocks) VALUES (?,?,?,?)").run(name, description||'', duration||60, JSON.stringify(blocks||[]));
  res.json({ok:true, id:r.lastInsertRowid});
});

app.put('/api/groups/:id', auth, (req, res) => {
  const { name, description, duration, blocks } = req.body;
  db.prepare("UPDATE group_presets SET name=?, description=?, duration=?, blocks=? WHERE id=?").run(name, description, duration, JSON.stringify(blocks||[]), +req.params.id);
  res.json({ok:true});
});

app.delete('/api/groups/:id', auth, (req, res) => {
  db.prepare("DELETE FROM group_presets WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// 훈련 일지 (sessions)
app.get('/api/sessions', auth, (req, res) => {
  let q = "SELECT * FROM sessions WHERE 1=1"; const p = [];
  if (req.query.date) { q += " AND date=?"; p.push(req.query.date); }
  if (req.query.from) { q += " AND date>=?"; p.push(req.query.from); }
  res.json(db.prepare(q + " ORDER BY date DESC, id DESC LIMIT 100").all(...p).map(s => ({
    ...s,
    blocks: s.blocks ? JSON.parse(s.blocks) : [],
    attendance: s.attendance ? JSON.parse(s.attendance) : []
  })));
});

app.post('/api/sessions', auth, (req, res) => {
  const { date, phase, group_name, title, blocks, attendance, notes, feedback } = req.body;
  const d = date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const r = db.prepare("INSERT INTO sessions (date, phase, group_name, title, blocks, attendance, notes, feedback) VALUES (?,?,?,?,?,?,?,?)").run(
    d, phase||'', group_name||'', title||'', JSON.stringify(blocks||[]), JSON.stringify(attendance||[]), notes||'', feedback||''
  );
  res.json({ok:true, id:r.lastInsertRowid});
});

app.put('/api/sessions/:id', auth, (req, res) => {
  const { title, blocks, attendance, notes, feedback } = req.body;
  db.prepare("UPDATE sessions SET title=?, blocks=?, attendance=?, notes=?, feedback=? WHERE id=?").run(
    title||'', JSON.stringify(blocks||[]), JSON.stringify(attendance||[]), notes||'', feedback||'', +req.params.id
  );
  res.json({ok:true});
});

app.delete('/api/sessions/:id', auth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// 선수 명단
app.get('/api/players', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM players WHERE active=1 ORDER BY level, name").all());
});

app.post('/api/players', auth, (req, res) => {
  const { name, level, birth_year } = req.body;
  if (!name) return res.status(400).json({error:'이름 필수'});
  const r = db.prepare("INSERT INTO players (name, level, birth_year) VALUES (?,?,?)").run(name, level||'amateur', birth_year||null);
  res.json({ok:true, id:r.lastInsertRowid});
});

app.delete('/api/players/:id', auth, (req, res) => {
  db.prepare("UPDATE players SET active=0 WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 선수(athletes) 확장 API ===
app.get('/api/athletes', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM players WHERE CAST(COALESCE(archived,0) AS INTEGER)=0 ORDER BY name").all());
});

app.post('/api/athletes', auth, (req, res) => {
  const { name, age, level, photo_url } = req.body;
  if (!name) return res.status(400).json({error:'이름 필수'});
  const token = require('crypto').randomBytes(8).toString('hex');
  const r = db.prepare("INSERT INTO players (name, age, level, photo_url, share_token, archived, active) VALUES (?,?,?,?,?,0,1)").run(name, age||null, level||'', photo_url||null, token);
  res.json({ok:true, id:r.lastInsertRowid, share_token:token});
});

app.put('/api/athletes/:id', auth, (req, res) => {
  const { name, age, level, photo_url } = req.body;
  db.prepare("UPDATE players SET name=?, age=?, level=?, photo_url=? WHERE id=?").run(name, age||null, level||'', photo_url||null, +req.params.id);
  res.json({ok:true});
});

app.delete('/api/athletes/:id', auth, (req, res) => {
  db.prepare("UPDATE players SET archived=1 WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

app.post('/api/athletes/:id/regen-token', auth, (req, res) => {
  const token = require('crypto').randomBytes(8).toString('hex');
  db.prepare("UPDATE players SET share_token=? WHERE id=?").run(token, +req.params.id);
  res.json({ok:true, share_token:token});
});

// === 선수별 일자 프로그램 ===
app.get('/api/athletes/:aid/programs', auth, (req, res) => {
  const aid = +req.params.aid;
  const programs = db.prepare("SELECT * FROM athlete_programs WHERE athlete_id=? ORDER BY program_date DESC LIMIT 50").all(aid);
  res.json(programs.map(p => ({
    ...p,
    exercises: db.prepare("SELECT * FROM athlete_exercises WHERE program_id=? ORDER BY order_idx, id").all(p.id)
  })));
});

app.post('/api/athletes/:aid/programs', auth, (req, res) => {
  const aid = +req.params.aid;
  const { program_date, title, coach_note } = req.body;
  const date = program_date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  try {
    const r = db.prepare("INSERT INTO athlete_programs (athlete_id, program_date, title, coach_note) VALUES (?,?,?,?)").run(aid, date, title||'', coach_note||'');
    res.json({ok:true, id:r.lastInsertRowid});
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({error:'해당 날짜 프로그램이 이미 있음'});
    res.status(500).json({error:e.message});
  }
});

app.put('/api/programs/:id', auth, (req, res) => {
  const { title, coach_note } = req.body;
  db.prepare("UPDATE athlete_programs SET title=?, coach_note=? WHERE id=?").run(title||'', coach_note||'', +req.params.id);
  res.json({ok:true});
});

app.delete('/api/programs/:id', auth, (req, res) => {
  db.prepare("DELETE FROM athlete_exercises WHERE program_id=?").run(+req.params.id);
  db.prepare("DELETE FROM athlete_programs WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// 운동 추가/수정/삭제
app.post('/api/programs/:pid/exercises', auth, (req, res) => {
  const pid = +req.params.pid;
  const { category, name, sets, reps, duration_min, notes, order_idx } = req.body;
  const r = db.prepare("INSERT INTO athlete_exercises (program_id, category, name, sets, reps, duration_min, notes, order_idx) VALUES (?,?,?,?,?,?,?,?)").run(pid, category||'technical', name||'', sets||null, reps||null, duration_min||null, notes||'', order_idx||0);
  res.json({ok:true, id:r.lastInsertRowid});
});

app.put('/api/exercises/:id', auth, (req, res) => {
  const { category, name, sets, reps, duration_min, notes, order_idx, done } = req.body;
  const cur = db.prepare("SELECT * FROM athlete_exercises WHERE id=?").get(+req.params.id);
  if (!cur) return res.status(404).json({error:'없음'});
  db.prepare("UPDATE athlete_exercises SET category=?, name=?, sets=?, reps=?, duration_min=?, notes=?, order_idx=?, done=? WHERE id=?").run(
    category!==undefined?category:cur.category, name!==undefined?name:cur.name,
    sets!==undefined?sets:cur.sets, reps!==undefined?reps:cur.reps,
    duration_min!==undefined?duration_min:cur.duration_min, notes!==undefined?notes:cur.notes,
    order_idx!==undefined?order_idx:cur.order_idx, done!==undefined?done:cur.done, +req.params.id
  );
  res.json({ok:true});
});

app.delete('/api/exercises/:id', auth, (req, res) => {
  db.prepare("DELETE FROM athlete_exercises WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 템플릿 (외국 아카데미 14개) ===
app.get('/api/templates', auth, (req, res) => {
  let q = "SELECT * FROM templates WHERE 1=1"; const p = [];
  if (req.query.methodology) { q += " AND methodology=?"; p.push(req.query.methodology); }
  res.json(db.prepare(q + " ORDER BY methodology, name").all(...p));
});

app.get('/api/templates/:id', auth, (req, res) => {
  const t = db.prepare("SELECT * FROM templates WHERE id=?").get(+req.params.id);
  if (!t) return res.status(404).json({error:'없음'});
  t.exercises = db.prepare("SELECT * FROM template_exercises WHERE template_id=? ORDER BY order_idx, id").all(t.id);
  res.json(t);
});

// 템플릿을 선수 프로그램에 적용
app.post('/api/programs/:pid/apply-template/:tid', auth, (req, res) => {
  const pid = +req.params.pid, tid = +req.params.tid;
  const exs = db.prepare("SELECT * FROM template_exercises WHERE template_id=? ORDER BY order_idx").all(tid);
  const ins = db.prepare("INSERT INTO athlete_exercises (program_id, category, name, sets, reps, duration_min, notes, order_idx) VALUES (?,?,?,?,?,?,?,?)");
  exs.forEach((e, i) => ins.run(pid, e.category, e.name, e.sets, e.reps, e.duration_min, e.notes||'', i));
  res.json({ok:true, count:exs.length});
});

// === 공유 링크 (비밀번호 없이 선수/학부모가 보기) ===
app.get('/api/share/:token/programs', (req, res) => {
  const a = db.prepare("SELECT id, name, level FROM players WHERE share_token=? AND CAST(COALESCE(archived,0) AS INTEGER)=0").get(req.params.token);
  if (!a) return res.status(404).json({error:'유효하지 않은 링크'});
  const programs = db.prepare("SELECT * FROM athlete_programs WHERE athlete_id=? ORDER BY program_date DESC LIMIT 30").all(a.id);
  res.json({
    athlete: a,
    programs: programs.map(p => ({
      ...p,
      exercises: db.prepare("SELECT * FROM athlete_exercises WHERE program_id=? ORDER BY order_idx").all(p.id)
    }))
  });
});

app.post('/api/share/:token/exercises/:eid/done', (req, res) => {
  const a = db.prepare("SELECT id FROM players WHERE share_token=?").get(req.params.token);
  if (!a) return res.status(404).json({error:'유효하지 않은 링크'});
  const e = db.prepare("SELECT ae.id FROM athlete_exercises ae JOIN athlete_programs ap ON ap.id=ae.program_id WHERE ae.id=? AND ap.athlete_id=?").get(+req.params.eid, a.id);
  if (!e) return res.status(404).json({error:'없음'});
  const cur = db.prepare("SELECT done FROM athlete_exercises WHERE id=?").get(e.id);
  db.prepare("UPDATE athlete_exercises SET done=? WHERE id=?").run(cur.done?0:1, e.id);
  res.json({ok:true, done:cur.done?0:1});
});

app.get('/share/:token', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'share.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// === Admin (관리자 페이지 — 라이트 테마 데스크탑) ===
app.get('/admin', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 학생 (확장 필드 포함)
app.get('/api/admin/students', auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM players WHERE CAST(COALESCE(archived,0) AS INTEGER)=0 ORDER BY name").all();
  res.json(rows.map(r => ({
    ...r,
    memos: db.prepare("SELECT id, date, text FROM student_memos WHERE athlete_id=? ORDER BY id DESC").all(r.id)
  })));
});

app.post('/api/admin/students', auth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({error:'이름 필수'});
  const token = require('crypto').randomBytes(8).toString('hex');
  const r = db.prepare(`INSERT INTO players (name, phone, level, age, start_date, end_date, total_sessions, used_sessions, note, share_token, archived, active)
                        VALUES (?,?,?,?,?,?,?,?,?,?,0,1)`).run(
    b.name, b.phone||'', b.level||'', b.age||null, b.start_date||null, b.end_date||null,
    b.total_sessions||0, b.used_sessions||0, b.note||'', token);
  res.json({ok:true, id:r.lastInsertRowid});
});

app.put('/api/admin/students/:id', auth, (req, res) => {
  const b = req.body || {};
  const id = +req.params.id;
  db.prepare(`UPDATE players SET name=?, phone=?, level=?, age=?, start_date=?, end_date=?, total_sessions=?, used_sessions=?, note=? WHERE id=?`).run(
    b.name||'', b.phone||'', b.level||'', b.age||null, b.start_date||null, b.end_date||null,
    b.total_sessions||0, b.used_sessions||0, b.note||'', id);
  res.json({ok:true});
});

app.delete('/api/admin/students/:id', auth, (req, res) => {
  const id = +req.params.id;
  db.prepare("UPDATE players SET archived=1 WHERE id=?").run(id);
  // 관련 데이터는 유지 (실제 삭제 X). 필요시 prune은 별도 API.
  res.json({ok:true});
});

// 통계
app.get('/api/admin/stats', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const month = today.slice(0,7);
  const all = db.prepare("SELECT * FROM players WHERE CAST(COALESCE(archived,0) AS INTEGER)=0").all();
  const total = all.length;
  let active=0, expiring=0, expired=0;
  all.forEach(s => {
    if (!s.end_date) { expired++; return; }
    const days = Math.ceil((new Date(s.end_date) - new Date(today)) / 86400000);
    if (days < 0) expired++;
    else if (days <= 7) expiring++;
    else active++;
  });
  const revenue = db.prepare("SELECT SUM(amount) as t FROM payments WHERE date LIKE ?").get(month + '%').t || 0;
  res.json({total, active, expiring, expired, revenue, month});
});

// 결제
app.get('/api/admin/payments', auth, (req, res) => {
  let q = "SELECT * FROM payments WHERE 1=1"; const p = [];
  if (req.query.month) { q += " AND date LIKE ?"; p.push(req.query.month + '%'); }
  if (req.query.athlete_id) { q += " AND athlete_id=?"; p.push(+req.query.athlete_id); }
  q += " ORDER BY date DESC, id DESC";
  res.json(db.prepare(q).all(...p));
});
app.post('/api/admin/payments', auth, (req, res) => {
  const b = req.body || {};
  if (!b.athlete_id) return res.status(400).json({error:'학생 필수'});
  const r = db.prepare("INSERT INTO payments (athlete_id, date, amount, note) VALUES (?,?,?,?)").run(b.athlete_id, b.date||new Date().toISOString().slice(0,10), b.amount||0, b.note||'');
  res.json({ok:true, id:r.lastInsertRowid});
});
app.delete('/api/admin/payments/:id', auth, (req, res) => {
  db.prepare("DELETE FROM payments WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// 출석 (toggle: 같은 status면 취소, 다른 status면 변경)
app.get('/api/admin/attendance', auth, (req, res) => {
  let q = "SELECT * FROM attendance WHERE 1=1"; const p = [];
  if (req.query.date) { q += " AND date=?"; p.push(req.query.date); }
  if (req.query.athlete_id) { q += " AND athlete_id=?"; p.push(+req.query.athlete_id); }
  res.json(db.prepare(q).all(...p));
});
app.post('/api/admin/attendance', auth, (req, res) => {
  const { athlete_id, date, status } = req.body || {};
  if (!athlete_id || !date) return res.status(400).json({error:'필수값 누락'});
  const cur = db.prepare("SELECT * FROM attendance WHERE athlete_id=? AND date=?").get(athlete_id, date);
  const player = db.prepare("SELECT used_sessions FROM players WHERE id=?").get(athlete_id);
  const counted = (s) => s === 'present' || s === 'late';
  if (cur) {
    if (cur.status === status) {
      // 토글 해제
      db.prepare("DELETE FROM attendance WHERE id=?").run(cur.id);
      if (counted(cur.status) && player) {
        db.prepare("UPDATE players SET used_sessions=MAX(0, used_sessions-1) WHERE id=?").run(athlete_id);
      }
      return res.json({ok:true, status:null});
    } else {
      const wasC = counted(cur.status), isC = counted(status);
      db.prepare("UPDATE attendance SET status=? WHERE id=?").run(status, cur.id);
      if (player) {
        if (wasC && !isC) db.prepare("UPDATE players SET used_sessions=MAX(0, used_sessions-1) WHERE id=?").run(athlete_id);
        if (!wasC && isC) db.prepare("UPDATE players SET used_sessions=used_sessions+1 WHERE id=?").run(athlete_id);
      }
      return res.json({ok:true, status});
    }
  } else {
    db.prepare("INSERT INTO attendance (athlete_id, date, status) VALUES (?,?,?)").run(athlete_id, date, status);
    if (counted(status) && player) {
      db.prepare("UPDATE players SET used_sessions=used_sessions+1 WHERE id=?").run(athlete_id);
    }
    return res.json({ok:true, status});
  }
});

// 메모 (학생별)
app.get('/api/admin/students/:id/memos', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM student_memos WHERE athlete_id=? ORDER BY id DESC").all(+req.params.id));
});
app.post('/api/admin/students/:id/memos', auth, (req, res) => {
  const b = req.body || {};
  const r = db.prepare("INSERT INTO student_memos (athlete_id, date, text) VALUES (?,?,?)").run(+req.params.id, b.date||new Date().toISOString().slice(0,10), b.text||'');
  res.json({ok:true, id:r.lastInsertRowid});
});
app.delete('/api/admin/memos/:id', auth, (req, res) => {
  db.prepare("DELETE FROM student_memos WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// 진행도 (커리큘럼 펀더멘털 체크)
app.get('/api/admin/students/:id/progress', auth, (req, res) => {
  res.json(db.prepare("SELECT level, fundamental_key, checked FROM curriculum_progress WHERE athlete_id=?").all(+req.params.id));
});
app.post('/api/admin/students/:id/progress/toggle', auth, (req, res) => {
  const id = +req.params.id;
  const { level, fundamental_key } = req.body || {};
  if (!level || !fundamental_key) return res.status(400).json({error:'필수값 누락'});
  const cur = db.prepare("SELECT * FROM curriculum_progress WHERE athlete_id=? AND level=? AND fundamental_key=?").get(id, level, fundamental_key);
  if (cur) {
    db.prepare("DELETE FROM curriculum_progress WHERE id=?").run(cur.id);
    return res.json({ok:true, checked:false});
  }
  db.prepare("INSERT INTO curriculum_progress (athlete_id, level, fundamental_key, checked) VALUES (?,?,?,1)").run(id, level, fundamental_key);
  res.json({ok:true, checked:true});
});

// 레슨 일정
function lessonRow(r) {
  return {
    ...r,
    student_ids: r.student_ids ? JSON.parse(r.student_ids) : [],
    blocks: r.blocks ? JSON.parse(r.blocks) : [],
    drill_ids: r.drill_ids ? JSON.parse(r.drill_ids) : []
  };
}

app.get('/api/admin/lessons', auth, (req, res) => {
  let q = "SELECT * FROM lesson_schedule WHERE 1=1"; const p = [];
  if (req.query.date) { q += " AND date=?"; p.push(req.query.date); }
  q += " ORDER BY date DESC, time";
  res.json(db.prepare(q).all(...p).map(lessonRow));
});

app.post('/api/admin/lessons', auth, (req, res) => {
  const b = req.body || {};
  const r = db.prepare(`INSERT INTO lesson_schedule (date, time, court, focus, student_ids, blocks, drill_ids, group_preset_id)
                        VALUES (?,?,?,?,?,?,?,?)`).run(
    b.date||'', b.time||'', b.court||'', b.focus||'',
    JSON.stringify(b.student_ids||[]), JSON.stringify(b.blocks||[]), JSON.stringify(b.drill_ids||[]),
    b.group_preset_id||null);
  res.json({ok:true, id:r.lastInsertRowid});
});

app.put('/api/admin/lessons/:id', auth, (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE lesson_schedule SET date=?, time=?, court=?, focus=?, student_ids=?, blocks=?, drill_ids=?, group_preset_id=? WHERE id=?`).run(
    b.date||'', b.time||'', b.court||'', b.focus||'',
    JSON.stringify(b.student_ids||[]), JSON.stringify(b.blocks||[]), JSON.stringify(b.drill_ids||[]),
    b.group_preset_id||null, +req.params.id);
  res.json({ok:true});
});

app.delete('/api/admin/lessons/:id', auth, (req, res) => {
  const id = +req.params.id;
  // 반복 일정의 원본을 지우면 자식들도 삭제
  if (req.query.cascade === '1') {
    db.prepare("DELETE FROM lesson_schedule WHERE recurring_parent=?").run(id);
  }
  db.prepare("DELETE FROM lesson_schedule WHERE id=?").run(id);
  res.json({ok:true});
});

// 그룹 프리셋 적용 (기존 일정의 blocks를 프리셋의 blocks로 덮어쓰기)
app.post('/api/admin/lessons/:id/apply-preset/:gid', auth, (req, res) => {
  const lessonId = +req.params.id, groupId = +req.params.gid;
  const grp = db.prepare("SELECT * FROM group_presets WHERE id=?").get(groupId);
  if (!grp) return res.status(404).json({error:'그룹 프리셋 없음'});
  const blocks = JSON.parse(grp.blocks || '[]');
  db.prepare("UPDATE lesson_schedule SET blocks=?, group_preset_id=? WHERE id=?").run(JSON.stringify(blocks), groupId, lessonId);
  res.json({ok:true, count:blocks.length});
});

// 반복 일정 생성 (예: 매주 화요일 16시, 8주)
app.post('/api/admin/lessons/recurring', auth, (req, res) => {
  const b = req.body || {};
  const { start_date, time, court, focus, student_ids, blocks, drill_ids, group_preset_id, weeks } = b;
  if (!start_date || !weeks) return res.status(400).json({error:'start_date, weeks 필수'});
  const startD = new Date(start_date + 'T00:00:00');
  // 첫 일정 (parent)
  const parent = db.prepare(`INSERT INTO lesson_schedule (date, time, court, focus, student_ids, blocks, drill_ids, group_preset_id)
                              VALUES (?,?,?,?,?,?,?,?)`).run(
    start_date, time||'', court||'', focus||'',
    JSON.stringify(student_ids||[]), JSON.stringify(blocks||[]), JSON.stringify(drill_ids||[]),
    group_preset_id||null);
  const parentId = parent.lastInsertRowid;
  // 자식들 (week 1 ~ weeks-1)
  let created = 1;
  for (let w = 1; w < weeks; w++) {
    const d = new Date(startD.getTime() + w * 7 * 86400000);
    const dStr = d.toISOString().slice(0,10);
    db.prepare(`INSERT INTO lesson_schedule (date, time, court, focus, student_ids, blocks, drill_ids, group_preset_id, recurring_parent)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(
      dStr, time||'', court||'', focus||'',
      JSON.stringify(student_ids||[]), JSON.stringify(blocks||[]), JSON.stringify(drill_ids||[]),
      group_preset_id||null, parentId);
    created++;
  }
  res.json({ok:true, parent_id:parentId, count:created});
});

// admin 전용 그룹/드릴 (편의)
app.get('/api/admin/groups', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM group_presets ORDER BY id").all().map(r => ({...r, blocks: JSON.parse(r.blocks || '[]')})));
});

app.get('/api/admin/drills', auth, (req, res) => {
  let q = "SELECT * FROM drills WHERE CAST(COALESCE(archived,0) AS INTEGER)=0"; const p = [];
  if (req.query.search) { q += " AND (name LIKE ? OR detail LIKE ?)"; p.push('%'+req.query.search+'%','%'+req.query.search+'%'); }
  if (req.query.category) { q += " AND category=?"; p.push(req.query.category); }
  q += " ORDER BY category, name LIMIT 100";
  res.json(db.prepare(q).all(...p));
});

// 백업 (전체 export)
app.get('/api/admin/backup', auth, (req, res) => {
  const out = {
    students: db.prepare("SELECT * FROM players").all(),
    payments: db.prepare("SELECT * FROM payments").all(),
    attendance: db.prepare("SELECT * FROM attendance").all(),
    memos: db.prepare("SELECT * FROM student_memos").all(),
    progress: db.prepare("SELECT * FROM curriculum_progress").all(),
    lessons: db.prepare("SELECT * FROM lesson_schedule").all(),
    exported_at: new Date().toISOString()
  };
  res.json(out);
});

// === 엑셀 export (CSV - UTF-8 BOM, 한글 호환) ===
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function sendCSV(res, filename, rows) {
  const csv = '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
  res.send(csv);
}

app.get('/api/export/today.csv', auth, (req, res) => {
  const cur = db.prepare("SELECT value FROM settings WHERE key='current_phase'").get();
  const phase = cur ? cur.value : 'practice';
  const local = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Ulaanbaatar'}));
  let dow = local.getDay(); if (dow === 0) dow = 7;
  const date = local.toISOString().slice(0,10);
  const prog = db.prepare("SELECT * FROM phase_programs WHERE phase=? AND day_of_week=?").get(phase, dow);
  const rows = [['오늘 훈련 프로그램'],['날짜', date],['단계', PHASE_PROGRAMS[phase]?PHASE_PROGRAMS[phase].label:phase],['요일', ['','월','화','수','목','금','토','일'][dow]],[],['시간','훈련 이름','상세']];
  if (prog) JSON.parse(prog.blocks).forEach(b => rows.push([b.time||'', b.name||'', b.detail||'']));
  sendCSV(res, '오늘훈련_' + date + '.csv', rows);
});

app.get('/api/export/sessions.csv', auth, (req, res) => {
  const sessions = db.prepare("SELECT * FROM sessions ORDER BY date DESC LIMIT 200").all();
  const rows = [['훈련 일지']];
  sessions.forEach(s => {
    rows.push([]);
    rows.push(['날짜', s.date, '단계', s.phase, '그룹', s.group_name||'']);
    rows.push(['제목', s.title || '']);
    if (s.blocks) {
      try { JSON.parse(s.blocks).forEach(b => rows.push(['', b.time||'', b.name||'', b.detail||''])); } catch(e){}
    }
    if (s.notes) rows.push(['메모', s.notes]);
  });
  sendCSV(res, '훈련일지_' + new Date().toISOString().slice(0,10) + '.csv', rows);
});

app.get('/api/export/drills.csv', auth, (req, res) => {
  const drills = db.prepare("SELECT * FROM drills WHERE CAST(COALESCE(archived,0) AS INTEGER)=0 ORDER BY category, name").all();
  const rows = [['카테고리','이름','상세','시간(분)','세트','반복','난이도','메모']];
  drills.forEach(d => rows.push([d.category, d.name, d.detail||'', d.duration||'', d.sets||'', d.reps||'', d.level||'', d.notes||'']));
  sendCSV(res, '드릴라이브러리.csv', rows);
});

app.get('/api/export/athletes/:id/programs.csv', auth, (req, res) => {
  const aid = +req.params.id;
  const a = db.prepare("SELECT * FROM players WHERE id=?").get(aid);
  if (!a) return res.status(404).json({error:'선수 없음'});
  const programs = db.prepare("SELECT * FROM athlete_programs WHERE athlete_id=? ORDER BY program_date DESC").all(aid);
  const rows = [['선수', a.name, '레벨', a.level||'', '나이', a.age||'']];
  programs.forEach(p => {
    rows.push([]);
    rows.push(['날짜', p.program_date, '제목', p.title||'']);
    if (p.coach_note) rows.push(['코치 메모', p.coach_note]);
    rows.push(['', '카테고리', '운동', '세트', '반복', '시간', '메모', '완료']);
    const exs = db.prepare("SELECT * FROM athlete_exercises WHERE program_id=? ORDER BY order_idx").all(p.id);
    exs.forEach(e => rows.push(['', e.category, e.name, e.sets||'', e.reps||'', e.duration_min||'', e.notes||'', e.done?'O':'']));
  });
  sendCSV(res, a.name + '_프로그램.csv', rows);
});


// ===== 라이브러리 CRUD: drills =====
app.post('/api/drills', auth, (req, res) => {
  const { category, name, detail, duration, level, sets, reps, notes } = req.body;
  if (!name || !category) return res.status(400).json({error:'카테고리/이름 필요'});
  const r = db.prepare("INSERT INTO drills (category, name, detail, duration, level, sets, reps, notes, sort_idx, archived) VALUES (?,?,?,?,?,?,?,?,?,0)")
    .run(category, name, detail||'', duration||null, level||'medium', sets||null, reps||null, notes||'', 99999);
  res.json({ok:true, id:r.lastInsertRowid});
});
app.put('/api/drills/:id', auth, (req, res) => {
  const { category, name, detail, duration, level, sets, reps, notes } = req.body;
  db.prepare("UPDATE drills SET category=?, name=?, detail=?, duration=?, level=?, sets=?, reps=?, notes=? WHERE id=?")
    .run(category, name, detail||'', duration||null, level||'medium', sets||null, reps||null, notes||'', +req.params.id);
  res.json({ok:true});
});
app.delete('/api/drills/:id', auth, (req, res) => {
  db.prepare("DELETE FROM drills WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// ===== 라이브러리 CRUD: templates =====
app.post('/api/templates', auth, (req, res) => {
  const { name, description, methodology } = req.body;
  if (!name) return res.status(400).json({error:'이름 필요'});
  const r = db.prepare("INSERT INTO templates (name, description, methodology, is_system, created_at) VALUES (?,?,?,0,datetime('now','localtime'))")
    .run(name, description||'', methodology||'custom');
  res.json({ok:true, id:r.lastInsertRowid});
});
app.put('/api/templates/:id', auth, (req, res) => {
  const { name, description, methodology } = req.body;
  db.prepare("UPDATE templates SET name=?, description=?, methodology=? WHERE id=?").run(name, description||'', methodology||'custom', +req.params.id);
  res.json({ok:true});
});
app.delete('/api/templates/:id', auth, (req, res) => {
  db.prepare("DELETE FROM template_exercises WHERE template_id=?").run(+req.params.id);
  db.prepare("DELETE FROM templates WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// ===== 라이브러리 CRUD: template_exercises =====
app.post('/api/templates/:tid/exercises', auth, (req, res) => {
  const { category, name, sets, reps, duration_min, notes } = req.body;
  const tid = +req.params.tid;
  if (!name) return res.status(400).json({error:'이름 필요'});
  const max = db.prepare("SELECT COALESCE(MAX(order_idx),-1) as m FROM template_exercises WHERE template_id=?").get(tid).m;
  const r = db.prepare("INSERT INTO template_exercises (template_id, category, name, sets, reps, duration_min, notes, order_idx) VALUES (?,?,?,?,?,?,?,?)")
    .run(tid, category||'technical', name, sets||null, reps||null, duration_min||null, notes||'', max+1);
  res.json({ok:true, id:r.lastInsertRowid});
});
app.put('/api/template-exercises/:id', auth, (req, res) => {
  const { category, name, sets, reps, duration_min, notes } = req.body;
  db.prepare("UPDATE template_exercises SET category=?, name=?, sets=?, reps=?, duration_min=?, notes=? WHERE id=?")
    .run(category||'technical', name, sets||null, reps||null, duration_min||null, notes||'', +req.params.id);
  res.json({ok:true});
});
app.delete('/api/template-exercises/:id', auth, (req, res) => {
  db.prepare("DELETE FROM template_exercises WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// ===== 라이브러리 CRUD: phase_programs =====
app.get('/api/phase-programs', auth, (req, res) => {
  let q = "SELECT * FROM phase_programs"; const p = [];
  if (req.query.phase) { q += " WHERE phase=?"; p.push(req.query.phase); }
  res.json(db.prepare(q + " ORDER BY phase, day_of_week, id").all(...p).map(r=>({...r, blocks: JSON.parse(r.blocks||'[]')})));
});
app.post('/api/phase-programs', auth, (req, res) => {
  const { phase, day_of_week, title, blocks } = req.body;
  if (!phase || !title) return res.status(400).json({error:'phase/제목 필요'});
  const r = db.prepare("INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)")
    .run(phase, day_of_week||1, title, JSON.stringify(blocks||[]));
  res.json({ok:true, id:r.lastInsertRowid});
});
app.put('/api/phase-programs/:id', auth, (req, res) => {
  const { phase, day_of_week, title, blocks } = req.body;
  db.prepare("UPDATE phase_programs SET phase=?, day_of_week=?, title=?, blocks=? WHERE id=?")
    .run(phase, day_of_week||1, title, JSON.stringify(blocks||[]), +req.params.id);
  res.json({ok:true});
});
app.delete('/api/phase-programs/:id', auth, (req, res) => {
  db.prepare("DELETE FROM phase_programs WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});


// === 매주 자동 프로그램 재생성 (inseason + winter) ===
// 수동 트리거 (코치 인증 필요)
app.post('/api/programs/regenerate', auth, (req, res) => {
  try {
    const result = regenerateWeeklyPrograms(db, 'manual_trigger');
    res.json({ ok: true, ...result });
    // 비동기 알림
    setImmediate(() => {
      const msg = `🎾 *코치 프로그램 수동 재생성*
교체: ${result.replaced || 0}개
백업: ${result.backed_up || 0}개
시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Ulaanbaatar' })}`;
      telegram.notify(msg).catch(e => console.error('[regen-notify]', e));
    });
  } catch (e) {
    console.error('[regen]', e);
    res.status(500).json({ ok: false, error: e.message });
    // 실패도 알림
    setImmediate(() => {
      telegram.notify(`⚠️ *코치 프로그램 재생성 실패*
오류: ${e.message}`).catch(()=>{});
    });
  }
});

// 매주 일요일 23:30 UB (EC2 TZ=Asia/Ulaanbaatar)
cron.schedule('30 23 * * 0', () => {
  try {
    const r = regenerateWeeklyPrograms(db, 'weekly_auto');
    console.log('[regen weekly]', new Date().toISOString(), r);
    setImmediate(() => {
      const msg = `🗓️ *코치 프로그램 매주 자동 재생성*
교체: ${r.replaced || 0}개
백업: ${r.backed_up || 0}개
다음 주(월~토) 프로그램이 새로 생성되었습니다.
어드민에서 확인: https://app.hawaiigroup.co/coach/admin.html`;
      telegram.notify(msg).catch(e => console.error('[regen-notify]', e));
    });
  } catch (e) {
    console.error('[regen weekly]', e);
    setImmediate(() => {
      telegram.notify(`⚠️ *매주 자동 재생성 실패*
${e.message}`).catch(()=>{});
    });
  }
});
console.log('[Coach App] weekly regen schedule registered (Sun 23:30 UB)');

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log('[Coach App] port ' + PORT));
