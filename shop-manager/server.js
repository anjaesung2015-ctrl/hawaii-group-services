const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./db');

const { syncFinance } = require('/home/ubuntu/.openclaw/workspace/app-sync');

const app = express();
const PORT = 6002;
const JWT_SECRET = 'shop-mgr-2026-secret';

app.use(express.json());
app.use(cookieParser());

// No cache for HTML/JS
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.shop_token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) { res.status(401).json({ error: '세션이 만료되었습니다' }); }
}

// ====== AUTH ======
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.use('/api', auth);

// ====== DASHBOARD ======
app.get('/api/dashboard', (req, res) => {
  const today = new Date(Date.now()+8*3600000).toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  const todaySales = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(final_amount),0) as total FROM sales WHERE date(sale_date) = ?").get(today);
  const monthSales = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(final_amount),0) as total FROM sales WHERE date(sale_date) >= ?").get(monthStart);
  const totalProducts = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1").get().cnt;
  const lowStock = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1 AND stock_qty <= min_stock").get().cnt;
  const outOfStock = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE is_active = 1 AND stock_qty = 0").get().cnt;

  // 오늘 매출 상세
  const todayDetail = db.prepare(`
    SELECT s.*, u.name as seller_name FROM sales s
    LEFT JOIN users u ON s.sold_by = u.id
    WHERE date(s.sale_date) = ? ORDER BY s.sale_date DESC
  `).all(today);

  // 재고 부족 상품
  const lowStockItems = db.prepare("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1 AND p.stock_qty <= p.min_stock ORDER BY p.stock_qty ASC LIMIT 10").all();

  // 인기 상품 (이번 달)
  const topProducts = db.prepare(`
    SELECT p.name, SUM(si.qty) as total_qty, SUM(si.subtotal) as total_amount
    FROM sale_items si JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE date(s.sale_date) >= ? GROUP BY si.product_id ORDER BY total_qty DESC LIMIT 5
  `).all(monthStart);

  // 월별 매출 (최근 6개월)
  const monthlySales = db.prepare(`
    SELECT strftime('%Y-%m', sale_date) as month, COUNT(*) as cnt, SUM(final_amount) as total
    FROM sales GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  res.json({ todaySales, monthSales, totalProducts, lowStock, outOfStock, todayDetail, lowStockItems, topProducts, monthlySales });
});

// ====== PRODUCTS ======
app.get('/api/products', (req, res) => {
  const { search, category_id, brand_id, low_stock } = req.query;
  let sql = `SELECT p.*, c.name as category_name, b.name as brand_name, s.name as supplier_name
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.is_active = 1`;
  const params = [];

  if (search) { sql += " AND (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (category_id) { sql += " AND p.category_id = ?"; params.push(category_id); }
  if (brand_id) { sql += " AND p.brand_id = ?"; params.push(brand_id); }
  if (low_stock === '1') { sql += " AND p.stock_qty <= p.min_stock"; }

  sql += " ORDER BY p.name";
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name as category_name, b.name as brand_name, s.name as supplier_name
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: '상품을 찾을 수 없습니다' });

  const history = db.prepare(`
    SELECT si.qty, si.unit_price, si.subtotal, s.sale_date, s.customer_name
    FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE si.product_id = ? ORDER BY s.sale_date DESC LIMIT 20
  `).all(req.params.id);

  const stockHistory = db.prepare("SELECT * FROM stock_in WHERE product_id = ? ORDER BY received_date DESC LIMIT 10").all(req.params.id);

  res.json({ ...p, salesHistory: history, stockHistory });
});

app.post('/api/products', (req, res) => {
  const { name, barcode, sku, category_id, brand_id, supplier_id, cost_price, sell_price, stock_qty, min_stock, unit, description } = req.body;
  if (!name) return res.status(400).json({ error: '상품명을 입력해주세요' });
  try {
    const r = db.prepare("INSERT INTO products (name, barcode, sku, category_id, brand_id, supplier_id, cost_price, sell_price, stock_qty, min_stock, unit, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(name, barcode||null, sku||null, category_id||null, brand_id||null, supplier_id||null, cost_price||0, sell_price||0, stock_qty||0, min_stock||5, unit||'개', description||null);
    res.json({ id: r.lastInsertRowid, message: '상품이 등록되었습니다' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '바코드 또는 SKU가 중복됩니다' });
    throw e;
  }
});

app.put('/api/products/:id', (req, res) => {
  const { name, barcode, sku, category_id, brand_id, supplier_id, cost_price, sell_price, stock_qty, min_stock, unit, description } = req.body;
  try {
    db.prepare("UPDATE products SET name=?,barcode=?,sku=?,category_id=?,brand_id=?,supplier_id=?,cost_price=?,sell_price=?,stock_qty=?,min_stock=?,unit=?,description=?,updated_at=datetime('now','localtime') WHERE id=?")
      .run(name, barcode||null, sku||null, category_id||null, brand_id||null, supplier_id||null, cost_price||0, sell_price||0, stock_qty||0, min_stock||5, unit||'개', description||null, req.params.id);
    res.json({ message: '상품이 수정되었습니다' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '바코드 또는 SKU가 중복됩니다' });
    throw e;
  }
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare("UPDATE products SET is_active = 0 WHERE id = ?").run(req.params.id);
  res.json({ message: '상품이 삭제되었습니다' });
});

// Barcode lookup
app.get('/api/products/barcode/:code', (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE barcode = ? AND is_active = 1").get(req.params.code);
  if (!p) return res.status(404).json({ error: '등록되지 않은 바코드' });
  res.json(p);
});

// ====== CATEGORIES & BRANDS ======
app.get('/api/categories', (req, res) => { res.json(db.prepare("SELECT * FROM categories ORDER BY sort_order").all()); });
app.post('/api/categories', (req, res) => {
  const r = db.prepare("INSERT INTO categories (name, icon) VALUES (?, ?)").run(req.body.name, req.body.icon || '📦');
  res.json({ id: r.lastInsertRowid });
});
app.get('/api/brands', (req, res) => { res.json(db.prepare("SELECT * FROM brands ORDER BY name").all()); });
app.post('/api/brands', (req, res) => {
  const r = db.prepare("INSERT INTO brands (name) VALUES (?)").run(req.body.name);
  res.json({ id: r.lastInsertRowid });
});

// ====== SUPPLIERS ======
app.get('/api/suppliers', (req, res) => { res.json(db.prepare("SELECT * FROM suppliers WHERE status = 'active' ORDER BY name").all()); });
app.post('/api/suppliers', (req, res) => {
  const { name, contact_person, phone, email, address, notes } = req.body;
  const r = db.prepare("INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?,?,?,?,?,?)").run(name, contact_person, phone, email, address, notes);
  res.json({ id: r.lastInsertRowid, message: '공급업체가 등록되었습니다' });
});
app.put('/api/suppliers/:id', (req, res) => {
  const { name, contact_person, phone, email, address, notes } = req.body;
  db.prepare("UPDATE suppliers SET name=?,contact_person=?,phone=?,email=?,address=?,notes=? WHERE id=?").run(name, contact_person, phone, email, address, notes, req.params.id);
  res.json({ message: '공급업체가 수정되었습니다' });
});

// ====== SALES (POS) ======
app.get('/api/sales', (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = `SELECT s.*, u.name as seller_name FROM sales s LEFT JOIN users u ON s.sold_by = u.id WHERE 1=1`;
  const params = [];
  if (date_from) { sql += " AND date(s.sale_date) >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND date(s.sale_date) <= ?"; params.push(date_to); }
  sql += " ORDER BY s.sale_date DESC LIMIT 100";
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/sales/:id', (req, res) => {
  const sale = db.prepare("SELECT s.*, u.name as seller_name FROM sales s LEFT JOIN users u ON s.sold_by = u.id WHERE s.id = ?").get(req.params.id);
  if (!sale) return res.status(404).json({ error: '판매 기록을 찾을 수 없습니다' });
  sale.items = db.prepare("SELECT si.*, p.name as product_name, p.barcode FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?").all(req.params.id);
  res.json(sale);
});

app.post('/api/sales', (req, res) => {
  const { items, customer_name, customer_phone, discount_amount, payment_method, notes } = req.body;
  if (!items?.length) return res.status(400).json({ error: '상품을 추가해주세요' });

  const insertSale = db.transaction(() => {
    let total = 0;
    // Validate stock
    for (const item of items) {
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(item.product_id);
      if (!p) throw new Error(`상품을 찾을 수 없습니다 (ID: ${item.product_id})`);
      if (p.stock_qty < item.qty) throw new Error(`${p.name} 재고 부족 (현재: ${p.stock_qty})`);
      item._price = item.unit_price || p.sell_price;
      item._subtotal = item._price * item.qty - (item.discount || 0);
      total += item._subtotal;
    }

    const finalAmount = total - (discount_amount || 0);
    const saleResult = db.prepare("INSERT INTO sales (customer_name, customer_phone, total_amount, discount_amount, final_amount, payment_method, sold_by, notes) VALUES (?,?,?,?,?,?,?,?)")
      .run(customer_name || null, customer_phone || null, total, discount_amount || 0, finalAmount, payment_method || 'cash', req.user.id, notes || null);

    for (const item of items) {
      db.prepare("INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, subtotal) VALUES (?,?,?,?,?,?)")
        .run(saleResult.lastInsertRowid, item.product_id, item.qty, item._price, item.discount || 0, item._subtotal);
      db.prepare("UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(item.qty, item.product_id);
    }

    return { id: saleResult.lastInsertRowid, final_amount: finalAmount };
  });

  try {
    const result = insertSale();
    
    // 재무 연동
    const itemNames = items.map(i => {
      const p = db.prepare("SELECT name FROM products WHERE id=?").get(i.product_id);
      return p?.name || '상품';
    }).join(', ');
    syncFinance('shop', 'sale', {
      amount: result.final_amount,
      date: new Date(Date.now()+8*3600000).toISOString().split('T')[0],
      payment_method: payment_method || 'cash',
      description: `${itemNames}${customer_name ? ' ('+customer_name+')' : ''}`
    }).catch(()=>{});
    
    res.json({ ...result, message: '판매가 완료되었습니다' });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// 판매 취소 (환불)
app.post('/api/sales/:id/refund', (req, res) => {
  const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(req.params.id);
  if (!sale) return res.status(404).json({ error: '판매 기록을 찾을 수 없습니다' });
  if (sale.payment_status === 'refunded') return res.status(400).json({ error: '이미 환불된 판매입니다' });

  const items = db.prepare("SELECT * FROM sale_items WHERE sale_id = ?").all(req.params.id);
  db.transaction(() => {
    for (const item of items) {
      db.prepare("UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?").run(item.qty, item.product_id);
    }
    db.prepare("UPDATE sales SET payment_status = 'refunded' WHERE id = ?").run(req.params.id);
  })();

  res.json({ message: '환불이 처리되었습니다 (재고 복원 완료)' });
});

// ====== STOCK IN (입고) ======
app.post('/api/stock-in', (req, res) => {
  const { product_id, qty, cost_price, supplier_id, invoice_no, notes } = req.body;
  db.transaction(() => {
    db.prepare("INSERT INTO stock_in (product_id, qty, cost_price, supplier_id, invoice_no, notes, created_by) VALUES (?,?,?,?,?,?,?)")
      .run(product_id, qty, cost_price || 0, supplier_id || null, invoice_no || null, notes || null, req.user.id);
    db.prepare("UPDATE products SET stock_qty = stock_qty + ?, cost_price = COALESCE(?, cost_price), updated_at = datetime('now','localtime') WHERE id = ?")
      .run(qty, cost_price || null, product_id);
  })();
  res.json({ message: '입고가 처리되었습니다' });
});

// ====== STOCK ADJUSTMENT ======
app.post('/api/stock-adjust', (req, res) => {
  const { product_id, adjust_type, qty_change, reason } = req.body;
  db.transaction(() => {
    db.prepare("INSERT INTO stock_adjustments (product_id, adjust_type, qty_change, reason, created_by) VALUES (?,?,?,?,?)")
      .run(product_id, adjust_type, qty_change, reason, req.user.id);
    db.prepare("UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(qty_change, product_id);
  })();
  res.json({ message: '재고가 조정되었습니다' });
});

// ====== STOCK OUT (출고) ======
app.post('/api/stock-out', (req, res) => {
  const { product_id, qty, out_type, destination, notes } = req.body;
  if (!product_id || !qty || qty <= 0) return res.status(400).json({ error: '상품과 수량을 확인해주세요' });
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
  if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다' });
  if (product.stock_qty < qty) return res.status(400).json({ error: `재고 부족 (현재: ${product.stock_qty} ${product.unit})` });

  db.transaction(() => {
    db.prepare("INSERT INTO stock_out (product_id, qty, out_type, destination, notes, created_by) VALUES (?,?,?,?,?,?)")
      .run(product_id, qty, out_type || 'other', destination || null, notes || null, req.user.id);
    db.prepare("UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(qty, product_id);
  })();
  res.json({ message: '출고가 처리되었습니다' });
});

// ====== STOCK HISTORY (입출고 이력) ======
app.get('/api/stock-history', (req, res) => {
  const { product_id, type, date_from, date_to, limit: lim } = req.query;
  const maxRows = Math.min(Number(lim) || 200, 500);

  // 입고 내역
  let inSql = `SELECT si.id, 'in' as direction, si.product_id, p.name as product_name, p.barcode,
    si.qty, si.cost_price, si.invoice_no, si.notes, si.received_date as date,
    s.name as supplier_name, u.name as user_name, si.created_at
    FROM stock_in si JOIN products p ON si.product_id = p.id
    LEFT JOIN suppliers s ON si.supplier_id = s.id LEFT JOIN users u ON si.created_by = u.id WHERE 1=1`;
  const inParams = [];

  // 출고 내역 (판매 외)
  let outSql = `SELECT so.id, 'out' as direction, so.product_id, p.name as product_name, p.barcode,
    so.qty, 0 as cost_price, so.out_type as invoice_no, so.notes, so.out_date as date,
    so.destination as supplier_name, u.name as user_name, so.created_at
    FROM stock_out so JOIN products p ON so.product_id = p.id
    LEFT JOIN users u ON so.created_by = u.id WHERE 1=1`;
  const outParams = [];

  // 판매 출고
  let saleSql = `SELECT s.id, 'sale' as direction, si.product_id, p.name as product_name, p.barcode,
    si.qty, si.unit_price as cost_price, s.payment_method as invoice_no, s.customer_name as notes, date(s.sale_date) as date,
    '' as supplier_name, u.name as user_name, s.sale_date as created_at
    FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
    LEFT JOIN users u ON s.sold_by = u.id WHERE s.payment_status = 'paid'`;
  const saleParams = [];

  if (product_id) {
    inSql += " AND si.product_id = ?"; inParams.push(product_id);
    outSql += " AND so.product_id = ?"; outParams.push(product_id);
    saleSql += " AND si.product_id = ?"; saleParams.push(product_id);
  }
  if (date_from) {
    inSql += " AND si.received_date >= ?"; inParams.push(date_from);
    outSql += " AND so.out_date >= ?"; outParams.push(date_from);
    saleSql += " AND date(s.sale_date) >= ?"; saleParams.push(date_from);
  }
  if (date_to) {
    inSql += " AND si.received_date <= ?"; inParams.push(date_to);
    outSql += " AND so.out_date <= ?"; outParams.push(date_to);
    saleSql += " AND date(s.sale_date) <= ?"; saleParams.push(date_to);
  }

  let results = [];
  if (!type || type === 'all' || type === 'in') {
    results = results.concat(db.prepare(inSql).all(...inParams));
  }
  if (!type || type === 'all' || type === 'out') {
    results = results.concat(db.prepare(outSql).all(...outParams));
  }
  if (!type || type === 'all' || type === 'sale') {
    results = results.concat(db.prepare(saleSql).all(...saleParams));
  }

  // Sort by date desc
  results.sort((a, b) => (b.created_at || b.date || '').localeCompare(a.created_at || a.date || ''));
  res.json(results.slice(0, maxRows));
});

// 입고 이력 조회
app.get('/api/stock-in', (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = `SELECT si.*, p.name as product_name, p.barcode, s.name as supplier_name, u.name as user_name
    FROM stock_in si JOIN products p ON si.product_id = p.id
    LEFT JOIN suppliers s ON si.supplier_id = s.id LEFT JOIN users u ON si.created_by = u.id WHERE 1=1`;
  const params = [];
  if (date_from) { sql += " AND si.received_date >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND si.received_date <= ?"; params.push(date_to); }
  sql += " ORDER BY si.created_at DESC LIMIT 100";
  res.json(db.prepare(sql).all(...params));
});

// 출고 이력 조회
app.get('/api/stock-out', (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = `SELECT so.*, p.name as product_name, p.barcode, u.name as user_name
    FROM stock_out so JOIN products p ON so.product_id = p.id
    LEFT JOIN users u ON so.created_by = u.id WHERE 1=1`;
  const params = [];
  if (date_from) { sql += " AND so.out_date >= ?"; params.push(date_from); }
  if (date_to) { sql += " AND so.out_date <= ?"; params.push(date_to); }
  sql += " ORDER BY so.created_at DESC LIMIT 100";
  res.json(db.prepare(sql).all(...params));
});

// ====== REPORTS ======
app.get('/api/reports/sales', (req, res) => {
  const { period } = req.query; // daily, monthly
  let sql;
  if (period === 'monthly') {
    sql = `SELECT strftime('%Y-%m', sale_date) as period, COUNT(*) as count, SUM(final_amount) as revenue,
      SUM(total_amount - final_amount) as total_discount FROM sales WHERE payment_status = 'paid' GROUP BY period ORDER BY period DESC LIMIT 12`;
  } else {
    sql = `SELECT date(sale_date) as period, COUNT(*) as count, SUM(final_amount) as revenue,
      SUM(total_amount - final_amount) as total_discount FROM sales WHERE payment_status = 'paid' GROUP BY period ORDER BY period DESC LIMIT 30`;
  }
  res.json(db.prepare(sql).all());
});

app.get('/api/reports/profit', (req, res) => {
  const { date_from, date_to } = req.query;
  let where = "WHERE s.payment_status = 'paid'";
  const params = [];
  if (date_from) { where += " AND date(s.sale_date) >= ?"; params.push(date_from); }
  if (date_to) { where += " AND date(s.sale_date) <= ?"; params.push(date_to); }

  const rows = db.prepare(`
    SELECT p.name, p.category_id, c.name as category_name,
      SUM(si.qty) as total_qty, SUM(si.subtotal) as revenue,
      SUM(si.qty * p.cost_price) as cost, SUM(si.subtotal) - SUM(si.qty * p.cost_price) as profit
    FROM sale_items si JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id LEFT JOIN categories c ON p.category_id = c.id
    ${where} GROUP BY si.product_id ORDER BY profit DESC
  `).all(...params);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  res.json({ items: rows, totalRevenue, totalCost, totalProfit, profitMargin: totalRevenue ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0 });
});

// ====== PARTS (KR→MG 부품) ======
app.get('/api/parts', (req, res) => {
  const { search } = req.query;
  let sql = "SELECT * FROM parts WHERE 1=1";
  const params = [];
  if (search) { sql += " AND (product_model LIKE ? OR part_number LIKE ? OR part_name LIKE ?)"; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  sql += " ORDER BY product_model, id";
  res.json(db.prepare(sql).all(...params));
});

// ====== ORDERS KR (한국 주문건) ======
app.get('/api/orders-kr', (req, res) => {
  const { status } = req.query;
  let sql = "SELECT * FROM orders_kr WHERE 1=1";
  if (status === 'shortage') sql += " AND shortage > 0";
  if (status === 'shipped') sql += " AND shipped_qty > 0";
  if (status === 'pending') sql += " AND (shipped_qty = 0 OR shipped_qty IS NULL)";
  sql += " ORDER BY id";
  res.json(db.prepare(sql).all());
});

// ====== INVENTORY SUMMARY ======
app.get('/api/inventory-summary', (req, res) => {
  const byCategory = db.prepare(`
    SELECT c.name as category, c.icon, COUNT(*) as count, SUM(p.stock_qty) as total_stock,
      SUM(CASE WHEN p.stock_qty = 0 THEN 1 ELSE 0 END) as out_of_stock,
      SUM(CASE WHEN p.stock_qty > 0 AND p.stock_qty <= p.min_stock THEN 1 ELSE 0 END) as low_stock
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 GROUP BY p.category_id ORDER BY total_stock DESC
  `).all();
  const totals = db.prepare("SELECT COUNT(*) as total, SUM(stock_qty) as stock, SUM(CASE WHEN stock_qty=0 THEN 1 ELSE 0 END) as oos FROM products WHERE is_active=1").get();
  res.json({ byCategory, totals });
});

app.listen(PORT, () => console.log(`Shop Manager running on port ${PORT}`));
