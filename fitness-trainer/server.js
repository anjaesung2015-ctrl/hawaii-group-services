const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = 6009;
const SECRET = 'fit-trainer-2026';
const db = new Database(path.join(__dirname, 'fitness.db'));

db.pragma('journal_mode = WAL');
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    age INTEGER,
    height_cm INTEGER,
    weight_kg REAL,
    goal TEXT DEFAULT 'general_fitness',
    fitness_level TEXT DEFAULT 'intermediate',
    injuries TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workout_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_number INTEGER DEFAULT 1,
    day_of_week TEXT NOT NULL,
    workout_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    duration_min INTEGER DEFAULT 60,
    difficulty TEXT DEFAULT 'moderate',
    target_muscles TEXT,
    calories_est INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    exercise_order INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'strength',
    sets INTEGER,
    reps TEXT,
    weight_kg REAL,
    duration_sec INTEGER,
    rest_sec INTEGER DEFAULT 60,
    tempo TEXT,
    notes TEXT,
    video_url TEXT,
    FOREIGN KEY (plan_id) REFERENCES workout_plans(id)
  );

  CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER,
    log_date TEXT NOT NULL,
    workout_type TEXT,
    title TEXT,
    duration_min INTEGER,
    calories_burned INTEGER,
    energy_level INTEGER DEFAULT 3,
    mood INTEGER DEFAULT 3,
    notes TEXT,
    completed INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS exercise_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets_done INTEGER,
    reps_done TEXT,
    weight_kg REAL,
    notes TEXT,
    pr_flag INTEGER DEFAULT 0,
    FOREIGN KEY (log_id) REFERENCES workout_logs(id)
  );

  CREATE TABLE IF NOT EXISTS body_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    log_date TEXT NOT NULL,
    weight_kg REAL,
    body_fat_pct REAL,
    muscle_mass REAL,
    chest_cm REAL,
    waist_cm REAL,
    arm_cm REAL,
    thigh_cm REAL,
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS daily_habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    log_date TEXT NOT NULL,
    water_liters REAL DEFAULT 0,
    sleep_hours REAL DEFAULT 0,
    steps INTEGER DEFAULT 0,
    protein_g INTEGER,
    calories_intake INTEGER,
    stretching INTEGER DEFAULT 0,
    meditation INTEGER DEFAULT 0,
    notes TEXT,
    UNIQUE(user_id, log_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Default user - 재성님 프로필
if (!db.prepare("SELECT id FROM users WHERE username='admin'").get()) {
  db.prepare("INSERT INTO users (username,password,name,age,height_cm,weight_kg,goal,fitness_level,injuries) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('admin','admin123','재성',null,null,null,'tennis_fitness','intermediate','');
}

// Pre-populate 4-week workout plan
if (db.prepare("SELECT COUNT(*) as c FROM workout_plans").get().c === 0) {
  const insPlan = db.prepare("INSERT INTO workout_plans (user_id,week_number,day_of_week,workout_type,title,description,duration_min,difficulty,target_muscles,calories_est) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insEx = db.prepare("INSERT INTO exercises (plan_id,exercise_order,name,category,sets,reps,weight_kg,duration_sec,rest_sec,tempo,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)");

  const batch = db.transaction(() => {
    // WEEK 1-4 rotating program for tennis athlete/business owner
    const weeks = [1,2,3,4];
    weeks.forEach(w => {
      // 월요일: 상체 + 코어
      let pid = insPlan.run(1,w,'월','strength','💪 상체 + 코어','테니스 파워를 위한 상체 근력. 서브/스트로크 파워 향상',65,'moderate','가슴,어깨,삼두,코어',450).lastInsertRowid;
      insEx.run(pid,1,'다이나믹 스트레칭','warmup',1,'5분',null,300,0,null,'어깨 돌리기, 팔 스윙, 몸통 회전');
      insEx.run(pid,2,'푸시업 (Push-up)','strength',4,'12-15',null,null,60,'2-1-2','가슴 넓히기, 코어 긴장 유지');
      insEx.run(pid,3,'덤벨 숄더 프레스','strength',4,'10-12',null,null,60,'2-1-2','서브 파워의 기본');
      insEx.run(pid,4,'덤벨 로우','strength',4,'10-12',null,null,60,'2-1-2','백핸드 안정성');
      insEx.run(pid,5,'트라이셉스 딥스','strength',3,'12-15',null,null,45,null,'서브 팔로스루 강화');
      insEx.run(pid,6,'플랭크','core',3,'45-60초',null,60,30,null,'코어 안정성 — 모든 샷의 기반');
      insEx.run(pid,7,'러시안 트위스트','core',3,'20회 (좌우)',null,null,30,null,'회전력 강화 — 포핸드/백핸드');
      insEx.run(pid,8,'메디신볼 회전 던지기','power',3,'10회 (좌우)',null,null,45,null,'폭발적 회전력');
      insEx.run(pid,9,'쿨다운 스트레칭','cooldown',1,'5분',null,300,0,null,'어깨, 가슴, 삼두 스트레칭');

      // 화요일: 하체 + 민첩성
      pid = insPlan.run(1,w,'화','strength','🦵 하체 + 민첩성','코트 위 폭발적 움직임을 위한 하체 훈련',60,'hard','대퇴,둔근,종아리,민첩성',500).lastInsertRowid;
      insEx.run(pid,1,'조깅 + 다이나믹 스트레칭','warmup',1,'5분',null,300,0,null,'가벼운 조깅 후 하체 동적 스트레칭');
      insEx.run(pid,2,'스쿼트','strength',4,'12-15',null,null,60,'3-1-2','기본 하체 파워');
      insEx.run(pid,3,'런지 워크','strength',3,'12회 (좌우)',null,null,60,null,'한발 안정성 + 둔근');
      insEx.run(pid,4,'박스 점프','power',4,'8-10',null,null,60,null,'폭발적 점프력 — 서브 시 활용');
      insEx.run(pid,5,'래터럴 셔플','agility',4,'30초',null,30,30,null,'코트 좌우 이동 스피드');
      insEx.run(pid,6,'카프 레이즈','strength',3,'15-20',null,null,30,null,'스플릿 스텝 + 방향 전환');
      insEx.run(pid,7,'사이드 플랭크','core',3,'30초 (좌우)',null,30,20,null,'측면 안정성');
      insEx.run(pid,8,'래더 드릴','agility',3,'3세트',null,60,30,null,'빠른 발놀림');
      insEx.run(pid,9,'폼롤러 하체','cooldown',1,'5분',null,300,0,null,'대퇴, 종아리, IT밴드');

      // 수요일: 유산소 + 유연성
      pid = insPlan.run(1,w,'수','cardio','🏃 유산소 + 유연성','심폐 능력 향상 + 부상 방지 유연성',50,'moderate','심폐,유연성',350).lastInsertRowid;
      insEx.run(pid,1,'가벼운 조깅','warmup',1,'5분',null,300,0,null,'');
      insEx.run(pid,2,'인터벌 러닝','cardio',6,'30초 전력 / 60초 걷기',null,null,0,null,'HIIT — 경기 중 회복력');
      insEx.run(pid,3,'점프 로프','cardio',3,'2분',null,120,30,null,'발목 강화 + 리듬감');
      insEx.run(pid,4,'요가 — 전사 자세 시퀀스','flexibility',1,'10분',null,600,0,null,'전사1-2-3, 삼각, 반달');
      insEx.run(pid,5,'힙 오프너 스트레칭','flexibility',1,'5분',null,300,0,null,'비둘기 자세, 나비 자세');
      insEx.run(pid,6,'어깨 유연성','flexibility',1,'5분',null,300,0,null,'테니스 어깨 관리 필수');
      insEx.run(pid,7,'딥 브리딩 + 명상','mental',1,'5분',null,300,0,null,'멘탈 리셋');

      // 목요일: 상체 + 폭발력
      pid = insPlan.run(1,w,'목','strength','⚡ 상체 + 폭발력','서브/스매시 파워를 위한 폭발적 상체',60,'hard','어깨,등,이두,폭발력',480).lastInsertRowid;
      insEx.run(pid,1,'밴드 워밍업','warmup',1,'5분',null,300,0,null,'어깨 밴드 운동, 회전근개 활성화');
      insEx.run(pid,2,'풀업 (또는 어시스트)','strength',4,'6-10',null,null,90,null,'등 전체 + 그립 강화');
      insEx.run(pid,3,'메디신볼 오버헤드 슬램','power',4,'10',null,null,45,null,'서브 모션과 동일한 폭발력');
      insEx.run(pid,4,'덤벨 체스트 플라이','strength',3,'12',null,null,60,'3-1-2','가슴 스트레치 + 스트로크 범위');
      insEx.run(pid,5,'페이스 풀','strength',3,'15',null,null,45,null,'후면 어깨 — 어깨 부상 방지');
      insEx.run(pid,6,'바이셉 컬 + 해머 컬','strength',3,'10+10',null,null,45,null,'그립 강화');
      insEx.run(pid,7,'행잉 니레이즈','core',3,'12-15',null,null,45,null,'하복부 + 힙 플렉서');
      insEx.run(pid,8,'우드찹 (케이블/밴드)','power',3,'12 (좌우)',null,null,45,null,'회전 파워 — 포핸드 핵심');
      insEx.run(pid,9,'쿨다운','cooldown',1,'5분',null,300,0,null,'등, 어깨, 이두 스트레칭');

      // 금요일: 하체 + 코어 서킷
      pid = insPlan.run(1,w,'금','circuit','🔥 하체 + 코어 서킷','고강도 서킷으로 경기력 체력',55,'hard','전신,코어,지구력',520).lastInsertRowid;
      insEx.run(pid,1,'점핑잭 + 다이나믹 스트레칭','warmup',1,'5분',null,300,0,null,'');
      insEx.run(pid,2,'[서킷A] 고블릿 스쿼트','circuit',3,'12',null,null,15,null,'서킷 — 쉬지 않고 연속');
      insEx.run(pid,3,'[서킷A] 버피','circuit',3,'8',null,null,15,null,'전신 폭발력');
      insEx.run(pid,4,'[서킷A] 마운틴 클라이머','circuit',3,'20회',null,null,60,null,'코어 + 심폐');
      insEx.run(pid,5,'[서킷B] 불가리안 스플릿 스쿼트','circuit',3,'10 (좌우)',null,null,15,null,'한발 밸런스');
      insEx.run(pid,6,'[서킷B] 케틀벨 스윙','circuit',3,'15',null,null,15,null,'후방체인 폭발력');
      insEx.run(pid,7,'[서킷B] 바이시클 크런치','circuit',3,'20회',null,null,60,null,'복사근 + 회전');
      insEx.run(pid,8,'[보너스] 배틀로프','power',3,'30초',null,30,30,null,'그립 + 전신 컨디셔닝');
      insEx.run(pid,9,'쿨다운 + 폼롤러','cooldown',1,'7분',null,420,0,null,'전신 근막 이완');

      // 토요일: 테니스 + 가벼운 체력
      pid = insPlan.run(1,w,'토','sport','🎾 테니스 + 액티브 리커버리','테니스 실전 + 가벼운 체력 보조',90,'moderate','전신,테니스',600).lastInsertRowid;
      insEx.run(pid,1,'웜업 조깅 + 동적 스트레칭','warmup',1,'10분',null,600,0,null,'');
      insEx.run(pid,2,'테니스 연습/시합','sport',1,'60분',null,3600,0,null,'기술 훈련 또는 연습 시합');
      insEx.run(pid,3,'가벼운 코어 운동','core',2,'10회씩',null,null,30,null,'플랭크 30초 + 크런치 15개');
      insEx.run(pid,4,'스트레칭 + 아이싱','cooldown',1,'15분',null,900,0,null,'어깨, 팔꿈치, 무릎 관리');

      // 일요일: 완전 휴식
      pid = insPlan.run(1,w,'일','rest','😴 완전 휴식','몸과 마음의 회복. 산책, 가족 시간',30,'easy','회복',100).lastInsertRowid;
      insEx.run(pid,1,'가벼운 산책','recovery',1,'20-30분',null,1800,0,null,'자연 속 걷기, 가족과 함께');
      insEx.run(pid,2,'폼롤러 전신','recovery',1,'10분',null,600,0,null,'뭉친 근육 이완');
      insEx.run(pid,3,'명상 / 호흡','mental',1,'5분',null,300,0,null,'한 주 돌아보기, 다음 주 목표');
    });
  });
  batch();
}

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=? AND password=?").get(username, password);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, name: user.name }, SECRET, { expiresIn: '30d' });
  res.cookie('fit_token', token, { httpOnly: false, maxAge: 30*24*60*60*1000, path: '/' });
  res.json({ token, user: { id: user.id, name: user.name } });
});
function auth(req, res, next) {
  const token = req.cookies?.fit_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).json({ error: '토큰 만료' }); }
}
app.use('/api', (req, res, next) => { if (req.path === '/login') return next(); auth(req, res, next); });

