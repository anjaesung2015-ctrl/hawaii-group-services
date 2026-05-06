const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join('/home/ubuntu/.openclaw/workspace/staff-manager', 'staff.db'));

function tableExists(n) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n);
}

if (!tableExists('staff_checklists')) {
  db.exec(`CREATE TABLE staff_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  )`);
  db.exec('CREATE INDEX idx_staff_checklists_staff ON staff_checklists(staff_id, deleted_at)');
  console.log('+ staff_checklists');
} else {
  console.log('= staff_checklists exists');
}

if (!tableExists('staff_checklist_completions')) {
  db.exec(`CREATE TABLE staff_checklist_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    done_at TEXT,
    UNIQUE(item_id, date)
  )`);
  db.exec('CREATE INDEX idx_chkl_comp_lookup ON staff_checklist_completions(staff_id, date)');
  console.log('+ staff_checklist_completions');
} else {
  console.log('= staff_checklist_completions exists');
}

console.log('done');
db.close();
