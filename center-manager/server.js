const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db');
const qpay = require('./qpay');

const app = express();
const PORT = 6004;
const JWT_SECRET = 'center-mgr-2026-secret';

// ====== PROXY: touring & schedule (before body-parser!) ======
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer({});
proxy.on('error', (err, req, res) => { try { res.writeHead(502); res.end('Proxy error'); } catch(e){} });

app.use('/touring', (req, res) => {
  if (req.url === '' || req.url === '/') {
    // serve index directly, no redirect
    req.url = '/';
  }
  proxy.web(req, res, { target: 'http://127.0.0.1:6006' });
});
app.use('/schedule', (req, res) => {
  if (req.url === '' || req.url === '/') {
    req.url = '/';
  }
  proxy.web(req, res, { target: 'http://127.0.0.1:6007' });
});
app.use('/vocab', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6008' });
});
app.use('/fit', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6009' });
});
app.use('/staff', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6010' });
});
app.use('/fitness-direct', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6001' });
});
app.use('/fit-crm', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6001' });
});
app.use('/translate', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6011' });
});
app.use('/chat', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6020' });
});
app.use('/us', (req, res) => {
  if (req.url === '' || req.url === '/') req.url = '/';
  proxy.web(req, res, { target: 'http://127.0.0.1:6021' });
});

app.use(express.json());
app.use(cookieParser());

// ====== 앱 연동 ======
const { syncFinance, syncSchedule } = require('/home/ubuntu/.openclaw/workspace/app-sync');
const FACILITY_NAMES = { 1: 'A코트', 2: 'B코트', 3: 'C코트', 4: '2층코트' };
async function syncToFinance(booking) {
  return syncFinance('center', 'court', {
    amount: booking.amount,
    date: booking.booking_date,
    payment_method: booking.payment_method || 'cash',
    description: `${FACILITY_NAMES[booking.facility_id]||'코트'} ${booking.start_time}~${booking.end_time} ${booking.customer_name||''}`
  });
}
async function syncToSchedule(booking) {
  return syncSchedule({
    title: `🎾 ${FACILITY_NAMES[booking.facility_id]||'코트'} - ${booking.customer_name||'예약'}`,
    category: 'training',
    date: booking.booking_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    location: '하와이센터',
    description: `${booking.customer_name||''} ${booking.customer_phone||''} / ₮${(booking.amount||0).toLocaleString()}`,
    source: 'center',
    color: '#a855f7'
  });
}
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); } }));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.center_token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Session expired' }); }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// Role middleware
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '권한이 없습니다' });
    next();
  };
}

// Public endpoint: court availability (no login needed)
app.get('/api/public/facilities', (req, res) => {
  res.json(db.prepare("SELECT id, name, type, hourly_rate, capacity, status, description FROM facilities WHERE hourly_rate > 0 ORDER BY sort_order").all());
});

app.get('/api/public/bookings', (req, res) => {
  const { date } = req.query;
  const d = date || new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  res.json(db.prepare("SELECT b.facility_id, b.start_time, b.end_time, b.booking_date FROM bookings b WHERE b.booking_date = ? AND b.status != 'cancelled' ORDER BY b.start_time").all(d));
});

app.get('/api/public/classes', (req, res) => {
  res.json(db.prepare("SELECT name, instructor, day_of_week, start_time, end_time, max_students, current_students, monthly_fee, description FROM classes WHERE status = 'active' ORDER BY name").all());
});

// 고객 회원가입 (로그인 불필요)
app.post('/api/public/register', (req, res) => {
  const { username, password, name, phone, gender, birth_date } = req.body;
  if (!username || !password || !name || !phone) return res.status(400).json({ error: '필수 항목을 입력하세요' });
  if (username.length < 3) return res.status(400).json({ error: '아이디는 3자 이상이어야 합니다' });
  if (password.length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다' });
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(400).json({ error: '이미 사용 중인 아이디입니다' });
  const phoneExists = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  if (phoneExists) return res.status(400).json({ error: '이미 등록된 전화번호입니다' });
  const r = db.prepare("INSERT INTO users (username, password, name, phone, gender, birth_date, role) VALUES (?,?,?,?,?,?,?)")
    .run(username, password, name, phone, gender || 'M', birth_date, 'customer');
  // 회원 테이블에도 등록
  db.prepare("INSERT INTO members (name, phone, gender, birth_date, membership_type, status) VALUES (?,?,?,?,?,?)")
    .run(name, phone, gender || 'M', birth_date, '일반', 'active');
  const token = jwt.sign({ id: r.lastInsertRowid, username, name, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: r.lastInsertRowid, name, role: 'customer' }, message: '회원가입 완료!' });
});

