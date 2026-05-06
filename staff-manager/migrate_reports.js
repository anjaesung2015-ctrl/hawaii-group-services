// migrate_reports.js — 업무보고 기능을 위한 DB 마이그레이션
// 재실행 안전 (idempotent)
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'staff.db'));

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

console.log('[migrate] start');

// 1) staff 테이블에 PIN 컬럼 추가
if (!columnExists('staff', 'pin_hash')) {
  db.exec("ALTER TABLE staff ADD COLUMN pin_hash TEXT");
  console.log('  + staff.pin_hash');
}
if (!columnExists('staff', 'pin_locked_until')) {
  db.exec("ALTER TABLE staff ADD COLUMN pin_locked_until TEXT");
  console.log('  + staff.pin_locked_until');
}
if (!columnExists('staff', 'pin_fail_count')) {
  db.exec("ALTER TABLE staff ADD COLUMN pin_fail_count INTEGER DEFAULT 0");
  console.log('  + staff.pin_fail_count');
}

// 2) work_reports 테이블 생성
if (!tableExists('work_reports')) {
  db.exec(`CREATE TABLE work_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    report_type TEXT NOT NULL,
    report_date TEXT NOT NULL,
    field_today TEXT, field_tomorrow TEXT, field_issue TEXT,
    field_done TEXT, field_plan TEXT, field_suggestion TEXT,
    field_today_ko TEXT, field_tomorrow_ko TEXT, field_issue_ko TEXT,
    field_done_ko TEXT, field_plan_ko TEXT, field_suggestion_ko TEXT,
    submitted_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    notified INTEGER DEFAULT 0,
    translation_status TEXT,
    UNIQUE(staff_id, report_type, report_date),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
  )`);
  console.log('  + work_reports table');
}

// 3) report_settings 테이블 생성
if (!tableExists('report_settings')) {
  db.exec(`CREATE TABLE report_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // 기본값
  const defaults = {
    telegram_chat_id: '',
    daily_summary_time: '21:00',
    summary_mode: 'simple',
    realtime_alert: '1',
    weekly_summary: '1',
    include_missing: '1'
  };
  const ins = db.prepare("INSERT INTO report_settings (key,value) VALUES (?,?)");
  Object.entries(defaults).forEach(([k,v]) => ins.run(k, v));
  console.log('  + report_settings table (with defaults)');
}

// 4) report_audit 테이블 생성
if (!tableExists('report_audit')) {
  db.exec(`CREATE TABLE report_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    action TEXT,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  console.log('  + report_audit table');
}

console.log('[migrate] done');
db.close();
