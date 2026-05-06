const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join('/home/ubuntu/.openclaw/workspace/staff-manager', 'staff.db'));

function tableExists(n) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n);
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
  console.log('= attendance exists');
}
db.close();
