const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { parseExcel } = require('./excel-parser');

// Upload storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) cb(null, true);
    else cb(new Error('엑셀 파일(.xlsx)만 업로드 가능합니다.'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
const PORT = 6003;
const JWT_SECRET = 'finance-mgr-2026-secret';


// === Staff features init ===
try {
  db.exec("CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, clock_in TEXT, clock_out TEXT, date TEXT, business TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS checklists (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, user_id INTEGER, username TEXT, date TEXT, is_done INTEGER DEFAULT 0, done_at TEXT, business TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS checklist_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, business TEXT, is_active INTEGER DEFAULT 1)");
  // Seed templates
  const tplCnt = db.prepare("SELECT COUNT(*) as c FROM checklist_templates").get();
  if (tplCnt.c === 0) {
    const ins = db.prepare("INSERT INTO checklist_templates (title,business) VALUES (?,?)");
    [['운동기구 점검','피트니스'],['샤워실 청소','피트니스'],['입구 청소','피트니스'],['코트 정리','센터'],['네트 점검','센터'],['식당 위생점검','센터'],['재고 확인','샵'],['매장 청소','샵'],['일일 보고서','전체']].forEach(t => ins.run(...t));
  }
  // Add staff users if not exist
  const staffUsers = [
    {username:'ysg', password:'1234', name:'유승거', role:'staff'},
    {username:'guen', password:'1234', name:'구엔', role:'staff'},
    {username:'miga', password:'1234', name:'미가', role:'staff'}
  ];
  staffUsers.forEach(u => {
    const exists = db.prepare("SELECT id FROM users WHERE username=?").get(u.username);
    if (!exists) db.prepare("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)").run(u.username, u.password, u.name, u.role);
  });
} catch(e) { console.error('Staff init:', e.message); }


// Fix: 이전 잘못된 date 수정
try {
  const wrongDate = db.prepare("SELECT * FROM attendance WHERE date < clock_in").all();
  wrongDate.forEach(function(a) {
    if (a.clock_in) {
      const correctDate = a.clock_in.slice(0, 10);
      db.prepare("UPDATE attendance SET date=? WHERE id=?").run(correctDate, a.id);
    }
  });
} catch(e) {}

try {
  db.exec("CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), is_active INTEGER DEFAULT 1)");
  db.exec("CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, business TEXT, category TEXT, stock INTEGER DEFAULT 0, min_stock INTEGER DEFAULT 5, unit TEXT DEFAULT 'ea', updated_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS daily_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, business TEXT, date TEXT, content TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
  db.exec("CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER, month TEXT, target_income REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))");
} catch(e) {}

// === Migrations: 체크리스트 업무별 분류 + 재고 전문화 ===
try {
  const addCol = (table, col, def) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch(e) {}
  };
  addCol('checklists', 'category', "TEXT DEFAULT '기타'");
  addCol('checklist_templates', 'category', "TEXT DEFAULT '기타'");
  addCol('inventory', 'initial_stock', 'INTEGER DEFAULT 0');
  addCol('inventory', 'initial_date', "TEXT");
  addCol('inventory', 'unit_price', 'REAL DEFAULT 0');
  addCol('inventory', 'supplier', 'TEXT');
  addCol('inventory', 'notes', 'TEXT');
  addCol('inventory', 'last_in_date', 'TEXT');
  addCol('inventory', 'last_out_date', 'TEXT');
  // 기존 재고 항목들에 initial_stock 백필 (0인 경우 현재 stock으로)
  db.exec("UPDATE inventory SET initial_stock=stock WHERE initial_stock IS NULL OR initial_stock=0");
  db.exec("UPDATE inventory SET initial_date=substr(updated_at,1,10) WHERE initial_date IS NULL");

  // 입출고 이력 테이블
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER,
    item_name TEXT,
    business TEXT,
    action TEXT,
    qty INTEGER,
    before_stock INTEGER,
    after_stock INTEGER,
    note TEXT,
    user_id INTEGER,
    username TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_invlog_item ON inventory_log(inventory_id, created_at DESC)");

  // 기본 체크리스트 템플릿 카테고리 백필 + 추가 시드
  db.exec("UPDATE checklist_templates SET category='청소' WHERE category IS NULL AND title LIKE '%청소%'");
  db.exec("UPDATE checklist_templates SET category='점검' WHERE category IS NULL AND (title LIKE '%점검%' OR title LIKE '%확인%')");
  db.exec("UPDATE checklist_templates SET category='정리' WHERE category IS NULL AND title LIKE '%정리%'");
  db.exec("UPDATE checklist_templates SET category='행정' WHERE category IS NULL AND title LIKE '%보고%'");
  db.exec("UPDATE checklist_templates SET category='기타' WHERE category IS NULL");
  // 같은 백필을 checklists에도
  db.exec("UPDATE checklists SET category='청소' WHERE category IS NULL AND title LIKE '%청소%'");
  db.exec("UPDATE checklists SET category='점검' WHERE category IS NULL AND (title LIKE '%점검%' OR title LIKE '%확인%')");
  db.exec("UPDATE checklists SET category='정리' WHERE category IS NULL AND title LIKE '%정리%'");
  db.exec("UPDATE checklists SET category='행정' WHERE category IS NULL AND title LIKE '%보고%'");
  db.exec("UPDATE checklists SET category='기타' WHERE category IS NULL");
} catch(e) { console.error('Migration:', e.message); }

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.fin_token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { console.error("Auth error:", e.message, "Token:", token?.slice(0,20)); res.status(401).json({ error: "Session expired" }); }
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, business: user.business }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie("fin_token", token, { httpOnly: false, maxAge: 30*24*60*60*1000, path: "/", sameSite: "lax" }); res.json({ token, user: { id: user.id, name: user.name, role: user.role, business: user.business } });
});

app.use('/api', auth);

