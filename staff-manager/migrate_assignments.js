// migrate_assignments.js — 업무지시 / 체크리스트 테이블 추가 (idempotent)
const Database = require('better-sqlite3');
const db = new Database(require('path').join(__dirname, 'staff.db'));

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

if (!tableExists('work_assignments')) {
  db.exec(`CREATE TABLE work_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL,
    scope_value TEXT,
    recurrence TEXT NOT NULL,
    target_date TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  console.log('+ work_assignments');
}

if (!tableExists('assignment_completions')) {
  db.exec(`CREATE TABLE assignment_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    done_at TEXT,
    UNIQUE(assignment_id, staff_id, date)
  )`);
  console.log('+ assignment_completions');
}


// add deleted_at column if missing (idempotent)
const cols = db.prepare("PRAGMA table_info(work_assignments)").all().map(c=>c.name);
if (!cols.includes('deleted_at')) {
  db.exec('ALTER TABLE work_assignments ADD COLUMN deleted_at TEXT');
  console.log('+ work_assignments.deleted_at');
}

console.log('DB migration done');
db.close();
