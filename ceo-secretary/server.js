const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 6050;
const SECRET = 'ceo-secretary-2026';
const FINANCE_DB = path.join(__dirname, '../finance-manager/finance.db');
const STAFF_DB = path.join(__dirname, '../staff-manager/staff.db');
const CENTER_DB = path.join(__dirname, '../center-manager/center.db');
const FITNESS_DB = path.join(__dirname, '../fitness-crm/fitness.db');
const LESSON_DB = path.join(__dirname, '../lesson-manager/lesson.db');
const SHOP_DB = path.join(__dirname, '../shop-manager/shop.db');
const POS_DB = path.join(__dirname, '../pos-system/pos.db');
const SCHEDULE_DB = path.join(__dirname, '../schedule-manager/schedule.db');
const db = new Database(path.join(__dirname, 'ceo.db'));
db.pragma('journal_mode = WAL');


try {
  db.exec("CREATE TABLE IF NOT EXISTS voice_memos (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS manager_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, manager TEXT, business TEXT, content TEXT, date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS pipeline (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT, contact TEXT, stage TEXT DEFAULT 'lead', package TEXT, amount REAL DEFAULT 0, next_action TEXT, next_date TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, date TEXT, venue TEXT, packages_sold INTEGER DEFAULT 0, revenue REAL DEFAULT 0, note TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS uniform_tracker (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, company TEXT, contact TEXT, status TEXT, result TEXT, date TEXT, note TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS delegation (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, assignee TEXT, deadline TEXT, status TEXT DEFAULT 'pending', note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS weekly_wins (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, win1 TEXT, win2 TEXT, win3 TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS quarter_review (id INTEGER PRIMARY KEY AUTOINCREMENT, quarter TEXT, q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT, q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, biz TEXT, category TEXT, num INTEGER, title TEXT, progress INTEGER DEFAULT 0, note TEXT, priority INTEGER DEFAULT 0)");
  // archived 컬럼 (완료 후 숨김 처리용) — 이미 있으면 무시
  try { db.exec("ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT"); } catch(e) {}
  // 진척률 변경 이력 (주간 진척 집계용)
  db.exec("CREATE TABLE IF NOT EXISTS progress_history (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, old_progress INTEGER, new_progress INTEGER, changed_at TEXT DEFAULT (datetime('now','localtime')))");
  // 데일리 미션 (컨텍스트 기반 자동 생성)
  db.exec("CREATE TABLE IF NOT EXISTS daily_missions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, mission_key TEXT, title TEXT, detail TEXT, category TEXT, emoji TEXT, link TEXT, is_done INTEGER DEFAULT 0, done_at TEXT, sort_order INTEGER DEFAULT 0)");
  // Seed projects if empty
  if (db.prepare("SELECT COUNT(*) as c FROM projects").get().c === 0) {
    var ins = db.prepare("INSERT INTO projects (biz,category,num,title,priority) VALUES (?,?,?,?,?)");
    var data = [["피트니스", "시설개선", 1, "락커룸 리모델링", 1], ["피트니스", "시설개선", 2, "샤워실 개선", 1], ["피트니스", "시설개선", 5, "공조/환기 시스템 점검", 0], ["피트니스", "시설개선", 7, "운동기구 정기 점검 시스템", 1], ["피트니스", "회원관리", 16, "회원 관리 프로그램(CRM) 도입", 1], ["피트니스", "회원관리", 20, "자동 결제 시스템", 1], ["피트니스", "회원관리", 24, "신규 회원 온보딩 프로그램", 1], ["피트니스", "프로그램", 31, "PT 프로그램 다양화", 0], ["피트니스", "프로그램", 37, "복싱/킥복싱 클래스", 0], ["피트니스", "마케팅", 51, "인스타그램 마케팅 강화", 1], ["피트니스", "마케팅", 60, "체험권 마케팅", 1], ["피트니스", "부가매출", 71, "프로틴 보충제 판매", 0], ["피트니스", "부가매출", 76, "PT 패키지 상품화", 1], ["피트니스", "운영", 86, "트레이너 교육 프로그램", 1], ["피트니스", "운영", 95, "데이터 분석 대시보드", 0], ["센터", "코트시설", 1, "실내 코트 바닥재 교체", 1], ["센터", "코트시설", 2, "실내 코트 조명 LED 교체", 1], ["센터", "코트시설", 8, "볼머신 도입", 0], ["센터", "클럽하우스", 17, "회원 락커룸 전면 개선", 1], ["센터", "레슨", 26, "키즈 테니스 프로그램", 0], ["센터", "레슨", 31, "성인 비기너 클래스", 0], ["센터", "레슨", 36, "패밀리 레슨 패키지", 1], ["센터", "가족특화", 46, "패밀리 멤버십 등급", 1], ["센터", "대회", 59, "클럽 챔피언십", 1], ["센터", "레스토랑", 71, "레스토랑 컨셉 재정립", 0], ["센터", "레스토랑", 73, "전문 셰프 영입", 1], ["센터", "레스토랑", 76, "주말 패밀리 브런치", 0], ["센터", "카페", 83, "카페 컨셉 차별화", 0], ["센터", "멤버십", 92, "회원 전용 모바일 앱", 0], ["센터", "멤버십", 95, "리뉴얼 그랜드 오픈 행사", 1], ["샵", "매장", 1, "1층 매장 컨셉 정립", 1], ["샵", "매장", 4, "벽면 라켓 디스플레이 월", 0], ["샵", "용품", 16, "라켓 라인업 다변화", 0], ["샵", "용품", 22, "스트링 작업 서비스 시스템화", 1], ["샵", "유니폼", 33, "유니폼 브랜드 컨셉 개발", 1], ["샵", "유니폼", 35, "샘플 라인 개발", 1], ["샵", "유니폼", 37, "2층 유니폼 쇼룸 구성", 1], ["샵", "유니폼", 43, "클럽 유니폼 B2B 영업", 1], ["샵", "서비스", 51, "거트 교체 서비스 시스템화", 1], ["샵", "서비스", 54, "거트 정기 회원권", 0], ["샵", "멤버십", 65, "클럽 회원 자동 할인 연계", 0], ["샵", "마케팅", 73, "인스타그램 샵 계정 운영", 0], ["샵", "운영", 86, "POS 시스템 도입", 1], ["샵", "직원", 95, "샵 매니저 채용", 0]];
    data.forEach(function(p) { ins.run(p[0], p[1], p[2], p[3], p[4] || 0); });
  }
} catch(e) {}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// === DB Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, section TEXT, title TEXT, is_done INTEGER DEFAULT 0,
    done_at TEXT, sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, type TEXT, content TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS top10 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num INTEGER, action TEXT, deadline TEXT, owner TEXT,
    kpi TEXT, progress INTEGER DEFAULT 0, note TEXT, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS weekly_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week TEXT, item TEXT, is_done INTEGER DEFAULT 0, note TEXT
  );
  CREATE TABLE IF NOT EXISTS self_check (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, question TEXT, answer TEXT
  );
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT, business TEXT, target REAL DEFAULT 0
  );