// Profile
app.get('/api/profile', (req, res) => {
  const u = db.prepare("SELECT id,name,age,height_cm,weight_kg,goal,fitness_level,injuries FROM users WHERE id=?").get(req.user.id);
  res.json(u);
});
app.put('/api/profile', (req, res) => {
  const b = req.body;
  db.prepare("UPDATE users SET name=?,age=?,height_cm=?,weight_kg=?,goal=?,fitness_level=?,injuries=? WHERE id=?")
    .run(b.name,b.age,b.height_cm,b.weight_kg,b.goal,b.fitness_level,b.injuries,req.user.id);
  res.json({ message: 'Updated' });
});

// Workout Plans
app.get('/api/plans', (req, res) => {
  const { week } = req.query;
  let sql = "SELECT * FROM workout_plans WHERE user_id=?";
  const params = [req.user.id];
  if (week) { sql += " AND week_number=?"; params.push(week); }
  sql += " ORDER BY week_number, CASE day_of_week WHEN '월' THEN 1 WHEN '화' THEN 2 WHEN '수' THEN 3 WHEN '목' THEN 4 WHEN '금' THEN 5 WHEN '토' THEN 6 WHEN '일' THEN 7 END";
  const plans = db.prepare(sql).all(...params);
  plans.forEach(p => { p.exercises = db.prepare("SELECT * FROM exercises WHERE plan_id=? ORDER BY exercise_order").all(p.id); });
  res.json(plans);
});

