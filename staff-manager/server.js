require("dotenv").config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const bcrypt = require('bcryptjs');

const app = express();
const PORT = 6010;
const SECRET = process.env.STAFF_MGR_SECRET || 'staff-mgr-2026-secret';
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

function todayKST() {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

// Schema - only if file exists (DB already created)
try {
  const schema = fs.readFileSync(path.join(__dirname, 'staff_schema.sql'), 'utf8');
  schema.split(';').filter(s => s.trim()).forEach(s => { try { db.exec(s); } catch(e) {} });
} catch(e) { /* DB already initialized */ }

// Auth
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.staff_token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch(e) { res.status(401).json({ error: '세션 만료' }); }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const pwMatch = user.password.startsWith('$2') ? bcrypt.compareSync(password, user.password) : (user.password === password);
  if (!pwMatch) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, staff_id: user.staff_id }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, staff_id: user.staff_id } });
});

// 업무보고 (work reports) - PIN 인증, 관리자 auth 거치지 않음
const createReportRoutes = require('./report-routes');
app.use('/api/reports', createReportRoutes(db));

app.use('/api', auth);

// ====== STAFF ======
// 매니저 사업장 조회 (auth 통과한 user의 staff_id로 본인 사업장)
function getMyBusiness(req) {
  if (!req.user || !req.user.staff_id) return null;
  const me = db.prepare("SELECT business FROM staff WHERE id=?").get(req.user.staff_id);
  return me ? me.business : null;
}

