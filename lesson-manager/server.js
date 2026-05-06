const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db');

const { syncFinance, syncSchedule } = require('/home/ubuntu/.openclaw/workspace/app-sync');

const app = express();
const PORT = 6005;
const JWT_SECRET = 'lesson-mgr-2026-secret';

app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.resolve(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, 'public', 'index.html')));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.lesson_token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Session expired' }); }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.use('/api', auth);

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  const monthStart = today.slice(0, 7) + '-01';

  const programs = db.prepare("SELECT * FROM programs WHERE status = 'active'").all();
  const totalStudents = db.prepare("SELECT COUNT(*) as cnt FROM students WHERE status = 'active'").get().cnt;
  const todaySessions = db.prepare("SELECT s.*, p.name as program_name FROM sessions s JOIN programs p ON s.program_id = p.id WHERE s.session_date = ?").all(today);
  const monthRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM payments WHERE payment_date >= ?").get(monthStart);
  const upcomingSessions = db.prepare("SELECT s.*, p.name as program_name FROM sessions s JOIN programs p ON s.program_id = p.id WHERE s.session_date >= ? AND s.status = 'scheduled' ORDER BY s.session_date, s.start_time LIMIT 10").all(today);
  const recentPayments = db.prepare("SELECT py.*, st.name as student_name, pr.name as program_name FROM payments py JOIN students st ON py.student_id = st.id JOIN programs pr ON py.program_id = pr.id ORDER BY py.payment_date DESC LIMIT 5").all();
  
  // 미납 학생
  const unpaidStudents = db.prepare(`
    SELECT s.id, s.name, s.phone, p.name as program_name, p.monthly_fee,
    (SELECT MAX(py.payment_date) FROM payments py WHERE py.student_id = s.id) as last_payment
    FROM students s JOIN programs p ON s.program_id = p.id
    WHERE s.status = 'active' AND s.payment_type = 'monthly'
    AND (SELECT MAX(py.payment_date) FROM payments py WHERE py.student_id = s.id AND py.payment_date >= ?) IS NULL
  `).all(monthStart);

  // 만료 임박 (7일 내) — 월정액과 회수제 모두
  const expiring = db.prepare(`
    SELECT s.id, s.name, s.phone, p.name as program_name, p.billing_type, p.billing_day,
      (SELECT MAX(py.payment_date) FROM payments py WHERE py.student_id=s.id) as last_paid,
      (SELECT sessions_bought FROM payments py WHERE py.student_id=s.id AND sessions_bought IS NOT NULL ORDER BY payment_date DESC LIMIT 1) as last_bought,
      (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON a.session_id=ss.id
       WHERE a.student_id=s.id AND a.status='present'
       AND ss.session_date >= COALESCE((SELECT MAX(payment_date) FROM payments WHERE student_id=s.id), date('now','-30 days'))) as att_since_paid
    FROM students s LEFT JOIN programs p ON s.program_id=p.id
    WHERE s.status='active' AND (SELECT MAX(payment_date) FROM payments WHERE student_id=s.id) IS NOT NULL
  `).all().filter(r => {
    if (r.billing_type === 'monthly') {
      const due = computeNextDue(r.last_paid, r.billing_day);
      if (!due) return false;
      const days = Math.floor((new Date(due+'T00:00:00').getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 7;
    }
    if (r.last_bought) {
      const remaining = Math.max(0, r.last_bought - (r.att_since_paid||0));
      return remaining > 0 && remaining <= 2;
    }
    return false;
  });

  res.json({ programs, totalStudents, todaySessions, monthRevenue, upcomingSessions, recentPayments, unpaidStudents, expiring, today, dow });
});