// 고객 예약 (로그인 필요)
app.get('/api/public/notices', (req, res) => {
  res.json(db.prepare("SELECT title, content, priority, created_at FROM notices WHERE priority = 'urgent' OR created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 10").all());
});

// QPay 콜백 (외부에서 호출, 인증 불필요)
app.get('/api/qpay/callback', async (req, res) => {
  const { slot_id } = req.query;
  console.log('📱 QPay 콜백 수신:', slot_id);
  if (!slot_id) return res.send('OK');
  
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(slot_id);
  if (!booking || !booking.qpay_invoice_id) return res.send('OK');
  
  try {
    const result = await qpay.checkPayment(booking.qpay_invoice_id);
    if (result.count > 0) {
      db.prepare("UPDATE bookings SET status = 'confirmed', payment_status = 'paid', notes = '✅ QPay 결제 완료' WHERE id = ?").run(slot_id);
      console.log('✅ 예약 자동 확정:', slot_id);
      // QPay 결제 완료 → 재무+스케줄 연동
      syncToFinance(booking).catch(()=>{});
      syncToSchedule(booking).catch(()=>{});
    }
  } catch(e) { console.error('QPay 결제 확인 오류:', e.message); }
  res.send('OK');
});

// QPay 결제 상태 확인 (고객이 폴링)
app.get('/api/qpay/check/:bookingId', async (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  if (booking.payment_status === 'paid') return res.json({ paid: true, status: 'confirmed' });
  if (!booking.qpay_invoice_id) return res.json({ paid: false, status: booking.status });
  
  try {
    const result = await qpay.checkPayment(booking.qpay_invoice_id);
    if (result.count > 0) {
      db.prepare("UPDATE bookings SET status = 'confirmed', payment_status = 'paid', notes = '✅ QPay 결제 완료' WHERE id = ?").run(req.params.bookingId);
      // QPay 폴링 결제 확인 → 재무+스케줄 연동
      syncToFinance(booking).catch(()=>{});
      syncToSchedule(booking).catch(()=>{});
      return res.json({ paid: true, status: 'confirmed' });
    }
  } catch(e) { console.error('QPay 확인 오류:', e.message); }
  res.json({ paid: false, status: booking.status });
});

app.use('/api', auth);

// ====== USER MANAGEMENT (admin only) ======
app.get('/api/users', requireRole('admin'), (req, res) => {
  res.json(db.prepare("SELECT id, username, name, role, created_at FROM users ORDER BY role, name").all());
});

app.post('/api/users', requireRole('admin'), (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: '필수 항목을 입력하세요' });
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(400).json({ error: '이미 존재하는 아이디입니다' });
  const r = db.prepare("INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)").run(username, password, name, role || 'customer');
  res.json({ id: r.lastInsertRowid, message: '사용자 등록 완료' });
});

