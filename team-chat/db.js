const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'chat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    lang TEXT DEFAULT 'mn',
    avatar_color TEXT DEFAULT '#3b82f6',
    business TEXT DEFAULT 'all',
    is_active INTEGER DEFAULT 1,
    last_seen TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'group',
    icon TEXT DEFAULT '💬',
    business TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    original_text TEXT NOT NULL,
    original_lang TEXT DEFAULT 'mn',
    translated_ko TEXT,
    translated_mn TEXT,
    msg_type TEXT DEFAULT 'text',
    reply_to INTEGER,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS read_receipts (
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    last_read_msg_id INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, room_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
`);

// Seed data
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  // 사장님
  db.prepare("INSERT INTO users (username, password, name, role, lang, avatar_color, business) VALUES (?,?,?,?,?,?,?)")
    .run('admin', 'admin123', '재성', 'admin', 'ko', '#f59e0b', 'all');

  // 피트니스 직원
  const fitnessStaff = [
    ['esongoо', 'staff123', 'Есөнгоо', 'manager', 'mn', '#22c55e', 'fitness'],
    ['enkhuush', 'staff123', 'Энхүүш', 'staff', 'mn', '#3b82f6', 'fitness'],
    ['nomio', 'staff123', 'Номио', 'staff', 'mn', '#ec4899', 'fitness'],
    ['enkhjin', 'staff123', 'Энхжин', 'staff', 'mn', '#8b5cf6', 'fitness'],
    ['gan', 'staff123', 'Ган Эрдэнэ', 'staff', 'mn', '#ef4444', 'fitness'],
    ['ichko', 'staff123', 'Ичко', 'staff', 'mn', '#14b8a6', 'fitness'],
  ];

  // 센터 직원
  const centerStaff = [
    ['matgarsuren', 'staff123', 'Матгарсүрэн', 'manager', 'mn', '#f97316', 'center'],
    ['udatchilgt', 'staff123', 'Удатчилгт', 'staff', 'mn', '#06b6d4', 'center'],
    ['enkhsargal', 'staff123', 'Энхсаргал', 'staff', 'mn', '#a855f7', 'center'],
  ];

  // 샵 직원
  const shopStaff = [
    ['guni', 'staff123', 'Гүни', 'staff', 'mn', '#84cc16', 'shop'],
    ['ulmga', 'staff123', 'Улмга', 'staff', 'mn', '#e11d48', 'shop'],
  ];

  const stmt = db.prepare("INSERT INTO users (username, password, name, role, lang, avatar_color, business) VALUES (?,?,?,?,?,?,?)");
  [...fitnessStaff, ...centerStaff, ...shopStaff].forEach(s => stmt.run(...s));

  // 기본 방
  const rooms = [
    ['📢 전체 공지', 'announce', '📢', 'all', 1],
    ['🏋️ 피트니스', 'group', '🏋️', 'fitness', 1],
    ['🎾 센터', 'group', '🎾', 'center', 1],
    ['🛒 하와이샵', 'group', '🛒', 'shop', 1],
    ['☕ 자유게시판', 'group', '☕', 'all', 1],
  ];
  const roomStmt = db.prepare("INSERT INTO rooms (name, type, icon, business, created_by) VALUES (?,?,?,?,?)");
  rooms.forEach(r => roomStmt.run(...r));

  // 모든 유저를 전체공지, 자유게시판에 추가
  const allUsers = db.prepare("SELECT id, business FROM users").all();
  const memberStmt = db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?,?)");
  
  allUsers.forEach(u => {
    memberStmt.run(1, u.id); // 전체 공지
    memberStmt.run(5, u.id); // 자유게시판
    if (u.business === 'fitness' || u.business === 'all') memberStmt.run(2, u.id);
    if (u.business === 'center' || u.business === 'all') memberStmt.run(3, u.id);
    if (u.business === 'shop' || u.business === 'all') memberStmt.run(4, u.id);
  });
}

module.exports = db;