`);

// Seed Top 10
if (false && db.prepare("SELECT COUNT(*) as c FROM top10").get().c === 0) {
  const ins = db.prepare("INSERT INTO top10 (num,action,deadline,owner,kpi) VALUES (?,?,?,?,?)");
  [
    [1,'유니폼 사업 매니저 채용','Week 2','사장님','9월 말 채용 완료'],
    [2,'대회 패키지 4종 출시','Week 1','센터 매니저','Standard 가격 200만 적용'],
    [3,'기업 멤버십 영업자료 제작','Week 1','사장님 + 외주','PT 자료 3개 언어'],
    [4,'유니폼 시장조사 30곳 인터뷰','Week 1~3','유니폼 매니저','응답 30건'],
    [5,'디월트 정리 일정 확정','Week 2','샵 직원','재고 처분 + 전환'],
    [6,'F&B 메뉴 리뉴얼','Week 2~4','식당 매니저','10종 + 점심 직장인'],
    [7,'휘트니스 PT 트레이너 추가 채용','Month 2','휘트니스 매니저','트레이너 2~3명'],
    [8,"자체 대회 'Hawaii Championship' 기획",'Month 2~3','사장님 + 매니저','시즌 1 기획서'],
    [9,'기업 멤버십 5개사 계약','Month 2~3','사장님 + 영업','Bronze·Silver 5건'],
    [10,'분기별 점검 시스템 구축','Week 3','사장님','월간 KPI 회의 정착']
  ].forEach(t => ins.run(...t));
}

// === Auth (admin only) ===
function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ','') || req.cookies?.ceo_token;
  if (!t) return res.status(401).json({error:'Login required'});
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({error:'Session expired'}); }
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== 'hawaii100') return res.status(401).json({error:'비밀번호 오류'});
  const token = jwt.sign({role:'ceo',name:'안재성'}, SECRET, {expiresIn:'30d'});
  res.cookie('ceo_token', token, {httpOnly:false, maxAge:30*24*60*60*1000, path:'/', sameSite:'lax'});
  res.json({token, user:{name:'안재성',role:'ceo'}});
});

// === 오늘 체크리스트 ===
app.get('/api/today', auth, (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  let items = db.prepare("SELECT * FROM daily_checklist WHERE date=? ORDER BY sort_order,id").all(date);
  if (!items.length) {
    // 자동 생성
    const templates = [
      {s:'morning',t:'어제 매출 입력 (3개 사업부)',o:1},
      {s:'morning',t:'어제 KPI 확인 + 빨간불 체크',o:2},
      {s:'morning',t:'오늘 1순위 액션 1개 결정',o:3},
      {s:'morning',t:'어제 미완료 액션 1개 처리 결정',o:4},
      {s:'afternoon',t:'Top 10 우선순위 중 1개 진행',o:5},
      {s:'afternoon',t:'매니저들과 짧은 점검 (각자 5분)',o:6},
      {s:'evening',t:'오늘 진행 상황 기록',o:7},
      {s:'evening',t:'매니저별 보고 사항 확인',o:8},
      {s:'evening',t:'내일 1순위 정하기',o:9},
      {s:'evening',t:'머릿속 걱정·생각 다 적기',o:10}
    ];
    const ins = db.prepare("INSERT INTO daily_checklist (date,section,title,sort_order) VALUES (?,?,?,?)");
    templates.forEach(t => ins.run(date, t.s, t.t, t.o));
    items = db.prepare("SELECT * FROM daily_checklist WHERE date=? ORDER BY sort_order,id").all(date);
  }
  const notes = db.prepare("SELECT * FROM daily_notes WHERE date=? ORDER BY id").all(date);

  // === 자동 체크 로직 ===
  try {
    var yesterday = new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});

    // 1. 어제 매출이 재무DB에 있으면 → "어제 매출 입력" 자동 체크
    if (fs.existsSync(FINANCE_DB)) {
      var fdb = new Database(FINANCE_DB, {readonly:true});
      var yesterdaySales = fdb.prepare("SELECT COUNT(*) as c FROM transactions WHERE transaction_date=?").get(yesterday);
      fdb.close();
      if (yesterdaySales && yesterdaySales.c > 0) {
        items.forEach(function(item) {
          if (!item.is_done && item.title.indexOf('매출') >= 0 && item.section === 'morning') {
            db.prepare("UPDATE daily_checklist SET is_done=1, done_at=? WHERE id=?").run('auto', item.id);
            item.is_done = 1; item.done_at = 'auto';
          }
        });
      }
    }

    // 2. 오늘 1순위를 적었으면 → "1순위 액션" 자동 체크
    var hasPriority = notes.find(function(n) { return n.type === 'priority' && n.content && n.content.trim().length > 0; });
    if (hasPriority) {
      items.forEach(function(item) {
        if (!item.is_done && item.title.indexOf('1순위') >= 0 && item.section === 'morning') {
          db.prepare("UPDATE daily_checklist SET is_done=1, done_at=? WHERE id=?").run('auto', item.id);
          item.is_done = 1; item.done_at = 'auto';
        }
      });
    }

    // 3. 내일 1순위를 적었으면 → 저녁 "내일 1순위" 자동 체크
    var hasTomorrow = notes.find(function(n) { return n.type === 'tomorrow' && n.content && n.content.trim().length > 0; });
    if (hasTomorrow) {
      items.forEach(function(item) {
        if (!item.is_done && item.title.indexOf('내일') >= 0 && item.section === 'evening') {
          db.prepare("UPDATE daily_checklist SET is_done=1, done_at=? WHERE id=?").run('auto', item.id);
          item.is_done = 1; item.done_at = 'auto';
        }
      });
    }

    // 4. 머릿속 비우기를 적었으면 → 자동 체크
    var hasBrain = notes.find(function(n) { return n.type === 'brain' && n.content && n.content.trim().length > 0; });
    if (hasBrain) {
      items.forEach(function(item) {
        if (!item.is_done && (item.title.indexOf('머릿속') >= 0 || item.title.indexOf('걱정') >= 0) && item.section === 'evening') {
          db.prepare("UPDATE daily_checklist SET is_done=1, done_at=? WHERE id=?").run('auto', item.id);
          item.is_done = 1; item.done_at = 'auto';
        }
      });
    }

    // 5. 오늘 진행 상황 기록했으면 → 자동 체크
    var hasAnyNote = notes.length > 0;
    if (hasAnyNote) {
      items.forEach(function(item) {
        if (!item.is_done && item.title.indexOf('진행 상황') >= 0 && item.section === 'evening') {
          db.prepare("UPDATE daily_checklist SET is_done=1, done_at=? WHERE id=?").run('auto', item.id);
          item.is_done = 1; item.done_at = 'auto';
        }
      });
    }
  } catch(autoErr) { /* 자동 체크 실패해도 무시 */ }

  res.json({items, notes, date});
});


// 체크리스트 항목 수정
app.put('/api/today/:id/edit', auth, (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({error:'제목 필요'});
  db.prepare("UPDATE daily_checklist SET title=? WHERE id=?").run(title, +req.params.id);
  res.json({ok:true});
});
app.put('/api/today/:id/toggle', auth, (req, res) => {
  const item = db.prepare("SELECT * FROM daily_checklist WHERE id=?").get(+req.params.id);
  if (!item) return res.status(404).json({error:'없음'});
  const now = item.is_done ? null : new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("UPDATE daily_checklist SET is_done=?,done_at=? WHERE id=?").run(item.is_done?0:1, now, item.id);
  res.json({ok:true});
});

// 머릿속 비우기 → voice_memos 동기화 (같은 날 1개만 유지)
function syncBrainToMemo(type, content, date) {
  if (type !== 'brain' || !content || !content.trim()) return;
  const prefix = '[머릿속 ' + date + ']';
  const memoContent = prefix + '\n' + content.trim();
  const existing = db.prepare("SELECT id FROM voice_memos WHERE content LIKE ?").get(prefix + '%');
  if (existing) {
    db.prepare("UPDATE voice_memos SET content=? WHERE id=?").run(memoContent, existing.id);
  } else {
    db.prepare("INSERT INTO voice_memos (content) VALUES (?)").run(memoContent);
  }
}

app.post('/api/today/note', auth, (req, res) => {
  const { type, content, date } = req.body;
  const d = date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const result = db.prepare("INSERT INTO daily_notes (date,type,content) VALUES (?,?,?)").run(d, type, content);
  syncBrainToMemo(type, content, d);
  // 머릿속은 메모로 이동했으니 daily_notes 내용 비우기
  if (type === 'brain' && content && content.trim()) {
    db.prepare("UPDATE daily_notes SET content='' WHERE id=?").run(result.lastInsertRowid);
  }
  res.json({ok:true});
});

app.put('/api/today/note/:id', auth, (req, res) => {
  const id = +req.params.id;
  db.prepare("UPDATE daily_notes SET content=? WHERE id=?").run(req.body.content, id);
  const note = db.prepare("SELECT type, date FROM daily_notes WHERE id=?").get(id);
  if (note) {
    syncBrainToMemo(note.type, req.body.content, note.date);
    if (note.type === 'brain' && req.body.content && req.body.content.trim()) {
      db.prepare("UPDATE daily_notes SET content='' WHERE id=?").run(id);
    }
  }
  res.json({ok:true});
});

// === Top 10 ===
app.get('/api/top10', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM top10 WHERE is_active=1 ORDER BY num").all());
});

app.put('/api/top10/:id', auth, (req, res) => {
  const { progress, note, action, deadline, owner, kpi } = req.body;
  if (progress !== undefined) db.prepare("UPDATE top10 SET progress=? WHERE id=?").run(progress, +req.params.id);
  if (note !== undefined) db.prepare("UPDATE top10 SET note=? WHERE id=?").run(note, +req.params.id);
  if (req.body.is_active !== undefined) db.prepare("UPDATE top10 SET is_active=? WHERE id=?").run(req.body.is_active, +req.params.id);
  if (action) db.prepare("UPDATE top10 SET action=?,deadline=?,owner=?,kpi=? WHERE id=?").run(action, deadline, owner, kpi, +req.params.id);
  res.json({ok:true});
});

app.post('/api/top10', auth, (req, res) => {
  const { action, deadline, owner, kpi } = req.body;
  const maxNum = db.prepare("SELECT MAX(num) as m FROM top10").get().m || 0;
  db.prepare("INSERT INTO top10 (num,action,deadline,owner,kpi) VALUES (?,?,?,?,?)").run(maxNum+1, action, deadline, owner, kpi);
  res.json({ok:true});
});

// === 자가 점검 ===
app.get('/api/self-check', auth, (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  let items = db.prepare("SELECT * FROM self_check WHERE date=? ORDER BY id").all(date);
  if (!items.length) {
    const qs = ['어제 잘 잤나요? (6시간 이상)','어제 가족과 1시간 이상 보냈나요?','이번 주 운동 1번 이상 했나요?','머리가 너무 복잡해서 잠 못 잤나요?','주말에 쉬었나요?'];
    const ins = db.prepare("INSERT INTO self_check (date,question) VALUES (?,?)");
    qs.forEach(q => ins.run(date, q));
    items = db.prepare("SELECT * FROM self_check WHERE date=? ORDER BY id").all(date);
  }
  res.json(items);
});

app.put('/api/self-check/:id', auth, (req, res) => {
  db.prepare("UPDATE self_check SET answer=? WHERE id=?").run(req.body.answer, +req.params.id);
  res.json({ok:true});
});

// === 재무 데이터 (finance DB에서 읽기) ===
app.get('/api/finance-summary', auth, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json({});
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const month = today.slice(0,7);
    const yesterday = new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});

    const todaySales = fdb.prepare("SELECT b.name,SUM(t.amount) as total FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.type='income' AND t.transaction_date=? GROUP BY b.name").all(today);
    const yesterdaySales = fdb.prepare("SELECT b.name,SUM(t.amount) as total FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.type='income' AND t.transaction_date=? GROUP BY b.name").all(yesterday);
    const monthSales = fdb.prepare("SELECT b.name,SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) as income,SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) as expense FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.transaction_date LIKE ? GROUP BY b.name").all(month+'%');
    const monthly = fdb.prepare("SELECT strftime('%Y-%m',transaction_date) as m,type,SUM(amount) as total FROM transactions WHERE transaction_date>='2026-01-01' GROUP BY m,type ORDER BY m").all();
    const yearTotal = fdb.prepare("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income FROM transactions WHERE transaction_date>='2026-01-01'").get();

    // 지난주 평균 매출
    const weekAgo = new Date(Date.now()-7*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const weekAvg = fdb.prepare("SELECT AVG(daily) as avg FROM (SELECT transaction_date,SUM(amount) as daily FROM transactions WHERE type='income' AND transaction_date>=? AND transaction_date<? GROUP BY transaction_date)").get(weekAgo, today);

    fdb.close();
    res.json({today:todaySales, yesterday:yesterdaySales, month:monthSales, monthly, yearIncome:yearTotal?.income||0, weekAvg:weekAvg?.avg||0, todayDate:today});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// === 목표 ===
app.get('/api/goals', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM goals ORDER BY month DESC").all());
});
app.post('/api/goals', auth, (req, res) => {
  const { month, business, target } = req.body;
  const ex = db.prepare("SELECT id FROM goals WHERE month=? AND business=?").get(month, business);
  if (ex) db.prepare("UPDATE goals SET target=? WHERE id=?").run(target, ex.id);
  else db.prepare("INSERT INTO goals (month,business,target) VALUES (?,?,?)").run(month, business, target);
  res.json({ok:true});
});

// === 음성 메모 (텍스트) ===
app.get('/api/memos', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM voice_memos ORDER BY id DESC LIMIT 50").all());
});
app.post('/api/memos', auth, (req, res) => {
  db.prepare("INSERT INTO voice_memos (content) VALUES (?)").run(req.body.content);
  res.json({ok:true});
});
app.delete('/api/memos/:id', auth, (req, res) => {
  db.prepare("DELETE FROM voice_memos WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 매니저 보고 ===
app.get('/api/reports', auth, (req, res) => {
  let q = "SELECT * FROM manager_reports WHERE 1=1"; const p = [];
  if (req.query.date) { q += " AND date=?"; p.push(req.query.date); }
  res.json(db.prepare(q + " ORDER BY date DESC,id DESC LIMIT 30").all(...p));
});
app.post('/api/reports', auth, (req, res) => {
  const { manager, business, content } = req.body;
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("INSERT INTO manager_reports (manager,business,content,date) VALUES (?,?,?,?)").run(manager, business, content, today);
  res.json({ok:true});
});

// === 고객 파이프라인 ===
app.get('/api/pipeline', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM pipeline ORDER BY CASE stage WHEN 'contract' THEN 4 WHEN 'proposal' THEN 3 WHEN 'meeting' THEN 2 ELSE 1 END DESC, id DESC").all());
});
app.post('/api/pipeline', auth, (req, res) => {
  const { company, contact, stage, package: pkg, amount, next_action, next_date, note } = req.body;
  db.prepare("INSERT INTO pipeline (company,contact,stage,package,amount,next_action,next_date,note) VALUES (?,?,?,?,?,?,?,?)").run(company, contact, stage||'lead', pkg, amount||0, next_action, next_date, note);
  res.json({ok:true});
});
app.put('/api/pipeline/:id', auth, (req, res) => {
  const { company, contact, stage, package: pkg, amount, next_action, next_date, note } = req.body;
  db.prepare("UPDATE pipeline SET company=?,contact=?,stage=?,package=?,amount=?,next_action=?,next_date=?,note=? WHERE id=?").run(company, contact, stage, pkg, amount, next_action, next_date, note, +req.params.id);
  res.json({ok:true});
});
app.delete('/api/pipeline/:id', auth, (req, res) => {
  db.prepare("DELETE FROM pipeline WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 대회 관리 ===
app.get('/api/events', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM events ORDER BY date DESC").all());
});
app.post('/api/events', auth, (req, res) => {
  const { name, date, venue, packages_sold, revenue, note } = req.body;
  db.prepare("INSERT INTO events (name,date,venue,packages_sold,revenue,note) VALUES (?,?,?,?,?,?)").run(name, date, venue, packages_sold||0, revenue||0, note);
  res.json({ok:true});
});
app.put('/api/events/:id', auth, (req, res) => {
  const { name, date, venue, packages_sold, revenue, note } = req.body;
  db.prepare("UPDATE events SET name=?,date=?,venue=?,packages_sold=?,revenue=?,note=? WHERE id=?").run(name, date, venue, packages_sold, revenue, note, +req.params.id);
  res.json({ok:true});
});

// === 유니폼 트래커 ===
app.get('/api/uniform', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM uniform_tracker ORDER BY date DESC,id DESC").all());
});
app.post('/api/uniform', auth, (req, res) => {
  const { type, company, contact, status, result, date, note } = req.body;
  db.prepare("INSERT INTO uniform_tracker (type,company,contact,status,result,date,note) VALUES (?,?,?,?,?,?,?)").run(type, company, contact, status, result, date, note);
  res.json({ok:true});
});
app.put('/api/uniform/:id', auth, (req, res) => {
  const { status, result, note } = req.body;
  db.prepare("UPDATE uniform_tracker SET status=?,result=?,note=? WHERE id=?").run(status, result, note, +req.params.id);
  res.json({ok:true});
});

// === 위임 보드 ===
app.get('/api/delegation', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM delegation ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'progress' THEN 2 ELSE 3 END, deadline").all());
});
app.post('/api/delegation', auth, (req, res) => {
  const { task, assignee, deadline, note } = req.body;
  db.prepare("INSERT INTO delegation (task,assignee,deadline,note) VALUES (?,?,?,?)").run(task, assignee, deadline, note);
  res.json({ok:true});
});
app.put('/api/delegation/:id', auth, (req, res) => {
  const { status, note } = req.body;
  if (status) db.prepare("UPDATE delegation SET status=? WHERE id=?").run(status, +req.params.id);
  if (note !== undefined) db.prepare("UPDATE delegation SET note=? WHERE id=?").run(note, +req.params.id);
  res.json({ok:true});
});
app.delete('/api/delegation/:id', auth, (req, res) => {
  db.prepare("DELETE FROM delegation WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 주간 승리 ===
app.get('/api/wins', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM weekly_wins ORDER BY week DESC LIMIT 12").all());
});
app.post('/api/wins', auth, (req, res) => {
  const { week, win1, win2, win3 } = req.body;
  const ex = db.prepare("SELECT id FROM weekly_wins WHERE week=?").get(week);
  if (ex) db.prepare("UPDATE weekly_wins SET win1=?,win2=?,win3=? WHERE id=?").run(win1, win2, win3, ex.id);
  else db.prepare("INSERT INTO weekly_wins (week,win1,win2,win3) VALUES (?,?,?,?)").run(week, win1, win2, win3);
  res.json({ok:true});
});

// === 분기 점검 ===
app.get('/api/quarter', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM quarter_review ORDER BY quarter DESC LIMIT 4").all());
});
app.post('/api/quarter', auth, (req, res) => {
  const b = req.body;
  const ex = db.prepare("SELECT id FROM quarter_review WHERE quarter=?").get(b.quarter);
  if (ex) db.prepare("UPDATE quarter_review SET q1=?,q2=?,q3=?,q4=?,q5=?,q6=?,q7=?,q8=?,q9=?,q10=? WHERE id=?").run(b.q1,b.q2,b.q3,b.q4,b.q5,b.q6,b.q7,b.q8,b.q9,b.q10,ex.id);
  else db.prepare("INSERT INTO quarter_review (quarter,q1,q2,q3,q4,q5,q6,q7,q8,q9,q10) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(b.quarter,b.q1,b.q2,b.q3,b.q4,b.q5,b.q6,b.q7,b.q8,b.q9,b.q10);
  res.json({ok:true});
});

// === AI 경영 분석 ===
app.get('/api/ai-analysis', auth, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json({alerts:[],tips:[]});
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const yesterday = new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const weekAgo = new Date(Date.now()-7*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const month = today.slice(0,7);
    const lastMonth = new Date(Date.now()-30*86400000).toISOString().slice(0,7);

    const alerts = [];
    const tips = [];

    // 어제 매출 vs 지난주 평균
    const yesterdayTotal = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date=?").get(yesterday);
    const weekAvg = fdb.prepare("SELECT AVG(daily) as avg FROM (SELECT SUM(amount) as daily FROM transactions WHERE type='income' AND transaction_date>=? AND transaction_date<? GROUP BY transaction_date)").get(weekAgo, today);
    if (yesterdayTotal?.t && weekAvg?.avg && yesterdayTotal.t < weekAvg.avg * 0.7) {
      alerts.push({type:'danger',msg:'어제 매출 '+Math.round(yesterdayTotal.t/1000000)+'백만₮ — 지난주 평균 대비 '+ Math.round(yesterdayTotal.t/weekAvg.avg*100)+'%. 원인 확인 필요'});
    } else if (yesterdayTotal?.t && weekAvg?.avg && yesterdayTotal.t > weekAvg.avg * 1.3) {
      tips.push({type:'success',msg:'어제 매출 호조! 지난주 평균 대비 '+Math.round(yesterdayTotal.t/weekAvg.avg*100)+'%. 무엇이 효과적이었는지 기록하세요'});
    }

    // 이번달 vs 지난달 비교
    const thisMonthIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date LIKE ?").get(month+'%');
    const lastMonthIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date LIKE ?").get(lastMonth+'%');
    if (thisMonthIncome?.t && lastMonthIncome?.t) {
      const growth = Math.round((thisMonthIncome.t / lastMonthIncome.t - 1) * 100);
      if (growth > 10) tips.push({type:'success',msg:'이번달 매출 전월 대비 +'+growth+'% 성장 중!'});
      else if (growth < -10) alerts.push({type:'warning',msg:'이번달 매출 전월 대비 '+growth+'%. 영업 활동 강화 필요'});
    }

    // 사업부별 이번달 점검
    const bizMonth = fdb.prepare("SELECT b.name,SUM(t.amount) as total FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.type='income' AND t.transaction_date LIKE ? GROUP BY b.name").all(month+'%');
    bizMonth.forEach(b => {
      if (b.total < 10000000) alerts.push({type:'warning',msg:b.name+' 이번달 매출 '+Math.round(b.total/1000000)+'백만₮. 목표 대비 점검 필요'});
    });

    // 100억 페이스 체크
    const yearIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date>='2026-01-01'").get();
    const dayOfYear = Math.ceil((new Date() - new Date('2026-01-01')) / 86400000);
    const pace = yearIncome?.t ? Math.round(yearIncome.t / dayOfYear * 365) : 0;
    if (pace > 0) {
      const monthsTo100 = Math.round((10000000000 - (yearIncome?.t||0)) / (yearIncome.t / dayOfYear * 30));
      tips.push({type:'info',msg:'현재 속도: 연 '+Math.round(pace/100000000)+'억₮ 페이스. 100억까지 약 '+monthsTo100+'개월 예상'});
    }

    // 명언
    const quotes = [
      '오늘 90분이 3년을 만듭니다.',
      '위임은 선택이 아니라 필수입니다.',
      '70% 일관성이 30% 완벽함보다 강합니다.',
      '매출은 5배 되지만 일은 10배가 됩니다. 시스템을 만드세요.',
      '사장님이 망가지면 사업도 망가집니다. 쉬세요.',
      '100억은 매일 한 작은 행동의 누적입니다.',
      '머릿속에 일을 담지 마세요. 다 적어두면 지워집니다.',
      '하루 빠져도 다음 날 시작하면 됩니다.',
      '직원에게 위임 = 회사 자산 만들기',
      '번아웃은 모든 사업의 적입니다.'
    ];
    const quote = quotes[new Date().getDate() % quotes.length];

    fdb.close();
    res.json({alerts, tips, quote, pace, yearIncome: yearIncome?.t||0});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// === 100억 카운트다운 ===
app.get('/api/countdown', auth, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json({});
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const yearIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date>='2026-01-01'").get();
    const total = yearIncome?.t || 0;
    const remaining = 10000000000 - total;
    const dayOfYear = Math.ceil((new Date() - new Date('2026-01-01')) / 86400000);
    const dailyAvg = total / Math.max(dayOfYear, 1);
    const daysRemaining = remaining > 0 ? Math.ceil(remaining / dailyAvg) : 0;
    const monthsRemaining = Math.round(daysRemaining / 30);
    const pct = Math.round(total / 10000000000 * 1000) / 10;
    fdb.close();
    res.json({total, remaining, pct, dailyAvg: Math.round(dailyAvg), daysRemaining, monthsRemaining});
  } catch(e) { res.status(500).json({error:e.message}); }
});


// === 통합 대시보드 (모든 DB 연결) ===
app.get('/api/integrated', auth, (req, res) => {
  var data = {};
  try {
    // 피트니스 회원
    if (fs.existsSync(FITNESS_DB)) {
      var fdb = new Database(FITNESS_DB, {readonly:true});
      data.fitnessMembers = fdb.prepare("SELECT COUNT(*) as c FROM members").get().c;
      data.fitnessMemberships = fdb.prepare("SELECT COUNT(*) as c FROM memberships WHERE status='active' OR end_date >= date('now')").get().c;
      fdb.close();
    }
  } catch(e) { data.fitnessError = e.message; }

  try {
    // 센터 예약
    if (fs.existsSync(CENTER_DB)) {
      var cdb = new Database(CENTER_DB, {readonly:true});
      var today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
      data.centerBookingsToday = cdb.prepare("SELECT COUNT(*) as c FROM bookings WHERE date=?").get(today).c;
      data.centerBookingsTotal = cdb.prepare("SELECT COUNT(*) as c FROM bookings").get().c;
      data.centerFacilities = cdb.prepare("SELECT COUNT(*) as c FROM facilities").get().c;
      cdb.close();
    }
  } catch(e) { data.centerError = e.message; }

  try {
    // 레슨
    if (fs.existsSync(LESSON_DB)) {
      var ldb = new Database(LESSON_DB, {readonly:true});
      data.lessonStudents = ldb.prepare("SELECT COUNT(*) as c FROM students").get().c;
      data.lessonPrograms = ldb.prepare("SELECT COUNT(*) as c FROM programs").get().c;
      data.lessonSessions = ldb.prepare("SELECT COUNT(*) as c FROM sessions").get().c;
      ldb.close();
    }
  } catch(e) { data.lessonError = e.message; }

  try {
    // 직원
    if (fs.existsSync(STAFF_DB)) {
      var sdb = new Database(STAFF_DB, {readonly:true});
      data.staffTotal = sdb.prepare("SELECT COUNT(*) as c FROM staff WHERE is_active=1").get().c;
      data.staffByBiz = sdb.prepare("SELECT business, COUNT(*) as c FROM staff WHERE is_active=1 GROUP BY business").all();
      sdb.close();
    }
  } catch(e) { data.staffError = e.message; }

  try {
    // 샵
    if (fs.existsSync(SHOP_DB)) {
      var shdb = new Database(SHOP_DB, {readonly:true});
      data.shopProducts = shdb.prepare("SELECT COUNT(*) as c FROM products").get().c;
      data.shopSales = shdb.prepare("SELECT COUNT(*) as c FROM sales").get().c;
      data.shopOrders = shdb.prepare("SELECT COUNT(*) as c FROM orders_kr").get().c;
      data.shopParts = shdb.prepare("SELECT COUNT(*) as c FROM parts").get().c;
      shdb.close();
    }
  } catch(e) { data.shopError = e.message; }

  try {
    // 스케줄
    if (fs.existsSync(SCHEDULE_DB)) {
      var scdb = new Database(SCHEDULE_DB, {readonly:true});
      var today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
      data.scheduleEventsToday = scdb.prepare("SELECT COUNT(*) as c FROM events WHERE date=?").get(today).c;
      data.scheduleGoals = scdb.prepare("SELECT COUNT(*) as c FROM goals").get().c;
      data.scheduleMilestones = scdb.prepare("SELECT COUNT(*) as c FROM milestones").get().c;
      scdb.close();
    }
  } catch(e) { data.scheduleError = e.message; }

  try {
    // 재무 요약
    if (fs.existsSync(FINANCE_DB)) {
      var fdb = new Database(FINANCE_DB, {readonly:true});
      var today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
      var month = today.slice(0,7);
      data.financeToday = fdb.prepare("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE transaction_date=?").get(today);
      data.financeMonth = fdb.prepare("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE transaction_date LIKE ?").get(month+'%');
      data.financeYear = fdb.prepare("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income FROM transactions WHERE transaction_date>='2026-01-01'").get();
      fdb.close();
    }
  } catch(e) { data.financeError = e.message; }

  res.json(data);
});


// === 스마트 비서 (사장님 관리) ===
app.get('/api/smart-brief', auth, (req, res) => {
  var today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  var now = new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  var hour = parseInt(now.slice(11,13));
  var dayOfWeek = new Date().getDay(); // 0=일, 1=월

  var greeting = '';
  if (hour < 12) greeting = '좋은 아침입니다, 사장님! ☀️';
  else if (hour < 18) greeting = '사장님, 오후도 파이팅! 💪';
  else greeting = '오늘 하루 고생하셨습니다 🌙';

  var urgent = []; // 긴급
  var todo = []; // 오늘 할 일
  var remind = []; // 리마인더
  var coach = []; // 코칭

  // 1. 오늘 체크리스트 미완료
  var checklist = db.prepare("SELECT * FROM daily_checklist WHERE date=? AND is_done=0").all(today);
  if (checklist.length > 0) {
    if (hour >= 10 && hour < 12) todo.push('아침 루틴 ' + checklist.filter(function(c){return c.section==='morning'}).length + '개 남았어요. 지금 하세요!');
    if (hour >= 14 && hour < 16) todo.push('점심 후 루틴 할 시간이에요. Top 10 중 1개 진행하세요!');
    if (hour >= 18) todo.push('퇴근 전 마감 루틴 ' + checklist.filter(function(c){return c.section==='evening'}).length + '개 남았어요. 머릿속 비우고 퇴근하세요!');
  }

  // 2. 1순위 액션 체크
  var priority = db.prepare("SELECT * FROM daily_notes WHERE date=? AND type='priority'").get(today);
  if (!priority) urgent.push('오늘 1순위 액션을 아직 안 정했어요! 지금 정하세요.');
  else if (priority.content) todo.push('오늘 1순위: ' + priority.content);

  // 3. Top 10 진행률 체크
  var top10 = db.prepare("SELECT * FROM top10 WHERE is_active=1").all();
  var lowProgress = top10.filter(function(t){return t.progress < 25});
  if (lowProgress.length > 0) remind.push('Top 10 중 ' + lowProgress.length + '개가 25% 미만이에요: ' + lowProgress.map(function(t){return '#'+t.num}).join(', '));
  var avgProgress = top10.length ? Math.round(top10.reduce(function(s,t){return s+t.progress},0)/top10.length) : 0;
  if (avgProgress >= 70) coach.push('Top 10 평균 ' + avgProgress + '%! 잘 가고 있어요! 🎉');

  // 4. 위임 마감 체크
  var overdue = db.prepare("SELECT * FROM delegation WHERE status='pending' AND deadline < ?").all(today);
  if (overdue.length > 0) urgent.push('위임 업무 ' + overdue.length + '개 마감 지남! ' + overdue.map(function(d){return d.assignee+':'+d.task}).join(', '));
  var dueSoon = db.prepare("SELECT * FROM delegation WHERE status='pending' AND deadline >= ? AND deadline <= ?").all(today, new Date(Date.now()+3*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'}));
  if (dueSoon.length > 0) remind.push('위임 업무 ' + dueSoon.length + '개 3일 내 마감: ' + dueSoon.map(function(d){return d.assignee}).join(', '));

  // 5. 파이프라인 팔로업
  var pipelineFollow = db.prepare("SELECT * FROM pipeline WHERE next_date <= ? AND stage != 'contract'").all(today);
  if (pipelineFollow.length > 0) todo.push('영업 팔로업 ' + pipelineFollow.length + '건: ' + pipelineFollow.map(function(p){return p.company}).join(', '));

  // 6. 매출 분석 (재무 DB)
  try {
    if (fs.existsSync(FINANCE_DB)) {
      var fdb = new Database(FINANCE_DB, {readonly:true});
      var yesterday = new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
      var weekAgo = new Date(Date.now()-7*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});

      var yTotal = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date=?").get(yesterday);
      var wAvg = fdb.prepare("SELECT AVG(d) as avg FROM (SELECT SUM(amount) as d FROM transactions WHERE type='income' AND transaction_date>=? AND transaction_date<? GROUP BY transaction_date)").get(weekAgo, today);

      if (yTotal && yTotal.t && wAvg && wAvg.avg) {
        var ratio = Math.round(yTotal.t / wAvg.avg * 100);
        if (ratio < 70) urgent.push('어제 매출 ' + Math.round(yTotal.t/1000000) + '백만₮ (평균 대비 ' + ratio + '%). 원인 파악 필요!');
        else if (ratio > 130) coach.push('어제 매출 호조! 평균 대비 ' + ratio + '%. 뭐가 효과적이었는지 기록하세요 📝');
      }

      // 100억 페이스
      var yearIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date>='2026-01-01'").get();
      var total = yearIncome ? yearIncome.t : 0;
      var dayOfYear = Math.ceil((new Date() - new Date('2026-01-01')) / 86400000);
      var pace = total / Math.max(dayOfYear,1) * 365;
      if (pace < 5000000000) coach.push('현재 연매출 페이스: ' + Math.round(pace/100000000) + '억₮. 100억 달성을 위해 신사업(유니폼/멤버십) 가속이 필요해요!');
      else if (pace >= 8000000000) coach.push('현재 페이스 ' + Math.round(pace/100000000) + '억₮! 이대로면 100억 가능합니다! 🚀');

      // 이번달 목표 대비
      var month = today.slice(0,7);
      var monthIncome = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date LIKE ?").get(month+'%');
      var dayOfMonth = parseInt(today.slice(8,10));
      if (monthIncome && monthIncome.t) {
        var monthPace = monthIncome.t / dayOfMonth * 30;
        remind.push('이번달 예상 매출: ' + Math.round(monthPace/1000000) + '백만₮ (현재 ' + Math.round(monthIncome.t/1000000) + '백만₮)');
      }

      fdb.close();
    }
  } catch(e) {}

  // 7. 월요일 주간점검
  if (dayOfWeek === 1) urgent.push('오늘은 월요일! 주간 점검 30분 하세요. [주간] 탭으로 가세요.');

  // 8. 자가점검 리마인더
  var selfCheck = db.prepare("SELECT * FROM self_check WHERE date=? AND answer IS NULL").all(today);
  if (selfCheck.length > 0 && hour >= 20) remind.push('오늘 자가 점검을 아직 안 했어요. 건강이 100억의 기반입니다!');

  // 9. 코칭 메시지
  var quotes = [
    '하루 90분만 100억 작업에 쓰세요. 나머지는 본업과 휴식.',
    '위임은 선택이 아니라 필수입니다. 매니저를 믿으세요.',
    '머릿속에 담지 마세요. 다 적어두면 머리에서 사라집니다.',
    '70% 일관성이 30% 완벽함보다 강합니다.',
    '사장님이 직접 할 일 5가지만 집중하세요.',
    '이번 주 1순위 1개만 끝내면 성공입니다.',
    '매주 월요일 30분 점검 = 100억 가는 가장 강력한 습관.',
    '번아웃은 모든 사업의 적입니다. 주말에 쉬세요.',
    '100억은 매일 한 작은 행동의 누적입니다.',
    '덜 일하면서 100억 가는 시스템을 만드세요.'
  ];
  var quote = quotes[new Date().getDate() % quotes.length];

  // 10. 100억 로드맵 단계 알림
  var monthNum = (new Date().getFullYear() - 2026) * 12 + new Date().getMonth() + 1;
  var roadmap = '';
  if (monthNum <= 3) roadmap = '현재 Phase: 기반 다지기 (Month 1~3). 유니폼 매니저 채용 + 패키지 검증 + 멤버십 시작';
  else if (monthNum <= 6) roadmap = '현재 Phase: 유니폼 본격화 (Month 4~6). 유니폼 사업 시작 + 멤버십 15개사 목표';
  else if (monthNum <= 9) roadmap = '현재 Phase: 브랜드 확장 (Month 7~9). 자체 브랜드 + Pro Shop 정착';
  else if (monthNum <= 12) roadmap = '현재 Phase: 도매·온라인 (Month 10~12). 도매 확장 + 2호점 입지 결정';

  res.json({
    greeting: greeting,
    urgent: urgent,
    todo: todo,
    remind: remind,
    coach: coach,
    quote: quote,
    roadmap: roadmap,
    hour: hour,
    today: today
  });
});


// === 프로젝트 100 ===
app.get('/api/projects', auth, (req, res) => {
  let q = "SELECT * FROM projects WHERE 1=1"; const p = [];
  // 기본: 진행 중만 (archived=0). ?archived=1 → 완료만, ?archived=all → 전부
  if (req.query.archived === '1') q += " AND archived=1";
  else if (req.query.archived !== 'all') q += " AND COALESCE(archived,0)=0";
  if (req.query.biz) { q += " AND biz=?"; p.push(req.query.biz); }
  if (req.query.category) { q += " AND category=?"; p.push(req.query.category); }
  res.json(db.prepare(q + " ORDER BY priority DESC, num").all(...p));
});

app.put('/api/projects/:id', auth, (req, res) => {
  const { progress, note, priority, archived } = req.body;
  const id = +req.params.id;
  if (progress !== undefined) {
    const cur = db.prepare("SELECT progress, archived FROM projects WHERE id=?").get(id);
    const oldP = cur ? cur.progress : 0;
    if (oldP !== progress) {
      db.prepare("INSERT INTO progress_history (project_id, old_progress, new_progress) VALUES (?,?,?)").run(id, oldP, progress);
    }
    db.prepare("UPDATE projects SET progress=? WHERE id=?").run(progress, id);
    // 100% 도달 시 자동 아카이브
    if (progress >= 100 && cur && !cur.archived) {
      db.prepare("UPDATE projects SET archived=1, archived_at=datetime('now','localtime') WHERE id=?").run(id);
    }
    // 100% 미만으로 되돌리면 아카이브 해제
    if (progress < 100 && cur && cur.archived) {
      db.prepare("UPDATE projects SET archived=0, archived_at=NULL WHERE id=?").run(id);
    }
  }
  if (note !== undefined) db.prepare("UPDATE projects SET note=? WHERE id=?").run(note, id);
  if (priority !== undefined) db.prepare("UPDATE projects SET priority=? WHERE id=?").run(priority, id);
  if (archived !== undefined) {
    db.prepare("UPDATE projects SET archived=?, archived_at=? WHERE id=?").run(archived?1:0, archived?new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'}):null, id);
  }
  res.json({ok:true});
});

app.post('/api/projects', auth, (req, res) => {
  const { biz, category, title, priority } = req.body;
  const maxNum = db.prepare("SELECT MAX(num) as m FROM projects WHERE biz=?").get(biz);
  db.prepare("INSERT INTO projects (biz,category,num,title,priority) VALUES (?,?,?,?,?)").run(biz, category||'기타', (maxNum?.m||0)+1, title, priority||0);
  res.json({ok:true});
});

app.delete('/api/projects/:id', auth, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

app.get('/api/projects/summary', auth, (req, res) => {
  // 전체 통계 (완료 포함) — 진척률 의미 보존
  const summary = db.prepare(`SELECT biz,
    COUNT(*) as total,
    SUM(CASE WHEN progress >= 100 THEN 1 ELSE 0 END) as done,
    SUM(CASE WHEN COALESCE(archived,0)=0 THEN 1 ELSE 0 END) as active,
    AVG(progress) as avg
    FROM projects GROUP BY biz`).all();
  res.json(summary);
});

// === 주간 진척 ===
app.get('/api/projects/weekly', auth, (req, res) => {
  // 이번주 월요일 00:00 (Asia/Ulaanbaatar 기준)
  const now = new Date();
  const tzOffset = 8 * 60; // UTC+8 (분 단위)
  const local = new Date(now.getTime() + (tzOffset - now.getTimezoneOffset()) * 60000);
  const dow = local.getDay() || 7; // 일=0→7
  const monday = new Date(local);
  monday.setDate(local.getDate() - (dow - 1));
  monday.setHours(0, 0, 0, 0);
  const weekStart = monday.toISOString().slice(0, 19).replace('T', ' ');

  // 이번주 진척 변동량 (프로젝트별 최신값 - 주 시작 직전값)
  const weekly = db.prepare(`
    SELECT p.id, p.biz, p.category, p.title, p.priority, p.progress as cur,
      COALESCE((SELECT new_progress FROM progress_history
                WHERE project_id=p.id AND changed_at < ?
                ORDER BY changed_at DESC LIMIT 1), 0) as week_start_progress
    FROM projects p
    WHERE EXISTS (SELECT 1 FROM progress_history h WHERE h.project_id=p.id AND h.changed_at >= ?)
    ORDER BY (p.progress - COALESCE((SELECT new_progress FROM progress_history
                WHERE project_id=p.id AND changed_at < ?
                ORDER BY changed_at DESC LIMIT 1), 0)) DESC
  `).all(weekStart, weekStart, weekStart);

  const movers = weekly.map(r => ({
    id: r.id, biz: r.biz, category: r.category, title: r.title, priority: r.priority,
    from: r.week_start_progress, to: r.cur, delta: r.cur - r.week_start_progress
  })).filter(m => m.delta !== 0);

  // 이번주 신규 완료
  const newDone = db.prepare(`
    SELECT p.id, p.biz, p.category, p.title, p.archived_at
    FROM projects p
    WHERE p.archived=1 AND p.archived_at >= ?
    ORDER BY p.archived_at DESC
  `).all(weekStart);

  // 사업부별 이번주 진척 합산
  const byBiz = {};
  movers.forEach(m => {
    if (!byBiz[m.biz]) byBiz[m.biz] = { biz: m.biz, total_delta: 0, count: 0 };
    byBiz[m.biz].total_delta += m.delta;
    byBiz[m.biz].count += 1;
  });

  res.json({
    week_start: weekStart,
    movers: movers.slice(0, 20),
    new_done: newDone,
    by_biz: Object.values(byBiz),
    summary: {
      total_movers: movers.length,
      total_delta: movers.reduce((s, m) => s + m.delta, 0),
      new_completed: newDone.length
    }
  });
});


// === 데일리 미션 (컨텍스트 기반 자동 생성) ===
function ensureTodayMissions(date) {
  const existing = db.prepare("SELECT COUNT(*) as c FROM daily_missions WHERE date=?").get(date);
  if (existing.c > 0) return;

  const missions = [];
  const dt = new Date(date + 'T00:00:00');
  const dow = dt.getDay();
  const hour = new Date().getHours();

  try {
    // 1. 오늘 1순위 비어있으면
    const todayNotes = db.prepare("SELECT * FROM daily_notes WHERE date=?").all(date);
    const hasPriority = todayNotes.find(n => n.type === 'priority' && n.content && n.content.trim());
    if (!hasPriority) {
      missions.push({key:'set_priority', title:'오늘 가장 중요한 1가지 정하기', detail:'아직 오늘 1순위가 비어있음', category:'집중', emoji:'🎯', link:'todo'});
    }

    // 2. 어제 미완료 체크리스트
    const yesterday = new Date(dt.getTime() - 86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
    const yUndone = db.prepare("SELECT COUNT(*) as c FROM daily_checklist WHERE date=? AND is_done=0").get(yesterday);
    if (yUndone && yUndone.c > 0) {
      missions.push({key:'rollover_checklist', title:'어제 미완료 ' + yUndone.c + '개 중 1개라도 처리', detail:'롤오버: 어제 ' + yUndone.c + '개 미완료', category:'루틴', emoji:'📋', link:'todo'});
    }

    // 3. 우선순위 1 + progress=0 프로젝트
    const stuckCnt = db.prepare("SELECT COUNT(*) as c FROM projects WHERE priority=1 AND progress=0 AND COALESCE(archived,0)=0").get();
    if (stuckCnt && stuckCnt.c > 0) {
      const sample = db.prepare("SELECT title, biz FROM projects WHERE priority=1 AND progress=0 AND COALESCE(archived,0)=0 ORDER BY RANDOM() LIMIT 1").get();
      missions.push({key:'progress_priority_pj', title:'우선순위 1 프로젝트 1개 진척', detail:'예: [' + sample.biz + '] ' + sample.title, category:'프로젝트', emoji:'🚀', link:'proj'});
    }

    // 4. 위임 미처리
    const pendD = db.prepare("SELECT COUNT(*) as c FROM delegation WHERE status='pending'").get();
    if (pendD && pendD.c > 0) {
      missions.push({key:'check_delegation', title:'위임 ' + pendD.c + '건 점검', detail:'1건이라도 마감 처리하기', category:'위임', emoji:'👥', link:'team'});
    }

    // 5. 어제 매출 0인 사업부
    if (fs.existsSync(FINANCE_DB)) {
      try {
        const fdb = new Database(FINANCE_DB, {readonly:true});
        const ySales = fdb.prepare("SELECT b.name FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.type='income' AND t.transaction_date=? GROUP BY b.name").all(yesterday);
        const allBiz = fdb.prepare("SELECT name FROM businesses").all();
        fdb.close();
        const haveSet = new Set(ySales.map(s => s.name));
        const zeroBiz = allBiz.filter(b => !haveSet.has(b.name)).map(b => b.name);
        if (zeroBiz.length > 0 && zeroBiz.length < allBiz.length) {
          missions.push({key:'check_zero_biz', title:'어제 매출 0인 사업부 점검', detail:zeroBiz.join(', ') + ' — 매니저 통화 또는 입력 누락 확인', category:'매출', emoji:'💰', link:'money'});
        }
      } catch(e) {}
    }

    // 6. 요일별
    if (dow === 1) {
      missions.push({key:'weekly_plan', title:'이번주 1순위 액션 1개 정하기', detail:'월요일 = 주간 계획 수립의 날', category:'주간', emoji:'📅', link:'todo'});
    } else if (dow === 5) {
      missions.push({key:'weekly_review', title:'이번주 한 일 5개 적기', detail:'금요일 = 주간 회고의 날', category:'주간', emoji:'✍️', link:'memo'});
    } else if (dow === 0) {
      missions.push({key:'next_week_prep', title:'다음주 1순위 미리 정하기', detail:'일요일 = 다음주 준비의 날', category:'주간', emoji:'🌅', link:'todo'});
    }

    // 7. 머릿속 비우기 (저녁 18시 이후이고 오늘 brain 메모 없으면)
    if (hour >= 18) {
      const todayBM = db.prepare("SELECT COUNT(*) as c FROM voice_memos WHERE content LIKE ?").get('[머릿속 ' + date + ']%');
      if (!todayBM || todayBM.c === 0) {
        missions.push({key:'brain_dump', title:'오늘 머릿속에 있는 거 다 적기', detail:'걱정·아이디어·할일 다 쏟아내기', category:'리플렉션', emoji:'🧠', link:'todo'});
      }
    }

    // 8. 100억 페이스 부족
    if (fs.existsSync(FINANCE_DB)) {
      try {
        const fdb = new Database(FINANCE_DB, {readonly:true});
        const year = date.slice(0,4);
        const yi = fdb.prepare("SELECT SUM(amount) as t FROM transactions WHERE type='income' AND transaction_date LIKE ?").get(year + '%');
        fdb.close();
        const monthsPassed = Math.max(1, new Date().getMonth() + 1);
        const pace = (yi && yi.t ? yi.t : 0) / monthsPassed * 12;
        if (pace < 5000000000) {
          missions.push({key:'accelerate', title:'신사업 가속 액션 1개 (유니폼/멤버십/B2B)', detail:'현재 페이스 ' + Math.round(pace/100000000) + '억₮ — 100억까지 가속 필요', category:'100억', emoji:'🚀', link:'todo'});
        }
      } catch(e) {}
    }

    // 9. 목표(top10) 비어있으면
    const topCnt = db.prepare("SELECT COUNT(*) as c FROM top10 WHERE is_active=1").get();
    if (!topCnt || topCnt.c === 0) {
      missions.push({key:'add_goal', title:'내 목표 1개 추가하기', detail:'아직 등록된 목표가 없음', category:'목표', emoji:'⭐', link:'todo'});
    }

  } catch(err) { console.error('mission gen error:', err); }

  if (missions.length === 0) {
    missions.push({key:'default_focus', title:'오늘 1가지에만 집중하기', detail:'쉬어가는 날도 좋은 날입니다', category:'집중', emoji:'🎯', link:'todo'});
  }
  const final = missions.slice(0, 5);
  const ins = db.prepare("INSERT INTO daily_missions (date, mission_key, title, detail, category, emoji, link, sort_order) VALUES (?,?,?,?,?,?,?,?)");
  final.forEach((m, idx) => ins.run(date, m.key, m.title, m.detail || '', m.category, m.emoji, m.link || '', idx));
}

app.get('/api/missions', auth, (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  ensureTodayMissions(date);
  const missions = db.prepare("SELECT * FROM daily_missions WHERE date=? ORDER BY sort_order").all(date);
  const done = missions.filter(m => m.is_done).length;
  res.json({date, missions, summary:{total:missions.length, done, pct:missions.length?Math.round(done/missions.length*100):0}});
});

app.put('/api/missions/:id/toggle', auth, (req, res) => {
  const m = db.prepare("SELECT * FROM daily_missions WHERE id=?").get(+req.params.id);
  if (!m) return res.status(404).json({error:'없음'});
  const now = m.is_done ? null : new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("UPDATE daily_missions SET is_done=?, done_at=? WHERE id=?").run(m.is_done?0:1, now, m.id);
  res.json({ok:true});
});

// 미션 강제 재생성 (오늘 미션 다 지우고 다시)
app.post('/api/missions/regenerate', auth, (req, res) => {
  const date = req.body.date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("DELETE FROM daily_missions WHERE date=?").run(date);
  ensureTodayMissions(date);
  res.json({ok:true});
});

// === 자동 미션 생성 스케줄러 (서버 시작 + 매시간 체크) ===
function autoGenerateMissions() {
  try {
    const date = new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Ulaanbaatar'});
    const exist = db.prepare("SELECT COUNT(*) as c FROM daily_missions WHERE date=?").get(date);
    if (exist.c === 0) {
      ensureTodayMissions(date);
      const ts = new Date().toLocaleString('sv-SE', {timeZone:'Asia/Ulaanbaatar'});
      console.log('[Mission Auto-Gen] ' + date + ' generated at ' + ts);
    }
  } catch(e) { console.error('[Mission Auto-Gen] error:', e.message); }
}
setTimeout(autoGenerateMissions, 5000);            // 서버 시작 5초 후 (DB 준비 보장)
setInterval(autoGenerateMissions, 60 * 60 * 1000); // 매시간 체크 (자정 넘어가면 다음 시간에 생성)


app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log('[CEO Secretary] port ' + PORT));
