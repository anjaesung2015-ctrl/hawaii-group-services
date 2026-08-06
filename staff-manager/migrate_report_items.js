const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  item_date TEXT NOT NULL,
  title TEXT,
  memo TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
)`);

const cols = db.prepare("PRAGMA table_info(report_items)").all().map(c => c.name);
console.log('report_items columns:', cols.join(','));
console.log('staff count:', db.prepare("SELECT COUNT(*) c FROM staff WHERE is_active=1").get().c);