app.get('/api/staff', (req, res) => {
  let { business } = req.query;
  // 매니저는 본인 사업장으로 강제 필터
  if (req.user.role === 'manager') {
    business = getMyBusiness(req) || business;
  }
  let sql = "SELECT * FROM staff WHERE is_active=1";
  const params = [];
  if (business) { sql += " AND business=?"; params.push(business); }
  sql += " ORDER BY business, role DESC, name";
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/staff', (req, res) => {
  const { name, name_mn, role, position, business, phone, work_days, salary } = req.body;
  const r = db.prepare("INSERT INTO staff (name, name_mn, role, position, business, phone, work_days, salary) VALUES (?,?,?,?,?,?,?,?)")
    .run(name, name_mn, role, position, business, phone, work_days || '월,화,수,목,금,토');
  // Auto-create user account
  const uname = name.replace(/\s/g, '').toLowerCase();
  const tempPw = String(Math.floor(Math.random()*9000)+1000);
  try {
    db.prepare("INSERT INTO users (username, password, name, role, staff_id) VALUES (?,?,?,?,?)")
      .run(uname, bcrypt.hashSync(tempPw, 10), name, 'staff', r.lastInsertRowid);
  } catch(e) {}
  console.log(`[auto-user] ${uname} / temp password: ${tempPw}`);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/staff/:id', (req, res) => {
  const target = db.prepare("SELECT * FROM staff WHERE id=?").get(req.params.id);
  if (!target) return res.status(404).json({ error: 'not_found' });

  const isAdmin = req.user.role === 'admin';
  const isManager = req.user.role === 'manager';
  if (!isAdmin && !isManager) return res.status(403).json({ error: 'forbidden' });

  // 매니저는 본인 사업장 직원만 수정 가능
  if (isManager) {
    const myBiz = getMyBusiness(req);
    if (!myBiz || target.business !== myBiz) return res.status(403).json({ error: 'forbidden_business' });
  }

  const { name, name_mn, role, position, business, phone, work_days, work_start, work_end, salary } = req.body;
  // 매니저는 민감 필드(role, business, salary)를 변경할 수 없음 — 기존 값 유지
  const finalRole     = isAdmin ? role     : target.role;
  const finalBusiness = isAdmin ? business : target.business;
  const finalSalary   = isAdmin ? salary   : target.salary;

  db.prepare("UPDATE staff SET name=?,name_mn=?,role=?,position=?,business=?,phone=?,work_days=?,work_start=?,work_end=?,salary=? WHERE id=?")
    .run(name ?? target.name, name_mn ?? target.name_mn, finalRole, position ?? target.position, finalBusiness,
         phone ?? target.phone, work_days ?? target.work_days, work_start || target.work_start || '09:00',
         work_end || target.work_end || '18:00', finalSalary, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/staff/:id', (req, res) => {
  db.prepare("UPDATE staff SET is_active=0 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ====== DAILY TASKS ======
const dayNames = ['일','월','화','수','목','금','토'];

// 오늘 업무 자동 생성
app.post('/api/tasks/generate', (req, res) => {
  const today = req.body.date || todayKST();
  const dayOfWeek = dayNames[new Date(today+'T00:00:00+09:00').getDay()];
  
  // 이미 생성됐으면 스킵
  const existing = db.prepare("SELECT COUNT(*) as cnt FROM daily_tasks WHERE task_date=?").get(today).cnt;
  if (existing > 0) return res.json({ message: '이미 생성됨', count: existing });
  
  const templates = db.prepare("SELECT * FROM task_templates WHERE is_active=1").all();
  const staff = db.prepare("SELECT * FROM staff WHERE is_active=1").all();
  
  let count = 0;
  for (const tmpl of templates) {
    // 해당 사업장 + 포지션 직원 찾기
    const assigned = staff.filter(s => {
      if (s.business !== tmpl.business) return false;
      if (tmpl.position && s.position !== tmpl.position) return false;
      if (s.work_days && !s.work_days.includes(dayOfWeek)) return false;
      return true;
    });
    
    if (assigned.length === 0) {
      // 사업장 책임자(매니저/총매니저/대표)에게 fallback, 없으면 사업장의 아무 활성 직원
      const mgr = staff.find(s => s.business === tmpl.business && ['매니저','총매니저','대표'].includes(s.role))
               || staff.find(s => s.business === tmpl.business);
      if (mgr) {
        db.prepare("INSERT INTO daily_tasks (task_date, staff_id, template_id, title, description, business) VALUES (?,?,?,?,?,?)")
          .run(today, mgr.id, tmpl.id, tmpl.title, tmpl.description, tmpl.business);
        count++;
      }
    } else {
      for (const s of assigned) {
        db.prepare("INSERT INTO daily_tasks (task_date, staff_id, template_id, title, description, business) VALUES (?,?,?,?,?,?)")
          .run(today, s.id, tmpl.id, tmpl.title, tmpl.description, tmpl.business);
        count++;
      }
    }
  }
  
  res.json({ message: `${count}건 생성`, count });
});

// 업무 조회 (하루 또는 기간)
app.get('/api/tasks', (req, res) => {
  const { date, date_from, date_to, business, staff_id, status } = req.query;
  let sql = "SELECT dt.*, s.name as staff_name, s.business as staff_biz FROM daily_tasks dt LEFT JOIN staff s ON dt.staff_id=s.id WHERE 1=1";
  const params = [];
  if (date_from && date_to) {
    sql += " AND dt.task_date BETWEEN ? AND ?"; params.push(date_from, date_to);
  } else {
    const d = date || todayKST();
    sql += " AND dt.task_date=?"; params.push(d);
  }
  if (business) { sql += " AND dt.business=?"; params.push(business); }
  if (staff_id) { sql += " AND dt.staff_id=?"; params.push(staff_id); }
  if (status) { sql += " AND dt.status=?"; params.push(status); }
  sql += " ORDER BY dt.task_date, dt.business, s.name, dt.id";
  res.json(db.prepare(sql).all(...params));
});

// 주간 업무 자동 생성
app.post('/api/tasks/generate-week', (req, res) => {
  const startDate = req.body.start || todayKST();
  const start = new Date(startDate + 'T00:00:00+09:00');
  let totalCount = 0;
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = dayNames[d.getDay()];
    
    const existing = db.prepare("SELECT COUNT(*) as cnt FROM daily_tasks WHERE task_date=?").get(dateStr).cnt;
    if (existing > 0) continue;
    
    const templates = db.prepare("SELECT * FROM task_templates WHERE is_active=1").all();
    const staff = db.prepare("SELECT * FROM staff WHERE is_active=1").all();
    
    for (const tmpl of templates) {
      const assigned = staff.filter(s => {
        if (s.business !== tmpl.business) return false;
        if (tmpl.position && s.position !== tmpl.position) return false;
        if (s.work_days && !s.work_days.includes(dayOfWeek)) return false;
        return true;
      });
      
      if (assigned.length === 0) {
        const mgr = staff.find(s => s.business === tmpl.business && (s.role === '매니저' || s.role === '총매니저'));
        if (mgr) {
          db.prepare("INSERT INTO daily_tasks (task_date, staff_id, template_id, title, description, business) VALUES (?,?,?,?,?,?)")
            .run(dateStr, mgr.id, tmpl.id, tmpl.title, tmpl.description, tmpl.business);
          totalCount++;
        }
      } else {
        for (const s of assigned) {
          db.prepare("INSERT INTO daily_tasks (task_date, staff_id, template_id, title, description, business) VALUES (?,?,?,?,?,?)")
            .run(dateStr, s.id, tmpl.id, tmpl.title, tmpl.description, tmpl.business);
          totalCount++;
        }
      }
    }
  }
  
  res.json({ message: `${totalCount}건 생성`, count: totalCount });
});

// 업무 상태/내용 업데이트 (부분 업데이트)
app.put('/api/tasks/:id', (req, res) => {
  const allowed = ['status', 'notes', 'title', 'description', 'business', 'staff_id', 'task_date'];
  const fields = []; const vals = [];
  for (const k of allowed) if (k in req.body) { fields.push(k + '=?'); vals.push(req.body[k]); }
  if (req.body.status === 'done') fields.push("completed_at=datetime('now')");
  else if (req.body.status && req.body.status !== 'done') fields.push("completed_at=NULL");
  if (!fields.length) return res.status(400).json({ error: 'no_changes' });
  vals.push(req.params.id);
  const r = db.prepare("UPDATE daily_tasks SET " + fields.join(', ') + " WHERE id=?").run(...vals);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// 업무 삭제 (수동 + 자동생성 모두)
app.delete('/api/tasks/:id', (req, res) => {
  const r = db.prepare("DELETE FROM daily_tasks WHERE id=?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// 특별 업무 추가
app.post('/api/tasks', (req, res) => {
  const { task_date, staff_id, title, description, business, priority } = req.body;
  const r = db.prepare("INSERT INTO daily_tasks (task_date, staff_id, title, description, business) VALUES (?,?,?,?,?)")
    .run(task_date || todayKST(), staff_id, title, description, business);
  res.json({ id: r.lastInsertRowid });
});

// ====== DASHBOARD (대표용) ======
app.get('/api/dashboard', (req, res) => {
  const today = todayKST();
  
  const totalStaff = db.prepare("SELECT COUNT(*) as cnt FROM staff WHERE is_active=1").get().cnt;
  const todayTasks = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done FROM daily_tasks WHERE task_date=?").get(today);
  
  // 사업장별 진행률
  const byBusiness = db.prepare(`
    SELECT dt.business, COUNT(*) as total, SUM(CASE WHEN dt.status='done' THEN 1 ELSE 0 END) as done
    FROM daily_tasks dt WHERE dt.task_date=? GROUP BY dt.business
  `).all(today);
  
  // 직원별 진행률
  const byStaff = db.prepare(`
    SELECT s.name, s.business, COUNT(*) as total, SUM(CASE WHEN dt.status='done' THEN 1 ELSE 0 END) as done
    FROM daily_tasks dt JOIN staff s ON dt.staff_id=s.id WHERE dt.task_date=? GROUP BY dt.staff_id ORDER BY s.business, s.name
  `).all(today);
  
  // 미완료 업무
  const pending = db.prepare(`
    SELECT dt.*, s.name as staff_name FROM daily_tasks dt LEFT JOIN staff s ON dt.staff_id=s.id
    WHERE dt.task_date=? AND dt.status='pending' ORDER BY dt.business
  `).all(today);
  
  res.json({ totalStaff, todayTasks, byBusiness, byStaff, pending });
});

// ====== REPORT ======
app.get('/api/report', (req, res) => {
  const { from, to } = req.query;
  const f = from || new Date(Date.now() + 9*3600000 - 7*86400000).toISOString().slice(0,10);
  const t = to || todayKST();
  
  const daily = db.prepare(`
    SELECT task_date, COUNT(*) as total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done
    FROM daily_tasks WHERE task_date BETWEEN ? AND ? GROUP BY task_date ORDER BY task_date
  `).all(f, t);
  
  const staffPerf = db.prepare(`
    SELECT s.name, s.business, COUNT(*) as total, SUM(CASE WHEN dt.status='done' THEN 1 ELSE 0 END) as done,
      ROUND(100.0 * SUM(CASE WHEN dt.status='done' THEN 1 ELSE 0 END) / COUNT(*), 0) as rate
    FROM daily_tasks dt JOIN staff s ON dt.staff_id=s.id WHERE dt.task_date BETWEEN ? AND ?
    GROUP BY dt.staff_id ORDER BY rate DESC
  `).all(f, t);
  
  res.json({ daily, staffPerf });
});

// ====== 계정 관리 ======
// 관리자: 직원 계정 조회/수정
app.get('/api/accounts', (req, res) => {
  res.json(db.prepare("SELECT u.id, u.username, u.name, u.role, u.staff_id, s.business FROM users u LEFT JOIN staff s ON u.staff_id=s.id ORDER BY s.business, u.name").all());
});

app.put('/api/accounts/:id', (req, res) => {
  const { username, password, name } = req.body;
  if (username) {
    const dup = db.prepare("SELECT id FROM users WHERE username=? AND id!=?").get(username, req.params.id);
    if (dup) return res.status(400).json({ error: '이미 사용 중인 아이디입니다' });
    db.prepare("UPDATE users SET username=? WHERE id=?").run(username, req.params.id);
  }
  if (password) db.prepare("UPDATE users SET password=? WHERE id=?").run(bcrypt.hashSync(password, 10), req.params.id);
  if (name) db.prepare("UPDATE users SET name=? WHERE id=?").run(name, req.params.id);
  res.json({ ok: true });
});

// 본인 정보 조회 (이름/전화 등)
app.get('/api/my-account', (req, res) => {
  const user = db.prepare("SELECT id, username, name, role, staff_id FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  let staff = null;
  if (user.staff_id) {
    staff = db.prepare("SELECT id, name, name_mn, phone, business, position FROM staff WHERE id=?").get(user.staff_id);
  }
  res.json({ user, staff });
});

// 본인 정보 변경 (비밀번호 + 이름/몽골어이름/전화)
app.put('/api/my-account', (req, res) => {
  const { password, new_password, name, name_mn, phone } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  // 비밀번호 변경은 현재 비밀번호 확인 필수
  if (new_password !== undefined && new_password !== '') {
    const curMatch = user.password.startsWith('$2') ? bcrypt.compareSync(password || '', user.password) : (user.password === password);
    if (!curMatch) return res.status(400).json({ error: '현재 비밀번호가 틀립니다' });
    db.prepare("UPDATE users SET password=? WHERE id=?").run(bcrypt.hashSync(new_password, 10), req.user.id);
  }

  // 이름/전화는 staff 테이블 업데이트, users.name도 같이 sync
  if (user.staff_id && (name !== undefined || name_mn !== undefined || phone !== undefined)) {
    const s = db.prepare("SELECT * FROM staff WHERE id=?").get(user.staff_id);
    if (s) {
      db.prepare("UPDATE staff SET name=?, name_mn=?, phone=? WHERE id=?")
        .run(name ?? s.name, name_mn ?? s.name_mn, phone ?? s.phone, user.staff_id);
      if (name !== undefined && name !== s.name) {
        db.prepare("UPDATE users SET name=? WHERE id=?").run(name, req.user.id);
      }
    }
  }
  res.json({ ok: true, message: '저장되었습니다' });
});


// 급여 요약
app.get('/api/salary-summary', (req, res) => {
  const staff = db.prepare("SELECT business, SUM(salary) as total, COUNT(*) as cnt FROM staff WHERE is_active=1 GROUP BY business").all();
  const grand = db.prepare("SELECT SUM(salary) as total, COUNT(*) as cnt FROM staff WHERE is_active=1").get();
  res.json({ byBusiness: staff, total: grand.total || 0, count: grand.cnt || 0 });
});

app.listen(PORT, () => console.log(`Staff Manager on port ${PORT}`));

require('./retranslate-job').start(db);
require('./daily-summary').start(db);
