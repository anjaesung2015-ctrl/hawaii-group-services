const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db');

const { syncFinance, syncRefund } = require('/home/ubuntu/.openclaw/workspace/app-sync');

// 재성님 알림 — 팀챗 + 로그 파일
const fs = require('fs');
async function notifyBoss(msg) {
  // 1. 파일 로그
  const now = new Date(Date.now() + 8*3600000).toISOString().replace('T',' ').slice(0,19);
  fs.appendFileSync(path.join(__dirname, 'register-log.txt'), `[${now}] ${msg}\n`);
  
  // 2. 팀챗 전체 공지방에 자동 메시지 (봇으로)
  try {
    const chatDb = require('/home/ubuntu/.openclaw/workspace/team-chat/db');
    const botUser = chatDb.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (botUser) {
      chatDb.prepare("INSERT INTO messages (room_id, user_id, original_text, original_lang, translated_ko, translated_mn, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(1, botUser.id, msg, 'ko', msg, null, now);
    }
  } catch(e) { console.error('Chat notify error:', e.message); }
}

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fitness-crm-secret-2026';

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ====== AUTH ======
// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'staff' CHECK(role IN ('admin', 'manager', 'staff')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// Insert default admin if none exists
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
if (userCount.cnt === 0) {
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)").run('admin', 'admin123', '관리자', 'admin');
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)").run('staff1', 'staff123', '직원1', 'staff');
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password);
  if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다' });
  
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요' });
  }
}

// No cache for HTML/JS
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));

// SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// All API routes require auth (except login)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  auth(req, res, next);
});

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const totalMembers = db.prepare("SELECT COUNT(*) as cnt FROM members WHERE status = 'active'").get().cnt;
  const expiringSoon = db.prepare("SELECT COUNT(*) as cnt FROM memberships WHERE status = 'active' AND end_date BETWEEN date('now') AND date('now', '+7 days')").get().cnt;
  const todayAttendance = db.prepare("SELECT COUNT(*) as cnt FROM attendance WHERE date(check_in) = date('now', 'localtime')").get().cnt;
  const monthRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now', 'localtime')").get().total;
  const todaySessions = db.prepare("SELECT COUNT(*) as cnt FROM pt_sessions WHERE session_date = date('now', 'localtime') AND status = 'scheduled'").get().cnt;
  const newMembersMonth = db.prepare("SELECT COUNT(*) as cnt FROM members WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')").get().cnt;

  const recentAttendance = db.prepare(`
    SELECT a.id, m.name, a.check_in, a.check_out
    FROM attendance a JOIN members m ON a.member_id = m.id
    ORDER BY a.check_in DESC LIMIT 10
  `).all();

  const expiringMembers = db.prepare(`
    SELECT m.name, m.phone, ms.end_date, mt.name as membership_type
    FROM memberships ms
    JOIN members m ON ms.member_id = m.id
    JOIN membership_types mt ON ms.type_id = mt.id
    WHERE ms.status = 'active' AND ms.end_date BETWEEN date('now') AND date('now', '+7 days')
    ORDER BY ms.end_date
  `).all();

  res.json({ totalMembers, expiringSoon, todayAttendance, monthRevenue, todaySessions, newMembersMonth, recentAttendance, expiringMembers });
});

