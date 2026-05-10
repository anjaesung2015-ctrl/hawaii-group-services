const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join('/home/ubuntu/.openclaw/workspace/staff-manager', 'staff.db'));

function tableExists(n) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n);
}

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

if (!tableExists('attendance')) {
  db.exec(`CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    UNIQUE(staff_id, date)
  )`);
  db.exec('CREATE INDEX idx_attendance_staff_date ON attendance(staff_id, date)');
  console.log('+ attendance');
} else {
  const cols = columnNames('attendance');
  if (cols.includes('clock_in') && !cols.includes('check_in')) {
    db.exec('ALTER TABLE attendance RENAME COLUMN clock_in TO check_in');
    console.log('~ attendance.clock_in -> check_in');
  }
  if (cols.includes('clock_out') && !cols.includes('check_out')) {
    db.exec('ALTER TABLE attendance RENAME COLUMN clock_out TO check_out');
    console.log('~ attendance.clock_out -> check_out');
  }
  console.log('= attendance exists');
}
db.close();
