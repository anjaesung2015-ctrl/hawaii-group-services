const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'finance.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 사업장
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🏢',
    color TEXT DEFAULT '#3b82f6',
    sort_order INTEGER DEFAULT 0
  );

  -- 계정 카테고리 (입금/지출 항목)
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    icon TEXT DEFAULT '📌',
    sort_order INTEGER DEFAULT 0
  );

  -- 거래 내역
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    category_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    amount REAL NOT NULL DEFAULT 0,
    description TEXT,
    payment_method TEXT DEFAULT 'cash',
    reference_no TEXT,
    transaction_date TEXT DEFAULT (date('now','localtime')),
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (business_id) REFERENCES businesses(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  -- 고정비용 (월 반복)
  CREATE TABLE IF NOT EXISTS fixed_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    category_id INTEGER,
    name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    due_day INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );

  -- 직원
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    position TEXT,
    phone TEXT,
    salary REAL DEFAULT 0,
    start_date TEXT,
    status TEXT DEFAULT 'active',
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );

  -- 급여 기록
  CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    bonus REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    pay_date TEXT DEFAULT (date('now','localtime')),
    pay_month TEXT,
    notes TEXT,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  -- 엑셀 import 로그 (파일 해시 기반 중복 업로드 차단용)
  CREATE TABLE IF NOT EXISTS import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_size INTEGER,
    parsed_type TEXT,
    business_id INTEGER,
    parsed_date TEXT,
    inserted_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    correction_count INTEGER DEFAULT 0,
    uploaded_by INTEGER,
    uploaded_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_import_logs_hash ON import_logs(file_hash);
`);

// SEED
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)").run('admin','admin123','관리자','admin');
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)").run('staff1','staff123','직원1','staff');

  // 사업장
  db.prepare("INSERT INTO businesses (name, icon, color, sort_order) VALUES (?,?,?,?)").run('체육관','🏋️','#ef4444',1);
  db.prepare("INSERT INTO businesses (name, icon, color, sort_order) VALUES (?,?,?,?)").run('피트니스','💪','#3b82f6',2);
  db.prepare("INSERT INTO businesses (name, icon, color, sort_order) VALUES (?,?,?,?)").run('샵','🏪','#f59e0b',3);

  // 입금 카테고리
  const incCats = ['회원권 매출','PT 매출','상품 판매','시설 대여','기타 수입'];
  incCats.forEach((n,i) => db.prepare("INSERT INTO categories (name, type, icon, sort_order) VALUES (?,?,?,?)").run(n,'income','💰',i));

  // 지출 카테고리
  const expCats = ['임대료','전기/수도/가스','인건비(급여)','장비 구입','장비 수리/유지보수','소모품','마케팅/광고','세금/보험','통신비','교통비','기타 지출'];
  expCats.forEach((n,i) => db.prepare("INSERT INTO categories (name, type, icon, sort_order) VALUES (?,?,?,?)").run(n,'expense','📤',i));

  // 직원
  const emps = [
    [1,'김직원','트레이너','99001111',800000],[1,'이직원','프론트','99002222',600000],
    [1,'박직원','트레이너','99003333',800000],[1,'최직원','청소','99004444',500000],
    [2,'강트레이너','수석 트레이너','99011111',1200000],[2,'조트레이너','트레이너','99012222',1000000],
    [2,'윤트레이너','트레이너','99013333',1000000],[2,'장트레이너','트레이너','99014444',1000000],
    [2,'한프론트','프론트','99015555',700000],[2,'서프론트','프론트','99016666',700000],
    [2,'임트레이너','트레이너','99017777',1000000],[2,'정트레이너','트레이너','99018888',1000000],
    [2,'오트레이너','트레이너','99019999',1000000],[2,'배트레이너','트레이너','99020000',1000000],
    [2,'류프론트','프론트','99021111',700000],[2,'권청소','청소','99022222',500000],
    [3,'나직원','판매','99031111',700000],[3,'문직원','판매','99032222',700000],
  ];
  emps.forEach(e => db.prepare("INSERT INTO employees (business_id, name, position, phone, salary) VALUES (?,?,?,?,?)").run(...e));

  // 고정비용
  const fixed = [
    [1,'임대료',3000000,1],[1,'전기세',500000,10],[1,'수도세',100000,10],[1,'인터넷',50000,5],
    [2,'임대료',5000000,1],[2,'전기세',800000,10],[2,'수도세',200000,10],[2,'인터넷',50000,5],
    [3,'임대료',2000000,1],[3,'전기세',200000,10],[3,'인터넷',50000,5],
  ];
  fixed.forEach(f => db.prepare("INSERT INTO fixed_costs (business_id, name, amount, due_day) VALUES (?,?,?,?)").run(...f));

  // 샘플 거래 (이번 달)
  const today = new Date();
  const y = today.getFullYear(), m = String(today.getMonth()+1).padStart(2,'0');
  const sampleTx = [
    [1,'income',1,2500000,'회원권 3명','cash',`${y}-${m}-01`],
    [1,'income',1,1800000,'회원권 2명','card',`${y}-${m}-03`],
    [1,'income',2,500000,'PT 5회권','qpay',`${y}-${m}-05`],
    [1,'expense',6,3000000,'임대료','transfer',`${y}-${m}-01`],
    [1,'expense',7,500000,'전기세','transfer',`${y}-${m}-10`],
    [2,'income',1,8500000,'회원권 10명','card',`${y}-${m}-01`],
    [2,'income',1,6200000,'회원권 8명','cash',`${y}-${m}-05`],
    [2,'income',2,3000000,'PT 매출','qpay',`${y}-${m}-07`],
    [2,'expense',6,5000000,'임대료','transfer',`${y}-${m}-01`],
    [2,'expense',7,800000,'전기세','transfer',`${y}-${m}-10`],
    [2,'expense',8,200000,'수도세','transfer',`${y}-${m}-10`],
    [2,'expense',10,1500000,'장비 수리','cash',`${y}-${m}-08`],
    [3,'income',3,4200000,'상품 판매','card',`${y}-${m}-01`],
    [3,'income',3,3800000,'상품 판매','cash',`${y}-${m}-05`],
    [3,'expense',6,2000000,'임대료','transfer',`${y}-${m}-01`],
    [3,'expense',9,350000,'장비 구입','card',`${y}-${m}-04`],
  ];
  sampleTx.forEach(t => db.prepare("INSERT INTO transactions (business_id, type, category_id, amount, description, payment_method, transaction_date) VALUES (?,?,?,?,?,?,?)").run(...t));
}

module.exports = db;
