const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'shop.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ====== SCHEMA ======
db.exec(`
  -- 사용자
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 카테고리
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    icon TEXT DEFAULT '📦',
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
  );

  -- 브랜드
  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    logo TEXT
  );

  -- 공급업체
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 상품
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    barcode TEXT UNIQUE,
    sku TEXT UNIQUE,
    category_id INTEGER,
    brand_id INTEGER,
    supplier_id INTEGER,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    stock_qty INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    unit TEXT DEFAULT '개',
    description TEXT,
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );

  -- 판매
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date TEXT DEFAULT (datetime('now','localtime')),
    customer_name TEXT,
    customer_phone TEXT,
    total_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    final_amount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    payment_status TEXT DEFAULT 'paid',
    sold_by INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (sold_by) REFERENCES users(id)
  );

  -- 판매 항목
  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty INTEGER DEFAULT 1,
    unit_price REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- 입고 (발주/입고)
  CREATE TABLE IF NOT EXISTS stock_in (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    qty INTEGER DEFAULT 0,
    cost_price REAL DEFAULT 0,
    supplier_id INTEGER,
    invoice_no TEXT,
    received_date TEXT DEFAULT (date('now','localtime')),
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );

  -- 재고 조정
  CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    adjust_type TEXT NOT NULL,
    qty_change INTEGER DEFAULT 0,
    reason TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- 출고 (판매 외)
  CREATE TABLE IF NOT EXISTS stock_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    qty INTEGER DEFAULT 0,
    out_type TEXT DEFAULT 'return',
    destination TEXT,
    notes TEXT,
    out_date TEXT DEFAULT (date('now','localtime')),
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// ====== SEED DATA ======
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)").run('admin', 'admin123', '관리자', 'admin');
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)").run('staff1', 'staff123', '직원1', 'staff');

  // 카테고리
  const cats = [
    ['🎾 테니스 라켓', null, '🎾', 1],
    ['🧵 테니스 줄 (스트링)', null, '🧵', 2],
    ['👟 테니스 신발', null, '👟', 3],
    ['👕 테니스 의류', null, '👕', 4],
    ['🎾 테니스 공', null, '🎾', 5],
    ['🎒 테니스 가방', null, '🎒', 6],
    ['🏸 테니스 악세서리', null, '🏸', 7],
    ['🔨 DeWalt 전동공구', null, '🔨', 10],
    ['🔧 DeWalt 수공구', null, '🔧', 11],
    ['🔋 DeWalt 배터리/충전기', null, '🔋', 12],
    ['🪚 DeWalt 악세서리', null, '🪚', 13],
  ];
  const catStmt = db.prepare("INSERT INTO categories (name, parent_id, icon, sort_order) VALUES (?, ?, ?, ?)");
  cats.forEach(c => catStmt.run(...c));

  // 브랜드
  const brands = ['Wilson', 'Head', 'Babolat', 'Yonex', 'Prince', 'Tecnifibre', 'DeWalt', 'Nike', 'Adidas', 'New Balance'];
  const brandStmt = db.prepare("INSERT INTO brands (name) VALUES (?)");
  brands.forEach(b => brandStmt.run(b));

  // 샘플 상품
  const products = [
    ['Wilson Pro Staff 97', 'WPS97-001', 'SKU-001', 1, 1, null, 180000, 280000, 8, 3, '개', '프로 스태프 시리즈'],
    ['Wilson Ultra 100', 'WU100-001', 'SKU-002', 1, 1, null, 150000, 250000, 5, 3, '개', '울트라 시리즈'],
    ['Head Speed MP', 'HSP-001', 'SKU-003', 1, 2, null, 170000, 270000, 6, 3, '개', '스피드 시리즈'],
    ['Babolat Pure Aero', 'BPA-001', 'SKU-004', 1, 3, null, 190000, 290000, 4, 3, '개', '퓨어 에어로'],
    ['Luxilon ALU Power 줄', 'LAP-001', 'SKU-010', 2, null, null, 15000, 25000, 30, 10, '개', '폴리에스터 스트링'],
    ['Wilson NXT 줄', 'WNXT-001', 'SKU-011', 2, 1, null, 18000, 30000, 20, 10, '개', '멀티필라멘트'],
    ['Wilson Tour Comp 공 (4개입)', 'WTC-001', 'SKU-020', 5, 1, null, 8000, 15000, 50, 20, '캔', '투어 컴프'],
    ['DeWalt DCD791 드릴', 'DW-DCD791', 'SKU-100', 8, 7, null, 250000, 380000, 3, 2, '개', '20V MAX 브러시리스 드릴'],
    ['DeWalt DCF887 임팩드릴', 'DW-DCF887', 'SKU-101', 8, 7, null, 280000, 420000, 4, 2, '개', '20V MAX 임팩트 드라이버'],
    ['DeWalt DCS391 원형톱', 'DW-DCS391', 'SKU-102', 8, 7, null, 300000, 450000, 2, 2, '개', '20V MAX 원형톱'],
    ['DeWalt DCB204 배터리 4Ah', 'DW-DCB204', 'SKU-110', 10, 7, null, 80000, 130000, 10, 5, '개', '20V MAX 4Ah 배터리'],
    ['DeWalt DCB115 충전기', 'DW-DCB115', 'SKU-111', 10, 7, null, 40000, 65000, 8, 5, '개', '12V/20V MAX 충전기'],
  ];
  const prodStmt = db.prepare("INSERT INTO products (name, barcode, sku, category_id, brand_id, supplier_id, cost_price, sell_price, stock_qty, min_stock, unit, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  products.forEach(p => prodStmt.run(...p));
}

module.exports = db;