// ====== BUSINESSES ======
app.get('/api/businesses', (req, res) => res.json(db.prepare('SELECT * FROM businesses ORDER BY sort_order').all()));
app.post('/api/businesses', (req, res) => {
  const { name, icon, color } = req.body;
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 as n FROM businesses").get().n;
  const r = db.prepare("INSERT INTO businesses (name, icon, color, sort_order) VALUES (?,?,?,?)").run(name, icon || '📌', color || '#3b82f6', maxOrder);
  res.json({ id: r.lastInsertRowid, message: '사업체 추가 완료' });
});
app.put('/api/businesses/:id', (req, res) => {
  const { name, icon, color } = req.body;
  db.prepare("UPDATE businesses SET name=?, icon=?, color=? WHERE id=?").run(name, icon, color, req.params.id);
  res.json({ message: '수정 완료' });
});
app.delete('/api/businesses/:id', (req, res) => {
  const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE business_id=?").get(req.params.id).c;
  if (txCount > 0) return res.status(400).json({ error: `거래 ${txCount}건이 있어 삭제 불가. 거래를 먼저 삭제하세요.` });
  db.prepare("DELETE FROM businesses WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== CATEGORIES ======
app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY type, sort_order').all()));
app.post('/api/categories', (req, res) => {
  const { name, type, icon, business_id } = req.body;
  const r = db.prepare("INSERT INTO categories (name, type, icon, business_id) VALUES (?,?,?,?)").run(name, type, icon || '📌', business_id || 0);
  res.json({ id: r.lastInsertRowid, message: '카테고리 추가 완료' });
});
app.put('/api/categories/:id', (req, res) => {
  const { name, type, icon, business_id } = req.body;
  db.prepare("UPDATE categories SET name=?, type=?, icon=?, business_id=? WHERE id=?").run(name, type, icon, business_id || 0, req.params.id);
  res.json({ message: '수정 완료' });
});
app.delete('/api/categories/:id', (req, res) => {
  const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE category_id=?").get(req.params.id).c;
  if (txCount > 0) return res.status(400).json({ error: `거래 ${txCount}건이 있어 삭제 불가` });
  db.prepare("DELETE FROM categories WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 UTC+8에서 8시간 밀려 30일이 29일로 보이는 버그 회피)
function localDateStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const today = localDateStr();
  const monthStart = today.slice(0, 7) + '-01';
  const [yy, mm] = today.split('-').map(Number);
  const monthEndDay = new Date(yy, mm, 0).getDate();
  const monthEnd = `${today.slice(0,7)}-${String(monthEndDay).padStart(2,'0')}`;
  const lastMonthStart = localDateStr(new Date(yy, mm - 2, 1));
  const lastMonthEnd = localDateStr(new Date(yy, mm - 1, 0));

  const businesses = db.prepare('SELECT * FROM businesses ORDER BY sort_order').all();
  const result = { businesses: [], totals: {}, recentTransactions: [] };

  let totalIncome = 0, totalExpense = 0;
  let lastTotalIncome = 0, lastTotalExpense = 0;

  for (const biz of businesses) {
    const monthIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='income' AND transaction_date >= ?").get(biz.id, monthStart).total;
    const monthExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='expense' AND transaction_date >= ?").get(biz.id, monthStart).total;
    const todayIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='income' AND transaction_date = ?").get(biz.id, today).total;
    const todayExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='expense' AND transaction_date = ?").get(biz.id, today).total;
    const lastIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='income' AND transaction_date >= ? AND transaction_date <= ?").get(biz.id, lastMonthStart, lastMonthEnd).total;
    const lastExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='expense' AND transaction_date >= ? AND transaction_date <= ?").get(biz.id, lastMonthStart, lastMonthEnd).total;
    // 전체 기간 합계
    const allIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='income'").get(biz.id).total;
    const allExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE business_id=? AND type='expense'").get(biz.id).total;

    totalIncome += monthIncome; totalExpense += monthExpense;
    lastTotalIncome += lastIncome; lastTotalExpense += lastExpense;

    result.businesses.push({
      ...biz, monthIncome, monthExpense, monthProfit: monthIncome - monthExpense,
      todayIncome, todayExpense, lastIncome, lastExpense,
      allIncome, allExpense, allProfit: allIncome - allExpense,
      incomeChange: lastIncome ? (((monthIncome - lastIncome) / lastIncome) * 100).toFixed(0) : 0
    });
  }

  result.totals = {
    monthIncome: totalIncome, monthExpense: totalExpense, monthProfit: totalIncome - totalExpense,
    lastIncome: lastTotalIncome, lastExpense: lastTotalExpense,
    profitChange: lastTotalIncome - lastTotalExpense ? (((totalIncome - totalExpense - (lastTotalIncome - lastTotalExpense)) / Math.abs(lastTotalIncome - lastTotalExpense)) * 100).toFixed(0) : 0
  };

  // Fixed costs
  result.fixedCosts = db.prepare(`SELECT fc.*, b.name as biz_name, b.icon as biz_icon FROM fixed_costs fc JOIN businesses b ON fc.business_id = b.id WHERE fc.is_active = 1 ORDER BY fc.due_day`).all();
  result.totalFixedCosts = result.fixedCosts.reduce((s, f) => s + f.amount, 0);

  // Employee count & total salary
  result.employeeCount = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status='active'").get().c;
  result.totalSalary = db.prepare("SELECT COALESCE(SUM(salary),0) as total FROM employees WHERE status='active'").get().total;

  // Recent transactions - 이번 달 1일~말일만 표시 (monthEnd는 위에서 계산됨)
  result.recentTransactions = db.prepare(`
    SELECT t.*, b.name as biz_name, b.icon as biz_icon, c.name as cat_name
    FROM transactions t JOIN businesses b ON t.business_id = b.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.transaction_date >= ? AND t.transaction_date <= ?
    ORDER BY t.transaction_date DESC, t.id DESC LIMIT 200
  `).all(monthStart, monthEnd);

  // Monthly trend (6 months)
  result.monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', transaction_date) as month, type, SUM(amount) as total
    FROM transactions GROUP BY month, type ORDER BY month DESC LIMIT 12
  `).all();

  // Category breakdown this month
  result.expenseByCategory = db.prepare(`
    SELECT c.name, SUM(t.amount) as total FROM transactions t JOIN categories c ON t.category_id = c.id
    WHERE t.type = 'expense' AND t.transaction_date >= ? GROUP BY t.category_id ORDER BY total DESC
  `).all(monthStart);

  res.json(result);
});

// ====== TRANSACTIONS ======
app.get('/api/transactions', (req, res) => {
  const { business_id, type, date_from, date_to, category_id } = req.query;
  let sql = `SELECT t.*, b.name as biz_name, b.icon as biz_icon, c.name as cat_name
    FROM transactions t JOIN businesses b ON t.business_id = b.id LEFT JOIN categories c ON t.category_id = c.id WHERE 1=1`;
  const params = [];
  if (business_id) { sql += " AND t.business_id = ?"; params.push(business_id); }
  if (type) { sql += " AND t.type = ?"; params.push(type); }
  if (date_from) { sql += " AND t.transaction_date >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND t.transaction_date <= ?"; params.push(date_to); }
  if (category_id) { sql += " AND t.category_id = ?"; params.push(category_id); }
  sql += " ORDER BY t.transaction_date DESC, t.id DESC LIMIT 200";
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/transactions', (req, res) => {
  const { business_id, category_id, type, amount, description, payment_method, reference_no, transaction_date } = req.body;
  if (!business_id || !type || !amount) return res.status(400).json({ error: 'Required fields missing' });
  const r = db.prepare("INSERT INTO transactions (business_id, category_id, type, amount, description, payment_method, reference_no, transaction_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(business_id, category_id || null, type, amount, description || null, payment_method || 'cash', reference_no || null, transaction_date || localDateStr(), req.user.id);
  res.json({ id: r.lastInsertRowid, message: 'Saved' });
});

app.get('/api/transactions/:id', (req, res) => {
  const tx = db.prepare("SELECT * FROM transactions WHERE id=?").get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(tx);
});
app.put('/api/transactions/:id', (req, res) => {
  const { category_id, amount, description, transaction_date, payment_method } = req.body;
  db.prepare("UPDATE transactions SET category_id=?, amount=?, description=?, transaction_date=?, payment_method=? WHERE id=?")
    .run(category_id, amount, description, transaction_date, payment_method, req.params.id);
  res.json({ message: 'Updated' });
});
app.delete('/api/transactions/:id', (req, res) => {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== EMPLOYEES ======
app.get('/api/employees', (req, res) => {
  const { business_id } = req.query;
  let sql = "SELECT e.*, b.name as biz_name FROM employees e JOIN businesses b ON e.business_id = b.id WHERE e.status = 'active'";
  if (business_id) sql += ` AND e.business_id = ${Number(business_id)}`;
  sql += " ORDER BY e.business_id, e.name";
  res.json(db.prepare(sql).all());
});

app.post('/api/employees', (req, res) => {
  const { business_id, name, position, phone, salary, start_date } = req.body;
  const r = db.prepare("INSERT INTO employees (business_id, name, position, phone, salary, start_date) VALUES (?,?,?,?,?,?)")
    .run(business_id, name, position, phone, salary || 0, start_date || null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/employees/:id', (req, res) => {
  const { business_id, name, position, phone, salary } = req.body;
  db.prepare("UPDATE employees SET business_id=?, name=?, position=?, phone=?, salary=? WHERE id=?").run(business_id, name, position, phone, salary, req.params.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/employees/:id', (req, res) => {
  db.prepare("DELETE FROM employees WHERE id=?").run(req.params.id);
  res.json({ message: '삭제 완료' });
});

// ====== PAYROLL ======
app.get('/api/payroll', (req, res) => {
  const { pay_month } = req.query;
  let sql = "SELECT p.*, e.name as emp_name, e.position, b.name as biz_name FROM payroll p JOIN employees e ON p.employee_id = e.id JOIN businesses b ON e.business_id = b.id";
  if (pay_month) sql += ` WHERE p.pay_month = '${pay_month}'`;
  sql += " ORDER BY p.pay_date DESC";
  res.json(db.prepare(sql).all());
});

app.post('/api/payroll', (req, res) => {
  const { employee_id, amount, bonus, deduction, pay_month, notes } = req.body;
  const r = db.prepare("INSERT INTO payroll (employee_id, amount, bonus, deduction, pay_month, notes) VALUES (?,?,?,?,?,?)")
    .run(employee_id, amount, bonus || 0, deduction || 0, pay_month, notes || null);

  // Also record as expense
  const emp = db.prepare("SELECT * FROM employees WHERE id = ?").get(employee_id);
  const total = (amount || 0) + (bonus || 0) - (deduction || 0);
  const expCat = db.prepare("SELECT id FROM categories WHERE name LIKE '%인건비%' OR name LIKE '%급여%' LIMIT 1").get();
  db.prepare("INSERT INTO transactions (business_id, category_id, type, amount, description, payment_method, transaction_date, created_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(emp.business_id, expCat?.id, 'expense', total, `${emp.name} ${pay_month} 급여`, 'transfer', localDateStr(), req.user.id);

  res.json({ id: r.lastInsertRowid, message: 'Payroll saved' });
});

// ====== FIXED COSTS ======
app.get('/api/fixed-costs', (req, res) => {
  res.json(db.prepare("SELECT fc.*, b.name as biz_name FROM fixed_costs fc JOIN businesses b ON fc.business_id = b.id WHERE fc.is_active = 1 ORDER BY b.sort_order, fc.due_day").all());
});

app.post('/api/fixed-costs', (req, res) => {
  const { business_id, name, amount, due_day, category_id } = req.body;
  const r = db.prepare("INSERT INTO fixed_costs (business_id, category_id, name, amount, due_day) VALUES (?,?,?,?,?)").run(business_id, category_id || null, name, amount, due_day || 1);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/fixed-costs/:id', (req, res) => {
  db.prepare("UPDATE fixed_costs SET is_active = 0 WHERE id = ?").run(req.params.id);
  res.json({ message: 'Removed' });
});

// === 세금 API ===
app.get('/api/tax', auth, (req, res) => {
  const { year, business_id } = req.query;
  let sql = 'SELECT t.*, b.name as business_name FROM tax_records t LEFT JOIN businesses b ON t.business_id = b.id WHERE 1=1';
  const params = [];
  if (year) { sql += ' AND t.period LIKE ?'; params.push(year + '%'); }
  if (business_id && business_id !== 'all') { sql += ' AND t.business_id = ?'; params.push(business_id); }
  sql += ' ORDER BY t.period DESC, t.due_date DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/tax/summary', auth, (req, res) => {
  const year = req.query.year || new Date().getFullYear().toString();
  // 사업장별 매출 가져오기 (НӨАТ 계산용)
  const revenue = db.prepare(`
    SELECT b.id, b.name, b.icon,
      SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) as total_income,
      SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) as total_expense
    FROM transactions t JOIN businesses b ON t.business_id = b.id
    WHERE t.transaction_date LIKE ?
    GROUP BY b.id
  `).all(year + '%');

  // 세금 납부 현황
  const taxes = db.prepare(`
    SELECT tax_type, 
      SUM(tax_amount) as total_tax,
      SUM(paid_amount) as total_paid,
      SUM(tax_amount - paid_amount) as remaining
    FROM tax_records WHERE period LIKE ?
    GROUP BY tax_type
  `).all(year + '%');

  // 월별 НӨАТ 추적
  const monthly = db.prepare(`
    SELECT substr(t.transaction_date,1,7) as month,
      SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) as expense
    FROM transactions t
    WHERE t.transaction_date LIKE ? AND t.business_id != 5
    GROUP BY month ORDER BY month
  `).all(year + '%');

  res.json({ revenue, taxes, monthly });
});

app.post('/api/tax', auth, (req, res) => {
  const { business_id, tax_type, period, tax_base, tax_rate, tax_amount, paid_amount, due_date, paid_date, status, notes } = req.body;
  const r = db.prepare(`
    INSERT INTO tax_records (business_id, tax_type, period, tax_base, tax_rate, tax_amount, paid_amount, due_date, paid_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(business_id, tax_type, period, tax_base||0, tax_rate||0, tax_amount||0, paid_amount||0, due_date, paid_date, status||'unpaid', notes);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/tax/:id', auth, (req, res) => {
  const { business_id, tax_type, period, tax_base, tax_rate, tax_amount, paid_amount, due_date, paid_date, status, notes } = req.body;
  db.prepare(`
    UPDATE tax_records SET business_id=?, tax_type=?, period=?, tax_base=?, tax_rate=?, tax_amount=?, paid_amount=?, due_date=?, paid_date=?, status=?, notes=?
    WHERE id=?
  `).run(business_id, tax_type, period, tax_base||0, tax_rate||0, tax_amount||0, paid_amount||0, due_date, paid_date, status, notes, req.params.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/tax/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tax_records WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ====== EXCEL UPLOAD & AUTO IMPORT ======
// 사업장별 보정 카테고리 (income / expense)
function correctionCategoriesFor(businessId) {
  if (businessId === 1) return { income: 26, expense: 35 }; // 센터: 기타수입 / 기타지출
  if (businessId === 3) return { income: 91, expense: 59 }; // 샵: 기타수입 / 기타지출
  return { income: 40, expense: 49 };                       // 휘트니스(기본)
}

app.post('/api/excel-import', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

  const filePath = req.file.path;
  const filename = req.file.originalname;
  const force = req.body.force === 'true' || req.body.force === true || req.body.force === '1';

  try {
    // 파일 해시 (중복 업로드 차단)
    const fileBuf = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
    const fileSize = fileBuf.length;

    if (!force) {
      const dup = db.prepare("SELECT id, filename, parsed_type, parsed_date, uploaded_at, inserted_count, updated_count, skipped_count, correction_count FROM import_logs WHERE file_hash=? ORDER BY id DESC LIMIT 1").get(fileHash);
      if (dup) {
        fs.unlinkSync(filePath);
        return res.status(409).json({
          error: '이미 처리된 동일 파일입니다.',
          duplicate: dup,
          hint: '강제로 다시 처리하려면 force=true 로 요청하세요.'
        });
      }
    }

    const businessIdHint = req.body.business_id ? Number(req.body.business_id) : undefined;
    const parsed = parseExcel(filePath, filename, businessIdHint);
    console.log(`[excel-import] ${new Date().toISOString()} user=${req.user?.id} file=${filename} hash=${fileHash.slice(0,8)} type=${parsed.type} biz=${parsed.businessId||''} hint=${businessIdHint||''} date=${parsed.date} entries=${parsed.entries?.length||0}`);

    // 디버그 사본
    try {
      const debugDir = path.join(__dirname, 'uploads', 'debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(debugDir, `${ts}---${filename}`));
    } catch(e) { console.warn('debug copy fail:', e.message); }

    if (parsed.type === 'unknown' || parsed.error) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: parsed.error || '파일 형식을 인식할 수 없습니다.', filename });
    }

    // 월간 정산표인데 사업장 자동 감지 실패 → 사용자에게 묻기
    if (parsed.type === 'monthly' && parsed.businessIdSource === 'default' && !businessIdHint) {
      fs.unlinkSync(filePath);
      return res.status(409).json({
        error: '사업장을 자동으로 감지하지 못했습니다. 어느 사업장 파일인지 선택해주세요.',
        needBusinessSelect: true,
        choices: [
          { id: 1, name: '센터' },
          { id: 2, name: '휘트니스' },
          { id: 3, name: '샵' }
        ],
        fileSummary: {
          type: parsed.type,
          month: parsed.month,
          totalIncome: parsed.totalIncome,
          totalExpense: parsed.totalExpense,
          entries: (parsed.entries || []).length
        },
        filename,
        hint: '파일을 다시 첨부하시고 사업장을 선택해주세요. (또는 파일명에 "shop"/"center"/"fitness" 등의 단어를 포함시키면 자동 인식됩니다)'
      });
    }

    // === entries dedup: same(skip) / conflict / new ===
    // monthly 타입은 entries dedup을 건너뛰고 일별 합계 보정으로만 처리 (아래 verification 블록)
    const isMonthly = parsed.type === 'monthly';
    const findSameAmount = db.prepare(
      "SELECT id FROM transactions WHERE business_id=? AND category_id=? AND type=? AND transaction_date=? AND amount=?"
    );
    const findAnyAmount = db.prepare(
      "SELECT id, amount FROM transactions WHERE business_id=? AND category_id=? AND type=? AND transaction_date=? ORDER BY id LIMIT 1"
    );
    const sameEntries = [];
    const conflictEntries = [];
    const newEntries = [];
    if (!isMonthly) {
      for (const entry of (parsed.entries || [])) {
        const sameAmount = findSameAmount.get(entry.business_id, entry.category_id, entry.type, entry.transaction_date, entry.amount);
        if (sameAmount) { sameEntries.push({ entry, existingId: sameAmount.id }); continue; }
        const anyAmount = findAnyAmount.get(entry.business_id, entry.category_id, entry.type, entry.transaction_date);
        if (anyAmount) conflictEntries.push({ entry, existingId: anyAmount.id, existingAmount: anyAmount.amount });
        else newEntries.push(entry);
      }

      if (conflictEntries.length > 0 && !force) {
        fs.unlinkSync(filePath);
        return res.status(409).json({
          error: '이미 입력된 데이터의 금액이 다릅니다.',
          conflicts: conflictEntries.map(c => ({
            date: c.entry.transaction_date,
            description: c.entry.description,
            oldAmount: c.existingAmount,
            newAmount: c.entry.amount,
            existingId: c.existingId
          })),
          skipped: sameEntries.map(s => ({ date: s.entry.transaction_date, description: s.entry.description, amount: s.entry.amount })),
          newCount: newEntries.length,
          parsed,
          hint: '덮어쓰려면 force=true 로 다시 요청하세요.'
        });
      }
    }

    // === apply: insert new + (force) update conflicts ===
    const updateTx = db.prepare("UPDATE transactions SET amount=?, description=?, payment_method=?, created_by=? WHERE id=?");
    const insertTx = db.prepare("INSERT INTO transactions (business_id, category_id, type, amount, description, payment_method, transaction_date, created_by) VALUES (?,?,?,?,?,?,?,?)");
    let updatedCount = 0;
    const insertedIds = [];

    // === monthly: 일별 합계 비교 후 차이만 보정 (수입+지출 양쪽) ===
    let verification = null;
    let correctionCount = 0;
    const corrections = [];
    if (parsed.type === 'monthly') {
      const bizId = parsed.businessId || 2;
      const cats = correctionCategoriesFor(bizId);
      const sumIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE business_id=? AND type='income' AND transaction_date=?");
      const sumExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE business_id=? AND type='expense' AND transaction_date=?");
      const dailyMap = {};
      // 수입 비교 데이터 모음
      for (const d of (parsed.dailyIncome || [])) {
        if (!dailyMap[d.date]) dailyMap[d.date] = { date: d.date, excelIncome: 0, excelExpense: 0 };
        dailyMap[d.date].excelIncome = d.monthly;
      }
      // 지출은 parsed.entries 안에 일자별로 있음
      for (const e of (parsed.entries || [])) {
        if (e.type !== 'expense') continue;
        if (!dailyMap[e.transaction_date]) dailyMap[e.transaction_date] = { date: e.transaction_date, excelIncome: 0, excelExpense: 0 };
        dailyMap[e.transaction_date].excelExpense += e.amount;
      }
      verification = Object.values(dailyMap).sort((a,b)=>a.date.localeCompare(b.date)).map(d => {
        const dbInc = sumIncome.get(bizId, d.date).t;
        const dbExp = sumExpense.get(bizId, d.date).t;
        const incDiff = d.excelIncome - dbInc;
        const expDiff = d.excelExpense - dbExp;
        return { date: d.date, excelIncome: d.excelIncome, dbIncome: dbInc, incomeDiff: incDiff, excelExpense: d.excelExpense, dbExpense: dbExp, expenseDiff: expDiff };
      });
    }

    const applyAll = db.transaction(() => {
      // 일반 entries 적용 (daily 엑셀 등)
      for (const e of newEntries) {
        const r = insertTx.run(e.business_id, e.category_id, e.type, e.amount, e.description, e.payment_method, e.transaction_date, req.user.id);
        insertedIds.push(r.lastInsertRowid);
      }
      if (force) {
        for (const c of conflictEntries) {
          const r = updateTx.run(c.entry.amount, c.entry.description, c.entry.payment_method, req.user.id, c.existingId);
          updatedCount += r.changes;
        }
      }
      // monthly 보정 적용
      if (parsed.type === 'monthly' && verification) {
        const bizId = parsed.businessId || 2;
        const cats = correctionCategoriesFor(bizId);
        for (const v of verification) {
          if (v.incomeDiff !== 0) {
            const r = insertTx.run(bizId, cats.income, 'income', v.incomeDiff, '엑셀 보정 (일별 수입 차이)', 'mixed', v.date, req.user.id);
            corrections.push({ date: v.date, type: 'income', amount: v.incomeDiff, id: r.lastInsertRowid });
            correctionCount++;
          }
          if (v.expenseDiff !== 0) {
            const r = insertTx.run(bizId, cats.expense, 'expense', v.expenseDiff, '엑셀 보정 (일별 지출 차이)', 'mixed', v.date, req.user.id);
            corrections.push({ date: v.date, type: 'expense', amount: v.expenseDiff, id: r.lastInsertRowid });
            correctionCount++;
          }
        }
      }
    });
    applyAll();

    // import 로그 기록
    db.prepare("INSERT INTO import_logs (filename, file_hash, file_size, parsed_type, business_id, parsed_date, inserted_count, updated_count, skipped_count, correction_count, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      filename, fileHash, fileSize, parsed.type, parsed.businessId || null, parsed.date || null,
      insertedIds.length, updatedCount, sameEntries.length, correctionCount, req.user?.id || null
    );

    fs.unlinkSync(filePath);

    const bizName = parsed.businessId === 1 ? '센터' : parsed.businessId === 3 ? '샵' : parsed.businessId === 2 ? '휘트니스' : '';
    const summary = parsed.type === 'fitness'
      ? `회원권 ${parsed.memberSum?.toLocaleString()}₮ + 카페/프로틴 ${parsed.drinkSum?.toLocaleString()}₮`
      : parsed.type === 'center'
      ? `코트대여 ${parsed.courtSum?.toLocaleString()}₮ + 식당/카페 ${parsed.foodSum?.toLocaleString()}₮`
      : parsed.type === 'monthly'
      ? `${bizName} ${parsed.month||''} 수입 ${(parsed.totalIncome||0).toLocaleString()}₮ + 지출 ${(parsed.totalExpense||0).toLocaleString()}₮`
      : `합계 ${parsed.totalSum?.toLocaleString?.() || ''}₮`;

    const parts = [];
    if (insertedIds.length > 0) parts.push(`신규 ${insertedIds.length}건`);
    if (updatedCount > 0) parts.push(`덮어쓰기 ${updatedCount}건`);
    if (sameEntries.length > 0) parts.push(`스킵 ${sameEntries.length}건(동일)`);
    if (correctionCount > 0) parts.push(`보정 ${correctionCount}건`);
    const action = parts.length > 0 ? parts.join(', ') : '변경 없음 (모두 일치)';

    const typeLabel = parsed.type === 'fitness' ? '피트니스'
      : parsed.type === 'center' ? '센터'
      : parsed.type === 'shop' ? '샵'
      : parsed.type === 'monthly' ? `월간(${bizName} ${parsed.month||''})`
      : '매출';

    res.json({
      ok: true,
      message: `✅ ${parsed.date} ${typeLabel} 처리 완료 — ${action}`,
      summary,
      date: parsed.date,
      type: parsed.type,
      businessId: parsed.businessId,
      entries: parsed.entries,
      inserted: insertedIds.length,
      updated: updatedCount,
      skipped: sameEntries.length,
      corrections,
      correctionCount,
      ids: insertedIds,
      verification
    });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch(e) {}
    console.error('Excel import error:', err);
    res.status(500).json({ error: `파싱 오류: ${err.message}`, filename });
  }
});

// Preview (저장 없이 파싱 결과만 반환)
app.post('/api/excel-preview', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  
  const filePath = req.file.path;
  const filename = req.file.originalname;
  
  try {
    const parsed = parseExcel(filePath, filename);
    fs.unlinkSync(filePath);
    res.json({ filename, ...parsed });
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch(e) {}
    res.status(500).json({ error: err.message, filename });
  }
});


// === Attendance ===
app.post('/api/attendance/in', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const now = new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'}).replace('T',' ');
  const existing = db.prepare("SELECT id FROM attendance WHERE user_id=? AND date=? AND clock_out IS NULL").get(req.user.id, today);
  if (existing) return res.status(400).json({error:'이미 출근됨'});
  db.prepare("INSERT INTO attendance (user_id,username,clock_in,date) VALUES (?,?,?,?)").run(req.user.id, req.user.name||req.user.username, now, today);
  res.json({ok:true, time:now});
});
app.post('/api/attendance/out', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const now = new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'}).replace('T',' ');
  const rec = db.prepare("SELECT id FROM attendance WHERE user_id=? AND date=? AND clock_out IS NULL").get(req.user.id, today);
  if (!rec) return res.status(400).json({error:'출근 기록 없음'});
  db.prepare("UPDATE attendance SET clock_out=? WHERE id=?").run(now, rec.id);
  res.json({ok:true, time:now});
});
app.get('/api/attendance/today', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  res.json(db.prepare("SELECT * FROM attendance WHERE user_id=? AND date=?").get(req.user.id, today) || {});
});
app.get('/api/attendance', auth, (req, res) => {
  let q = "SELECT * FROM attendance WHERE 1=1"; const p = [];
  if (req.user.role === 'staff') { q += " AND user_id=?"; p.push(req.user.id); }
  else if (req.user.role === 'manager') { q += " AND (business=? OR user_id=?)"; p.push(req.user.business||''); p.push(req.user.id); }
  if (req.query.from) { q += " AND date>=?"; p.push(req.query.from); }
  if (req.query.to) { q += " AND date<=?"; p.push(req.query.to); }
  res.json(db.prepare(q + " ORDER BY date DESC,clock_in DESC LIMIT 200").all(...p));
});

