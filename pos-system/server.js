const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const multer = require('multer');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir, limits: { fileSize: 10*1024*1024 } });

const app = express();
const PORT = 6040;
const SECRET = 'pos-hawaii-2026';
const STAFF_DB = path.join(__dirname, '../staff-manager/staff.db');
const FINANCE_DB = path.join(__dirname, '../finance-manager/finance.db');
const db = new Database(path.join(__dirname, 'pos.db'));
db.pragma('journal_mode = WAL');

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const pad = n => String(n).padStart(2,'0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const nowStr = () => {
  const d = new Date();
  return `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// === DB Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, price REAL DEFAULT 0, business TEXT NOT NULL,
    category TEXT, stock INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_name TEXT,
    business TEXT, total REAL DEFAULT 0, payment TEXT DEFAULT 'cash',
    note TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER,
    product_name TEXT, qty INTEGER DEFAULT 1, price REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_name TEXT,
    business TEXT, clock_in TEXT, clock_out TEXT,
    date TEXT DEFAULT (date('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    business TEXT, staff_name TEXT, date TEXT DEFAULT (date('now','localtime')),
    is_done INTEGER DEFAULT 0, done_at TEXT
  );
  CREATE TABLE IF NOT EXISTS checklist_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    business TEXT, is_active INTEGER DEFAULT 1
  );
`);

// Seed templates
if (db.prepare("SELECT COUNT(*) as c FROM checklist_templates").get().c === 0) {
  const ins = db.prepare("INSERT INTO checklist_templates (title,business) VALUES (?,?)");
  [['운동기구 점검','피트니스'],['샤워실 청소','피트니스'],['입구 청소','피트니스'],
   ['코트 정리','센터'],['네트 점검','센터'],['식당 위생점검','센터'],
   ['재고 확인','샵'],['매장 청소','샵'],['일일 보고서 작성',null]
  ].forEach(t => ins.run(...t));
}

// === Auth (staff DB에서 읽기) ===
function getStaffDB() { return new Database(STAFF_DB, { readonly: true }); }