// ====== MEMBERS ======
app.get('/api/members', (req, res) => {
  const { search, status, page = 1, limit = 20 } = req.query;
  let sql = 'SELECT * FROM members WHERE 1=1';
  const params = [];

  if (search) { sql += ' AND (name LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
  const total = db.prepare(countSql).get(...params).cnt;

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const members = db.prepare(sql).all(...params);
  // 각 회원의 현재 회원권 정보 추가
  const msStmt = db.prepare(`SELECT ms.*, mt.name as type_name, mt.duration_days FROM memberships ms JOIN membership_types mt ON ms.type_id=mt.id WHERE ms.member_id=? ORDER BY ms.end_date DESC LIMIT 1`);
  const lastPayStmt = db.prepare(`SELECT amount, payment_date, payment_type FROM payments WHERE member_id=? ORDER BY payment_date DESC LIMIT 1`);
  members.forEach(m => {
    m.current_membership = msStmt.get(m.id) || null;
    m.last_payment = lastPayStmt.get(m.id) || null;
  });
  res.json({ members, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
});

app.get('/api/members/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: '회원을 찾을 수 없습니다' });

  const memberships = db.prepare(`
    SELECT ms.*, mt.name as type_name FROM memberships ms
    JOIN membership_types mt ON ms.type_id = mt.id
    WHERE ms.member_id = ? ORDER BY ms.start_date DESC
  `).all(req.params.id);

  const attendance = db.prepare('SELECT * FROM attendance WHERE member_id = ? ORDER BY check_in DESC LIMIT 30').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE member_id = ? ORDER BY payment_date DESC LIMIT 20').all(req.params.id);
  const ptSessions = db.prepare(`
    SELECT ps.*, t.name as trainer_name FROM pt_sessions ps
    JOIN trainers t ON ps.trainer_id = t.id
    WHERE ps.member_id = ? ORDER BY ps.session_date DESC LIMIT 20
  `).all(req.params.id);

  res.json({ ...member, memberships, attendance, payments, ptSessions });
});

app.post('/api/members', (req, res) => {
  const { name, phone, email, gender, birth_date, address, emergency_contact, emergency_phone, notes, barcode_id } = req.body;
  if (!name) return res.status(400).json({ error: '이름은 필수입니다' });

  try {
    const result = db.prepare(
      'INSERT INTO members (name, phone, email, gender, birth_date, address, emergency_contact, emergency_phone, notes, barcode_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, phone, email, gender, birth_date, address, emergency_contact, emergency_phone, notes, barcode_id || null);
    
    // 🔔 재성님 알림
    const staffName = req.user?.name || '직원';
    const now = new Date(Date.now()+8*3600000).toTimeString().slice(0,5);
    notifyBoss(`🆕 신규 회원 등록!\n👤 ${name}${phone ? ' ('+phone+')' : ''}\n📝 담당: ${staffName}\n🕐 ${now}`);
    
    res.json({ id: result.lastInsertRowid, message: '회원이 등록되었습니다' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '이미 등록된 바코드입니다' });
    throw e;
  }
});

app.put('/api/members/:id', (req, res) => {
  const { name, phone, email, gender, birth_date, address, emergency_contact, emergency_phone, notes, status, barcode_id } = req.body;
  try {
    db.prepare(`UPDATE members SET name=?, phone=?, email=?, gender=?, birth_date=?, address=?, emergency_contact=?, emergency_phone=?, notes=?, status=?, barcode_id=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(name, phone, email, gender, birth_date, address, emergency_contact, emergency_phone, notes, status, barcode_id || null, req.params.id);
    res.json({ message: '회원 정보가 수정되었습니다' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '이미 등록된 바코드입니다' });
    throw e;
  }
});

app.delete('/api/members/:id', (req, res) => {
  db.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").run(req.params.id);
  res.json({ message: '회원이 비활성화되었습니다' });
});

// ====== MEMBERSHIPS ======
app.get('/api/membership-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM membership_types WHERE is_active = 1').all());
});

app.put('/api/membership-types/:id', (req, res) => {
  const { name, duration_days, price } = req.body;
  db.prepare("UPDATE membership_types SET name=?, duration_days=?, price=? WHERE id=?")
    .run(name, duration_days, price, req.params.id);
  res.json({ message: '회원권이 수정되었습니다' });
});

app.post('/api/membership-types', (req, res) => {
  const { name, duration_days, price } = req.body;
  const r = db.prepare("INSERT INTO membership_types (name, duration_days, price) VALUES (?,?,?)")
    .run(name, duration_days || 30, price || 0);
  res.json({ id: r.lastInsertRowid, message: '회원권이 추가되었습니다' });
});

app.delete('/api/membership-types/:id', (req, res) => {
  db.prepare("UPDATE membership_types SET is_active = 0 WHERE id = ?").run(req.params.id);
  res.json({ message: '회원권이 삭제되었습니다' });
});

app.post('/api/memberships', (req, res) => {
  const { member_id, type_id, start_date, price_paid, payment_method } = req.body;
  const type = db.prepare('SELECT * FROM membership_types WHERE id = ?').get(type_id);
  if (!type) return res.status(400).json({ error: '회원권 종류를 찾을 수 없습니다' });

  const startD = new Date(start_date);
  const endD = new Date(startD);
  endD.setDate(endD.getDate() + type.duration_days);
  const end_date = endD.toISOString().split('T')[0];

  const result = db.prepare(
    'INSERT INTO memberships (member_id, type_id, start_date, end_date, price_paid, payment_method) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(member_id, type_id, start_date, end_date, price_paid || type.price, payment_method);

  if (price_paid || type.price) {
    db.prepare('INSERT INTO payments (member_id, amount, payment_type, payment_method, description) VALUES (?, ?, ?, ?, ?)')
      .run(member_id, price_paid || type.price, '회원권', payment_method || 'cash', `${type.name} 등록`);
  }

  db.prepare("UPDATE members SET status = 'active' WHERE id = ?").run(member_id);
  
  // 재무 연동
  const member = db.prepare("SELECT name FROM members WHERE id=?").get(member_id);
  syncFinance('fitness', 'membership', {
    amount: price_paid || type.price,
    date: start_date || new Date(Date.now()+8*3600000).toISOString().split('T')[0],
    payment_method: payment_method || 'cash',
    description: `${member?.name||''} ${type.name} 등록`
  }).catch(()=>{});
  
  // 🔔 재성님 알림
  const memberInfo = db.prepare("SELECT name FROM members WHERE id=?").get(member_id);
  const staffName2 = req.user?.name || '직원';
  const now2 = new Date(Date.now()+8*3600000).toTimeString().slice(0,5);
  const amt = price_paid || type.price;
  notifyBoss(`💳 회원권 등록!\n👤 ${memberInfo?.name||'?'} → ${type.name}\n💰 ₮${Number(amt).toLocaleString()} (${payment_method||'cash'})\n📝 담당: ${staffName2}\n🕐 ${now2}`);

  res.json({ id: result.lastInsertRowid, end_date, message: '회원권이 등록되었습니다' });
});

// ====== MEMBERSHIP ACTIONS (정지/해제/환불/수정) ======

// 회원권 정지 (출장, 휴가 등)
app.post('/api/memberships/:id/freeze', (req, res) => {
  const { reason } = req.body;
  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.params.id);
  if (!ms) return res.status(404).json({ error: '회원권을 찾을 수 없습니다' });
  if (ms.status !== 'active') return res.status(400).json({ error: '활성 회원권만 정지할 수 있습니다' });

  // 남은 일수 계산해서 저장
  const today = new Date();
  const endDate = new Date(ms.end_date);
  const remainingDays = Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)));

  db.prepare("UPDATE memberships SET status = 'frozen', freeze_date = date('now', 'localtime'), remaining_days = ?, freeze_reason = ? WHERE id = ?")
    .run(remainingDays, reason || '', req.params.id);
  db.prepare("UPDATE members SET status = 'frozen' WHERE id = ?").run(ms.member_id);

  res.json({ message: '회원권이 정지되었습니다', remainingDays });
});

// 회원권 정지 해제
app.post('/api/memberships/:id/unfreeze', (req, res) => {
  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.params.id);
  if (!ms) return res.status(404).json({ error: '회원권을 찾을 수 없습니다' });
  if (ms.status !== 'frozen') return res.status(400).json({ error: '정지된 회원권만 해제할 수 있습니다' });

  // 남은 일수만큼 새 종료일 계산
  const newEnd = new Date();
  newEnd.setDate(newEnd.getDate() + (ms.remaining_days || 30));
  const end_date = newEnd.toISOString().split('T')[0];

  db.prepare("UPDATE memberships SET status = 'active', end_date = ?, freeze_date = NULL, remaining_days = NULL WHERE id = ?")
    .run(end_date, req.params.id);
  db.prepare("UPDATE members SET status = 'active' WHERE id = ?").run(ms.member_id);

  res.json({ message: '회원권이 재개되었습니다', new_end_date: end_date });
});

// 회원권 수정
app.put('/api/memberships/:id', (req, res) => {
  const { start_date, end_date, price_paid, status } = req.body;
  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(req.params.id);
  if (!ms) return res.status(404).json({ error: '회원권을 찾을 수 없습니다' });

  db.prepare("UPDATE memberships SET start_date = ?, end_date = ?, price_paid = ?, status = ? WHERE id = ?")
    .run(start_date || ms.start_date, end_date || ms.end_date, price_paid !== undefined ? price_paid : ms.price_paid, status || ms.status, req.params.id);

  res.json({ message: '회원권이 수정되었습니다' });
});

// 환불
app.post('/api/memberships/:id/refund', (req, res) => {
  const { refund_amount, reason } = req.body;
  const ms = db.prepare('SELECT ms.*, mt.name as type_name FROM memberships ms JOIN membership_types mt ON ms.type_id = mt.id WHERE ms.id = ?').get(req.params.id);
  if (!ms) return res.status(404).json({ error: '회원권을 찾을 수 없습니다' });

  // 남은 일수 기준 환불액 계산 (요청 금액이 없으면 자동 계산)
  const today = new Date();
  const startDate = new Date(ms.start_date);
  const endDate = new Date(ms.end_date);
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const usedDays = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, totalDays - usedDays);
  const autoRefund = Math.round((ms.price_paid || 0) * (remainingDays / totalDays));
  const finalRefund = refund_amount || autoRefund;

  // 회원권 취소
  db.prepare("UPDATE memberships SET status = 'cancelled' WHERE id = ?").run(req.params.id);

  // 환불 결제 기록 (마이너스 금액)
  db.prepare("INSERT INTO payments (member_id, amount, payment_type, payment_method, description) VALUES (?, ?, ?, ?, ?)")
    .run(ms.member_id, -finalRefund, '환불', ms.payment_method || 'cash', `${ms.type_name} 환불 (${reason || '회원 요청'})`);

  // 다른 활성 회원권이 없으면 상태 변경
  const otherActive = db.prepare("SELECT COUNT(*) as cnt FROM memberships WHERE member_id = ? AND status = 'active' AND id != ?").get(ms.member_id, req.params.id);
  if (otherActive.cnt === 0) {
    db.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").run(ms.member_id);
  }

  // 재무 환불 연동
  const member = db.prepare("SELECT name FROM members WHERE id=?").get(ms.member_id);
  syncRefund('fitness', 'membership', {
    amount: finalRefund,
    description: `${member?.name||''} ${ms.type_name} 환불`,
    payment_method: ms.payment_method || 'cash'
  }).catch(()=>{});
  
  res.json({ message: '환불이 처리되었습니다', refund_amount: finalRefund, remaining_days: remainingDays, auto_calculated: !refund_amount });
});

// ====== ATTENDANCE ======
// 바코드 스캔 출석
app.post('/api/attendance/barcode', (req, res) => {
  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ error: '바코드를 스캔해주세요' });

  // barcode_id, phone, or member id로 검색
  let member = db.prepare("SELECT * FROM members WHERE barcode_id = ?").get(barcode);
  if (!member) member = db.prepare("SELECT * FROM members WHERE phone = ?").get(barcode);
  if (!member) member = db.prepare("SELECT * FROM members WHERE id = ?").get(barcode);
  if (!member) return res.status(404).json({ error: '등록되지 않은 바코드입니다', barcode });

  const activeMembership = db.prepare("SELECT ms.*, mt.name as type_name FROM memberships ms JOIN membership_types mt ON ms.type_id = mt.id WHERE ms.member_id = ? AND ms.status = 'active' AND ms.end_date >= date('now') ORDER BY ms.end_date DESC LIMIT 1").get(member.id);

  // 오늘 이미 체크인 했는지 확인
  const todayCheckin = db.prepare("SELECT * FROM attendance WHERE member_id = ? AND date(check_in) = date('now', 'localtime') ORDER BY check_in DESC LIMIT 1").get(member.id);

  if (todayCheckin) {
    return res.json({
      action: 'already', member_name: member.name, member_id: member.id,
      message: `${member.name}님 이미 출석 완료`,
      check_in_time: todayCheckin.check_in,
      has_active_membership: !!activeMembership,
      membership_type: activeMembership?.type_name || null,
      remaining_days: activeMembership ? Math.max(0, Math.ceil((new Date(activeMembership.end_date) - new Date()) / (1000*60*60*24))) : 0
    });
  }

  const result = db.prepare('INSERT INTO attendance (member_id) VALUES (?)').run(member.id);

  const remainingDays = activeMembership ? Math.max(0, Math.ceil((new Date(activeMembership.end_date) - new Date()) / (1000*60*60*24))) : 0;

  res.json({
    action: 'checkin', id: result.lastInsertRowid,
    member_name: member.name, member_id: member.id,
    has_active_membership: !!activeMembership,
    membership_type: activeMembership?.type_name || null,
    remaining_days: remainingDays,
    message: `${member.name}님 출석 체크 완료`
  });
});

// 회원에 바코드 등록
app.put('/api/members/:id/barcode', (req, res) => {
  const { barcode_id } = req.body;
  try {
    db.prepare("UPDATE members SET barcode_id = ? WHERE id = ?").run(barcode_id, req.params.id);
    res.json({ message: '바코드가 등록되었습니다' });
  } catch(e) {
    res.status(400).json({ error: '이미 다른 회원에게 등록된 바코드입니다' });
  }
});

app.post('/api/attendance/checkin', (req, res) => {
  const { member_id } = req.body;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).json({ error: '회원을 찾을 수 없습니다' });

  const activeMembership = db.prepare(`SELECT * FROM memberships WHERE member_id = ? AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`).get(member_id);

  const result = db.prepare('INSERT INTO attendance (member_id) VALUES (?)').run(member_id);
  res.json({ id: result.lastInsertRowid, member_name: member.name, has_active_membership: !!activeMembership, message: `${member.name}님 출석 체크 완료` });
});

app.post('/api/attendance/checkout', (req, res) => {
  const { member_id } = req.body;
  db.prepare(`UPDATE attendance SET check_out = datetime('now', 'localtime') WHERE member_id = ? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1`).run(member_id);
  res.json({ message: '퇴장 처리되었습니다' });
});

// ====== TRAINERS ======
app.get('/api/trainers', (req, res) => {
  res.json(db.prepare("SELECT * FROM trainers WHERE status = 'active'").all());
});

app.post('/api/trainers', (req, res) => {
  const { name, phone, specialty } = req.body;
  const result = db.prepare('INSERT INTO trainers (name, phone, specialty) VALUES (?, ?, ?)').run(name, phone, specialty);
  res.json({ id: result.lastInsertRowid, message: '트레이너가 등록되었습니다' });
});

// ====== PT SESSIONS ======
app.get('/api/pt-sessions', (req, res) => {
  const { date, trainer_id } = req.query;
  let sql = `SELECT ps.*, m.name as member_name, t.name as trainer_name 
    FROM pt_sessions ps JOIN members m ON ps.member_id = m.id JOIN trainers t ON ps.trainer_id = t.id WHERE 1=1`;
  const params = [];
  if (date) { sql += ' AND ps.session_date = ?'; params.push(date); }
  if (trainer_id) { sql += ' AND ps.trainer_id = ?'; params.push(trainer_id); }
  sql += ' ORDER BY ps.session_date, ps.start_time';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/pt-sessions', (req, res) => {
  const { member_id, trainer_id, session_date, start_time, end_time, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO pt_sessions (member_id, trainer_id, session_date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(member_id, trainer_id, session_date, start_time, end_time, notes);
  res.json({ id: result.lastInsertRowid, message: 'PT 세션이 예약되었습니다' });
});

app.put('/api/pt-sessions/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE pt_sessions SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: '세션 상태가 업데이트되었습니다' });
});

// ====== PAYMENTS ======
app.get('/api/payments', (req, res) => {
  const { month } = req.query;
  let sql = `SELECT p.*, m.name as member_name FROM payments p JOIN members m ON p.member_id = m.id`;
  const params = [];
  if (month) { sql += ` WHERE strftime('%Y-%m', p.payment_date) = ?`; params.push(month); }
  sql += ' ORDER BY p.payment_date DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/payments', (req, res) => {
  const { member_id, amount, payment_type, payment_method, description } = req.body;
  const result = db.prepare(
    'INSERT INTO payments (member_id, amount, payment_type, payment_method, description) VALUES (?, ?, ?, ?, ?)'
  ).run(member_id, amount, payment_type, payment_method || 'cash', description);
  res.json({ id: result.lastInsertRowid, message: '결제가 기록되었습니다' });
});

// ====== STATS ======
// 재무관리 DB에서 피트니스(business_id=2) 일매출 가져오기
const finDb = require('better-sqlite3')(require('path').join(__dirname, '..', 'finance-manager', 'finance.db'), { readonly: true });

// 출석 관리 API
app.get('/api/attendance-mgmt', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT m.id, m.name, m.phone,
        ms.start_date, ms.end_date,
        mt.name as type_name,
        CAST(julianday(ms.end_date) - julianday('now') as INTEGER) as days_left,
        CAST(julianday('now') - julianday(ms.start_date) as INTEGER) as days_used,
        CAST(julianday(ms.end_date) - julianday(ms.start_date) as INTEGER) as total_days,
        (SELECT COUNT(*) FROM attendance a WHERE a.member_id=m.id 
          AND a.check_in >= ms.start_date AND a.check_in <= ms.end_date||' 23:59:59') as visits
      FROM members m
      LEFT JOIN memberships ms ON m.id = ms.member_id AND ms.status = 'active'
      LEFT JOIN membership_types mt ON ms.type_id = mt.id
      WHERE m.status = 'active'
      ORDER BY ms.end_date ASC NULLS LAST, m.name
    `).all();
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/daily-revenue', (req, res) => {
  const month = req.query.month || new Date(Date.now()+8*3600000).toISOString().slice(0,7);
  const daily = finDb.prepare(`
    SELECT transaction_date as date,
      CAST(SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as INTEGER) as income,
      CAST(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as INTEGER) as expense,
      COUNT(*) as cnt
    FROM transactions
    WHERE business_id = 2 AND strftime('%Y-%m', transaction_date) = ?
    GROUP BY transaction_date
    ORDER BY transaction_date
  `).all(month);
  
  const totalIncome = daily.reduce((s, d) => s + d.income, 0);
  const totalExpense = daily.reduce((s, d) => s + d.expense, 0);
  const avgDaily = daily.length ? Math.round(totalIncome / daily.length) : 0;
  const bestDay = daily.reduce((best, d) => d.income > (best?.income || 0) ? d : best, null);
  
  res.json({ month, daily, totalIncome, totalExpense, net: totalIncome - totalExpense, avgDaily, bestDay, days: daily.length });
});

app.get('/api/stats/monthly-revenue', (req, res) => {
  const data = db.prepare(`
    SELECT strftime('%Y-%m', payment_date) as month, SUM(amount) as total
    FROM payments GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();
  res.json(data);
});

app.get('/api/stats/attendance-daily', (req, res) => {
  const data = db.prepare(`
    SELECT date(check_in) as date, COUNT(*) as count
    FROM attendance WHERE check_in >= date('now', '-30 days')
    GROUP BY date ORDER BY date
  `).all();
  res.json(data);
});

// ====== USER MANAGEMENT ======
app.get('/api/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근 가능합니다' });
  const users = db.prepare("SELECT id, username, name, role, created_at FROM users").all();
  res.json(users);
});

app.post('/api/users', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근 가능합니다' });
  const { username, password, name, role } = req.body;
  try {
    const result = db.prepare("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)").run(username, password, name, role || 'staff');
    res.json({ id: result.lastInsertRowid, message: '계정이 생성되었습니다' });
  } catch (e) {
    res.status(400).json({ error: '이미 존재하는 아이디입니다' });
  }
});

const PORT = 6001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏋️ 피트니스 CRM 서버 실행 중: http://localhost:${PORT}`);
});