app.put('/api/users/:id', requireRole('admin'), (req, res) => {
  const { name, role, password } = req.body;
  if (password) {
    db.prepare("UPDATE users SET name=?, role=?, password=? WHERE id=?").run(name, role, password, req.params.id);
  } else {
    db.prepare("UPDATE users SET name=?, role=? WHERE id=?").run(name, role, req.params.id);
  }
  res.json({ message: '수정 완료' });
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다' });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== MEMBERS ======
app.get('/api/members', (req, res) => {
  const { q, status } = req.query;
  let sql = "SELECT * FROM members WHERE 1=1";
  const p = [];
  if (status) { sql += " AND status = ?"; p.push(status); }
  if (q) { sql += " AND (name LIKE ? OR phone LIKE ?)"; p.push('%'+q+'%', '%'+q+'%'); }
  sql += " ORDER BY created_at DESC";
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/members/:id', (req, res) => {
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

app.post('/api/members', (req, res) => {
  const { name, phone, gender, birth_date, membership_type, start_date, end_date, locker_no, notes } = req.body;
  if (!name) return res.status(400).json({ error: '이름을 입력하세요' });
  const r = db.prepare("INSERT INTO members (name, phone, gender, birth_date, membership_type, start_date, end_date, locker_no, notes) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(name, phone, gender || 'M', birth_date, membership_type || '일반', start_date, end_date, locker_no, notes);
  res.json({ id: r.lastInsertRowid, message: '회원 등록 완료' });
});

app.put('/api/members/:id', (req, res) => {
  const { name, phone, gender, birth_date, membership_type, start_date, end_date, locker_no, status, notes } = req.body;
  db.prepare("UPDATE members SET name=?, phone=?, gender=?, birth_date=?, membership_type=?, start_date=?, end_date=?, locker_no=?, status=?, notes=? WHERE id=?")
    .run(name, phone, gender, birth_date, membership_type, start_date, end_date, locker_no, status || 'active', notes, req.params.id);
  res.json({ message: '수정 완료' });
});

app.delete('/api/members/:id', (req, res) => {
  db.prepare("DELETE FROM members WHERE id = ?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

app.get('/api/members/stats/summary', (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as cnt FROM members").get().cnt;
  const active = db.prepare("SELECT COUNT(*) as cnt FROM members WHERE status = 'active'").get().cnt;
  const expired = db.prepare("SELECT COUNT(*) as cnt FROM members WHERE end_date < date('now') AND status = 'active'").get().cnt;
  const expiring = db.prepare("SELECT COUNT(*) as cnt FROM members WHERE end_date BETWEEN date('now') AND date('now', '+7 days') AND status = 'active'").get().cnt;
  res.json({ total, active, expired, expiring });
});

// ====== MY BOOKINGS (customer) ======
app.get('/api/my-bookings', (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id
    WHERE b.created_by = ? AND b.status != 'cancelled'
    ORDER BY b.booking_date DESC, b.start_time
  `).all(req.user.id);
  res.json(bookings);
});

app.post('/api/my-bookings', async (req, res) => {
  const { facility_id, start_time, end_time, booking_date, payment_method } = req.body;
  if (!facility_id || !start_time || !end_time || !booking_date) return res.status(400).json({ error: '필수 항목을 입력하세요' });
  
  // 과거 날짜 체크
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  if (booking_date < today) return res.status(400).json({ error: '과거 날짜는 예약할 수 없습니다' });

  // 중복 체크
  const conflict = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE facility_id = ? AND booking_date = ? AND status != 'cancelled' AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))").get(facility_id, booking_date, end_time, start_time, end_time, start_time, start_time, end_time);
  if (conflict.c > 0) return res.status(400).json({ error: '해당 시간에 이미 예약이 있습니다' });

  const facility = db.prepare("SELECT * FROM facilities WHERE id = ?").get(facility_id);
  const hours = (parseInt(end_time) - parseInt(start_time));
  const amount = (facility?.hourly_rate || 0) * hours;

  const user = db.prepare("SELECT name, phone FROM users WHERE id = ?").get(req.user.id);
  
  const r = db.prepare("INSERT INTO bookings (facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount, payment_method, notes, created_by, status, payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(facility_id, user?.name || req.user.name, user?.phone || '', start_time, end_time, booking_date, amount, payment_method || 'qpay', '고객 직접 예약', req.user.id, 'pending', 'unpaid');
  
  const bookingId = r.lastInsertRowid;
  const facilityName = facility.name;

  // QPay 결제인 경우 인보이스 생성
  if (!payment_method || payment_method === 'qpay') {
    try {
      const invoice = await qpay.createInvoice({
        invoiceId: 'CTR-' + bookingId,
        amount,
        description: `${facilityName} 예약 (${booking_date} ${start_time}~${end_time})`,
        callbackParam: bookingId
      });
      // 인보이스 정보 저장
      db.prepare("UPDATE bookings SET qpay_invoice_id = ?, qpay_qr = ?, notes = '결제 대기' WHERE id = ?")
        .run(invoice.invoice_id, invoice.qr_text || '', bookingId);
      
      return res.json({ 
        id: bookingId, amount, 
        qpay: { invoice_id: invoice.invoice_id, qr_text: invoice.qr_text, qr_image: invoice.qr_image, urls: invoice.urls },
        message: 'QPay 결제를 완료하면 예약이 자동 확정됩니다!'
      });
    } catch(e) {
      console.error('QPay 인보이스 생성 실패:', e.message);
      // QPay 실패 시 수동 승인으로 전환
      notifyManager({ bookingId, customerName: user?.name || req.user.name, customerPhone: user?.phone || '', facilityName, date: booking_date, startTime: start_time, endTime: end_time, amount, paymentMethod: 'qpay (실패→수동)' });
      return res.json({ id: bookingId, amount, message: '예약 신청 완료! QPay 연결 오류로 매니저 승인 후 확정됩니다.' });
    }
  }

  // 현금/카드 등은 매니저 승인 방식
  notifyManager({ bookingId, customerName: user?.name || req.user.name, customerPhone: user?.phone || '', facilityName, date: booking_date, startTime: start_time, endTime: end_time, amount, paymentMethod: payment_method });
  res.json({ id: bookingId, amount, message: '예약 신청 완료! 매니저 승인 후 확정됩니다.' });
});

app.delete('/api/my-bookings/:id', (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ? AND created_by = ?").get(req.params.id, req.user.id);
  if (!booking) return res.status(404).json({ error: '예약을 찾을 수 없습니다' });
  // 당일 취소 불가
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  if (booking.booking_date <= today) return res.status(400).json({ error: '당일 예약은 취소할 수 없습니다. 프론트에 문의하세요.' });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: '예약이 취소되었습니다' });
});

// DELETE booking (완전 삭제 - admin/staff only)
app.delete('/api/bookings/:id', auth, (req, res) => {
  if (req.user.role === 'customer') return res.status(403).json({ error: '권한 없음' });
  db.prepare("DELETE FROM bookings WHERE id = ?").run(req.params.id);
  res.json({ message: '예약이 삭제되었습니다' });
});

// ====== BOOKING APPROVAL ======
app.get('/api/pending-bookings', requireRole('admin', 'staff'), (req, res) => {
  res.json(db.prepare(`
    SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id
    WHERE b.status = 'pending' ORDER BY b.created_at DESC
  `).all());
});

app.post('/api/bookings/:id/approve', requireRole('admin', 'staff'), (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'pending') return res.status(400).json({ error: '이미 처리된 예약입니다' });
  db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(req.params.id);
  
  // 승인 시 재무+스케줄 연동
  syncToFinance(b).catch(()=>{});
  syncToSchedule(b).catch(()=>{});
  
  res.json({ message: '예약이 승인되었습니다' });
});

app.post('/api/bookings/:id/reject', requireRole('admin', 'staff'), (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'pending') return res.status(400).json({ error: '이미 처리된 예약입니다' });
  const { reason } = req.body;
  db.prepare("UPDATE bookings SET status = 'rejected', notes = notes || ? WHERE id = ?").run(' [거절: ' + (reason || '사유 없음') + ']', req.params.id);
  res.json({ message: '예약이 거절되었습니다' });
});

// Telegram 알림 전송
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '8171404664';

async function notifyManager(info) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[알림] 텔레그램 봇 토큰 미설정. 콘솔 알림:', JSON.stringify(info));
    // 파일로 알림 저장
    const fs = require('fs');
    const notiFile = path.join(__dirname, 'notifications.json');
    let notis = [];
    try { notis = JSON.parse(fs.readFileSync(notiFile, 'utf8')); } catch(e) {}
    notis.push({ ...info, timestamp: new Date().toISOString(), read: false });
    fs.writeFileSync(notiFile, JSON.stringify(notis, null, 2));
    return;
  }
  try {
    const msg = `🎾 *새 예약 신청*\n\n👤 ${info.customerName} (${info.customerPhone})\n🏟️ ${info.facilityName}\n📅 ${info.date}\n⏰ ${info.startTime} ~ ${info.endTime}\n💰 ₮${Number(info.amount).toLocaleString()}\n💳 ${info.paymentMethod}\n\n승인: /approve_${info.bookingId}\n거절: /reject_${info.bookingId}`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const https = require('https');
    const data = JSON.stringify({ chat_id: MANAGER_CHAT_ID, text: msg, parse_mode: 'Markdown' });
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
    req.write(data);
    req.end();
  } catch(e) { console.log('[알림 오류]', e.message); }
}

// 인앱 알림 조회
app.get('/api/notifications', requireRole('admin', 'staff'), (req, res) => {
  const fs = require('fs');
  const notiFile = path.join(__dirname, 'notifications.json');
  try { res.json(JSON.parse(fs.readFileSync(notiFile, 'utf8'))); }
  catch(e) { res.json([]); }
});

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const dow = ['일','월','화','수','목','금','토'][new Date(Date.now()+8*3600000).getUTCDay()];

  const facilities = db.prepare('SELECT * FROM facilities ORDER BY sort_order').all();
  
  // 오늘 예약
  const todayBookings = db.prepare(`
    SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id
    WHERE b.booking_date = ? AND b.status != 'cancelled' ORDER BY b.start_time
  `).all(today);

  // 오늘 매출
  const todayRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM bookings WHERE booking_date = ? AND payment_status = 'paid'").get(today);

  // 이번 달 매출
  const monthStart = today.slice(0,7) + '-01';
  const monthRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM bookings WHERE booking_date >= ? AND payment_status = 'paid'").get(monthStart);

  // 오늘 수업
  const todayClasses = db.prepare("SELECT * FROM classes WHERE status = 'active' AND day_of_week LIKE ?").all(`%${dow}%`);

  // 체크리스트
  const openChecks = db.prepare("SELECT * FROM daily_checklist WHERE category = 'open' ORDER BY sort_order").all();
  const closeChecks = db.prepare("SELECT * FROM daily_checklist WHERE category = 'close' ORDER BY sort_order").all();
  const checkedToday = db.prepare("SELECT checklist_id FROM checklist_log WHERE check_date = ?").all(today).map(r => r.checklist_id);

  // 유지보수 필요 장비
  const needsMaintenance = db.prepare("SELECT * FROM equipment WHERE condition IN ('poor','fair') OR next_maintenance <= ?").all(today);

  // 공지
  const notices = db.prepare("SELECT * FROM notices ORDER BY created_at DESC LIMIT 5").all();

  // 승인 대기 예약
  const pendingCount = db.prepare("SELECT COUNT(*) as cnt FROM bookings WHERE status = 'pending'").get().cnt;

  // 한달치 일별 데이터
  const month = req.query.month || today.slice(0,7);
  const monthDays = db.prepare(`
    SELECT booking_date, COUNT(*) as cnt, COALESCE(SUM(amount),0) as revenue,
      SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END) as paid_revenue
    FROM bookings WHERE booking_date LIKE ? AND status != 'cancelled'
    GROUP BY booking_date ORDER BY booking_date
  `).all(month + '%');

  // 시설별 월 이용 현황
  const monthByFacility = db.prepare(`
    SELECT f.name, COUNT(b.id) as cnt, COALESCE(SUM(b.amount),0) as revenue
    FROM bookings b JOIN facilities f ON b.facility_id=f.id
    WHERE b.booking_date LIKE ? AND b.status != 'cancelled'
    GROUP BY f.id ORDER BY revenue DESC
  `).all(month + '%');

  // 월 총계
  const monthTotal = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as revenue FROM bookings WHERE booking_date LIKE ? AND status != 'cancelled'").get(month + '%');

  res.json({ facilities, todayBookings, todayRevenue, monthRevenue, todayClasses, openChecks, closeChecks, checkedToday, needsMaintenance, notices, pendingCount, today, dow, monthDays, monthByFacility, monthTotal, currentMonth: month });
});

// ====== FACILITIES ======
app.get('/api/facilities', (req, res) => res.json(db.prepare('SELECT * FROM facilities ORDER BY sort_order').all()));

app.put('/api/facilities/:id/status', (req, res) => {
  db.prepare("UPDATE facilities SET status = ? WHERE id = ?").run(req.body.status, req.params.id);
  res.json({ message: 'Updated' });
});

app.put('/api/facilities/:id', requireRole('admin'), (req, res) => {
  const { name, hourly_rate, capacity, description } = req.body;
  db.prepare("UPDATE facilities SET name=?, hourly_rate=?, capacity=?, description=? WHERE id=?")
    .run(name, hourly_rate || 0, capacity || 0, description || null, req.params.id);
  res.json({ message: '시설 정보가 수정되었습니다' });
});

// ====== BOOKINGS ======
app.get('/api/bookings/month', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const facId = req.query.facility_id;
  let sql = `SELECT b.*, f.name as facility_name FROM bookings b JOIN facilities f ON b.facility_id=f.id WHERE b.booking_date LIKE ? AND b.status != 'cancelled'`;
  const params = [month + '%'];
  if (facId) { sql += ' AND b.facility_id = ?'; params.push(facId); }
  sql += ' ORDER BY b.booking_date, b.start_time';
  const bookings = db.prepare(sql).all(...params);
  const byDate = {};
  bookings.forEach(b => {
    if (!byDate[b.booking_date]) byDate[b.booking_date] = { bookings: [], revenue: 0, count: 0, groups: {} };
    // 같은 날짜+시간+이름 → 그룹(대회/시합)
    const gKey = b.start_time + '|' + b.end_time + '|' + b.customer_name;
    if (byDate[b.booking_date].groups[gKey]) {
      byDate[b.booking_date].groups[gKey].courts++;
      byDate[b.booking_date].groups[gKey].totalAmount += b.amount || 0;
    } else {
      byDate[b.booking_date].groups[gKey] = { ...b, courts: 1, totalAmount: b.amount || 0 };
      byDate[b.booking_date].bookings.push(byDate[b.booking_date].groups[gKey]);
      byDate[b.booking_date].count++;
    }
    if (b.payment_status === 'paid') byDate[b.booking_date].revenue += b.amount || 0;
  });
  // clean up groups
  Object.values(byDate).forEach(d => { delete d.groups; });
  const totalRevenue = bookings.filter(b=>b.payment_status==='paid').reduce((s,b)=>s+(b.amount||0),0);
  const totalCount = Object.values(byDate).reduce((s,d)=>s+d.count,0);
  res.json({ month, byDate, totalRevenue, totalCount });
});

app.get('/api/bookings', (req, res) => {
  const { date, facility_id } = req.query;
  let sql = "SELECT b.*, f.name as facility_name FROM bookings b JOIN facilities f ON b.facility_id = f.id WHERE 1=1";
  const p = [];
  if (date) { sql += " AND b.booking_date = ?"; p.push(date); }
  if (facility_id) { sql += " AND b.facility_id = ?"; p.push(facility_id); }
  sql += " ORDER BY b.start_time";
  res.json(db.prepare(sql).all(...p));
});

// 전체 코트 일괄 예약 (시합/이벤트)
app.post('/api/bookings/bulk', (req, res) => {
  const { booking_date, start_time, end_time, customer_name, notes, amount, payment_method, facility_ids, override } = req.body;
  if (!booking_date || !start_time || !end_time) return res.status(400).json({ error: '날짜/시간 필수' });

  const courts = facility_ids && facility_ids.length > 0
    ? facility_ids
    : db.prepare("SELECT id FROM facilities WHERE hourly_rate > 0").all().map(f => f.id);

  const results = [];
  const cancelled = [];

  for (const fid of courts) {
    // 기존 예약 충돌 확인 + 강제 시 취소
    if (override) {
      const conflicts = db.prepare("SELECT id, customer_name FROM bookings WHERE facility_id = ? AND booking_date = ? AND status != 'cancelled' AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))").all(fid, booking_date, end_time, start_time, end_time, start_time, start_time, end_time);
      for (const c of conflicts) {
        db.prepare("UPDATE bookings SET status = 'cancelled', notes = notes || ' [시합으로 취소]' WHERE id = ?").run(c.id);
        cancelled.push(c.customer_name || c.id);
      }
    }

    // 금액은 첫 번째 코트에만 (전체 금액)
    const thisAmount = results.length === 0 ? (amount || 0) : 0;
    const r = db.prepare("INSERT INTO bookings (facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount, payment_method, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(fid, customer_name || '🏆 시합/이벤트', '', start_time, end_time, booking_date, thisAmount, payment_method || 'cash', notes || '', req.user.id);
    results.push(r.lastInsertRowid);
  }

  let msg = `${results.length}개 코트 예약 완료`;
  if (cancelled.length) msg += ` (기존 ${cancelled.length}건 취소됨)`;
  res.json({ ids: results, cancelled, message: msg });
});

app.post('/api/bookings', (req, res) => {
  const { facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount, payment_method, notes } = req.body;
  if (!facility_id || !start_time || !end_time) return res.status(400).json({ error: 'Required fields' });
  
  // 중복 체크
  const conflict = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE facility_id = ? AND booking_date = ? AND status != 'cancelled' AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))").get(facility_id, booking_date || new Date(Date.now()+8*3600000).toISOString().split('T')[0], end_time, start_time, end_time, start_time, start_time, end_time);
  if (conflict.c > 0) return res.status(400).json({ error: '해당 시간에 이미 예약이 있습니다' });

  const bkDate = booking_date || new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const r = db.prepare("INSERT INTO bookings (facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount, payment_method, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(facility_id, customer_name, customer_phone, start_time, end_time, bkDate, amount || 0, payment_method || 'cash', notes, req.user.id);
  
  // 앱 연동: 재무 + 스케줄 자동 등록
  const syncData = { facility_id, customer_name, customer_phone, start_time, end_time, booking_date: bkDate, amount: amount || 0, payment_method: payment_method || 'cash' };
  syncToFinance(syncData).catch(()=>{});
  syncToSchedule(syncData).catch(()=>{});
  
  res.json({ id: r.lastInsertRowid, message: '예약 완료' });
});

app.put('/api/bookings/:id', (req, res) => {
  const { status, payment_status, facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount, payment_method, notes } = req.body;
  if (facility_id && start_time && end_time) {
    // Full edit
    const conflict = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE facility_id = ? AND booking_date = ? AND status != 'cancelled' AND id != ? AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))").get(facility_id, booking_date, req.params.id, end_time, start_time, end_time, start_time, start_time, end_time);
    if (conflict.c > 0) return res.status(400).json({ error: '해당 시간에 이미 예약이 있습니다' });
    db.prepare("UPDATE bookings SET facility_id=?, customer_name=?, customer_phone=?, start_time=?, end_time=?, booking_date=?, amount=?, payment_method=?, notes=? WHERE id=?")
      .run(facility_id, customer_name, customer_phone, start_time, end_time, booking_date, amount||0, payment_method||'cash', notes, req.params.id);
  } else {
    if (status) db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, req.params.id);
    if (payment_status) db.prepare("UPDATE bookings SET payment_status = ? WHERE id = ?").run(payment_status, req.params.id);
  }
  res.json({ message: '수정 완료' });
});

app.get('/api/bookings/:id', (req, res) => {
  const b = db.prepare("SELECT b.*, f.name as facility_name FROM bookings b JOIN facilities f ON b.facility_id=f.id WHERE b.id=?").get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

app.delete('/api/bookings/:id', (req, res) => {
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Cancelled' });
});

// ====== CLASSES ======
app.get('/api/classes', (req, res) => res.json(db.prepare("SELECT c.*, f.name as facility_name FROM classes c LEFT JOIN facilities f ON c.facility_id = f.id ORDER BY c.name").all()));

app.post('/api/classes', (req, res) => {
  const { name, instructor, facility_id, day_of_week, start_time, end_time, max_students, monthly_fee, description } = req.body;
  const r = db.prepare("INSERT INTO classes (name,instructor,facility_id,day_of_week,start_time,end_time,max_students,monthly_fee,description) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(name, instructor, facility_id, day_of_week, start_time, end_time, max_students || 20, monthly_fee || 0, description);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/classes/:id', (req, res) => {
  const { name, instructor, facility_id, day_of_week, start_time, end_time, max_students, current_students, monthly_fee, status, description } = req.body;
  db.prepare("UPDATE classes SET name=?,instructor=?,facility_id=?,day_of_week=?,start_time=?,end_time=?,max_students=?,current_students=?,monthly_fee=?,status=?,description=? WHERE id=?")
    .run(name, instructor, facility_id, day_of_week, start_time, end_time, max_students, current_students, monthly_fee, status, description, req.params.id);
  res.json({ message: 'Updated' });
});

// ====== EQUIPMENT ======
app.get('/api/equipment', (req, res) => res.json(db.prepare('SELECT * FROM equipment ORDER BY name').all()));

app.post('/api/equipment', (req, res) => {
  const { name, category, qty, location, purchase_date, purchase_price, condition, notes } = req.body;
  const r = db.prepare("INSERT INTO equipment (name,category,qty,location,purchase_date,purchase_price,condition,notes) VALUES (?,?,?,?,?,?,?,?)")
    .run(name, category, qty || 1, location, purchase_date, purchase_price || 0, condition || 'good', notes);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/equipment/:id', (req, res) => {
  const { name, category, qty, location, condition, notes, next_maintenance } = req.body;
  db.prepare("UPDATE equipment SET name=?,category=?,qty=?,location=?,condition=?,notes=?,next_maintenance=? WHERE id=?")
    .run(name, category, qty, location, condition, notes, next_maintenance, req.params.id);
  res.json({ message: 'Updated' });
});

app.post('/api/equipment/:id/maintenance', (req, res) => {
  const { type, description, cost, done_by } = req.body;
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  db.prepare("INSERT INTO maintenance_log (equipment_id, type, description, cost, done_by) VALUES (?,?,?,?,?)").run(req.params.id, type || 'repair', description, cost || 0, done_by);
  db.prepare("UPDATE equipment SET last_maintenance = ?, condition = 'good' WHERE id = ?").run(today, req.params.id);
  res.json({ message: 'Maintenance logged' });
});

app.get('/api/equipment/:id/history', (req, res) => {
  res.json(db.prepare("SELECT * FROM maintenance_log WHERE equipment_id = ? ORDER BY done_date DESC").all(req.params.id));
});

// ====== CHECKLIST ======
app.post('/api/checklist/check', (req, res) => {
  const { checklist_id } = req.body;
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  try {
    db.prepare("INSERT INTO checklist_log (checklist_id, check_date, checked_by) VALUES (?,?,?)").run(checklist_id, today, req.user.id);
  } catch(e) { /* already checked */ }
  res.json({ message: 'Checked' });
});

app.post('/api/checklist/uncheck', (req, res) => {
  const { checklist_id } = req.body;
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  db.prepare("DELETE FROM checklist_log WHERE checklist_id = ? AND check_date = ?").run(checklist_id, today);
  res.json({ message: 'Unchecked' });
});

// ====== NOTICES ======
app.get('/api/notices', (req, res) => res.json(db.prepare("SELECT * FROM notices ORDER BY created_at DESC LIMIT 20").all()));

app.post('/api/notices', (req, res) => {
  const { title, content, priority } = req.body;
  const r = db.prepare("INSERT INTO notices (title, content, priority, created_by) VALUES (?,?,?,?)").run(title, content, priority || 'normal', req.user.id);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/notices/:id', requireRole('admin','staff'), (req, res) => {
  db.prepare("DELETE FROM notices WHERE id = ?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// moved to before /api/bookings/:id

app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));

const server = app.listen(PORT, () => console.log(`Center Manager running on port ${PORT}`));

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/chat/') || req.url.startsWith('/chat')) {
    req.url = req.url.replace(/^\/chat/, '') || '/';
    proxy.ws(req, socket, head, { target: 'http://127.0.0.1:6020' });
  } else if (req.url.startsWith('/us/') || req.url.startsWith('/us')) {
    req.url = req.url.replace(/^\/us/, '') || '/';
    proxy.ws(req, socket, head, { target: 'http://127.0.0.1:6021' });
  }
});