function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ','') || req.cookies?.pos_token;
  if (!t) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  try {
    const sdb = getStaffDB();
    const u = sdb.prepare("SELECT u.*,s.name,s.business,s.position FROM users u LEFT JOIN staff s ON u.staff_id=s.id WHERE u.username=?").get(username);
    sdb.close();
    if (!u || u.password !== password) return res.status(401).json({ error: '로그인 실패' });
    const token = jwt.sign({ username:u.username, name:u.name||u.username, role:u.role, business:u.business }, SECRET, { expiresIn:'30d' });
    res.cookie('pos_token', token, { httpOnly:false, maxAge:30*24*60*60*1000, path:'/', sameSite:'lax' });
    res.json({ token, user:{ username:u.username, name:u.name, role:u.role, business:u.business }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// === Products ===
app.get('/api/products', auth, (req, res) => {
  let q = "SELECT * FROM products WHERE is_active=1"; const p = [];
  if (req.query.business) { q += " AND business=?"; p.push(req.query.business); }
  res.json(db.prepare(q + " ORDER BY business,category,name").all(...p));
});
app.post('/api/products', auth, adminOnly, (req, res) => {
  const { name, price, business, category, stock } = req.body;
  const r = db.prepare("INSERT INTO products (name,price,business,category,stock) VALUES (?,?,?,?,?)").run(name, price||0, business, category, stock||0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/products/:id', auth, adminOnly, (req, res) => {
  const { name, price, business, category, stock, is_active } = req.body;
  db.prepare("UPDATE products SET name=?,price=?,business=?,category=?,stock=?,is_active=? WHERE id=?").run(name, price, business, category, stock, is_active??1, +req.params.id);
  res.json({ ok:true });
});
app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  db.prepare("UPDATE products SET is_active=0 WHERE id=?").run(+req.params.id);
  res.json({ ok:true });
});

// === Sales (POS) ===
app.post('/api/sales', auth, (req, res) => {
  const { business, items, payment, note } = req.body;
  if (!items?.length) return res.status(400).json({ error: '상품 없음' });
  const total = items.reduce((s,i) => s + i.price * i.qty, 0);
  const sale = db.transaction(() => {
    const r = db.prepare("INSERT INTO sales (staff_name,business,total,payment,note) VALUES (?,?,?,?,?)").run(req.user.name, business, total, payment||'현금', note);
    const ins = db.prepare("INSERT INTO sale_items (sale_id,product_name,qty,price) VALUES (?,?,?,?)");
    const dec = db.prepare("UPDATE products SET stock=MAX(0,stock-?) WHERE id=? AND stock>0");
    for (const i of items) { ins.run(r.lastInsertRowid, i.name, i.qty, i.price); if (i.id) dec.run(i.qty, i.id); }
    return { id: r.lastInsertRowid, total };
  })();
  // Finance sync
  try {
    if (fs.existsSync(FINANCE_DB)) {
      const fdb = new Database(FINANCE_DB);
      const bizMap = { '피트니스':2, '센터':1, '샵':3 };
      const catMap = { '피트니스':36, '센터':22, '샵':91 };
      fdb.prepare("INSERT INTO transactions (business_id,category_id,type,amount,description,payment_method,transaction_date,created_by) VALUES (?,?,'income',?,?,?,?,1)")
        .run(bizMap[business]||1, catMap[business]||1, total, 'POS #'+sale.id+' '+business, payment||'현금', todayStr());
      fdb.close();
    }
  } catch(e) { console.error('Finance sync:', e.message); }
  res.json({ ok:true, id:sale.id, total });
});
app.get('/api/sales', auth, adminOnly, (req, res) => {
  let q = "SELECT * FROM sales WHERE 1=1"; const p = [];
  if (req.query.date) { q += " AND date(created_at)=?"; p.push(req.query.date); }
  if (req.query.from) { q += " AND date(created_at)>=?"; p.push(req.query.from); }
  if (req.query.to) { q += " AND date(created_at)<=?"; p.push(req.query.to); }
  if (req.query.business) { q += " AND business=?"; p.push(req.query.business); }
  res.json(db.prepare(q + " ORDER BY created_at DESC LIMIT 500").all(...p));
});
app.get('/api/sales/:id', auth, adminOnly, (req, res) => {
  const sale = db.prepare("SELECT * FROM sales WHERE id=?").get(+req.params.id);
  const items = db.prepare("SELECT * FROM sale_items WHERE sale_id=?").all(+req.params.id);
  res.json({ sale, items });
});

// === Attendance ===
app.post('/api/attendance/in', auth, (req, res) => {
  const today = todayStr(), now = nowStr();
  if (db.prepare("SELECT id FROM attendance WHERE staff_name=? AND date=? AND clock_out IS NULL").get(req.user.name, today))
    return res.status(400).json({ error: '이미 출근됨' });
  db.prepare("INSERT INTO attendance (staff_name,business,clock_in,date) VALUES (?,?,?,?)").run(req.user.name, req.user.business, now, today);
  res.json({ ok:true, time:now });
});
app.post('/api/attendance/out', auth, (req, res) => {
  const today = todayStr(), now = nowStr();
  const rec = db.prepare("SELECT id FROM attendance WHERE staff_name=? AND date=? AND clock_out IS NULL").get(req.user.name, today);
  if (!rec) return res.status(400).json({ error: '출근 기록 없음' });
  db.prepare("UPDATE attendance SET clock_out=? WHERE id=?").run(now, rec.id);
  res.json({ ok:true, time:now });
});
app.get('/api/attendance/today', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM attendance WHERE staff_name=? AND date=?").get(req.user.name, todayStr()) || {});
});
app.get('/api/attendance', auth, (req, res) => {
  let q = "SELECT * FROM attendance WHERE 1=1"; const p = [];
  if (req.user.role !== 'admin') { q += " AND staff_name=?"; p.push(req.user.name); }
  else if (req.query.staff) { q += " AND staff_name=?"; p.push(req.query.staff); }
  if (req.query.from) { q += " AND date>=?"; p.push(req.query.from); }
  if (req.query.to) { q += " AND date<=?"; p.push(req.query.to); }
  res.json(db.prepare(q + " ORDER BY date DESC, clock_in DESC LIMIT 200").all(...p));
});

// === Checklists ===
app.get('/api/checklist/templates', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM checklist_templates WHERE is_active=1 ORDER BY business,title").all());
});
app.post('/api/checklist/templates', auth, adminOnly, (req, res) => {
  const { title, business } = req.body;
  const r = db.prepare("INSERT INTO checklist_templates (title,business) VALUES (?,?)").run(title, business);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/checklist/templates/:id', auth, adminOnly, (req, res) => {
  db.prepare("UPDATE checklist_templates SET is_active=0 WHERE id=?").run(+req.params.id);
  res.json({ ok:true });
});
app.get('/api/checklist', auth, (req, res) => {
  const date = req.query.date || todayStr();
  let q = "SELECT * FROM checklists WHERE date=?"; const p = [date];
  if (req.user.role !== 'admin') { q += " AND staff_name=?"; p.push(req.user.name); }
  else if (req.query.staff) { q += " AND staff_name=?"; p.push(req.query.staff); }
  res.json(db.prepare(q + " ORDER BY is_done, title").all(...p));
});
app.post('/api/checklist/assign', auth, adminOnly, (req, res) => {
  const today = todayStr();
  try {
    const sdb = getStaffDB();
    const staff = sdb.prepare("SELECT name,business FROM staff WHERE is_active=1").all();
    sdb.close();
    const tpls = db.prepare("SELECT * FROM checklist_templates WHERE is_active=1").all();
    const ins = db.prepare("INSERT OR IGNORE INTO checklists (title,business,staff_name,date) VALUES (?,?,?,?)");
    db.transaction(() => {
      for (const s of staff) for (const t of tpls.filter(t => !t.business || t.business === s.business))
        ins.run(t.title, s.business, s.name, today);
    })();
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/checklist/:id/toggle', auth, (req, res) => {
  const item = db.prepare("SELECT * FROM checklists WHERE id=?").get(+req.params.id);
  if (!item) return res.status(404).json({ error: '없음' });
  if (req.user.role !== 'admin' && item.staff_name !== req.user.name) return res.status(403).json({ error: '권한 없음' });
  const now = item.is_done ? null : nowStr();
  db.prepare("UPDATE checklists SET is_done=?,done_at=? WHERE id=?").run(item.is_done?0:1, now, item.id);
  res.json({ ok:true });
});
app.post('/api/checklist', auth, (req, res) => {
  const { title, business, staff_name } = req.body;
  const name = req.user.role === 'admin' ? (staff_name || req.user.name) : req.user.name;
  const r = db.prepare("INSERT INTO checklists (title,business,staff_name,date) VALUES (?,?,?,?)").run(title, business||req.user.business, name, todayStr());
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/checklist/:id', auth, (req, res) => {
  db.prepare("DELETE FROM checklists WHERE id=?").run(+req.params.id);
  res.json({ ok:true });
});

// === Dashboard ===
app.get('/api/dashboard', auth, (req, res) => {
  const today = todayStr();
  const month = today.slice(0,7);
  const d = {};
  if (req.user.role === 'admin') {
    d.todaySales = db.prepare("SELECT business,SUM(total) as total,COUNT(*) as cnt FROM sales WHERE date(created_at)=? GROUP BY business").all(today);
    d.monthSales = db.prepare("SELECT SUM(total) as total FROM sales WHERE date(created_at) LIKE ?").get(month+'%');
    d.lowStock = db.prepare("SELECT * FROM products WHERE stock<=5 AND is_active=1 ORDER BY stock LIMIT 10").all();
    d.todayAttendance = db.prepare("SELECT * FROM attendance WHERE date=? ORDER BY clock_in").all(today);
  }
  d.myAttendance = db.prepare("SELECT * FROM attendance WHERE staff_name=? AND date=?").get(req.user.name, today);
  d.myChecklist = db.prepare("SELECT * FROM checklists WHERE staff_name=? AND date=? ORDER BY is_done,title").all(req.user.name, today);
  res.json(d);
});

// Staff list (from staff DB)
app.get('/api/staff', auth, (req, res) => {
  try {
    const sdb = getStaffDB();
    const staff = sdb.prepare("SELECT id,name,business,position,role FROM staff WHERE is_active=1 ORDER BY business,name").all();
    sdb.close();
    res.json(staff);
  } catch(e) { res.json([]); }
});


// === Finance DB Read (admin only) ===
app.get('/api/finance/summary', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json({businesses:[],months:[]});
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const businesses = fdb.prepare("SELECT b.id,b.name,b.icon,SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) as income,SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) as expense FROM businesses b LEFT JOIN transactions t ON b.id=t.business_id AND t.transaction_date >= ? GROUP BY b.id ORDER BY b.id").all(req.query.from || '2026-01-01');
    const months = fdb.prepare("SELECT strftime('%Y-%m',transaction_date) as month,type,SUM(amount) as total FROM transactions WHERE transaction_date >= ? GROUP BY month,type ORDER BY month").all(req.query.from || '2026-01-01');
    const today = todayStr();
    const todayData = fdb.prepare("SELECT b.name as biz,t.type,SUM(t.amount) as total FROM transactions t JOIN businesses b ON t.business_id=b.id WHERE t.transaction_date=? GROUP BY b.name,t.type").all(today);
    fdb.close();
    res.json({businesses,months,today:todayData});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/finance/transactions', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json([]);
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    let q = "SELECT t.*,b.name as biz_name,c.name as cat_name FROM transactions t JOIN businesses b ON t.business_id=b.id LEFT JOIN categories c ON t.category_id=c.id WHERE 1=1";
    const p = [];
    if (req.query.from) { q += " AND t.transaction_date>=?"; p.push(req.query.from); }
    if (req.query.to) { q += " AND t.transaction_date<=?"; p.push(req.query.to); }
    if (req.query.business) { q += " AND b.name=?"; p.push(req.query.business); }
    if (req.query.type) { q += " AND t.type=?"; p.push(req.query.type); }
    q += " ORDER BY t.transaction_date DESC,t.id DESC LIMIT 500";
    const rows = fdb.prepare(q).all(...p);
    fdb.close();
    res.json(rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});


// === Finance DB Write (admin only) ===
app.post('/api/finance/transaction', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.status(500).json({error:'재무 DB 없음'});
  try {
    const fdb = new Database(FINANCE_DB);
    const { business_id, category_id, type, amount, description, payment_method, transaction_date } = req.body;
    if (!business_id || !type || !amount) return res.status(400).json({error:'필수 항목 누락'});
    const r = fdb.prepare("INSERT INTO transactions (business_id,category_id,type,amount,description,payment_method,transaction_date,created_by) VALUES (?,?,?,?,?,?,?,1)")
      .run(business_id, category_id||null, type, amount, description||'', payment_method||'cash', transaction_date||todayStr());
    fdb.close();
    res.json({ok:true, id:r.lastInsertRowid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/finance/transaction/:id', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.status(500).json({error:'재무 DB 없음'});
  try {
    const fdb = new Database(FINANCE_DB);
    fdb.prepare("DELETE FROM transactions WHERE id=?").run(+req.params.id);
    fdb.close();
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/finance/businesses', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json([]);
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const r = fdb.prepare("SELECT * FROM businesses ORDER BY id").all();
    fdb.close();
    res.json(r);
  } catch(e) { res.json([]); }
});

app.get('/api/finance/categories', auth, adminOnly, (req, res) => {
  if (!fs.existsSync(FINANCE_DB)) return res.json([]);
  try {
    const fdb = new Database(FINANCE_DB, {readonly:true});
    const r = fdb.prepare("SELECT * FROM categories ORDER BY business_id,id").all();
    fdb.close();
    res.json(r);
  } catch(e) { res.json([]); }
});

// 엑셀 업로드
app.post('/api/finance/excel', auth, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({error:'파일 없음'});
  try {
    const parserPath = path.join(__dirname, '../finance-manager/excel-parser');
    const { parseExcel } = require(parserPath);
    const parsed = parseExcel(req.file.path, req.file.originalname);
    fs.unlinkSync(req.file.path);
    if (!parsed.entries || !parsed.entries.length) return res.json({ok:false, message:'데이터 없음', parsed});
    const fdb = new Database(FINANCE_DB);
    const ins = fdb.prepare("INSERT INTO transactions (business_id,category_id,type,amount,description,payment_method,transaction_date,created_by) VALUES (?,?,?,?,?,?,?,1)");
    const results = [];
    for (const e of parsed.entries) {
      const dup = fdb.prepare("SELECT id FROM transactions WHERE business_id=? AND category_id=? AND transaction_date=? AND type=? AND amount=?").get(e.business_id, e.category_id, e.transaction_date, e.type, e.amount);
      if (dup) { results.push({skip:true, desc:e.description}); continue; }
      const r = ins.run(e.business_id, e.category_id, e.type, e.amount, e.description, e.payment_method, e.transaction_date);
      results.push({id:r.lastInsertRowid, desc:e.description, amount:e.amount});
    }
    fdb.close();
    res.json({ok:true, type:parsed.type, date:parsed.date, results});
  } catch(e) { try{fs.unlinkSync(req.file.path)}catch(x){} res.status(500).json({error:e.message}); }
});


app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log('[POS] port ' + PORT));