app.get('/api/plans/:id', (req, res) => {
  const p = db.prepare("SELECT * FROM workout_plans WHERE id=?").get(req.params.id);
  if (p) p.exercises = db.prepare("SELECT * FROM exercises WHERE plan_id=? ORDER BY exercise_order").all(p.id);
  res.json(p);
});

// Today's workout
app.get('/api/plans/today', (req, res) => {
  const days = ['일','월','화','수','목','금','토'];
  const today = days[new Date().getDay()];
  const week = req.query.week || 1;
  const plan = db.prepare("SELECT * FROM workout_plans WHERE user_id=? AND week_number=? AND day_of_week=?").get(req.user.id, week, today);
  if (plan) plan.exercises = db.prepare("SELECT * FROM exercises WHERE plan_id=? ORDER BY exercise_order").all(plan.id);
  res.json(plan || { rest: true, day: today });
});

// Workout Logs
app.get('/api/logs', (req, res) => {
  res.json(db.prepare("SELECT * FROM workout_logs WHERE user_id=? ORDER BY log_date DESC LIMIT 50").all(req.user.id));
});
app.post('/api/logs', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO workout_logs (user_id,plan_id,log_date,workout_type,title,duration_min,calories_burned,energy_level,mood,notes,completed) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(req.user.id,b.plan_id,b.log_date,b.workout_type,b.title,b.duration_min,b.calories_burned,b.energy_level||3,b.mood||3,b.notes,b.completed??1);
  if (b.exercises?.length) {
    const insE = db.prepare("INSERT INTO exercise_logs (log_id,exercise_name,sets_done,reps_done,weight_kg,notes,pr_flag) VALUES (?,?,?,?,?,?,?)");
    b.exercises.forEach(e => insE.run(r.lastInsertRowid,e.exercise_name,e.sets_done,e.reps_done,e.weight_kg,e.notes,e.pr_flag||0));
  }
  res.json({ id: r.lastInsertRowid });
});

