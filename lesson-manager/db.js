const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'lesson.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,
    days TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    max_students INTEGER DEFAULT 8,
    per_session_fee INTEGER DEFAULT 100000,
    monthly_fee INTEGER DEFAULT 800000,
    monthly_sessions INTEGER DEFAULT 8,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    court_id INTEGER DEFAULT 0,
    level TEXT DEFAULT 'all',
    theme TEXT DEFAULT '',
    billing_type TEXT DEFAULT 'per_session'
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    gender TEXT DEFAULT 'M',
    level TEXT DEFAULT 'beginner',
    program_id INTEGER,
    payment_type TEXT DEFAULT 'monthly',
    status TEXT DEFAULT 'active',
    notes TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    custom_fee INTEGER DEFAULT 0,
    sessions_bought INTEGER DEFAULT NULL,
    FOREIGN KEY (program_id) REFERENCES programs(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (program_id) REFERENCES programs(id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    status TEXT DEFAULT 'present',
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    UNIQUE(session_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    program_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT DEFAULT 'monthly',
    period TEXT,
    payment_method TEXT DEFAULT 'cash',
    payment_date TEXT NOT NULL,
    notes TEXT,
    sessions_bought INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (program_id) REFERENCES programs(id)
  );

  CREATE TABLE IF NOT EXISTS courts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    surface TEXT DEFAULT 'hard',
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS training_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    week_number INTEGER DEFAULT 1,
    day_of_week TEXT,
    block_order INTEGER DEFAULT 1,
    block_name TEXT,
    duration_min INTEGER DEFAULT 30,
    description TEXT,
    drills TEXT,
    intensity TEXT DEFAULT 'medium',
    video_url TEXT,
    steps TEXT,
    steps_1court TEXT,
    steps_2court TEXT,
    players_per_drill INTEGER DEFAULT 2,
    court_count INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    program_id INTEGER,
    session_date TEXT,
    coach_notes TEXT,
    performance_rating INTEGER DEFAULT 3,
    highlights TEXT,
    improvements TEXT,
    injuries TEXT,
    attendance_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// 기본 계정
const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!admin) {
  db.prepare("INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)").run('admin', 'admin123', '관리자', 'admin');
}

module.exports = db;