// === Checklist ===
app.get('/api/checklist', auth, (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  let q = "SELECT * FROM checklists WHERE date=?"; const p = [date];
  if (req.user.role === 'staff') { q += " AND user_id=?"; p.push(req.user.id); }
  else if (req.user.role === 'manager' && req.user.business) { q += " AND business=?"; p.push(req.user.business); }
  else if (req.query.business) { q += " AND business=?"; p.push(req.query.business); }
  res.json(db.prepare(q + " ORDER BY category,is_done,title").all(...p));
});
app.put('/api/checklist/:id/toggle', auth, (req, res) => {
  const item = db.prepare("SELECT * FROM checklists WHERE id=?").get(+req.params.id);
  if (!item) return res.status(404).json({error:'없음'});
  const now = item.is_done ? null : new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("UPDATE checklists SET is_done=?,done_at=? WHERE id=?").run(item.is_done?0:1, now, item.id);
  res.json({ok:true});
});
app.post('/api/checklist', auth, (req, res) => {
  const { title, category } = req.body;
  const date = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("INSERT INTO checklists (title,user_id,username,date,business,category) VALUES (?,?,?,?,?,?)").run(title, req.user.id, req.user.name||req.user.username, date, req.user.business||null, category||'기타');
  res.json({ok:true});
});
app.delete('/api/checklist/:id', auth, (req, res) => {
  db.prepare("DELETE FROM checklists WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});
app.post('/api/checklist/assign', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const users = db.prepare("SELECT * FROM users WHERE role='staff'").all();
  const tpls = db.prepare("SELECT * FROM checklist_templates WHERE is_active=1").all();
  const ins = db.prepare("INSERT OR IGNORE INTO checklists (title,user_id,username,date,business,category) VALUES (?,?,?,?,?,?)");
  db.transaction(() => {
    for (const u of users) for (const t of tpls.filter(tp => !tp.business || tp.business === u.business || tp.business === '전체'))
      ins.run(t.title, u.id, u.name, today, u.business, t.category||'기타');
  })();
  res.json({ok:true});
});

// 체크리스트 템플릿 관리
app.get('/api/checklist-templates', auth, (req, res) => {
  let q = "SELECT * FROM checklist_templates WHERE is_active=1"; const p = [];
  if (req.query.business) { q += " AND (business=? OR business='전체')"; p.push(req.query.business); }
  res.json(db.prepare(q + " ORDER BY business,category,title").all(...p));
});
app.post('/api/checklist-templates', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  const { title, business, category } = req.body;
  db.prepare("INSERT INTO checklist_templates (title,business,category) VALUES (?,?,?)").run(title, business||'전체', category||'기타');
  res.json({ok:true});
});
app.delete('/api/checklist-templates/:id', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  db.prepare("UPDATE checklist_templates SET is_active=0 WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === Staff Dashboard ===
app.get('/api/staff-dashboard', auth, (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const d = {};
  d.attendance = db.prepare("SELECT * FROM attendance WHERE user_id=? AND date=?").get(req.user.id, today) || {};
  d.checklist = db.prepare("SELECT * FROM checklists WHERE user_id=? AND date=? ORDER BY is_done,title").all(req.user.id, today);
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    d.allAttendance = db.prepare("SELECT * FROM attendance WHERE date=? ORDER BY clock_in").all(today);
    d.allChecklist = db.prepare("SELECT * FROM checklists WHERE date=? ORDER BY username,is_done,title").all(today);
  }
  d.business = req.user.business;
  res.json(d);
});


// 월별 요약 API (LIMIT 없음)
app.get('/api/monthly-by-biz', auth, (req, res) => {
  const bizId = req.query.business_id;
  let q = "SELECT strftime('%Y-%m', transaction_date) as month, type, SUM(amount) as total, COUNT(*) as cnt FROM transactions WHERE 1=1";
  const p = [];
  if (bizId) { q += " AND business_id=?"; p.push(bizId); }
  if (req.query.from) { q += " AND transaction_date>=?"; p.push(req.query.from); }
  q += " GROUP BY month, type ORDER BY month";
  res.json(db.prepare(q).all(...p));
});


// === 공지사항 ===
app.get('/api/notices', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM notices WHERE is_active=1 ORDER BY id DESC LIMIT 20").all());
});
app.post('/api/notices', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error:'권한 없음'});
  const { title, content } = req.body;
  db.prepare("INSERT INTO notices (title,content,created_by) VALUES (?,?,?)").run(title, content, req.user.name||req.user.username);
  res.json({ok:true});
});
app.delete('/api/notices/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error:'권한 없음'});
  db.prepare("UPDATE notices SET is_active=0 WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// === 재고 관리 ===
app.get('/api/inventory', auth, (req, res) => {
  let q = "SELECT * FROM inventory WHERE 1=1"; const p = [];
  if (req.query.business) { q += " AND business=?"; p.push(req.query.business); }
  res.json(db.prepare(q + " ORDER BY business,category,name").all(...p));
});
app.post('/api/inventory', auth, (req, res) => {
  const { name, business, category, stock, min_stock, unit, unit_price, supplier, notes } = req.body;
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const initStock = stock || 0;
  const r = db.prepare(`INSERT INTO inventory
    (name,business,category,stock,min_stock,unit,unit_price,supplier,notes,initial_stock,initial_date,last_in_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      name, business, category||'', initStock, min_stock||5, unit||'ea',
      unit_price||0, supplier||'', notes||'', initStock, today, initStock>0?today:null);
  if (initStock > 0) {
    db.prepare(`INSERT INTO inventory_log
      (inventory_id,item_name,business,action,qty,before_stock,after_stock,note,user_id,username)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        r.lastInsertRowid, name, business, 'in', initStock, 0, initStock,
        '최초 입고', req.user.id, req.user.name||req.user.username);
  }
  res.json({ok:true,id:r.lastInsertRowid});
});
app.put('/api/inventory/:id', auth, (req, res) => {
  const { name, business, category, stock, min_stock, unit, unit_price, supplier, notes } = req.body;
  const cur = db.prepare("SELECT * FROM inventory WHERE id=?").get(+req.params.id);
  if (!cur) return res.status(404).json({error:'없음'});
  db.prepare(`UPDATE inventory SET name=?,business=?,category=?,stock=?,min_stock=?,unit=?,
    unit_price=?,supplier=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`).run(
      name, business, category, stock, min_stock, unit,
      unit_price||cur.unit_price||0, supplier||'', notes||'', +req.params.id);
  if (stock !== cur.stock) {
    const diff = stock - cur.stock;
    db.prepare(`INSERT INTO inventory_log
      (inventory_id,item_name,business,action,qty,before_stock,after_stock,note,user_id,username)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        cur.id, name, business, 'adjust', diff, cur.stock, stock,
        '수량 직접 수정', req.user.id, req.user.name||req.user.username);
  }
  res.json({ok:true});
});
app.put('/api/inventory/:id/adjust', auth, (req, res) => {
  const { qty, note } = req.body;
  const cur = db.prepare("SELECT * FROM inventory WHERE id=?").get(+req.params.id);
  if (!cur) return res.status(404).json({error:'없음'});
  const after = Math.max(0, cur.stock + qty);
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const action = qty > 0 ? 'in' : 'out';
  const updates = ["stock=?","updated_at=datetime('now','localtime')"];
  const params = [after];
  if (qty > 0) { updates.push("last_in_date=?"); params.push(today); }
  else if (qty < 0) { updates.push("last_out_date=?"); params.push(today); }
  params.push(+req.params.id);
  db.prepare(`UPDATE inventory SET ${updates.join(',')} WHERE id=?`).run(...params);
  db.prepare(`INSERT INTO inventory_log
    (inventory_id,item_name,business,action,qty,before_stock,after_stock,note,user_id,username)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      cur.id, cur.name, cur.business, action, qty, cur.stock, after,
      note||(qty>0?'입고':'출고'), req.user.id, req.user.name||req.user.username);
  res.json({ok:true,stock:after});
});
app.delete('/api/inventory/:id', auth, (req, res) => {
  // staff는 본인 사업장 품목만 삭제 가능
  const item = db.prepare("SELECT * FROM inventory WHERE id=?").get(+req.params.id);
  if (!item) return res.status(404).json({error:'없음'});
  if (req.user.role === 'staff' && req.user.business && item.business !== req.user.business) {
    return res.status(403).json({error:'다른 사업장 품목'});
  }
  db.prepare("DELETE FROM inventory WHERE id=?").run(+req.params.id);
  db.prepare(`INSERT INTO inventory_log
    (inventory_id,item_name,business,action,qty,before_stock,after_stock,note,user_id,username)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      item.id, item.name, item.business, 'delete', -(item.stock||0), item.stock||0, 0,
      '품목 삭제', req.user.id, req.user.name||req.user.username);
  res.json({ok:true});
});

// 재고 이력 조회
app.get('/api/inventory/:id/log', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM inventory_log WHERE inventory_id=? ORDER BY id DESC LIMIT 100").all(+req.params.id));
});
app.get('/api/inventory-log', auth, (req, res) => {
  let q = "SELECT * FROM inventory_log WHERE 1=1"; const p = [];
  if (req.query.business) { q += " AND business=?"; p.push(req.query.business); }
  if (req.query.action) { q += " AND action=?"; p.push(req.query.action); }
  if (req.query.from) { q += " AND date(created_at)>=?"; p.push(req.query.from); }
  if (req.query.to) { q += " AND date(created_at)<=?"; p.push(req.query.to); }
  res.json(db.prepare(q + " ORDER BY id DESC LIMIT 200").all(...p));
});

// === 일일 보고서 ===
app.get('/api/daily-reports', auth, (req, res) => {
  let q = "SELECT * FROM daily_reports WHERE 1=1"; const p = [];
  if (req.user.role !== 'admin') { q += " AND user_id=?"; p.push(req.user.id); }
  if (req.query.date) { q += " AND date=?"; p.push(req.query.date); }
  res.json(db.prepare(q + " ORDER BY date DESC,id DESC LIMIT 30").all(...p));
});
app.post('/api/daily-reports', auth, (req, res) => {
  const { content } = req.body;
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  db.prepare("INSERT INTO daily_reports (user_id,username,business,date,content) VALUES (?,?,?,?,?)").run(req.user.id, req.user.name||req.user.username, req.user.business, today, content);
  res.json({ok:true});
});

// === 목표 매출 ===
app.get('/api/goals', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM goals ORDER BY month DESC").all());
});
app.post('/api/goals', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({error:'권한 없음'});
  const { business_id, month, target_income } = req.body;
  const existing = db.prepare("SELECT id FROM goals WHERE business_id=? AND month=?").get(business_id, month);
  if (existing) db.prepare("UPDATE goals SET target_income=? WHERE id=?").run(target_income, existing.id);
  else db.prepare("INSERT INTO goals (business_id,month,target_income) VALUES (?,?,?)").run(business_id, month, target_income);
  res.json({ok:true});
});

// === 비밀번호 변경 ===
app.post('/api/change-password', auth, (req, res) => {
  const { old_password, new_password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (user.password !== old_password) return res.status(400).json({error:'현재 비밀번호가 틀립니다'});
  db.prepare("UPDATE users SET password=? WHERE id=?").run(new_password, req.user.id);
  res.json({ok:true});
});

// === 프로필 ===
app.get('/api/profile', auth, (req, res) => {
  const user = db.prepare("SELECT id,username,name,role,business FROM users WHERE id=?").get(req.user.id);
  res.json(user);
});

// === 카테고리별 매출 요약 ===
app.get('/api/category-breakdown', auth, (req, res) => {
  let q = "SELECT c.name, t.type, SUM(t.amount) as total FROM transactions t JOIN categories c ON t.category_id=c.id WHERE 1=1";
  const p = [];
  if (req.query.business_id) { q += " AND t.business_id=?"; p.push(req.query.business_id); }
  if (req.query.from) { q += " AND t.transaction_date>=?"; p.push(req.query.from); }
  if (req.query.to) { q += " AND t.transaction_date<=?"; p.push(req.query.to); }
  q += " GROUP BY c.name, t.type ORDER BY total DESC";
  res.json(db.prepare(q).all(...p));
});


// === Manager: 자기 사업장 직원 조회 ===
app.get('/api/my-staff', auth, (req, res) => {
  if (req.user.role === 'staff') return res.json([]);
  if (req.user.role === 'admin') return res.json(db.prepare("SELECT * FROM users WHERE role != 'admin'").all());
  // manager: 자기 사업장만
  res.json(db.prepare("SELECT * FROM users WHERE business=? AND role='staff'").all(req.user.business));
});

app.post('/api/my-staff', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  const { username, password, name, business } = req.body;
  const biz = req.user.role === 'manager' ? req.user.business : business;
  if (!username || !password) return res.status(400).json({error:'아이디/비밀번호 필수'});
  try {
    db.prepare("INSERT INTO users (username,password,name,role,business) VALUES (?,?,?,?,?)").run(username, password, name, 'staff', biz);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:'이미 존재하는 아이디'}); }
});

app.put('/api/my-staff/:id', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(+req.params.id);
  if (!target) return res.status(404).json({error:'없음'});
  if (req.user.role === 'manager' && target.business !== req.user.business) return res.status(403).json({error:'다른 사업장'});
  const { name, password, business } = req.body;
  if (name) db.prepare("UPDATE users SET name=? WHERE id=?").run(name, +req.params.id);
  if (password) db.prepare("UPDATE users SET password=? WHERE id=?").run(password, +req.params.id);
  if (business && req.user.role === 'admin') db.prepare("UPDATE users SET business=? WHERE id=?").run(business, +req.params.id);
  res.json({ok:true});
});

app.delete('/api/my-staff/:id', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(+req.params.id);
  if (!target) return res.status(404).json({error:'없음'});
  if (req.user.role === 'manager' && target.business !== req.user.business) return res.status(403).json({error:'다른 사업장'});
  db.prepare("DELETE FROM users WHERE id=?").run(+req.params.id);
  res.json({ok:true});
});

// manager도 체크리스트 배정 가능
app.post('/api/checklist/assign-staff', auth, (req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({error:'권한 없음'});
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ulaanbaatar'});
  const biz = req.user.role === 'manager' ? req.user.business : (req.body.business || null);
  const users = biz ? db.prepare("SELECT * FROM users WHERE business=? AND role='staff'").all(biz) : db.prepare("SELECT * FROM users WHERE role='staff'").all();
  const tpls = db.prepare("SELECT * FROM checklist_templates WHERE is_active=1").all();
  const ins = db.prepare("INSERT OR IGNORE INTO checklists (title,user_id,username,date,business,category) VALUES (?,?,?,?,?,?)");
  db.transaction(() => {
    for (const u of users) for (const t of tpls.filter(tp => !tp.business || tp.business === u.business || tp.business === '전체'))
      ins.run(t.title, u.id, u.name, today, u.business, t.category||'기타');
  })();
  res.json({ok:true});
});


app.listen(PORT, () => console.log(`Finance Manager running on port ${PORT}`));

// ====== MONTHLY SUMMARY (월별 현황) ======
app.get('/api/monthly-summary', (req, res) => {
  const months = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', transaction_date) as month 
    FROM transactions ORDER BY month
  `).all().map(r => r.month);
  
  const summary = months.map(m => {
    const income = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='income' AND strftime('%Y-%m',transaction_date)=?").get(m).v;
    const expense = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense' AND strftime('%Y-%m',transaction_date)=?").get(m).v;
    
    // Category breakdown
    const categories = db.prepare(`
      SELECT c.name, t.type, SUM(t.amount) as total 
      FROM transactions t JOIN categories c ON t.category_id=c.id 
      WHERE strftime('%Y-%m',t.transaction_date)=? 
      GROUP BY c.name, t.type ORDER BY total DESC
    `).all(m);
    
    // Daily breakdown
    const daily = db.prepare(`
      SELECT transaction_date as date, type, SUM(amount) as total
      FROM transactions WHERE strftime('%Y-%m',transaction_date)=?
      GROUP BY transaction_date, type ORDER BY transaction_date
    `).all(m);
    
    // Business breakdown
    const bizBreak = db.prepare(`
      SELECT b.name, b.icon, t.type, SUM(t.amount) as total
      FROM transactions t JOIN businesses b ON t.business_id=b.id
      WHERE strftime('%Y-%m',t.transaction_date)=?
      GROUP BY b.id, t.type ORDER BY total DESC
    `).all(m);
    
    return { month: m, income, expense, profit: income - expense, categories, daily, bizBreak };
  });
  
  // Grand totals
  const grandIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='income'").get().v;
  const grandExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense'").get().v;
  
  res.json({ months: summary, grand: { income: grandIncome, expense: grandExpense, profit: grandIncome - grandExpense } });
});

// ====== BUSINESS MONTHLY SUMMARY (사업장별 월별 현황) ======
app.get('/api/monthly-summary/:bizId', (req, res) => {
  const bizId = req.params.bizId;
  const months = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', transaction_date) as month 
    FROM transactions WHERE business_id=? ORDER BY month
  `).all(bizId).map(r => r.month);
  
  const summary = months.map(m => {
    const income = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE business_id=? AND type='income' AND strftime('%Y-%m',transaction_date)=?").get(bizId, m).v;
    const expense = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE business_id=? AND type='expense' AND strftime('%Y-%m',transaction_date)=?").get(bizId, m).v;
    const categories = db.prepare("SELECT c.name, t.type, SUM(t.amount) as total FROM transactions t JOIN categories c ON t.category_id=c.id WHERE t.business_id=? AND strftime('%Y-%m',t.transaction_date)=? GROUP BY c.name, t.type ORDER BY total DESC").all(bizId, m);
    const daily = db.prepare(`SELECT transaction_date as date, 
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) as expense
      FROM transactions WHERE business_id=? AND strftime('%Y-%m',transaction_date)=?
      GROUP BY transaction_date ORDER BY transaction_date`).all(bizId, m);
    return { month: m, income, expense, profit: income - expense, categories, daily };
  });
  
  const grandIncome = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE business_id=? AND type='income'").get(bizId).v;
  const grandExpense = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE business_id=? AND type='expense'").get(bizId).v;
  const biz = db.prepare("SELECT * FROM businesses WHERE id=?").get(bizId);
  
  res.json({ business: biz, months: summary, grand: { income: grandIncome, expense: grandExpense, profit: grandIncome - grandExpense } });
});

// ====== YEARLY SUMMARY (연도별 합산) ======
app.get('/api/yearly-summary', (req, res) => {
  const bizId = req.query.business_id;
  const where = bizId ? `AND business_id=${parseInt(bizId)}` : '';
  
  const years = db.prepare(`SELECT DISTINCT strftime('%Y', transaction_date) as year FROM transactions WHERE 1=1 ${where} ORDER BY year`).all().map(r => r.year);
  
  const summary = years.map(y => {
    const income = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='income' AND strftime('%Y',transaction_date)=? ${where}`).get(y).v;
    const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense' AND strftime('%Y',transaction_date)=? ${where}`).get(y).v;
    
    // Business breakdown
    const bizBreak = db.prepare(`
      SELECT b.name, b.icon,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) as income,
        COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) as expense
      FROM transactions t JOIN businesses b ON t.business_id=b.id
      WHERE strftime('%Y',t.transaction_date)=? ${where}
      GROUP BY b.id ORDER BY income DESC
    `).all(y);
    
    return { year: y, income, expense, profit: income - expense, businesses: bizBreak };
  });
  
  const grandIncome = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='income' ${where}`).get().v;
  const grandExpense = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense' ${where}`).get().v;
  
  res.json({ years: summary, grand: { income: grandIncome, expense: grandExpense, profit: grandIncome - grandExpense } });
});