// Body Logs
app.get('/api/body', (req, res) => {
  res.json(db.prepare("SELECT * FROM body_logs WHERE user_id=? ORDER BY log_date DESC LIMIT 30").all(req.user.id));
});
app.post('/api/body', (req, res) => {
  const b = req.body;
  const r = db.prepare("INSERT INTO body_logs (user_id,log_date,weight_kg,body_fat_pct,muscle_mass,chest_cm,waist_cm,arm_cm,thigh_cm,notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(req.user.id,b.log_date,b.weight_kg,b.body_fat_pct,b.muscle_mass,b.chest_cm,b.waist_cm,b.arm_cm,b.thigh_cm,b.notes);
  res.json({ id: r.lastInsertRowid });
});

// Daily Habits
app.get('/api/habits', (req, res) => {
  res.json(db.prepare("SELECT * FROM daily_habits WHERE user_id=? ORDER BY log_date DESC LIMIT 30").all(req.user.id));
});
app.post('/api/habits', (req, res) => {
  const b = req.body;
  const existing = db.prepare("SELECT id FROM daily_habits WHERE user_id=? AND log_date=?").get(req.user.id, b.log_date);
  if (existing) {
    db.prepare("UPDATE daily_habits SET water_liters=?,sleep_hours=?,steps=?,protein_g=?,calories_intake=?,stretching=?,meditation=?,notes=? WHERE id=?")
      .run(b.water_liters,b.sleep_hours,b.steps,b.protein_g,b.calories_intake,b.stretching?1:0,b.meditation?1:0,b.notes,existing.id);
  } else {
    db.prepare("INSERT INTO daily_habits (user_id,log_date,water_liters,sleep_hours,steps,protein_g,calories_intake,stretching,meditation,notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(req.user.id,b.log_date,b.water_liters,b.sleep_hours,b.steps,b.protein_g,b.calories_intake,b.stretching?1:0,b.meditation?1:0,b.notes);
  }
  res.json({ message: 'Saved' });
});

// Dashboard stats
app.get('/api/dashboard', (req, res) => {
  const uid = req.user.id;
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const thisWeek = db.prepare("SELECT COUNT(*) as c FROM workout_logs WHERE user_id=? AND log_date >= date(?, '-7 days')").get(uid, today);
  const thisMonth = db.prepare("SELECT COUNT(*) as c FROM workout_logs WHERE user_id=? AND log_date >= date(?, '-30 days')").get(uid, today);
  const totalLogs = db.prepare("SELECT COUNT(*) as c FROM workout_logs WHERE user_id=?").get(uid);
  const streak = db.prepare("SELECT COUNT(DISTINCT log_date) as c FROM workout_logs WHERE user_id=? AND log_date >= date(?, '-7 days')").get(uid, today);
  const latestBody = db.prepare("SELECT * FROM body_logs WHERE user_id=? ORDER BY log_date DESC LIMIT 1").get(uid);
  const todayHabit = db.prepare("SELECT * FROM daily_habits WHERE user_id=? AND log_date=?").get(uid, today);
  const days = ['일','월','화','수','목','금','토'];
  const todayDay = days[new Date().getDay()];
  const todayPlan = db.prepare("SELECT * FROM workout_plans WHERE user_id=? AND week_number=1 AND day_of_week=?").get(uid, todayDay);
  if (todayPlan) todayPlan.exercises = db.prepare("SELECT * FROM exercises WHERE plan_id=? ORDER BY exercise_order").all(todayPlan.id);
  const todayCompleted = db.prepare("SELECT id FROM workout_logs WHERE user_id=? AND log_date=?").get(uid, today);
  res.json({ thisWeek: thisWeek.c, thisMonth: thisMonth.c, totalLogs: totalLogs.c, streak: streak.c, latestBody, todayHabit, todayPlan, todayCompleted: !!todayCompleted, today, todayDay });
});

// ====== 운동 수정/삭제 ======
app.put('/api/exercises/:id', (req, res) => {
  const { name, category, sets, reps, rest_sec, notes, weight_kg, duration_sec } = req.body;
  db.prepare("UPDATE exercises SET name=?,category=?,sets=?,reps=?,rest_sec=?,notes=?,weight_kg=?,duration_sec=? WHERE id=?")
    .run(name, category, sets, reps, rest_sec||0, notes, weight_kg, duration_sec, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/exercises/:id', (req, res) => {
  db.prepare("DELETE FROM exercises WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/exercises', (req, res) => {
  const { plan_id, name, category, sets, reps, rest_sec, notes, weight_kg, duration_sec } = req.body;
  const maxOrder = db.prepare("SELECT MAX(exercise_order) as m FROM exercises WHERE plan_id=?").get(plan_id);
  const r = db.prepare("INSERT INTO exercises (plan_id, exercise_order, name, category, sets, reps, rest_sec, notes, weight_kg, duration_sec) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(plan_id, (maxOrder?.m||0)+1, name, category||'strength', sets, reps, rest_sec||0, notes, weight_kg, duration_sec);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// ====== 식단 API ======
app.get('/api/meals', (req, res) => {
  const uid = req.user.id;
  const plans = db.prepare("SELECT * FROM meal_plans WHERE user_id=? ORDER BY CASE day_of_week WHEN '월' THEN 1 WHEN '화' THEN 2 WHEN '수' THEN 3 WHEN '목' THEN 4 WHEN '금' THEN 5 WHEN '토' THEN 6 WHEN '일' THEN 7 END").all(uid);
  plans.forEach(p => { try { p.meals = JSON.parse(p.meals); } catch(e) { p.meals = []; } });
  res.json(plans);
});

app.get('/api/meals/today', (req, res) => {
  const uid = req.user.id;
  const days = ['일','월','화','수','목','금','토'];
  const todayDay = days[new Date().getDay()];
  const plan = db.prepare("SELECT * FROM meal_plans WHERE user_id=? AND day_of_week=?").get(uid, todayDay);
  if (plan) { try { plan.meals = JSON.parse(plan.meals); } catch(e) { plan.meals = []; } }
  
  const logs = db.prepare("SELECT * FROM meal_logs WHERE user_id=? AND log_date=date('now') ORDER BY created_at").all(uid);
  res.json({ plan, logs, today: new Date(Date.now()+8*3600000).toISOString().split('T')[0], todayDay });
});

app.post('/api/meals/log', (req, res) => {
  const uid = req.user.id;
  const { meal_type, description, calories, protein, carbs, fat } = req.body;
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  db.prepare("INSERT INTO meal_logs (user_id, log_date, meal_type, description, calories, protein, carbs, fat) VALUES (?,?,?,?,?,?,?,?)")
    .run(uid, today, meal_type, description, calories||0, protein||0, carbs||0, fat||0);
  res.json({ ok: true });
});

app.delete('/api/meals/log/:id', (req, res) => {
  db.prepare("DELETE FROM meal_logs WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/meals/:id', (req, res) => {
  const { meals, total_calories, total_protein, total_carbs, total_fat, notes } = req.body;
  db.prepare("UPDATE meal_plans SET meals=?,total_calories=?,total_protein=?,total_carbs=?,total_fat=?,notes=? WHERE id=?")
    .run(JSON.stringify(meals), total_calories, total_protein, total_carbs, total_fat, notes, req.params.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Fitness Trainer on port ${PORT}`));