// ====== PROGRAMS ======
app.get('/api/programs', (req, res) => res.json(db.prepare("SELECT * FROM programs ORDER BY court_id, start_time").all()));
app.get('/api/courts', (req, res) => res.json(db.prepare("SELECT * FROM courts ORDER BY id").all()));
app.post('/api/programs', (req, res) => {
  const { name, description, location, days, start_time, end_time, max_students, per_session_fee, monthly_fee, monthly_sessions, court_id, level, theme, billing_type, billing_day } = req.body;
  const r = db.prepare("INSERT INTO programs (name,description,location,days,start_time,end_time,max_students,per_session_fee,monthly_fee,monthly_sessions,court_id,level,theme,billing_type,billing_day) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(name, description, location, days, start_time, end_time, max_students || 8, per_session_fee || 0, monthly_fee || 0, monthly_sessions || 8, court_id || 0, level || 'all', theme || '', billing_type || 'per_session', billing_day || null);
  res.json({ id: r.lastInsertRowid, message: '프로그램 등록 완료' });
});
app.put('/api/programs/:id', (req, res) => {
  const { name, description, location, days, start_time, end_time, max_students, per_session_fee, monthly_fee, monthly_sessions, status, court_id, level, theme, billing_type, billing_day } = req.body;
  db.prepare("UPDATE programs SET name=?,description=?,location=?,days=?,start_time=?,end_time=?,max_students=?,per_session_fee=?,monthly_fee=?,monthly_sessions=?,status=?,court_id=?,level=?,theme=?,billing_type=?,billing_day=? WHERE id=?")
    .run(name, description, location, days, start_time, end_time, max_students, per_session_fee, monthly_fee, monthly_sessions, status || 'active', court_id || 0, level || 'all', theme || '', billing_type || 'per_session', billing_day || null, req.params.id);
  res.json({ message: '수정 완료' });
});

// 다음 결제일 계산 (월정액)
function computeNextDue(lastPaidStr, billingDay) {
  if (!lastPaidStr) return null;
  if (billingDay) {
    // 결제일 고정 (예: 매달 20일)
    const last = new Date(lastPaidStr + 'T00:00:00');
    let y = last.getFullYear(), m = last.getMonth() + 1;
    if (last.getDate() >= billingDay) m += 1;
    if (m > 12) { y += 1; m -= 12; }
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    const day = Math.min(billingDay, lastDayOfMonth);
    return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  // 30일 롤링
  const due = new Date(new Date(lastPaidStr).getTime() + 30 * 86400000);
  return due.toISOString().split('T')[0];
}
app.delete('/api/programs/:id', (req, res) => {
  db.prepare("DELETE FROM programs WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== STUDENTS ======
app.get('/api/students', (req, res) => {
  const { program_id, status, q } = req.query;
  let sql = "SELECT s.*, p.name as program_name FROM students s LEFT JOIN programs p ON s.program_id = p.id WHERE 1=1";
  const params = [];
  if (program_id) { sql += " AND s.program_id = ?"; params.push(program_id); }
  if (status) { sql += " AND s.status = ?"; params.push(status); }
  if (q) { sql += " AND (s.name LIKE ? OR s.phone LIKE ?)"; params.push('%' + q + '%', '%' + q + '%'); }
  sql += " ORDER BY s.name";
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/students', (req, res) => {
  const { name, phone, gender, level, program_id, payment_type, notes, custom_fee, end_date, total_sessions, used_sessions } = req.body;
  if (!name) return res.status(400).json({ error: '이름을 입력하세요' });
  const r = db.prepare("INSERT INTO students (name,phone,gender,level,program_id,payment_type,notes,custom_fee,end_date,total_sessions,used_sessions,memos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(name, phone, gender || 'M', level || 'beginner', program_id, payment_type || 'per_session', notes, custom_fee || 0, end_date || null, total_sessions || 0, used_sessions || 0, '[]');
  res.json({ id: r.lastInsertRowid, message: '수강생 등록 완료' });
});
app.put('/api/students/:id', (req, res) => {
  const { name, phone, gender, level, program_id, payment_type, status, notes, custom_fee, end_date, total_sessions, used_sessions } = req.body;
  db.prepare("UPDATE students SET name=?,phone=?,gender=?,level=?,program_id=?,payment_type=?,status=?,notes=?,custom_fee=?,end_date=?,total_sessions=?,used_sessions=? WHERE id=?")
    .run(name, phone, gender, level, program_id, payment_type, status || 'active', notes, custom_fee || 0, end_date || null, total_sessions || 0, used_sessions || 0, req.params.id);
  res.json({ message: '수정 완료' });
});
app.delete('/api/students/:id', (req, res) => {
  const id = req.params.id;
  db.prepare("DELETE FROM attendance WHERE student_id = ?").run(id);
  db.prepare("DELETE FROM payments WHERE student_id = ?").run(id);
  db.prepare("DELETE FROM students WHERE id = ?").run(id);
  res.json({ message: '삭제 완료' });
});

// 재등록 (회수/만료일 추가 + 결제 기록)
app.post('/api/students/:id/renew', (req, res) => {
  const { add_sessions, end_date, amount, note, payment_method } = req.body;
  const id = req.params.id;
  const student = db.prepare("SELECT * FROM students WHERE id=?").get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const newTotal = (student.total_sessions || 0) + (Number(add_sessions) || 0);
  db.prepare("UPDATE students SET total_sessions=?, end_date=COALESCE(?, end_date) WHERE id=?")
    .run(newTotal, end_date || null, id);
  let paymentId = null;
  if (Number(amount) > 0) {
    const today = new Date(Date.now() + 8*3600000).toISOString().split('T')[0];
    const r = db.prepare("INSERT INTO payments (student_id, program_id, amount, type, period, payment_method, payment_date, notes, sessions_bought) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, student.program_id, Number(amount), 'per_session', today.slice(0,7), payment_method || 'cash', today, note || '재등록', Number(add_sessions) || null);
    paymentId = r.lastInsertRowid;
    syncFinance('lesson', 'onetime', { amount: Number(amount), date: today, payment_method: payment_method || 'cash', description: `${student.name} 재등록 ${add_sessions}회` }).catch(()=>{});
  }
  res.json({ message: '재등록 완료', total_sessions: newTotal, payment_id: paymentId });
});

// 메모 추가
app.post('/api/students/:id/memos', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const s = db.prepare("SELECT memos FROM students WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  let memos = []; try { memos = JSON.parse(s.memos || '[]'); } catch(_) {}
  const today = new Date(Date.now() + 8*3600000).toISOString().split('T')[0];
  memos.unshift({ date: today, text });
  db.prepare("UPDATE students SET memos=? WHERE id=?").run(JSON.stringify(memos), req.params.id);
  res.json({ memos });
});

// 메모 삭제
app.delete('/api/students/:id/memos/:idx', (req, res) => {
  const s = db.prepare("SELECT memos FROM students WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  let memos = []; try { memos = JSON.parse(s.memos || '[]'); } catch(_) {}
  memos.splice(Number(req.params.idx), 1);
  db.prepare("UPDATE students SET memos=? WHERE id=?").run(JSON.stringify(memos), req.params.id);
  res.json({ memos });
});

// CSV 일괄 등록 (수강생)
app.post('/api/students/bulk-import', (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  const stmt = db.prepare("INSERT INTO students (name,phone,gender,level,program_id,payment_type,notes,sessions_bought) VALUES (?,?,?,?,?,?,?,?)");
  let added = 0, skipped = 0;
  const tx = db.transaction(list => {
    for (const r of list) {
      if (!r.name) { skipped++; continue; }
      const programs = db.prepare("SELECT id FROM programs WHERE name=?").get(r.program||'');
      stmt.run(
        r.name, r.phone||'', r.gender==='F'?'F':'M',
        ['beginner','intermediate','advanced'].includes(r.level)?r.level:'beginner',
        programs?.id || null,
        r.payment_type==='monthly'?'monthly':'per_session',
        r.notes||null,
        r.sessions_bought ? Number(r.sessions_bought) : null
      );
      added++;
    }
  });
  try { tx(rows); res.json({ added, skipped }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 전체 백업 (DB 덤프)
app.get('/api/backup', (req, res) => {
  try {
    const tables = ['users','programs','students','sessions','attendance','payments','training_plans','session_notes','courts'];
    const dump = { version: 1, exported_at: new Date().toISOString() };
    tables.forEach(t => { dump[t] = db.prepare(`SELECT * FROM ${t}`).all(); });
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="lesson_backup_${new Date(Date.now()+8*3600000).toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(dump, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 복원 (백업 JSON으로 DB 덮어쓰기)
app.post('/api/restore', (req, res) => {
  try {
    const dump = req.body;
    if (!dump || !dump.version) return res.status(400).json({ error: 'invalid backup file' });
    const tables = ['attendance','payments','session_notes','training_plans','sessions','students','programs','courts'];
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      tables.forEach(t => db.prepare(`DELETE FROM ${t}`).run());
      const restoreOrder = ['courts','programs','students','sessions','attendance','payments','training_plans','session_notes'];
      restoreOrder.forEach(t => {
        const rows = dump[t] || [];
        if (!rows.length) return;
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(()=>'?').join(',');
        const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`);
        rows.forEach(r => stmt.run(cols.map(c => r[c])));
      });
    });
    tx();
    db.pragma('foreign_keys = ON');
    res.json({ ok: true, message: '복원 완료' });
  } catch (e) {
    db.pragma('foreign_keys = ON');
    res.status(500).json({ error: e.message });
  }
});

// ====== SESSIONS ======
app.get('/api/sessions', (req, res) => {
  const { program_id, date_from, date_to } = req.query;
  let sql = "SELECT s.*, p.name as program_name, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') as attend_count FROM sessions s JOIN programs p ON s.program_id = p.id WHERE 1=1";
  const params = [];
  if (program_id) { sql += " AND s.program_id = ?"; params.push(program_id); }
  if (date_from) { sql += " AND s.session_date >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND s.session_date <= ?"; params.push(date_to); }
  sql += " ORDER BY s.session_date DESC, s.start_time";
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/sessions/generate', (req, res) => {
  const { program_id, weeks } = req.body;
  const prog = db.prepare("SELECT * FROM programs WHERE id = ?").get(program_id);
  if (!prog) return res.status(404).json({ error: 'Program not found' });
  
  const dayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  const targetDays = prog.days.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined);
  const today = new Date();
  let created = 0;

  for (let d = 0; d < (weeks || 4) * 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    if (!targetDays.includes(date.getDay())) continue;
    const dateStr = date.toISOString().split('T')[0];

    const exists = db.prepare("SELECT id FROM sessions WHERE program_id = ? AND session_date = ?").get(program_id, dateStr);
    if (exists) continue;

    db.prepare("INSERT INTO sessions (program_id, session_date, start_time, end_time, location, status) VALUES (?,?,?,?,?,?)")
      .run(program_id, dateStr, prog.start_time, prog.end_time, prog.location, 'scheduled');
    created++;
  }
  res.json({ created, message: `${created}개 수업 생성 완료` });
});
app.put('/api/sessions/:id', (req, res) => {
  const { status, notes, location } = req.body;
  if (status) db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, req.params.id);
  if (notes !== undefined) db.prepare("UPDATE sessions SET notes = ? WHERE id = ?").run(notes, req.params.id);
  if (location) db.prepare("UPDATE sessions SET location = ? WHERE id = ?").run(location, req.params.id);
  res.json({ message: 'Updated' });
});

// ====== ATTENDANCE ======
app.get('/api/sessions/:id/attendance', (req, res) => {
  const session = db.prepare("SELECT s.*, p.name as program_name FROM sessions s JOIN programs p ON s.program_id = p.id WHERE s.id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  const students = db.prepare("SELECT st.*, COALESCE(a.status, 'absent') as attend_status FROM students st LEFT JOIN attendance a ON a.student_id = st.id AND a.session_id = ? WHERE st.program_id = ? AND st.status = 'active' ORDER BY st.name").all(req.params.id, session.program_id);
  res.json({ session, students });
});
app.post('/api/sessions/:id/attendance', (req, res) => {
  const { student_id, status } = req.body;
  const newStatus = status || 'present';
  // Get previous attendance status to compute used_sessions delta
  const prev = db.prepare("SELECT status FROM attendance WHERE session_id=? AND student_id=?").get(req.params.id, student_id);
  const wasCounted = prev && (prev.status === 'present' || prev.status === 'late');
  const isCounted = newStatus === 'present' || newStatus === 'late';
  try {
    db.prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?,?,?) ON CONFLICT(session_id, student_id) DO UPDATE SET status = ?")
      .run(req.params.id, student_id, newStatus, newStatus);
  } catch (e) {
    db.prepare("INSERT OR REPLACE INTO attendance (session_id, student_id, status) VALUES (?,?,?)")
      .run(req.params.id, student_id, newStatus);
  }
  // Adjust used_sessions counter
  if (!wasCounted && isCounted) {
    db.prepare("UPDATE students SET used_sessions = COALESCE(used_sessions,0) + 1 WHERE id=?").run(student_id);
  } else if (wasCounted && !isCounted) {
    db.prepare("UPDATE students SET used_sessions = MAX(0, COALESCE(used_sessions,0) - 1) WHERE id=?").run(student_id);
  }
  res.json({ message: 'OK' });
});

// 출석 토글 (셀 클릭 - 추가/제거)
app.delete('/api/sessions/:sessionId/attendance/:studentId', (req, res) => {
  const prev = db.prepare("SELECT status FROM attendance WHERE session_id=? AND student_id=?").get(req.params.sessionId, req.params.studentId);
  if (prev && (prev.status === 'present' || prev.status === 'late')) {
    db.prepare("UPDATE students SET used_sessions = MAX(0, COALESCE(used_sessions,0) - 1) WHERE id=?").run(req.params.studentId);
  }
  db.prepare("DELETE FROM attendance WHERE session_id=? AND student_id=?").run(req.params.sessionId, req.params.studentId);
  res.json({ message: 'OK' });
});

// ====== PAYMENTS ======
app.get('/api/payments', (req, res) => {
  const { student_id, month } = req.query;
  let sql = "SELECT py.*, st.name as student_name, pr.name as program_name FROM payments py JOIN students st ON py.student_id = st.id JOIN programs pr ON py.program_id = pr.id WHERE 1=1";
  const params = [];
  if (student_id) { sql += " AND py.student_id = ?"; params.push(student_id); }
  if (month) { sql += " AND py.payment_date LIKE ?"; params.push(month + '%'); }
  sql += " ORDER BY py.payment_date DESC";
  res.json(db.prepare(sql).all(...params));
});
// 수강생별 납부현황 (월별)
app.get('/api/payments/status', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const students = db.prepare(`
    SELECT s.id, s.name, s.phone, s.payment_type, s.status, s.program_id, s.custom_fee,
      p.name as program_name, p.monthly_fee, p.per_session_fee,
      CASE WHEN s.custom_fee > 0 THEN s.custom_fee ELSE p.monthly_fee END as actual_fee,
      (SELECT COALESCE(SUM(py.amount),0) FROM payments py WHERE py.student_id = s.id AND py.period = ?) as paid_amount,
      (SELECT COUNT(*) FROM payments py WHERE py.student_id = s.id AND py.period = ?) as pay_count,
      (SELECT MAX(py.payment_date) FROM payments py WHERE py.student_id = s.id) as last_payment
    FROM students s
    JOIN programs p ON s.program_id = p.id
    WHERE s.status = 'active'
    ORDER BY p.id, s.name
  `).all(month, month);
  const totalDue = students.reduce((sum, s) => sum + (s.actual_fee || 0), 0);
  const totalPaid = students.reduce((sum, s) => sum + (s.paid_amount || 0), 0);
  res.json({ month, students, totalDue, totalPaid, unpaidCount: students.filter(s => s.paid_amount < s.actual_fee).length });
});
app.post('/api/payments', (req, res) => {
  const { student_id, program_id, amount, type, period, payment_method, payment_date, notes, sessions_bought } = req.body;
  const pDate = payment_date || new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const r = db.prepare("INSERT INTO payments (student_id, program_id, amount, type, period, payment_method, payment_date, notes, sessions_bought) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(student_id, program_id, amount, type || 'monthly', period, payment_method || 'cash', pDate, notes, sessions_bought || null);

  // 회수제 결제 시 학생의 sessions_bought 갱신
  if (sessions_bought) {
    db.prepare("UPDATE students SET sessions_bought=? WHERE id=?").run(sessions_bought, student_id);
  }

  // 재무 연동
  const student = db.prepare("SELECT name FROM students WHERE id=?").get(student_id);
  const program = db.prepare("SELECT name FROM programs WHERE id=?").get(program_id);
  const catKey = type === 'onetime' ? 'onetime' : 'monthly';
  syncFinance('lesson', catKey, {
    amount, date: pDate, payment_method: payment_method || 'cash',
    description: `${student?.name||''} ${program?.name||''} ${period||''}`
  }).catch(()=>{});

  res.json({ id: r.lastInsertRowid, message: '결제 등록 완료' });
});
app.get('/api/payments/:id', (req, res) => {
  const p = db.prepare("SELECT * FROM payments WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});
app.put('/api/payments/:id', (req, res) => {
  const { student_id, program_id, amount, type, period, payment_method, payment_date, notes, sessions_bought } = req.body;
  db.prepare("UPDATE payments SET student_id=?, program_id=?, amount=?, type=?, period=?, payment_method=?, payment_date=?, notes=?, sessions_bought=? WHERE id=?")
    .run(student_id, program_id, amount, type, period, payment_method, payment_date, notes||null, sessions_bought || null, req.params.id);
  res.json({ message: '수정 완료' });
});
app.delete('/api/payments/:id', (req, res) => {
  db.prepare("DELETE FROM payments WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== TRAINING PLANS ======
app.get('/api/training-plans/:programId', (req, res) => {
  const plans = db.prepare("SELECT id, program_id, week_number, day_of_week, block_order, block_name, duration_min, description, drills, intensity, video_url, steps, steps_1court, steps_2court, players_per_drill, court_count FROM training_plans WHERE program_id = ? ORDER BY week_number, CASE day_of_week WHEN '월' THEN 1 WHEN '화' THEN 2 WHEN '수' THEN 3 WHEN '목' THEN 4 WHEN '금' THEN 5 WHEN '토' THEN 6 WHEN '일' THEN 7 END, block_order").all(req.params.programId);
  res.json(plans);
});

app.post('/api/training-plans', (req, res) => {
  const { program_id, week_number, day_of_week, block_order, block_name, duration_min, description, drills, intensity } = req.body;
  const r = db.prepare("INSERT INTO training_plans (program_id, week_number, day_of_week, block_order, block_name, duration_min, description, drills, intensity) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(program_id, week_number || 1, day_of_week, block_order || 1, block_name, duration_min || 30, description, drills, intensity || 'medium');
  res.json({ id: r.lastInsertRowid, message: '훈련 계획 추가 완료' });
});

app.put('/api/training-plans/:id', (req, res) => {
  const { block_name, duration_min, description, drills, intensity, steps, steps_1court, steps_2court, video_url } = req.body;
  db.prepare("UPDATE training_plans SET block_name=?, duration_min=?, description=?, drills=?, intensity=?, steps=?, steps_1court=?, steps_2court=?, video_url=? WHERE id=?")
    .run(block_name, duration_min, description, drills, intensity, steps, steps_1court, steps_2court, video_url, req.params.id);
  res.json({ message: '수정 완료' });
});
app.delete('/api/training-plans/:id', (req, res) => {
  db.prepare("DELETE FROM training_plans WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

app.put('/api/training-plans/:id/duration', (req, res) => {
  const { duration_min } = req.body;
  db.prepare("UPDATE training_plans SET duration_min=? WHERE id=?").run(duration_min, req.params.id);
  res.json({ message: '시간 수정 완료' });
});

app.put('/api/training-plans/:id/players', (req, res) => {
  const { players_per_drill } = req.body;
  db.prepare("UPDATE training_plans SET players_per_drill=? WHERE id=?")
    .run(players_per_drill, req.params.id);
  res.json({ message: '드릴당 인원 수정 완료' });
});

app.put('/api/training-plans/:id/courts', (req, res) => {
  const { court_count } = req.body;
  db.prepare("UPDATE training_plans SET court_count=? WHERE id=?").run(court_count, req.params.id);
  res.json({ message: 'Updated' });
});

// ====== SESSION NOTES (훈련 기록) ======
app.get('/api/session-notes', (req, res) => {
  const { program_id, date_from, date_to } = req.query;
  let sql = "SELECT * FROM session_notes WHERE 1=1";
  const params = [];
  if (program_id) { sql += " AND program_id=?"; params.push(program_id); }
  if (date_from) { sql += " AND session_date>=?"; params.push(date_from); }
  if (date_to) { sql += " AND session_date<=?"; params.push(date_to); }
  sql += " ORDER BY session_date DESC, created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/session-notes', (req, res) => {
  const { session_id, program_id, session_date, coach_notes, performance_rating, highlights, improvements, injuries, attendance_count } = req.body;
  const r = db.prepare("INSERT INTO session_notes (session_id, program_id, session_date, coach_notes, performance_rating, highlights, improvements, injuries, attendance_count) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(session_id || null, program_id, session_date, coach_notes, performance_rating || 3, highlights, improvements, injuries, attendance_count || 0);
  res.json({ id: r.lastInsertRowid, message: '훈련 기록 저장 완료' });
});

app.put('/api/session-notes/:id', (req, res) => {
  const { coach_notes, performance_rating, highlights, improvements, injuries, attendance_count } = req.body;
  db.prepare("UPDATE session_notes SET coach_notes=?, performance_rating=?, highlights=?, improvements=?, injuries=?, attendance_count=? WHERE id=?")
    .run(coach_notes, performance_rating, highlights, improvements, injuries, attendance_count, req.params.id);
  res.json({ message: '수정 완료' });
});

app.delete('/api/session-notes/:id', (req, res) => {
  db.prepare("DELETE FROM session_notes WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== STATS ======
app.get('/api/stats', (req, res) => {
  const students = db.prepare("SELECT s.id, s.name, s.program_id, (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON a.session_id = ss.id WHERE a.student_id = s.id AND a.status = 'present' AND ss.session_date >= date('now','-30 days')) as month_attendance, (SELECT COALESCE(SUM(py.amount),0) FROM payments py WHERE py.student_id = s.id AND py.payment_date >= date('now','-30 days')) as month_paid FROM students s WHERE s.status = 'active'").all();
  res.json({ students });
});

// 출석 관리 API
app.get('/api/attendance-mgmt', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.name, s.phone, p.name as program, p.id as program_id,
        p.billing_type, p.billing_day, s.payment_type, s.sessions_bought,
        (SELECT payment_date FROM payments pay WHERE pay.student_id=s.id ORDER BY payment_date DESC LIMIT 1) as last_paid,
        (SELECT period FROM payments pay WHERE pay.student_id=s.id ORDER BY payment_date DESC LIMIT 1) as last_period,
        (SELECT amount FROM payments pay WHERE pay.student_id=s.id ORDER BY payment_date DESC LIMIT 1) as last_amount,
        (SELECT type FROM payments pay WHERE pay.student_id=s.id ORDER BY payment_date DESC LIMIT 1) as last_pay_type,
        (SELECT sessions_bought FROM payments pay WHERE pay.student_id=s.id AND sessions_bought IS NOT NULL ORDER BY payment_date DESC LIMIT 1) as last_bought,
        (SELECT COUNT(*) FROM attendance a WHERE a.student_id=s.id AND a.status='present') as total_att,
        (SELECT COUNT(*) FROM attendance a
         JOIN sessions ss ON a.session_id=ss.id
         WHERE a.student_id=s.id AND a.status='present' AND ss.session_date >= date('now','-30 days')) as month_att,
        (SELECT COUNT(*) FROM sessions ss WHERE ss.program_id=s.program_id AND ss.session_date >= date('now','-30 days')) as month_sessions,
        (SELECT COUNT(*) FROM attendance a
         JOIN sessions ss ON a.session_id=ss.id
         WHERE a.student_id=s.id AND a.status='present'
         AND ss.session_date >= COALESCE(
           (SELECT payment_date FROM payments pay WHERE pay.student_id=s.id ORDER BY payment_date DESC LIMIT 1),
           date('now','-30 days')
         )) as att_since_paid
      FROM students s
      LEFT JOIN programs p ON s.program_id=p.id
      WHERE s.status='active'
      ORDER BY p.id, s.name
    `).all();

    rows.forEach(r => {
      // billing_type은 프로그램에서 (없으면 학생 payment_type fallback)
      r.billing_type = r.billing_type || (r.payment_type === 'per_session' ? 'per_session' : 'monthly');

      if (r.billing_type === 'monthly') {
        r.bought = null;
        r.used = r.month_att;
        r.remaining = null;
      } else {
        // 회수제: payments.sessions_bought (최근 결제) > students.sessions_bought
        const bought = r.last_bought || r.sessions_bought || null;
        r.bought = bought;
        r.used = r.att_since_paid || 0;
        r.remaining = bought ? Math.max(0, bought - r.used) : null;
      }

      // 결제 상태
      if (!r.last_paid) {
        r.payment_status = 'unpaid';
        r.days_until_due = null;
        r.next_due = null;
      } else if (r.billing_type === 'monthly') {
        r.next_due = computeNextDue(r.last_paid, r.billing_day);
        r.days_until_due = r.next_due ? Math.floor((new Date(r.next_due+'T00:00:00').getTime() - Date.now()) / 86400000) : null;
        if (r.days_until_due == null) r.payment_status = 'unpaid';
        else if (r.days_until_due < 0) r.payment_status = 'overdue';
        else if (r.days_until_due <= 3) r.payment_status = 'urgent';
        else if (r.days_until_due <= 7) r.payment_status = 'soon';
        else r.payment_status = 'ok';
      } else {
        if (r.remaining === null) r.payment_status = 'unpaid';
        else if (r.remaining === 0) r.payment_status = 'overdue';
        else if (r.remaining === 1) r.payment_status = 'urgent';
        else if (r.remaining <= 2) r.payment_status = 'soon';
        else r.payment_status = 'ok';
        r.next_due = null;
        r.days_until_due = null;
      }
    });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 출석표 (스프레드시트 형식) API
app.get('/api/attendance-sheet', (req, res) => {
  try {
    const progId = req.query.program_id || null;
    
    // Get students for program(s)
    let studentQuery = `SELECT s.id, s.name, s.sessions_bought, s.program_id, p.name as program
      FROM students s LEFT JOIN programs p ON s.program_id=p.id WHERE s.status='active'`;
    if (progId) studentQuery += ` AND s.program_id=${parseInt(progId)}`;
    studentQuery += ` ORDER BY p.id, s.name`;
    const students = db.prepare(studentQuery).all();
    
    // Get all session dates for these programs
    const progIds = [...new Set(students.map(s=>s.program_id))];
    const sessions = db.prepare(`
      SELECT id, program_id, session_date FROM sessions 
      WHERE program_id IN (${progIds.join(',')}) AND session_date >= date('now','-90 days')
      ORDER BY session_date
    `).all();
    
    // Get all attendance records
    const attendance = db.prepare(`
      SELECT a.student_id, ss.session_date, a.status
      FROM attendance a JOIN sessions ss ON a.session_id=ss.id
      WHERE ss.program_id IN (${progIds.join(',')}) AND ss.session_date >= date('now','-90 days')
    `).all();
    
    // Build attendance map: student_id -> [dates]
    const attMap = {};
    attendance.forEach(a => {
      if (a.status !== 'present') return;
      if (!attMap[a.student_id]) attMap[a.student_id] = [];
      attMap[a.student_id].push(a.session_date);
    });
    
    // Get payments
    const payments = db.prepare(`
      SELECT student_id, payment_date, amount, period, sessions_bought
      FROM payments WHERE student_id IN (${students.map(s=>s.id).join(',') || '0'})
      ORDER BY student_id, payment_date
    `).all();
    const payMap = {};
    payments.forEach(p => {
      if (!payMap[p.student_id]) payMap[p.student_id] = [];
      payMap[p.student_id].push(p);
    });
    
    // Group sessions by month
    const months = {};
    sessions.forEach(s => {
      const m = s.session_date.slice(0,7);
      if (!months[m]) months[m] = [];
      if (!months[m].includes(s.session_date)) months[m].push(s.session_date);
    });
    
    // Build student rows with cumulative counts per payment cycle
    const result = students.map(s => {
      const dates = (attMap[s.id] || []).sort();
      const pays = payMap[s.id] || [];
      
      // For each date, calculate running count within payment cycle
      const dateCounts = {};
      let cycleStart = null;
      let count = 0;
      let bought = 0;
      
      // Get all session dates for this program
      const allDates = sessions.filter(ss=>ss.program_id===s.program_id).map(ss=>ss.session_date).sort();
      
      // Find which payment cycle each date belongs to
      allDates.forEach(date => {
        // Check if new payment cycle starts (most recent payment <= this date)
        const applicable = pays.filter(p => p.payment_date <= date).sort((a,b)=>a.payment_date.localeCompare(b.payment_date));
        const newPay = applicable[applicable.length-1];
        if (newPay && newPay.payment_date !== cycleStart) {
          cycleStart = newPay.payment_date;
          count = 0;
          bought = newPay.sessions_bought || 0;
        }

        if (dates.includes(date)) {
          count++;
          dateCounts[date] = { count, bought, attended: true };
        } else {
          dateCounts[date] = { count, bought, attended: false };
        }
      });
      
      return {
        id: s.id,
        name: s.name,
        program: s.program,
        program_id: s.program_id,
        sessions_bought: s.sessions_bought,
        payments: pays,
        dateCounts,
        totalAtt: dates.length
      };
    });
    
    res.json({ months, students: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 출석 토글 API (셀 클릭)
app.post('/api/attendance-toggle', (req, res) => {
  try {
    const { student_id, date } = req.body;
    if (!student_id || !date) return res.status(400).json({ error: 'student_id, date required' });
    
    // Find or create session for this date/program
    const student = db.prepare('SELECT program_id FROM students WHERE id=?').get(student_id);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    let session = db.prepare('SELECT id FROM sessions WHERE program_id=? AND session_date=?').get(student.program_id, date);
    if (!session) {
      // Create session
      const prog = db.prepare('SELECT start_time, end_time FROM programs WHERE id=?').get(student.program_id);
      const r = db.prepare('INSERT INTO sessions (program_id, session_date, start_time, end_time, status) VALUES (?,?,?,?,?)')
        .run(student.program_id, date, prog?.start_time||'19:00', prog?.end_time||'21:00', 'completed');
      session = { id: r.lastInsertRowid };
    }
    
    // Check if attendance exists
    const att = db.prepare('SELECT id, status FROM attendance WHERE session_id=? AND student_id=?').get(session.id, student_id);
    
    if (att) {
      // Toggle: remove attendance
      db.prepare('DELETE FROM attendance WHERE id=?').run(att.id);
      res.json({ action: 'removed', student_id, date });
    } else {
      // Add attendance
      db.prepare('INSERT INTO attendance (session_id, student_id, status) VALUES (?,?,?)').run(session.id, student_id, 'present');
      res.json({ action: 'added', student_id, date });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 날짜 추가 API
app.post('/api/attendance-add-date', (req, res) => {
  try {
    const { program_id, date } = req.body;
    if (!program_id || !date) return res.status(400).json({ error: 'program_id, date required' });
    
    const exists = db.prepare('SELECT id FROM sessions WHERE program_id=? AND session_date=?').get(program_id, date);
    if (exists) return res.json({ exists: true, id: exists.id });
    
    const prog = db.prepare('SELECT start_time, end_time FROM programs WHERE id=?').get(program_id);
    const r = db.prepare('INSERT INTO sessions (program_id, session_date, start_time, end_time, status) VALUES (?,?,?,?,?)')
      .run(program_id, date, prog?.start_time||'19:00', prog?.end_time||'21:00', 'completed');
    res.json({ created: true, id: r.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ====== STUDENT DETAIL (출석/결제 이력) ======
app.get('/api/students/:id/detail', (req, res) => {
  try {
    const id = Number(req.params.id);
    const student = db.prepare(`
      SELECT s.*, p.name as program_name, p.billing_type, p.monthly_fee, p.per_session_fee
      FROM students s LEFT JOIN programs p ON s.program_id=p.id
      WHERE s.id=?
    `).get(id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const payments = db.prepare(`
      SELECT py.*, pr.name as program_name
      FROM payments py LEFT JOIN programs pr ON py.program_id=pr.id
      WHERE py.student_id=? ORDER BY py.payment_date DESC
    `).all(id);

    const attendance = db.prepare(`
      SELECT a.id, a.status, a.checked_at, ss.session_date, ss.start_time, ss.end_time,
        ss.program_id, pr.name as program_name
      FROM attendance a
      JOIN sessions ss ON a.session_id=ss.id
      LEFT JOIN programs pr ON ss.program_id=pr.id
      WHERE a.student_id=?
      ORDER BY ss.session_date DESC, ss.start_time DESC
    `).all(id);

    // 현재 사이클 잔여횟수
    const lastPay = payments[0] || null;
    const billingType = student.billing_type || (student.payment_type === 'per_session' ? 'per_session' : 'monthly');
    let bought = null, used = 0, remaining = null, nextDue = null;
    if (billingType === 'per_session') {
      bought = lastPay?.sessions_bought || student.sessions_bought || null;
      if (lastPay) {
        used = db.prepare(`
          SELECT COUNT(*) c FROM attendance a JOIN sessions ss ON a.session_id=ss.id
          WHERE a.student_id=? AND a.status='present' AND ss.session_date >= ?
        `).get(id, lastPay.payment_date).c;
        remaining = bought ? Math.max(0, bought - used) : null;
      }
    } else if (lastPay) {
      nextDue = computeNextDue(lastPay.payment_date, student.billing_day);
    }

    const totalPaid = payments.reduce((s,p)=>s+(p.amount||0), 0);
    const totalAtt = attendance.filter(a=>a.status==='present').length;

    let memos = []; try { memos = JSON.parse(student.memos || '[]'); } catch(_) {}
    const totalSessions = student.total_sessions || 0;
    const usedSessions = student.used_sessions || 0;
    const remainingSessions = Math.max(0, totalSessions - usedSessions);

    res.json({
      student, payments, attendance, memos,
      summary: { billingType, bought, used, remaining, nextDue, totalPaid, totalAtt, totalSessions, usedSessions, remainingSessions, endDate: student.end_date }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ====== TELEGRAM 알림 ======
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '8171404664';
const NOTI_FILE = path.resolve(__dirname, 'notifications.json');

function saveLocalNotification(info) {
  const fs = require('fs');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(NOTI_FILE, 'utf8')); } catch(_) {}
  list.push({ ...info, timestamp: new Date().toISOString(), read: false });
  fs.writeFileSync(NOTI_FILE, JSON.stringify(list.slice(-200), null, 2));
}

function sendTelegram(text) {
  return new Promise(resolve => {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('붙여넣기')) {
      saveLocalNotification({ type: 'lesson-alert', text });
      return resolve({ ok: false, fallback: 'file' });
    }
    try {
      const https = require('https');
      const data = JSON.stringify({ chat_id: MANAGER_CHAT_ID, text, parse_mode: 'Markdown' });
      const req = https.request(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, resp => { let b=''; resp.on('data',c=>b+=c); resp.on('end',()=>resolve({ ok: resp.statusCode<400, body: b })); });
      req.on('error', e => { saveLocalNotification({ type: 'lesson-alert', text, error: e.message }); resolve({ ok: false, error: e.message }); });
      req.write(data); req.end();
    } catch (e) {
      saveLocalNotification({ type: 'lesson-alert', text, error: e.message });
      resolve({ ok: false, error: e.message });
    }
  });
}

// 미납/잔여횟수 부족 알림 (수동 트리거 또는 cron)
app.post('/api/notify/unpaid', async (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.name, s.phone, p.name as program, p.billing_type, p.billing_day,
        (SELECT payment_date FROM payments WHERE student_id=s.id ORDER BY payment_date DESC LIMIT 1) as last_paid,
        (SELECT sessions_bought FROM payments WHERE student_id=s.id AND sessions_bought IS NOT NULL ORDER BY payment_date DESC LIMIT 1) as last_bought,
        (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON a.session_id=ss.id
         WHERE a.student_id=s.id AND a.status='present'
         AND ss.session_date >= COALESCE((SELECT payment_date FROM payments WHERE student_id=s.id ORDER BY payment_date DESC LIMIT 1), date('now','-30 days'))
        ) as att_since_paid
      FROM students s LEFT JOIN programs p ON s.program_id=p.id
      WHERE s.status='active'
    `).all();

    const alerts = [];
    rows.forEach(r => {
      const billingType = r.billing_type || 'per_session';
      if (billingType === 'monthly') {
        if (!r.last_paid) { alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: '미납 (월정액)' }); return; }
        const due = computeNextDue(r.last_paid, r.billing_day);
        if (!due) return;
        const days = Math.floor((new Date(due+'T00:00:00').getTime() - Date.now()) / 86400000);
        if (days < 0) alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: `결제일 ${-days}일 경과 (다음 ${due})` });
        else if (days <= 3) alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: `${days}일 후 결제일 (${due})` });
      } else {
        const bought = r.last_bought;
        if (!bought) { if (!r.last_paid) alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: '미납 (회수제)' }); return; }
        const remaining = Math.max(0, bought - (r.att_since_paid||0));
        if (remaining === 0) alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: `회차 소진 (${bought}회)` });
        else if (remaining === 1) alerts.push({ name: r.name, phone: r.phone, program: r.program, reason: `1회 남음 (${bought}회 중)` });
      }
    });

    if (!alerts.length) {
      return res.json({ ok: true, count: 0, message: '알릴 학생이 없습니다' });
    }

    const lines = alerts.map(a => `• *${a.name}* — ${a.program||'-'} — ${a.reason}${a.phone?` (${a.phone})`:''}`);
    const text = `🎾 *레슨 결제 알림* (${new Date(Date.now()+8*3600000).toISOString().split('T')[0]})\n\n` + lines.join('\n');
    const r = await sendTelegram(text);
    res.json({ ok: true, count: alerts.length, alerts, telegram: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 알림 이력 조회 (텔레그램 미설정 시 파일에 쌓인 것)
app.get('/api/notify/history', (req, res) => {
  const fs = require('fs');
  try { res.json(JSON.parse(fs.readFileSync(NOTI_FILE, 'utf8'))); }
  catch(_) { res.json([]); }
});

app.listen(PORT, () => console.log(`Lesson Manager running on port ${PORT}`));
