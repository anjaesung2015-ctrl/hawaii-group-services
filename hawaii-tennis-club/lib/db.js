// SQLite 한 파일(data/club.db)에 전부 담는다. 스키마는 부팅 때 멱등으로 만든다.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'club.db');

// 울란바토르 기준 날짜 — 폰 시간대가 어디로 맞춰져 있어도 클럽 날짜는 하나다
const UB = 'Asia/Ulaanbaatar';
const DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: UB, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DATE_FMT.format(new Date());
const thisMonth = () => today().slice(0, 7);

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
const EVENT_KINDS = ['regular', 'event', 'tournament'];
const ANSWERS = ['yes', 'no', 'maybe'];
const METHODS = ['cash', 'transfer', 'qpay'];
const DUE_KINDS = ['monthly', 'joining'];

const DEFAULTS = {
  club_name: 'Hawaii Tennis Club',
  monthly_fee: '200000',
  joining_fee: '300000',
  currency: '₮',
};

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL UNIQUE,
      pin_hash   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'member'  CHECK (role IN ('admin','member')),
      title      TEXT,                                  -- 대표 / 코치 등 (표시용)
      level      TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('newbie','beginner','intermediate','advanced')),
      status     TEXT NOT NULL DEFAULT 'active'   CHECK (status IN ('active','dormant')),
      joined_at  TEXT NOT NULL,
      memo       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS event (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      kind       TEXT NOT NULL CHECK (kind IN ('regular','event','tournament')),
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time   TEXT NOT NULL,
      courts     INTEGER NOT NULL DEFAULT 1,
      memo       TEXT,
      created_by INTEGER REFERENCES member(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      reminded_at TEXT                                  -- 하루 전 알림을 보낸 시각 (두 번 보내지 않도록)
    );
    CREATE INDEX IF NOT EXISTS idx_event_date ON event(event_date);

    -- 참석/불참/미정은 회원마다 한 줄. 바꾸면 그 줄을 덮어쓴다.
    CREATE TABLE IF NOT EXISTS rsvp (
      event_id   INTEGER NOT NULL REFERENCES event(id)  ON DELETE CASCADE,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      answer     TEXT NOT NULL CHECK (answer IN ('yes','no','maybe')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (event_id, member_id)
    );

    -- 회비 한 줄 = 한 사람의 한 달치(또는 입회비 1회). paid_at 이 NULL 이면 미납.
    CREATE TABLE IF NOT EXISTS due (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK (kind IN ('monthly','joining')),
      period     TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      paid_at    TEXT,
      method     TEXT CHECK (method IN ('cash','transfer','qpay')),
      note       TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (member_id, kind, period)
    );

    CREATE TABLE IF NOT EXISTS notice (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      photo      TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES member(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS setting (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    -- 회칙 등 클럽 문서. 언어마다 한 줄. 고치면 version 이 올라간다(동의 받은 판을 구분하기 위해).
    CREATE TABLE IF NOT EXISTS doc (
      key        TEXT NOT NULL,
      lang       TEXT NOT NULL CHECK (lang IN ('ko','mn')),
      body       TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by INTEGER REFERENCES member(id),
      PRIMARY KEY (key, lang)
    );

    -- 조직도 (회칙 제14조). 회원을 지정하거나, 회원이 아닌 분은 이름만 적는다(명예회장·고문).
    CREATE TABLE IF NOT EXISTS officer (
      role        TEXT PRIMARY KEY,
      member_id   INTEGER REFERENCES member(id) ON DELETE SET NULL,
      person_name TEXT,
      note        TEXT,
      sort        INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT
    );

    -- 폰 알림 구독 — 한 사람이 폰·PC 여러 대를 등록할 수 있다(기기마다 endpoint 하나).
    CREATE TABLE IF NOT EXISTS push_sub (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- 자유게시판 — 회원이 쓰고, 사진을 붙이고, 댓글·좋아요를 단다.
    -- 회원을 지우면 그 사람 글·댓글·좋아요도 함께 사라진다(ON DELETE CASCADE).
    CREATE TABLE IF NOT EXISTS post (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_post_new ON post(id DESC);

    CREATE TABLE IF NOT EXISTS post_photo (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
      path    TEXT NOT NULL,
      sort    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS comment (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL REFERENCES post(id)   ON DELETE CASCADE,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_comment_post ON comment(post_id, id);

    -- 좋아요는 한 사람이 한 번 (다시 누르면 지워진다)
    CREATE TABLE IF NOT EXISTS post_like (
      post_id   INTEGER NOT NULL REFERENCES post(id)   ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, member_id)
    );

    -- 가입 신청 — 승인될 때까지는 회원이 아니다(로그인 불가). PIN은 신청할 때 받은 걸 그대로 물려준다.
    CREATE TABLE IF NOT EXISTS join_request (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      pin_hash   TEXT NOT NULL,
      level      TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('newbie','beginner','intermediate','advanced')),
      memo       TEXT,
      status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      decided_at TEXT,
      decided_by INTEGER REFERENCES member(id)
    );
    -- 같은 번호로 신청을 두 번 겹쳐 넣을 수 없다 (거절·승인된 옛 신청은 남아도 된다)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_join_pending ON join_request(phone) WHERE status='pending';
  `);

  // 이미 만들어진 DB 에도 새 칸을 더한다 (없을 때만)
  const cols = db.prepare('PRAGMA table_info(event)').all().map(c => c.name);
  if (!cols.includes('reminded_at')) db.exec('ALTER TABLE event ADD COLUMN reminded_at TEXT');

  // 회칙 동의 — 언제, 어느 판(version)에 동의했는지
  const mcols = db.prepare('PRAGMA table_info(member)').all().map(c => c.name);
  // 오너(사장님) 표시 — role 의 CHECK 제약을 건드리지 않으려고 별도 칸으로 둔다.
  // 오너는 운영진 권한을 주고 회수하며, 회칙 수정·조직도·회비 금액·회원 삭제를 혼자 한다.
  if (!mcols.includes('is_owner')) db.exec('ALTER TABLE member ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0');
  if (!mcols.includes('rules_agreed_at')) db.exec('ALTER TABLE member ADD COLUMN rules_agreed_at TEXT');
  if (!mcols.includes('rules_version')) db.exec('ALTER TABLE member ADD COLUMN rules_version INTEGER');
  const jcols = db.prepare('PRAGMA table_info(join_request)').all().map(c => c.name);
  if (!jcols.includes('agreed_at')) db.exec('ALTER TABLE join_request ADD COLUMN agreed_at TEXT');
  if (!jcols.includes('agreed_version')) db.exec('ALTER TABLE join_request ADD COLUMN agreed_version INTEGER');
  // 가입 신청서 (종이 회칙 동의서와 같은 칸) — 영문 이름, 티셔츠 사이즈, 추천 회원, 개인정보 동의
  for (const [c, type] of [['name_en', 'TEXT'], ['shirt_size', 'TEXT'], ['recommenders', 'TEXT'], ['privacy_agreed_at', 'TEXT']]) {
    if (!jcols.includes(c)) db.exec(`ALTER TABLE join_request ADD COLUMN ${c} ${type}`);
  }

  const put = db.prepare('INSERT INTO setting (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING');
  for (const [k, v] of Object.entries(DEFAULTS)) put.run(k, v);

  // 회칙 처음 내용 (비어 있을 때만 — 앱에서 고친 내용을 덮어쓰지 않는다)
  const { KO, MN } = require('./rules-text');
  const putDoc = db.prepare("INSERT INTO doc (key, lang, body) VALUES ('rules', ?, ?) ON CONFLICT(key, lang) DO NOTHING");
  putDoc.run('ko', KO);
  putDoc.run('mn', MN);

  // 조직도 자리 (회칙 제14조) — 사람은 비어 있고 자리만 먼저 만들어 둔다
  const putOfficer = db.prepare('INSERT INTO officer (role, sort) VALUES (?,?) ON CONFLICT(role) DO NOTHING');
  OFFICER_ROLES.forEach((r, i) => putOfficer.run(r.role, i));
}

// 회칙 제14조의 직책. slots = 그 자리에 몇 명까지.
const OFFICER_ROLES = [
  { role: 'owner',     group: 'owner',    slots: 1 },
  { role: 'president', group: 'exec',     slots: 1 },
  { role: 'vice1',     group: 'exec',     slots: 1 },
  { role: 'vice2',     group: 'exec',     slots: 1 },
  { role: 'manager1',  group: 'exec',     slots: 1 },
  { role: 'manager2',  group: 'exec',     slots: 1 },
  { role: 'match',     group: 'exec',     slots: 1 },
  { role: 'event',     group: 'exec',     slots: 1 },
  { role: 'external',  group: 'exec',     slots: 1 },
  { role: 'honorary',  group: 'honorary', slots: 1 },
  { role: 'advisor1',  group: 'honorary', slots: 1 },
  { role: 'advisor2',  group: 'honorary', slots: 1 },
  { role: 'advisor3',  group: 'honorary', slots: 1 },
];

// 첫 실행이면 관리자(대표) 한 명을 만든다. 이미 관리자가 있으면 아무것도 하지 않는다.
function ensureFirstAdmin(db, { name, phone, pin } = {}) {
  const has = db.prepare("SELECT COUNT(*) c FROM member WHERE role='admin'").get().c;
  if (has) return null;

  const admin = {
    name: name || process.env.ADMIN_NAME || '대표',
    phone: normalizePhone(phone || process.env.ADMIN_PHONE || '99000000'),
    pin: String(pin || process.env.ADMIN_PIN || '1234'),
  };
  db.prepare(`INSERT INTO member (name, phone, pin_hash, role, title, level, status, joined_at)
              VALUES (?,?,?,'admin','대표','advanced','active',?)`)
    .run(admin.name, admin.phone, hashPin(admin.pin), today());
  return admin;
}

// 오너가 아무도 없으면 가장 먼저 만들어진 관리자를 오너로 삼는다 (부팅 때 한 번).
function ensureOwner(db) {
  const has = db.prepare('SELECT COUNT(*) c FROM member WHERE is_owner=1').get().c;
  if (has) return null;
  const first = db.prepare("SELECT id, name FROM member WHERE role='admin' ORDER BY id LIMIT 1").get();
  if (!first) return null;
  db.prepare('UPDATE member SET is_owner=1 WHERE id=?').run(first.id);
  return first;
}

const hashPin = (pin) => bcrypt.hashSync(String(pin), 10);
const checkPin = (pin, hash) => bcrypt.compareSync(String(pin ?? ''), hash);

// 저장은 숫자만 (0901-2345, +976 9012 3456 … 어떻게 적어도 같은 번호로 모인다)
function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.startsWith('976') && digits.length > 8 ? digits.slice(3) : digits;
}
const validPhone = (p) => /^\d{8}$/.test(normalizePhone(p));   // 몽골 번호 8자리
const validPin = (p) => /^\d{4}$/.test(String(p ?? ''));

function getSettings(db) {
  const rows = db.prepare('SELECT k, v FROM setting').all();
  const out = {};
  for (const r of rows) out[r.k] = r.v;
  return {
    club_name: out.club_name || DEFAULTS.club_name,
    monthly_fee: Number(out.monthly_fee || DEFAULTS.monthly_fee),
    joining_fee: Number(out.joining_fee || DEFAULTS.joining_fee),
    currency: out.currency || DEFAULTS.currency,
  };
}

function setSettings(db, patch) {
  const put = db.prepare('INSERT INTO setting (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
  const tx = db.transaction((p) => {
    for (const [k, v] of Object.entries(p)) if (k in DEFAULTS) put.run(k, String(v));
  });
  tx(patch);
  return getSettings(db);
}

module.exports = {
  open, migrate, ensureFirstAdmin, ensureOwner, getSettings, setSettings,
  hashPin, checkPin, normalizePhone, validPhone, validPin,
  today, thisMonth, UB,
  LEVELS, EVENT_KINDS, ANSWERS, METHODS, DUE_KINDS, DEFAULTS, DB_PATH,
  OFFICER_ROLES,
};
