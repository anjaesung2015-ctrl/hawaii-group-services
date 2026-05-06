const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fitness.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    gender TEXT CHECK(gender IN ('M', 'F', 'Other')),
    birth_date TEXT,
    address TEXT,
    emergency_contact TEXT,
    emergency_phone TEXT,
    photo_url TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'expired', 'frozen')),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS membership_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    type_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    price_paid REAL,
    payment_method TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'frozen', 'cancelled')),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (member_id) REFERENCES members(id),
    FOREIGN KEY (type_id) REFERENCES membership_types(id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    check_in TEXT DEFAULT (datetime('now', 'localtime')),
    check_out TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS trainers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    specialty TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS pt_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    trainer_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (member_id) REFERENCES members(id),
    FOREIGN KEY (trainer_id) REFERENCES trainers(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_type TEXT NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    description TEXT,
    payment_date TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (member_id) REFERENCES members(id)
  );
`);

// Insert default membership types if empty
const count = db.prepare('SELECT COUNT(*) as cnt FROM membership_types').get();
if (count.cnt === 0) {
  const insert = db.prepare('INSERT INTO membership_types (name, duration_days, price, description) VALUES (?, ?, ?, ?)');
  insert.run('1개월', 30, 50000, '1개월 이용권');
  insert.run('3개월', 90, 130000, '3개월 이용권');
  insert.run('6개월', 180, 240000, '6개월 이용권');
  insert.run('1년', 365, 420000, '1년 이용권');
  insert.run('PT 10회', 30, 300000, 'PT 10회 패키지');
  insert.run('PT 20회', 60, 550000, 'PT 20회 패키지');
}

// Add freeze columns if not exist
try { db.exec("ALTER TABLE memberships ADD COLUMN freeze_date TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE memberships ADD COLUMN remaining_days INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE memberships ADD COLUMN freeze_reason TEXT"); } catch(e) {}
// Add barcode_id to members
try { db.exec("ALTER TABLE members ADD COLUMN barcode_id TEXT UNIQUE"); } catch(e) {}

module.exports = db;
