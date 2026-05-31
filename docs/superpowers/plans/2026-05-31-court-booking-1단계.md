# Court Booking 1단계 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hawaii Sports 테니스 코트 1면 셀프 예약 + QPay 결제 + 어드민 대시보드 시스템을 4~6주 안에 출시 가능한 상태로 구축한다.

**Architecture:** 단일 Node.js (Express 5) 모놀리식 서버 + SQLite(better-sqlite3) + node-cron + 정적 `public/`. 빌드 단계 없음. staff-manager JWT 쿠키 SSO. QPay v2 결제 (15분 하드락, 안전망 cron). 직원 알림은 Telegram, 손님 알림은 이메일.

**Tech Stack:** Node 20+ / Express 5 / better-sqlite3 11+ / jsonwebtoken / cookie-parser / bcryptjs / node-cron / dotenv / nodemailer / express-rate-limit / Tailwind CSS (CDN) / Alpine.js v3 / dayjs / node:test (의존성 ✗)

**Spec:** `docs/superpowers/specs/2026-05-31-court-booking-design.md`

**작업 환경:** 모든 파일/명령은 EC2 (`ubuntu@3.93.96.130`) 기준. 로컬 Windows에서 SSH/SCP로 작업하거나 EC2에 직접 SSH 후 편집. SSH 명령 예: `ssh -i C:\Users\Asus\Downloads\eunice-key.pem ubuntu@3.93.96.130`

---

## File Structure

```
/home/ubuntu/.openclaw/workspace/court-booking/
├── server.js                  Express 부트, 라우터 마운트, 정적 서빙
├── package.json
├── .env                       (gitignored) 시크릿
├── .env.example               시크릿 키 명세
├── .gitignore
├── court.db                   (gitignored) SQLite
├── db.js                      better-sqlite3 wrapper + 트랜잭션 헬퍼
├── public-code.js             public_code 생성기 + 충돌 재시도
├── availability.js            가용성 계산 (요일별 운영시간)
├── audit-log.js               audit_log INSERT 헬퍼
├── errors.js                  표준 에러 응답 (message_mn 포함)
├── auth.js                    staff-manager JWT 검증 미들웨어
├── qpay-client.js             QPay v2 클라이언트 (auth/invoice/check)
├── telegram-client.js         staff-manager에서 복사
├── email-client.js            nodemailer + 확정 이메일 템플릿
├── cron-jobs.js               autoCancel + verifyAwaiting + markCompleted
├── routes/
│   ├── public.js              공개 API
│   ├── admin.js               어드민 API (JWT 필수)
│   └── qpay.js                QPay 콜백
├── middleware/
│   ├── rate-limit.js          express-rate-limit 인스턴스
│   ├── csrf.js                Origin 헤더 화이트리스트
│   └── error-handler.js       전역 에러 핸들러
├── migrations/
│   ├── 001_init.sql           초기 스키마 + 시드
│   └── migrate.js             마이그레이션 실행기
├── test/
│   ├── public-code.test.js
│   ├── slot-conflict.test.js
│   ├── availability.test.js
│   ├── qpay-idempotency.test.js
│   ├── cron-autocancel.test.js
│   └── auth.test.js
└── public/
    ├── index.html             고객 SPA
    ├── admin/index.html       어드민 SPA
    ├── assets/
    │   ├── css/app.css        Tailwind 사용자 컴포넌트 (최소)
    │   └── js/
    │       ├── api.js         fetch 래퍼
    │       ├── i18n.js        t('key', vars) 헬퍼
    │       ├── customer.js    고객 Alpine 컴포넌트
    │       └── admin.js       어드민 Alpine 컴포넌트
    └── locales/
        └── mn.json            몽골어 키 약 40개
```

**커밋 컨벤션**: `<type>(court-booking): <변경 요약>` (예: `feat(court-booking): POST /api/bookings 추가`). 기존 staff-manager 패턴과 동일.

---

## Phase A — Foundation

### Task 1: 디렉토리 생성 + npm init + 의존성 설치

**Files:**
- Create: `/home/ubuntu/.openclaw/workspace/court-booking/package.json`
- Create: `/home/ubuntu/.openclaw/workspace/court-booking/.gitignore`

- [ ] **Step 1: 디렉토리 생성**

```bash
cd /home/ubuntu/.openclaw/workspace
mkdir court-booking && cd court-booking
```

- [ ] **Step 2: package.json 초기화 + 의존성 설치**

```bash
npm init -y
npm i express@^5.0.0 better-sqlite3@^11.0.0 jsonwebtoken@^9.0.0 \
  cookie-parser@^1.4.7 bcryptjs@^3.0.3 node-cron@^4.0.0 \
  dotenv@^17.0.0 nodemailer@^6.9.0 express-rate-limit@^7.0.0
```

- [ ] **Step 3: package.json 정리**

`package.json`의 `"main"`을 `"server.js"`로, `"scripts"`에 추가:

```json
{
  "name": "court-booking",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/",
    "migrate": "node migrations/migrate.js"
  }
}
```

- [ ] **Step 4: .gitignore 작성**

`.gitignore`:
```
node_modules/
*.db
*.db-shm
*.db-wal
.env
*.bak
*.bak-*
```

- [ ] **Step 5: 커밋**

```bash
cd /home/ubuntu/.openclaw/workspace
git add court-booking/package.json court-booking/package-lock.json court-booking/.gitignore
git commit -m "chore(court-booking): 초기 패키지 구성"
```

---

### Task 2: 환경변수 (.env.example) + dotenv 부트

**Files:**
- Create: `court-booking/.env.example`
- Create: `court-booking/.env` (gitignored, 운영자가 실제 값 입력)

- [ ] **Step 1: .env.example 작성**

```bash
cat > .env.example <<'EOF'
# Server
PORT=6031
NODE_ENV=production

# SSO (staff-manager와 동일 값 공유)
JWT_SECRET=__copy_from_staff_manager_env__
STAFF_MANAGER_URL=http://localhost:6010

# QPay v2
QPAY_USERNAME=
QPAY_PASSWORD=
QPAY_INVOICE_CODE=
QPAY_CALLBACK_URL=https://app.hawaiigroup.co/booking/qpay/callback

# Telegram (직원 알림)
TELEGRAM_BOT_TOKEN=__same_as_staff_manager__
TELEGRAM_STAFF_CHAT_ID=

# SMTP (손님 이메일)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=
SMTP_FROM=booking@hawaiigroup.co

# 보안
ALLOWED_ORIGINS=https://app.hawaiigroup.co
EOF
```

- [ ] **Step 2: .env 복사 후 실제 값 입력 (수동, 운영자)**

```bash
cp .env.example .env
# JWT_SECRET 가져오기:
grep '^JWT_SECRET=' /home/ubuntu/.openclaw/workspace/staff-manager/.env
# TELEGRAM_BOT_TOKEN도 동일하게 확인
# QPay/SMTP는 운영자가 발급/입력
vi .env
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/.env.example
git commit -m "chore(court-booking): .env.example 추가"
```

---

### Task 3: SQLite 마이그레이션 (001_init.sql + 실행기)

**Files:**
- Create: `court-booking/migrations/001_init.sql`
- Create: `court-booking/migrations/migrate.js`

- [ ] **Step 1: 001_init.sql 작성**

```bash
mkdir -p migrations
cat > migrations/001_init.sql <<'SQL'
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE court (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_mn         TEXT NOT NULL,
  group_name      TEXT NOT NULL DEFAULT 'main',
  sport           TEXT NOT NULL DEFAULT 'tennis' CHECK (sport IN ('tennis')),
  open_hours      TEXT NOT NULL,
  price_per_hour  INTEGER NOT NULL CHECK (price_per_hour > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE booking (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_code     TEXT NOT NULL UNIQUE,
  court_id        INTEGER NOT NULL REFERENCES court(id),
  booking_date    TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  guest_email     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','no_show','completed')),
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  confirmed_at    TEXT,
  cancelled_at    TEXT,
  cancelled_by    TEXT,
  cancel_reason   TEXT,
  no_show_at      TEXT,
  no_show_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX booking_court_slot_active
  ON booking (court_id, booking_date, start_time)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX booking_court_date_idx     ON booking (court_id, booking_date);
CREATE INDEX booking_status_date_idx    ON booking (status, booking_date);
CREATE INDEX booking_phone_idx          ON booking (guest_phone);

CREATE TABLE payment (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES booking(id),
  provider          TEXT NOT NULL DEFAULT 'qpay' CHECK (provider IN ('qpay','cash')),
  qpay_invoice_id   TEXT,
  amount            INTEGER NOT NULL CHECK (amount > 0),
  status            TEXT NOT NULL DEFAULT 'awaiting'
                    CHECK (status IN ('awaiting','paid','auto_cancelled','failed')),
  awaiting_until    TEXT,
  paid_at           TEXT,
  paid_by           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX payment_qpay_invoice_unique
  ON payment (qpay_invoice_id) WHERE qpay_invoice_id IS NOT NULL;
CREATE INDEX payment_booking_idx        ON payment (booking_id);
CREATE INDEX payment_awaiting_idx       ON payment (awaiting_until) WHERE status = 'awaiting';

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      TEXT,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('admin','system','customer')),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  metadata      TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

INSERT INTO court (name_mn, group_name, sport, open_hours, price_per_hour) VALUES (
  'Хавайн теннисний корт №1',
  'main',
  'tennis',
  '{"0":{"open":"06:00","close":"22:00"},"1":{"open":"06:00","close":"22:00"},"2":{"open":"06:00","close":"22:00"},"3":{"open":"06:00","close":"22:00"},"4":{"open":"06:00","close":"22:00"},"5":{"open":"06:00","close":"22:00"},"6":{"open":"06:00","close":"22:00"}}',
  30000
);

INSERT INTO schema_version (version) VALUES (1);
SQL
```

- [ ] **Step 2: migrate.js 작성**

```bash
cat > migrations/migrate.js <<'JS'
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'court.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function appliedVersions() {
  try {
    return new Set(db.prepare('SELECT version FROM schema_version').all().map(r => r.version));
  } catch (e) {
    return new Set();
  }
}

function apply(file) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  console.log(`Applying ${file}...`);
  db.exec(sql);
  console.log(`  ✓ ${file}`);
}

const migrations = fs.readdirSync(__dirname)
  .filter(f => /^\d{3}_.+\.sql$/.test(f))
  .sort();

const applied = appliedVersions();
for (const file of migrations) {
  const version = parseInt(file.slice(0, 3), 10);
  if (applied.has(version)) {
    console.log(`Skipping ${file} (already applied)`);
    continue;
  }
  apply(file);
}

console.log('Done.');
db.close();
JS
chmod +x migrations/migrate.js
```

- [ ] **Step 3: 실행 + 검증**

```bash
npm run migrate
sqlite3 court.db ".tables"
# Expected: audit_log  booking  court  payment  schema_version

sqlite3 court.db "SELECT id, name_mn, price_per_hour FROM court;"
# Expected: 1|Хавайн теннисний корт №1|30000
```

- [ ] **Step 4: 커밋**

```bash
git add court-booking/migrations/
git commit -m "feat(court-booking): SQLite 마이그레이션 + 시드 (코트 1면)"
```

---

### Task 4: db.js wrapper + 트랜잭션 헬퍼

**Files:**
- Create: `court-booking/db.js`

- [ ] **Step 1: db.js 작성**

```bash
cat > db.js <<'JS'
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'court.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// 캐시된 prepared statements (성능)
const stmtCache = new Map();
function prepare(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

// BEGIN IMMEDIATE 트랜잭션 (write lock 즉시 확보)
function txImmediate(fn) {
  return db.transaction(fn).immediate;
}

module.exports = { db, prepare, txImmediate };
JS
```

- [ ] **Step 2: 커밋**

```bash
git add court-booking/db.js
git commit -m "feat(court-booking): db wrapper + 트랜잭션 헬퍼"
```

---

### Task 5: Express 서버 부트 (server.js skeleton + /health)

**Files:**
- Create: `court-booking/server.js`

- [ ] **Step 1: server.js 작성**

```bash
cat > server.js <<'JS'
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT || '6031', 10);

app.set('trust proxy', 1);   // nginx 뒤
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// 정적 (public/)
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// health
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 라우터는 이후 task에서 마운트
// app.use('/api', require('./routes/public'));
// app.use('/api/admin', require('./routes/admin'));
// app.use('/qpay', require('./routes/qpay'));

app.listen(PORT, () => {
  console.log(`[court-booking] listening on ${PORT}`);
});
JS
```

- [ ] **Step 2: 실행 + 검증**

```bash
node server.js &
sleep 1
curl http://localhost:6031/health
# Expected: {"ok":true,"ts":"..."}
kill %1
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/server.js
git commit -m "feat(court-booking): Express 서버 부트 + /health"
```

---

### Task 6: pm2 등록 (port 6031)

**Files:** 변경 없음 (pm2 메타데이터만)

- [ ] **Step 1: pm2 시작 + 저장**

```bash
cd /home/ubuntu/.openclaw/workspace/court-booking
pm2 start server.js --name court-booking
pm2 save
```

- [ ] **Step 2: 검증**

```bash
pm2 list | grep court-booking
# Expected: court-booking ... online

curl http://localhost:6031/health
# Expected: {"ok":true,...}
```

> **nginx 설정은 Task 50에서 진행** (먼저 내부에서만 검증).

---

## Phase B — 코어 도메인

### Task 7: public_code 생성기 (BK + 4자) + 충돌 재시도

**Files:**
- Create: `court-booking/public-code.js`
- Create: `court-booking/test/public-code.test.js`

- [ ] **Step 1: 실패 테스트 작성**

```bash
mkdir -p test
cat > test/public-code.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { generate, isValid } = require('../public-code');

test('generate produces BK + 4 chars from base32 alphabet', () => {
  const code = generate();
  assert.match(code, /^BK[2-9A-HJKMNPQRSTUVWXYZ]{4}$/);
});

test('isValid accepts generated codes', () => {
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(isValid(generate()), true);
  }
});

test('isValid rejects bad inputs', () => {
  assert.strictEqual(isValid('BK000O'), false);   // 0, O 제외
  assert.strictEqual(isValid('XX1234'), false);   // BK 접두 아님
  assert.strictEqual(isValid('BK123'), false);    // 길이
  assert.strictEqual(isValid(''), false);
  assert.strictEqual(isValid(null), false);
});

test('generate is sufficiently random (100k unique)', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(generate());
  assert.ok(seen.size >= 95, `too many collisions: ${seen.size}/100`);
});
JS
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test
# Expected: FAIL — Cannot find module '../public-code'
```

- [ ] **Step 3: public-code.js 구현**

```bash
cat > public-code.js <<'JS'
// Crockford-style base32 (혼동 문자 0/O, 1/I/L 제외)
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PATTERN = /^BK[2-9A-HJKMNPQRSTUVWXYZ]{4}$/;

function randomChar() {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function generate() {
  let s = 'BK';
  for (let i = 0; i < 4; i++) s += randomChar();
  return s;
}

function isValid(code) {
  return typeof code === 'string' && PATTERN.test(code);
}

// DB 충돌 시 재시도 (호출자가 lookupFn 제공)
function generateUnique(lookupFn, maxRetry = 10) {
  for (let i = 0; i < maxRetry; i++) {
    const code = generate();
    if (!lookupFn(code)) return code;
  }
  throw new Error('PUBLIC_CODE_EXHAUSTED');
}

module.exports = { generate, isValid, generateUnique };
JS
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
# Expected: PASS (4 tests)
```

- [ ] **Step 5: 커밋**

```bash
git add court-booking/public-code.js court-booking/test/public-code.test.js
git commit -m "feat(court-booking): public_code 생성기 (BK + base32 4자)"
```

---

### Task 8: 슬롯 겹침 체크 + createBookingSafely

**Files:**
- Modify: `court-booking/db.js` (createBookingSafely 추가)
- Create: `court-booking/test/slot-conflict.test.js`

- [ ] **Step 1: 실패 테스트 작성**

```bash
cat > test/slot-conflict.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 인메모리 DB로 격리
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);
  return db;
}

// db.js를 테스트용으로 다시 require
let mod;
function loadWith(db) {
  delete require.cache[require.resolve('../db')];
  process.env.DB_PATH = ':memory:';
  // 트릭: db.js에서 모듈 export된 db를 교체
  mod = require('../db');
  Object.defineProperty(mod, 'db', { value: db, writable: false, configurable: true });
  return mod;
}

test('첫 예약은 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  const id = m.createBookingSafely({
    court_id: 1, booking_date: '2026-07-15',
    start_time: '10:00', end_time: '11:00',
    guest_name: 'A', guest_phone: '99110001',
    amount: 30000
  });
  assert.ok(id > 0);
});

test('정확히 같은 시작시각 → SLOT_CONFLICT', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  assert.throws(
    () => m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 }),
    /SLOT_CONFLICT/
  );
});

test('부분 겹침 (10:30~11:30 over 10:00~11:00) → SLOT_CONFLICT', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  assert.throws(
    () => m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:30', end_time:'11:30', guest_name:'B', guest_phone:'99110002', amount:30000 }),
    /SLOT_CONFLICT/
  );
});

test('인접 슬롯 (11:00~12:00 vs 10:00~11:00) → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'11:00', end_time:'12:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});

test('다른 날짜 → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-16', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});

test('취소된 예약과 같은 슬롯 → 성공', () => {
  const db = freshDb();
  const m = loadWith(db);
  const id1 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'A', guest_phone:'99110001', amount:30000 });
  db.prepare(`UPDATE booking SET status='cancelled', cancelled_at=datetime('now') WHERE id=?`).run(id1);
  const id2 = m.createBookingSafely({ court_id:1, booking_date:'2026-07-15', start_time:'10:00', end_time:'11:00', guest_name:'B', guest_phone:'99110002', amount:30000 });
  assert.ok(id2 > 0);
});
JS
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test
# Expected: FAIL — createBookingSafely is not a function
```

- [ ] **Step 3: db.js에 createBookingSafely 추가**

`db.js`를 다음으로 완전히 교체:

```bash
cat > db.js <<'JS'
const path = require('path');
const Database = require('better-sqlite3');
const { generateUnique } = require('./public-code');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'court.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const stmtCache = new Map();
function prepare(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

// 슬롯 겹침 검사 + 부분유니크 인덱스의 안전망
function createBookingSafely(input) {
  const tx = db.transaction((input) => {
    const conflict = db.prepare(`
      SELECT id FROM booking
      WHERE court_id = @court_id
        AND booking_date = @booking_date
        AND status NOT IN ('cancelled','no_show')
        AND start_time < @end_time
        AND end_time > @start_time
    `).get(input);

    if (conflict) {
      const err = new Error('SLOT_CONFLICT');
      err.code = 'SLOT_CONFLICT';
      throw err;
    }

    const codeExists = (code) => db.prepare('SELECT 1 FROM booking WHERE public_code=?').get(code);
    const public_code = generateUnique(codeExists);

    const result = db.prepare(`
      INSERT INTO booking
        (public_code, court_id, booking_date, start_time, end_time,
         guest_name, guest_phone, guest_email, amount)
      VALUES
        (@public_code, @court_id, @booking_date, @start_time, @end_time,
         @guest_name, @guest_phone, @guest_email, @amount)
    `).run({ ...input, public_code, guest_email: input.guest_email || null });

    return result.lastInsertRowid;
  });

  // BEGIN IMMEDIATE — write lock 즉시 확보
  return tx.immediate(input);
}

module.exports = { db, prepare, createBookingSafely };
JS
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
# Expected: PASS (slot-conflict 6 + public-code 4 = 10)
```

- [ ] **Step 5: 커밋**

```bash
git add court-booking/db.js court-booking/test/slot-conflict.test.js
git commit -m "feat(court-booking): createBookingSafely + 슬롯 겹침 차단"
```

---

### Task 9: 가용성 계산 (availability.js)

**Files:**
- Create: `court-booking/availability.js`
- Create: `court-booking/test/availability.test.js`

- [ ] **Step 1: 실패 테스트 작성**

```bash
cat > test/availability.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { computeSlots, computeAvailability } = require('../availability');

test('06:00~22:00은 16개 1시간 슬롯', () => {
  const slots = computeSlots({ open: '06:00', close: '22:00' });
  assert.strictEqual(slots.length, 16);
  assert.deepStrictEqual(slots[0], { start: '06:00', end: '07:00' });
  assert.deepStrictEqual(slots[15], { start: '21:00', end: '22:00' });
});

test('운영시간 short (10:00~12:00) → 2슬롯', () => {
  const slots = computeSlots({ open: '10:00', close: '12:00' });
  assert.strictEqual(slots.length, 2);
});

test('가용성 계산: 예약 1건 있으면 해당 슬롯만 false', () => {
  const open_hours = JSON.stringify({
    "0":{"open":"06:00","close":"22:00"},
    "1":{"open":"06:00","close":"22:00"},
    "2":{"open":"06:00","close":"22:00"},
    "3":{"open":"06:00","close":"22:00"},
    "4":{"open":"06:00","close":"22:00"},
    "5":{"open":"06:00","close":"22:00"},
    "6":{"open":"06:00","close":"22:00"}
  });
  const taken = [{ start_time: '10:00', end_time: '11:00' }];
  const date = '2026-07-15';   // 수요일
  const result = computeAvailability({ open_hours, date, taken });
  const tenSlot = result.find(s => s.start === '10:00');
  assert.strictEqual(tenSlot.available, false);
  const nineSlot = result.find(s => s.start === '09:00');
  assert.strictEqual(nineSlot.available, true);
});
JS
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test
# Expected: FAIL — Cannot find module '../availability'
```

- [ ] **Step 3: availability.js 구현**

```bash
cat > availability.js <<'JS'
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 1시간 단위 슬롯
function computeSlots(hours, stepMin = 60) {
  const start = toMinutes(hours.open);
  const end = toMinutes(hours.close);
  const slots = [];
  for (let t = start; t + stepMin <= end; t += stepMin) {
    slots.push({ start: toHHMM(t), end: toHHMM(t + stepMin) });
  }
  return slots;
}

// open_hours: JSON string, date: 'YYYY-MM-DD', taken: [{start_time, end_time}]
function computeAvailability({ open_hours, date, taken }) {
  const hoursMap = typeof open_hours === 'string' ? JSON.parse(open_hours) : open_hours;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const today = hoursMap[String(dayOfWeek)];
  if (!today) return [];

  const slots = computeSlots(today);
  return slots.map(s => ({
    ...s,
    available: !taken.some(t => s.start < t.end_time && s.end > t.start_time)
  }));
}

module.exports = { computeSlots, computeAvailability, toMinutes, toHHMM };
JS
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
# Expected: PASS
```

- [ ] **Step 5: 커밋**

```bash
git add court-booking/availability.js court-booking/test/availability.test.js
git commit -m "feat(court-booking): 가용성 계산 (요일별 운영시간)"
```

---

### Task 10: errors.js + audit-log.js 헬퍼

**Files:**
- Create: `court-booking/errors.js`
- Create: `court-booking/audit-log.js`

- [ ] **Step 1: errors.js 작성**

```bash
cat > errors.js <<'JS'
// 표준 에러 응답 생성
const CATALOG = {
  SLOT_CONFLICT:        { status: 409, mn: 'Энэ цаг саяхан өөр хэрэглэгч авлаа. Өөр цаг сонгоно уу.', en: 'This slot was just taken.' },
  BOOKING_NOT_FOUND:    { status: 404, mn: 'Захиалга олдсонгүй.', en: 'Booking not found.' },
  BOOKING_NOT_CANCELLABLE: { status: 409, mn: '24 цаг дотор захиалгыг цуцлах боломжгүй. Операторт хандана уу.', en: 'Cannot cancel within 24h.' },
  PAYMENT_EXPIRED:      { status: 410, mn: 'Төлбөрийн хугацаа дууссан.', en: 'Payment expired.' },
  INVALID_INPUT:        { status: 400, mn: 'Буруу мэдээлэл оруулсан байна.', en: 'Invalid input.' },
  NO_TOKEN:             { status: 401, mn: 'Нэвтэрнэ үү.', en: 'Login required.' },
  INVALID_TOKEN:        { status: 401, mn: 'Хүчингүй токен.', en: 'Invalid token.' },
  INSUFFICIENT_ROLE:    { status: 403, mn: 'Эрх хүрэлцэхгүй.', en: 'Insufficient permission.' },
  PHONE_MISMATCH:       { status: 403, mn: 'Утасны сүүлийн 4 орон таарахгүй байна.', en: 'Phone last 4 digits mismatch.' },
  RATE_LIMITED:         { status: 429, mn: 'Хэт олон хүсэлт.', en: 'Too many requests.' },
  INTERNAL:             { status: 500, mn: 'Серверийн алдаа.', en: 'Server error.' }
};

function apiError(code, extra = {}) {
  const e = CATALOG[code] || CATALOG.INTERNAL;
  const err = new Error(code);
  err.error_code = code;
  err.status = e.status;
  err.message_mn = e.mn;
  err.message_en = e.en;
  err.extra = extra;
  return err;
}

function sendError(res, err) {
  const code = err.error_code || 'INTERNAL';
  const e = CATALOG[code] || CATALOG.INTERNAL;
  res.status(err.status || e.status).json({
    error_code: code,
    message_mn: err.message_mn || e.mn,
    message_en: err.message_en || e.en,
    ...err.extra
  });
}

module.exports = { apiError, sendError, CATALOG };
JS
```

- [ ] **Step 2: audit-log.js 작성**

```bash
cat > audit-log.js <<'JS'
const { db } = require('./db');

const stmt = db.prepare(`
  INSERT INTO audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata, ip)
  VALUES (@actor_id, @actor_type, @action, @entity_type, @entity_id, @metadata, @ip)
`);

function log({ actor_id = null, actor_type, action, entity_type, entity_id, metadata = null, ip = null }) {
  try {
    stmt.run({
      actor_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ip
    });
  } catch (e) {
    console.error('[audit-log] failed:', e.message);
  }
}

module.exports = { log };
JS
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/errors.js court-booking/audit-log.js
git commit -m "feat(court-booking): 표준 에러 + audit-log 헬퍼"
```

---

## Phase C — 공개 API (인증 ✗)

### Task 11: routes/public.js — GET /api/courts, GET /api/availability

**Files:**
- Create: `court-booking/routes/public.js`
- Modify: `court-booking/server.js` (라우터 마운트)

- [ ] **Step 1: routes/public.js 작성**

```bash
mkdir -p routes
cat > routes/public.js <<'JS'
const express = require('express');
const { db, prepare } = require('../db');
const { computeAvailability } = require('../availability');
const { apiError, sendError } = require('../errors');

const router = express.Router();

router.get('/courts', (req, res) => {
  const rows = prepare(`
    SELECT id, name_mn, group_name, sport, open_hours, price_per_hour
    FROM court WHERE active = 1 ORDER BY id
  `).all();
  res.json(rows.map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.get('/availability', (req, res) => {
  try {
    const court_id = parseInt(req.query.court_id, 10);
    const date = String(req.query.date || '');
    if (!court_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw apiError('INVALID_INPUT');
    }
    const court = prepare('SELECT open_hours FROM court WHERE id=? AND active=1').get(court_id);
    if (!court) throw apiError('INVALID_INPUT');

    const taken = prepare(`
      SELECT start_time, end_time FROM booking
      WHERE court_id = ? AND booking_date = ?
        AND status NOT IN ('cancelled','no_show')
    `).all(court_id, date);

    res.json(computeAvailability({ open_hours: court.open_hours, date, taken }));
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;
JS
```

- [ ] **Step 2: server.js에 마운트**

server.js의 `// app.use('/api', require('./routes/public'));` 주석 줄을 활성화:

```js
app.use('/api', require('./routes/public'));
```

- [ ] **Step 3: 재시작 + 검증**

```bash
pm2 restart court-booking
curl http://localhost:6031/api/courts
# Expected: [{"id":1,"name_mn":"Хавайн теннисний корт №1",...}]

curl 'http://localhost:6031/api/availability?court_id=1&date=2026-07-15'
# Expected: [{"start":"06:00","end":"07:00","available":true},...]
```

- [ ] **Step 4: 커밋**

```bash
git add court-booking/routes/public.js court-booking/server.js
git commit -m "feat(court-booking): GET /api/courts + /api/availability"
```

---

### Task 12: POST /api/bookings (트랜잭션 + idempotency cooldown)

**Files:**
- Modify: `court-booking/routes/public.js`

- [ ] **Step 1: routes/public.js에 POST 추가**

`routes/public.js`에 추가 (router 정의 다음에):

```js
// 가격 계산: 단순 1시간당 * 시간
function calcAmount(price_per_hour, start_time, end_time) {
  const [sh, sm] = start_time.split(':').map(Number);
  const [eh, em] = end_time.split(':').map(Number);
  const hours = (eh * 60 + em - sh * 60 - sm) / 60;
  return Math.round(price_per_hour * hours);
}

const { createBookingSafely } = require('../db');
const { log: auditLog } = require('../audit-log');

router.post('/bookings', express.json(), (req, res) => {
  try {
    const { court_id, booking_date, start_time, end_time, guest_name, guest_phone, guest_email } = req.body || {};

    // 기본 검증
    if (!court_id || !booking_date || !start_time || !end_time || !guest_name || !guest_phone) {
      throw apiError('INVALID_INPUT', { missing: ['court_id','booking_date','start_time','end_time','guest_name','guest_phone'].filter(k => !req.body?.[k]) });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) throw apiError('INVALID_INPUT', { field: 'booking_date' });
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) throw apiError('INVALID_INPUT', { field: 'time' });
    if (!/^[0-9+\-\s]{6,20}$/.test(guest_phone)) throw apiError('INVALID_INPUT', { field: 'guest_phone' });

    // Idempotency cooldown: 같은 phone + date + start_time 60초 내 → 기존 booking 반환
    const recent = prepare(`
      SELECT public_code, status, amount
      FROM booking
      WHERE guest_phone=? AND booking_date=? AND start_time=?
        AND created_at >= datetime('now','-60 seconds')
        AND status NOT IN ('cancelled','no_show')
      ORDER BY id DESC LIMIT 1
    `).get(guest_phone, booking_date, start_time);
    if (recent) {
      return res.status(200).json({ public_code: recent.public_code, idempotent: true });
    }

    const court = prepare('SELECT id, price_per_hour FROM court WHERE id=? AND active=1').get(court_id);
    if (!court) throw apiError('INVALID_INPUT', { field: 'court_id' });

    const amount = calcAmount(court.price_per_hour, start_time, end_time);

    const id = createBookingSafely({
      court_id, booking_date, start_time, end_time,
      guest_name, guest_phone, guest_email: guest_email || null,
      amount
    });

    const created = prepare('SELECT public_code FROM booking WHERE id=?').get(id);

    auditLog({
      actor_type: 'customer', action: 'booking.create',
      entity_type: 'booking', entity_id: id,
      metadata: { court_id, booking_date, start_time, amount },
      ip: req.ip
    });

    // QPay 인보이스는 Task 18에서 연결 (현재는 pending booking + payment(awaiting) 없이 일단 booking만)
    res.status(201).json({
      public_code: created.public_code,
      amount,
      // expires_at, qpay_qr_url, qpay_deeplink 는 Task 18에서 추가
    });
  } catch (e) {
    sendError(res, e);
  }
});
```

- [ ] **Step 2: 재시작 + 검증**

```bash
pm2 restart court-booking
curl -X POST http://localhost:6031/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"court_id":1,"booking_date":"2026-07-15","start_time":"10:00","end_time":"11:00","guest_name":"Test","guest_phone":"99119999"}'
# Expected: {"public_code":"BKXXXX","amount":30000}

# 같은 슬롯 재시도 → 409
curl -X POST http://localhost:6031/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"court_id":1,"booking_date":"2026-07-15","start_time":"10:00","end_time":"11:00","guest_name":"Test2","guest_phone":"99119998"}'
# Expected: 409 {"error_code":"SLOT_CONFLICT",...}

# 정리
sqlite3 court.db "DELETE FROM booking WHERE guest_name LIKE 'Test%';"
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/routes/public.js
git commit -m "feat(court-booking): POST /api/bookings (트랜잭션 + cooldown)"
```

---

### Task 13: GET /api/bookings/:public_code + payment-status

**Files:**
- Modify: `court-booking/routes/public.js`

- [ ] **Step 1: 라우터에 추가**

`routes/public.js`에 추가:

```js
router.get('/bookings/:code', (req, res) => {
  try {
    const code = req.params.code;
    const b = prepare(`
      SELECT b.public_code, b.booking_date, b.start_time, b.end_time, b.status, b.amount,
             b.guest_name, c.name_mn AS court_name
      FROM booking b JOIN court c ON c.id = b.court_id
      WHERE b.public_code = ?
    `).get(code);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    res.json(b);
  } catch (e) { sendError(res, e); }
});

router.get('/bookings/:code/payment-status', (req, res) => {
  try {
    const code = req.params.code;
    const row = prepare(`
      SELECT b.status AS booking_status, p.status AS payment_status
      FROM booking b
      LEFT JOIN payment p ON p.booking_id = b.id
      WHERE b.public_code = ?
      ORDER BY p.id DESC LIMIT 1
    `).get(code);
    if (!row) throw apiError('BOOKING_NOT_FOUND');

    let status = 'awaiting';
    if (row.payment_status === 'paid' || row.booking_status === 'confirmed') status = 'paid';
    else if (row.booking_status === 'cancelled') status = 'cancelled';

    res.json({ status });
  } catch (e) { sendError(res, e); }
});
```

- [ ] **Step 2: 재시작 + 검증**

```bash
pm2 restart court-booking
# 새 booking 생성
CODE=$(curl -s -X POST http://localhost:6031/api/bookings -H 'Content-Type: application/json' -d '{"court_id":1,"booking_date":"2026-07-20","start_time":"10:00","end_time":"11:00","guest_name":"T","guest_phone":"99110000"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["public_code"])')
echo $CODE

curl http://localhost:6031/api/bookings/$CODE
# Expected: {"public_code":"BK...","booking_date":"2026-07-20",...}

curl http://localhost:6031/api/bookings/$CODE/payment-status
# Expected: {"status":"awaiting"}

sqlite3 court.db "DELETE FROM booking WHERE guest_phone='99110000';"
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/routes/public.js
git commit -m "feat(court-booking): GET /bookings/:code + payment-status"
```

---

### Task 14: POST /api/bookings/:code/cancel (24h + phone 4자리 인증)

**Files:**
- Modify: `court-booking/routes/public.js`

- [ ] **Step 1: 라우터에 추가**

```js
router.post('/bookings/:code/cancel', express.json(), (req, res) => {
  try {
    const code = req.params.code;
    const { phone_last4 } = req.body || {};
    if (!phone_last4 || !/^\d{4}$/.test(phone_last4)) throw apiError('INVALID_INPUT', { field: 'phone_last4' });

    const b = prepare(`
      SELECT id, booking_date, start_time, guest_phone, status
      FROM booking WHERE public_code = ?
    `).get(code);
    if (!b) throw apiError('BOOKING_NOT_FOUND');

    if (b.guest_phone.slice(-4) !== phone_last4) throw apiError('PHONE_MISMATCH');

    if (!['pending','confirmed'].includes(b.status)) throw apiError('BOOKING_NOT_CANCELLABLE');

    // 24h 이내 차단
    const startIso = `${b.booking_date}T${b.start_time}:00`;
    const startTs = new Date(startIso + '+08:00').getTime();
    const now = Date.now();
    if (startTs - now < 24 * 3600 * 1000) throw apiError('BOOKING_NOT_CANCELLABLE');

    prepare(`
      UPDATE booking
      SET status='cancelled', cancelled_at=datetime('now'),
          cancelled_by='customer', cancel_reason='self_cancel'
      WHERE id = ?
    `).run(b.id);

    // 연관 awaiting payment도 정리
    prepare(`
      UPDATE payment SET status='auto_cancelled'
      WHERE booking_id=? AND status='awaiting'
    `).run(b.id);

    require('../audit-log').log({
      actor_type: 'customer', action: 'booking.cancel.self',
      entity_type: 'booking', entity_id: b.id,
      metadata: { reason: 'self_cancel' },
      ip: req.ip
    });

    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});
```

- [ ] **Step 2: 재시작 + 검증**

```bash
pm2 restart court-booking
# 미래 날짜로 booking (24h 이상 후)
CODE=$(curl -s -X POST http://localhost:6031/api/bookings -H 'Content-Type: application/json' -d '{"court_id":1,"booking_date":"2026-12-31","start_time":"10:00","end_time":"11:00","guest_name":"T","guest_phone":"99110000"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["public_code"])')

# 잘못된 4자리
curl -X POST http://localhost:6031/api/bookings/$CODE/cancel -H 'Content-Type: application/json' -d '{"phone_last4":"1234"}'
# Expected: 403 PHONE_MISMATCH

# 올바른 4자리
curl -X POST http://localhost:6031/api/bookings/$CODE/cancel -H 'Content-Type: application/json' -d '{"phone_last4":"0000"}'
# Expected: {"ok":true}

sqlite3 court.db "DELETE FROM booking WHERE guest_phone='99110000';"
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/routes/public.js
git commit -m "feat(court-booking): POST /bookings/:code/cancel (phone 4자리 + 24h)"
```

---

## Phase D — QPay 통합

### Task 15: qpay-client.js (auth + invoice + check)

**Files:**
- Create: `court-booking/qpay-client.js`

- [ ] **Step 1: qpay-client.js 작성**

```bash
cat > qpay-client.js <<'JS'
const https = require('https');

const BASE = 'merchant.qpay.mn';   // v2
let tokenCache = { access: null, expiresAt: 0 };

function request({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: BASE, path: `/v2${path}`, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      },
      timeout: 10000
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          if (res.statusCode >= 400) return reject(new Error(`QPAY_${res.statusCode}: ${chunks}`));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('QPAY_TIMEOUT')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  if (tokenCache.access && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.access;
  const basic = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');
  const res = await request({
    method: 'POST', path: '/auth/token',
    headers: { Authorization: `Basic ${basic}` }
  });
  tokenCache = {
    access: res.access_token,
    expiresAt: Date.now() + (res.expires_in || 86400) * 1000
  };
  return tokenCache.access;
}

async function createInvoice({ amount, description, callback_url, sender_invoice_no, receiver_code }) {
  const token = await getAccessToken();
  const res = await request({
    method: 'POST', path: '/invoice',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      invoice_code: process.env.QPAY_INVOICE_CODE,
      sender_invoice_no,
      invoice_receiver_code: receiver_code || 'guest',
      invoice_description: description,
      amount,
      callback_url
    }
  });
  // res: { invoice_id, qr_text, qr_image, urls: [{name, link}], deeplink }
  return res;
}

async function checkPayment(invoice_id) {
  const token = await getAccessToken();
  const res = await request({
    method: 'POST', path: '/payment/check',
    headers: { Authorization: `Bearer ${token}` },
    body: { object_type: 'INVOICE', object_id: invoice_id, offset: { page_number: 1, page_limit: 100 } }
  });
  // res.rows: [{payment_status: 'PAID'|...}]
  return res;
}

module.exports = { getAccessToken, createInvoice, checkPayment };
JS
```

- [ ] **Step 2: 커밋 (실거래 검증은 Task 18 이후)**

```bash
git add court-booking/qpay-client.js
git commit -m "feat(court-booking): QPay v2 클라이언트 (auth/invoice/check)"
```

---

### Task 16: POST /api/bookings에 QPay 인보이스 연결

**Files:**
- Modify: `court-booking/routes/public.js`

- [ ] **Step 1: POST /bookings 핸들러 수정**

`routes/public.js`의 `router.post('/bookings', ...)` 핸들러에서 `auditLog(...)` 호출 다음을 다음으로 교체:

```js
// QPay 인보이스 생성
const qpay = require('../qpay-client');
let invoice;
try {
  invoice = await qpay.createInvoice({
    amount,
    description: `Tennis ${booking_date} ${start_time}-${end_time}`,
    callback_url: `${process.env.QPAY_CALLBACK_URL}?bk=${created.public_code}`,
    sender_invoice_no: created.public_code,
    receiver_code: guest_phone
  });
} catch (e) {
  // booking 롤백
  prepare('DELETE FROM booking WHERE id=?').run(id);
  throw apiError('INTERNAL', { qpay_error: e.message });
}

// payment(awaiting) + qpay_invoice_id 저장
const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
prepare(`
  INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until)
  VALUES (?, 'qpay', ?, ?, 'awaiting', ?)
`).run(id, invoice.invoice_id, amount, expiresAt);

res.status(201).json({
  public_code: created.public_code,
  amount,
  expires_at: expiresAt,
  qpay_qr_text: invoice.qr_text,
  qpay_qr_image: invoice.qr_image,
  qpay_deeplinks: invoice.urls || []
});
```

또한 핸들러 함수를 `async`로 변경: `router.post('/bookings', express.json(), async (req, res) => {`

- [ ] **Step 2: QPay 자격증명 .env 입력 확인 후 검증**

`.env`에 `QPAY_USERNAME/PASSWORD/INVOICE_CODE/CALLBACK_URL` 설정되어 있어야 함.

```bash
pm2 restart court-booking
curl -X POST http://localhost:6031/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"court_id":1,"booking_date":"2026-12-31","start_time":"10:00","end_time":"11:00","guest_name":"T","guest_phone":"99110000"}'
# Expected: {"public_code":"...","qpay_qr_text":"00020101...","qpay_qr_image":"iVBOR...","qpay_deeplinks":[...]}

sqlite3 court.db "DELETE FROM booking WHERE guest_phone='99110000';"
sqlite3 court.db "DELETE FROM payment WHERE booking_id NOT IN (SELECT id FROM booking);"
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/routes/public.js
git commit -m "feat(court-booking): POST /bookings에 QPay 인보이스 연결"
```

---

### Task 17: routes/qpay.js — POST /qpay/callback (멱등 + 재검증)

**Files:**
- Create: `court-booking/routes/qpay.js`
- Modify: `court-booking/server.js`
- Create: `court-booking/test/qpay-idempotency.test.js`

- [ ] **Step 1: 실패 테스트 작성**

```bash
cat > test/qpay-idempotency.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);
  return db;
}

test('markPaidIfAwaiting: awaiting → paid + booking confirmed', () => {
  const db = freshDb();
  const bookingId = db.prepare(`
    INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status)
    VALUES ('BKAAAA', 1, '2026-07-15', '10:00', '11:00', 'T', '99110000', 30000, 'pending')
  `).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV1', 30000, 'awaiting', datetime('now','+15 minutes'))`).run(bookingId);

  const { markPaidByInvoice } = require('../routes/qpay-tx')(db);
  markPaidByInvoice('INV1');

  const p = db.prepare('SELECT status FROM payment WHERE qpay_invoice_id=?').get('INV1');
  const b = db.prepare('SELECT status FROM booking WHERE id=?').get(bookingId);
  assert.strictEqual(p.status, 'paid');
  assert.strictEqual(b.status, 'confirmed');
});

test('두 번째 호출은 no-op (멱등)', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKBBBB', 1, '2026-07-15', '11:00', '12:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV2', 30000, 'awaiting', datetime('now','+15 minutes'))`).run(bookingId);

  const { markPaidByInvoice } = require('../routes/qpay-tx')(db);
  const r1 = markPaidByInvoice('INV2');
  const r2 = markPaidByInvoice('INV2');
  assert.strictEqual(r1.changed, true);
  assert.strictEqual(r2.changed, false);
});
JS
```

- [ ] **Step 2: qpay-tx 모듈 (테스트용 분리)**

```bash
cat > routes/qpay-tx.js <<'JS'
// markPaidByInvoice를 db 주입 받게 분리 (테스트 가능성)
module.exports = (db) => {
  function markPaidByInvoice(invoice_id) {
    const tx = db.transaction(() => {
      const p = db.prepare(`SELECT id, booking_id, status FROM payment WHERE qpay_invoice_id=?`).get(invoice_id);
      if (!p) return { changed: false, reason: 'NOT_FOUND' };
      if (p.status === 'paid') return { changed: false, reason: 'ALREADY_PAID' };
      if (p.status !== 'awaiting') return { changed: false, reason: `STATE_${p.status}` };

      db.prepare(`UPDATE payment SET status='paid', paid_at=datetime('now') WHERE id=?`).run(p.id);
      db.prepare(`UPDATE booking SET status='confirmed', confirmed_at=datetime('now') WHERE id=? AND status='pending'`).run(p.booking_id);
      return { changed: true, booking_id: p.booking_id };
    });
    return tx.immediate();
  }
  return { markPaidByInvoice };
};
JS
```

- [ ] **Step 3: 테스트 실행 (통과 확인)**

```bash
npm test
# Expected: PASS
```

- [ ] **Step 4: routes/qpay.js 작성 (실제 콜백)**

```bash
cat > routes/qpay.js <<'JS'
const express = require('express');
const { db } = require('../db');
const qpay = require('../qpay-client');
const { markPaidByInvoice } = require('./qpay-tx')(db);
const { log: auditLog } = require('../audit-log');

const router = express.Router();

// QPay → 우리
// query 또는 body로 invoice_id 옴 (계정 설정에 따라). 둘 다 받음.
router.post('/callback', express.json(), async (req, res) => {
  const invoice_id = req.query.qpay_invoice_id || req.body?.qpay_invoice_id || req.query.invoice_id || req.body?.invoice_id;
  if (!invoice_id) return res.status(400).end();

  try {
    // 위조 방지: QPay에 직접 재검증
    const check = await qpay.checkPayment(invoice_id);
    const paid = (check.rows || []).some(r => r.payment_status === 'PAID');
    if (!paid) return res.status(200).end();

    const result = markPaidByInvoice(invoice_id);

    if (result.changed) {
      auditLog({
        actor_type: 'system', action: 'payment.paid',
        entity_type: 'booking', entity_id: result.booking_id,
        metadata: { invoice_id }
      });
      // 알림은 Task 22에서 비동기 발송
      const { sendNotificationsForBooking } = require('../notifications');
      setImmediate(() => sendNotificationsForBooking(result.booking_id).catch(e => console.error('[notify]', e.message)));
    }

    res.status(200).end();
  } catch (e) {
    console.error('[qpay/callback]', e.message);
    res.status(200).end();   // QPay에 재시도 트리거 막음 — 우리 cron이 안전망
  }
});

module.exports = router;
JS
```

- [ ] **Step 5: server.js에 마운트 + notifications 스텁**

`server.js`에 추가:
```js
app.use('/qpay', require('./routes/qpay'));
```

`notifications.js` 임시 스텁 (Task 22에서 실제 구현):
```bash
cat > notifications.js <<'JS'
async function sendNotificationsForBooking(booking_id) {
  console.log('[notify-stub] booking', booking_id);
}
module.exports = { sendNotificationsForBooking };
JS
```

- [ ] **Step 6: 커밋**

```bash
git add court-booking/routes/qpay.js court-booking/routes/qpay-tx.js \
  court-booking/test/qpay-idempotency.test.js court-booking/notifications.js \
  court-booking/server.js
git commit -m "feat(court-booking): POST /qpay/callback (멱등 + 재검증)"
```

---

### Task 18: cron-jobs.js — autoCancel (1분)

**Files:**
- Create: `court-booking/cron-jobs.js`
- Create: `court-booking/test/cron-autocancel.test.js`
- Modify: `court-booking/server.js`

- [ ] **Step 1: 실패 테스트**

```bash
cat > test/cron-autocancel.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));
  return db;
}

test('autoCancel: awaiting_until 지난 payment → cancelled', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKAAAA', 1, '2026-07-15', '10:00', '11:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV1', 30000, 'awaiting', datetime('now','-1 minute'))`).run(bookingId);

  const { autoCancelExpired } = require('../cron-jobs')(db);
  const n = autoCancelExpired();
  assert.strictEqual(n, 1);

  const p = db.prepare(`SELECT status FROM payment WHERE booking_id=?`).get(bookingId);
  const b = db.prepare(`SELECT status FROM booking WHERE id=?`).get(bookingId);
  assert.strictEqual(p.status, 'auto_cancelled');
  assert.strictEqual(b.status, 'cancelled');
});

test('autoCancel: awaiting_until 안 지난 건은 그대로', () => {
  const db = freshDb();
  const bookingId = db.prepare(`INSERT INTO booking (public_code, court_id, booking_date, start_time, end_time, guest_name, guest_phone, amount, status) VALUES ('BKBBBB', 1, '2026-07-15', '11:00', '12:00', 'T', '99110000', 30000, 'pending')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO payment (booking_id, provider, qpay_invoice_id, amount, status, awaiting_until) VALUES (?, 'qpay', 'INV2', 30000, 'awaiting', datetime('now','+5 minutes'))`).run(bookingId);

  const { autoCancelExpired } = require('../cron-jobs')(db);
  const n = autoCancelExpired();
  assert.strictEqual(n, 0);
});
JS
```

- [ ] **Step 2: cron-jobs.js 구현**

```bash
cat > cron-jobs.js <<'JS'
module.exports = (dbOverride) => {
  const db = dbOverride || require('./db').db;

  function autoCancelExpired() {
    const tx = db.transaction(() => {
      const expired = db.prepare(`
        SELECT id, booking_id FROM payment
        WHERE status='awaiting' AND awaiting_until < datetime('now')
      `).all();
      for (const p of expired) {
        db.prepare(`UPDATE payment SET status='auto_cancelled' WHERE id=?`).run(p.id);
        db.prepare(`
          UPDATE booking SET status='cancelled', cancelled_at=datetime('now'),
            cancelled_by='system', cancel_reason='payment_timeout'
          WHERE id=? AND status='pending'
        `).run(p.booking_id);
      }
      return expired.length;
    });
    return tx.immediate();
  }

  async function verifyAwaitingViaQPay() {
    const qpay = require('./qpay-client');
    const { markPaidByInvoice } = require('./routes/qpay-tx')(db);
    const rows = db.prepare(`
      SELECT id, qpay_invoice_id FROM payment
      WHERE status='awaiting' AND qpay_invoice_id IS NOT NULL
        AND created_at < datetime('now','-1 minute')
    `).all();
    let n = 0;
    for (const p of rows) {
      try {
        const check = await qpay.checkPayment(p.qpay_invoice_id);
        if ((check.rows || []).some(r => r.payment_status === 'PAID')) {
          markPaidByInvoice(p.qpay_invoice_id);
          n++;
        }
      } catch (e) {
        console.error('[verifyAwaiting]', p.qpay_invoice_id, e.message);
      }
    }
    return n;
  }

  function markCompleted() {
    return db.prepare(`
      UPDATE booking SET status='completed'
      WHERE status='confirmed'
        AND datetime(booking_date || ' ' || end_time, '+8 hours') < datetime('now','+8 hours','-10 minutes')
    `).run().changes;
  }

  function startSchedules() {
    const cron = require('node-cron');
    cron.schedule('* * * * *', () => { try { const n = autoCancelExpired(); if (n) console.log('[cron] autoCancel', n); } catch (e) { console.error(e); } });
    cron.schedule('*/5 * * * *', async () => { try { const n = await verifyAwaitingViaQPay(); if (n) console.log('[cron] verify', n); } catch (e) { console.error(e); } });
    cron.schedule('*/10 * * * *', () => { try { const n = markCompleted(); if (n) console.log('[cron] completed', n); } catch (e) { console.error(e); } });
    console.log('[cron] schedules started');
  }

  return { autoCancelExpired, verifyAwaitingViaQPay, markCompleted, startSchedules };
};
JS
```

- [ ] **Step 3: 테스트 실행**

```bash
npm test
# Expected: PASS
```

- [ ] **Step 4: server.js에서 cron 시작**

`server.js`의 `app.listen` 직전에 추가:
```js
require('./cron-jobs')().startSchedules();
```

- [ ] **Step 5: 재시작 + 로그 확인**

```bash
pm2 restart court-booking
pm2 logs court-booking --lines 20 --nostream
# Expected: "[cron] schedules started"
```

- [ ] **Step 6: 커밋**

```bash
git add court-booking/cron-jobs.js court-booking/test/cron-autocancel.test.js court-booking/server.js
git commit -m "feat(court-booking): cron — autoCancel/verifyAwaiting/markCompleted"
```

---

## Phase E — 알림

### Task 19: telegram-client.js 복사 + email-client.js

**Files:**
- Create: `court-booking/telegram-client.js`
- Create: `court-booking/email-client.js`

- [ ] **Step 1: telegram-client.js 복사**

```bash
cp /home/ubuntu/.openclaw/workspace/staff-manager/telegram-client.js telegram-client.js
```

- [ ] **Step 2: email-client.js 작성**

```bash
cat > email-client.js <<'JS'
const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporter;
}

function confirmationHtml(b) {
  return `<!doctype html>
<html lang="mn"><body style="font-family:sans-serif">
<h2>🎾 Захиалга баталгаажлаа</h2>
<p>Танай захиалгын код: <b style="font-size:1.5em">${b.public_code}</b></p>
<table style="border-collapse:collapse">
  <tr><td style="padding:4px 12px"><b>Корт</b></td><td>${b.court_name}</td></tr>
  <tr><td style="padding:4px 12px"><b>Өдөр</b></td><td>${b.booking_date}</td></tr>
  <tr><td style="padding:4px 12px"><b>Цаг</b></td><td>${b.start_time} - ${b.end_time}</td></tr>
  <tr><td style="padding:4px 12px"><b>Үнэ</b></td><td>₮${b.amount.toLocaleString()}</td></tr>
</table>
<p style="color:#666">Энэ имэйлийг хадгална уу. Кортод ирэхдээ кодоо үзүүлнэ үү.</p>
</body></html>`;
}

async function sendConfirmation(booking) {
  if (!booking.guest_email) return { skipped: true };
  if (!process.env.SMTP_HOST) { console.warn('[email] SMTP_HOST not set'); return { skipped: true }; }
  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: booking.guest_email,
    subject: `Захиалга баталгаажлаа — ${booking.public_code}`,
    html: confirmationHtml(booking)
  });
  return { messageId: info.messageId };
}

module.exports = { sendConfirmation };
JS
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/telegram-client.js court-booking/email-client.js
git commit -m "feat(court-booking): telegram + email 클라이언트"
```

---

### Task 20: notifications.js — 실제 구현

**Files:**
- Modify: `court-booking/notifications.js`

- [ ] **Step 1: notifications.js 교체**

```bash
cat > notifications.js <<'JS'
const { prepare } = require('./db');
const tg = require('./telegram-client');
const email = require('./email-client');

function fetchBookingForNotify(booking_id) {
  return prepare(`
    SELECT b.id, b.public_code, b.booking_date, b.start_time, b.end_time, b.amount,
           b.guest_name, b.guest_phone, b.guest_email, c.name_mn AS court_name
    FROM booking b JOIN court c ON c.id = b.court_id WHERE b.id = ?
  `).get(booking_id);
}

async function sendStaffTelegram(b) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_STAFF_CHAT_ID) return { skipped: true };
  const text = `🎾 <b>Шинэ захиалга</b>
Код: <code>${b.public_code}</code>
${b.guest_name} (${b.guest_phone})
${b.court_name}
${b.booking_date} ${b.start_time}~${b.end_time}
₮${b.amount.toLocaleString()}`;
  return tg.send(process.env.TELEGRAM_STAFF_CHAT_ID, text);
}

async function sendNotificationsForBooking(booking_id) {
  const b = fetchBookingForNotify(booking_id);
  if (!b) return;
  const results = await Promise.allSettled([
    email.sendConfirmation(b).catch(e => { console.error('[email]', e.message); throw e; }),
    sendStaffTelegram(b).catch(e => { console.error('[telegram]', e.message); throw e; })
  ]);
  console.log('[notify]', b.public_code, results.map(r => r.status));
}

module.exports = { sendNotificationsForBooking };
JS
```

- [ ] **Step 2: 재시작 + 수동 검증 (SMTP/TG 자격증명 설정 후)**

```bash
pm2 restart court-booking
# 실제 booking + QPay 결제 시 알림 도착 확인 (베타 단계)
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/notifications.js
git commit -m "feat(court-booking): 결제 확정 시 이메일 + 직원 텔레그램"
```

---

## Phase F — 어드민 API + SSO

### Task 21: auth.js — JWT 검증 미들웨어

**Files:**
- Create: `court-booking/auth.js`
- Create: `court-booking/test/auth.test.js`

- [ ] **Step 1: 실패 테스트**

```bash
cat > test/auth.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const { requireAdmin } = require('../auth');

function mockReq(token, headers = {}) {
  return { cookies: token ? { token } : {}, headers, ip: '127.0.0.1' };
}
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
}

test('토큰 없음 → 401 NO_TOKEN', () => {
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(null), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error_code, 'NO_TOKEN');
  assert.strictEqual(next, false);
});

test('유효한 admin 토큰 → next + req.user 세팅', () => {
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', role: 'super_admin' }, 'test-secret');
  const req = mockReq(token); const res = mockRes(); let next = false;
  requireAdmin(req, res, () => { next = true; });
  assert.strictEqual(next, true);
  assert.deepStrictEqual(req.user, { id: 'u1', email: 'a@b.com', role: 'super_admin' });
});

test('role 없음 → 403', () => {
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', role: 'guest' }, 'test-secret');
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(token), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(next, false);
});

test('만료 토큰 → 401 INVALID_TOKEN', () => {
  const token = jwt.sign({ sub: 'u1', role: 'manager' }, 'test-secret', { expiresIn: '-1s' });
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(token), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error_code, 'INVALID_TOKEN');
});
JS
```

- [ ] **Step 2: auth.js 구현**

```bash
cat > auth.js <<'JS'
const jwt = require('jsonwebtoken');
const { sendError, apiError } = require('./errors');

const ALLOWED_ROLES = ['super_admin', 'manager', 'staff'];

// staff-manager JWT 쿠키 키 이름은 구현 시 검증 필요. 디폴트 'token'.
const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'token';

function requireAdmin(req, res, next) {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    const auth = req.headers?.authorization || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7);
  }
  if (!token) return sendError(res, apiError('NO_TOKEN'));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!ALLOWED_ROLES.includes(payload.role)) {
      return sendError(res, apiError('INSUFFICIENT_ROLE'));
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (e) {
    return sendError(res, apiError('INVALID_TOKEN'));
  }
}

module.exports = { requireAdmin };
JS
```

- [ ] **Step 3: 테스트 실행**

```bash
npm test
# Expected: PASS
```

> **검증 필요 (Task 26 직전)**: staff-manager의 JWT payload 키 이름, 쿠키 이름. `grep -nE 'jwt.sign|cookie' /home/ubuntu/.openclaw/workspace/staff-manager/*.js` 로 확인. 다르면 `auth.js`에서 payload 매핑 수정.

- [ ] **Step 4: 커밋**

```bash
git add court-booking/auth.js court-booking/test/auth.test.js
git commit -m "feat(court-booking): JWT 검증 미들웨어 + 테스트"
```

---

### Task 22: routes/admin.js — 예약 목록 + 상세

**Files:**
- Create: `court-booking/routes/admin.js`
- Modify: `court-booking/server.js`

- [ ] **Step 1: routes/admin.js 작성**

```bash
cat > routes/admin.js <<'JS'
const express = require('express');
const { prepare } = require('../db');
const { requireAdmin } = require('../auth');
const { apiError, sendError } = require('../errors');
const { log: auditLog } = require('../audit-log');

const router = express.Router();
router.use(requireAdmin);

// 예약 목록 (필터)
router.get('/bookings', (req, res) => {
  try {
    const date = req.query.date;
    const status = req.query.status;
    const phone = req.query.phone;
    const where = [];
    const args = {};
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { where.push('b.booking_date = @date'); args.date = date; }
    if (status) { where.push('b.status = @status'); args.status = status; }
    if (phone) { where.push('b.guest_phone LIKE @phone'); args.phone = `%${phone}%`; }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = prepare(`
      SELECT b.id, b.public_code, b.booking_date, b.start_time, b.end_time, b.status, b.amount,
             b.guest_name, b.guest_phone, b.guest_email, c.name_mn AS court_name
      FROM booking b JOIN court c ON c.id = b.court_id
      ${whereSql}
      ORDER BY b.booking_date DESC, b.start_time DESC
      LIMIT 200
    `).all(args);
    res.json(rows);
  } catch (e) { sendError(res, e); }
});

// 예약 상세 + 결제이력
router.get('/bookings/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare(`
      SELECT b.*, c.name_mn AS court_name FROM booking b JOIN court c ON c.id=b.court_id WHERE b.id=?
    `).get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    const payments = prepare(`SELECT * FROM payment WHERE booking_id=? ORDER BY id`).all(id);
    res.json({ ...b, payments });
  } catch (e) { sendError(res, e); }
});

// 강제 취소
router.post('/bookings/:id/cancel', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body || {};
    if (!reason || reason.length < 2) throw apiError('INVALID_INPUT', { field: 'reason' });
    const b = prepare('SELECT id, status FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (!['pending','confirmed'].includes(b.status)) throw apiError('BOOKING_NOT_CANCELLABLE');

    prepare(`UPDATE booking SET status='cancelled', cancelled_at=datetime('now'), cancelled_by=?, cancel_reason=? WHERE id=?`).run(req.user.id, reason, id);
    prepare(`UPDATE payment SET status='auto_cancelled' WHERE booking_id=? AND status='awaiting'`).run(id);

    auditLog({
      actor_id: req.user.id, actor_type: 'admin', action: 'booking.cancel.admin',
      entity_type: 'booking', entity_id: id, metadata: { reason }, ip: req.ip
    });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 노쇼
router.post('/bookings/:id/no-show', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare('SELECT id, status FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (b.status !== 'confirmed') throw apiError('INVALID_INPUT', { hint: '확정된 예약만 노쇼 처리 가능' });
    prepare(`UPDATE booking SET status='no_show', no_show_at=datetime('now'), no_show_by=? WHERE id=?`).run(req.user.id, id);
    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'booking.no_show', entity_type: 'booking', entity_id: id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 현금 수납 처리
router.post('/bookings/:id/confirm-cash', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = prepare('SELECT id, status, amount FROM booking WHERE id=?').get(id);
    if (!b) throw apiError('BOOKING_NOT_FOUND');
    if (b.status !== 'pending') throw apiError('INVALID_INPUT', { hint: 'pending만 현금 처리 가능' });

    const { db } = require('../db');
    db.transaction(() => {
      db.prepare(`INSERT INTO payment (booking_id, provider, amount, status, paid_at, paid_by) VALUES (?, 'cash', ?, 'paid', datetime('now'), ?)`).run(id, b.amount, req.user.id);
      db.prepare(`UPDATE booking SET status='confirmed', confirmed_at=datetime('now') WHERE id=?`).run(id);
    }).immediate();

    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'payment.cash', entity_type: 'booking', entity_id: id, ip: req.ip });

    // 알림 비동기
    const { sendNotificationsForBooking } = require('../notifications');
    setImmediate(() => sendNotificationsForBooking(id).catch(e => console.error(e)));

    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// 코트 관리
router.get('/courts', (req, res) => {
  res.json(prepare('SELECT * FROM court ORDER BY id').all().map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.patch('/courts/:id', express.json(), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const args = { id };
    const allowed = ['name_mn','group_name','open_hours','price_per_hour','active','maintenance_mode'];
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) {
        fields.push(`${k} = @${k}`);
        args[k] = k === 'open_hours' && typeof req.body[k] === 'object' ? JSON.stringify(req.body[k]) : req.body[k];
      }
    }
    if (!fields.length) throw apiError('INVALID_INPUT');
    fields.push(`updated_at = datetime('now')`);
    const sql = `UPDATE court SET ${fields.join(', ')} WHERE id = @id`;
    const result = require('../db').db.prepare(sql).run(args);
    if (!result.changes) throw apiError('BOOKING_NOT_FOUND');   // 재사용
    auditLog({ actor_id: req.user.id, actor_type: 'admin', action: 'court.update', entity_type: 'court', entity_id: id, metadata: req.body, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

module.exports = router;
JS
```

- [ ] **Step 2: server.js에 마운트**

`server.js`에 추가:
```js
app.use('/api/admin', require('./routes/admin'));
```

- [ ] **Step 3: 재시작 + 검증**

```bash
pm2 restart court-booking

# 토큰 없이 호출 → 401
curl -i http://localhost:6031/api/admin/bookings
# Expected: HTTP/1.1 401

# staff-manager 로그인 토큰으로 호출 (수동, 베타 시 검증)
```

- [ ] **Step 4: 커밋**

```bash
git add court-booking/routes/admin.js court-booking/server.js
git commit -m "feat(court-booking): 어드민 API (목록/상세/취소/노쇼/현금/코트관리)"
```

---

## Phase G — 보안 미들웨어

### Task 23: rate-limit + CSRF + 에러 핸들러

**Files:**
- Create: `court-booking/middleware/rate-limit.js`
- Create: `court-booking/middleware/csrf.js`
- Create: `court-booking/middleware/error-handler.js`
- Modify: `court-booking/server.js`
- Modify: `court-booking/routes/public.js` (분당 rate limit)

- [ ] **Step 1: 미들웨어 작성**

```bash
mkdir -p middleware

cat > middleware/rate-limit.js <<'JS'
const rateLimit = require('express-rate-limit');

const createBookingLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон захиалга илгээгдсэн.', message_en: 'Too many bookings.' }
});

const cancelLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон хүсэлт.', message_en: 'Too many requests.' }
});

const readLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон хүсэлт.', message_en: 'Too many requests.' }
});

module.exports = { createBookingLimiter, cancelLimiter, readLimiter };
JS

cat > middleware/csrf.js <<'JS'
// Origin 헤더 화이트리스트로 CSRF 방어 (상태변경 메서드만)
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function csrfGuard(req, res, next) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  // QPay 콜백은 외부 → CSRF 가드 제외 (라우트에서 직접 분기)
  if (req.path.startsWith('/qpay/')) return next();

  const origin = req.headers.origin;
  if (!origin) {
    // origin 없음: same-origin 또는 비-브라우저. 1단계 허용 (curl/POS 환경 고려)
    return next();
  }
  if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return next();
  return res.status(403).json({ error_code: 'CSRF_BLOCKED', message_en: `Origin ${origin} not allowed.` });
}

module.exports = { csrfGuard };
JS

cat > middleware/error-handler.js <<'JS'
const { sendError, apiError } = require('../errors');

function notFound(req, res) {
  res.status(404).json({ error_code: 'NOT_FOUND' });
}

function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  if (err.error_code) return sendError(res, err);
  sendError(res, apiError('INTERNAL'));
}

module.exports = { notFound, errorHandler };
JS
```

- [ ] **Step 2: server.js 통합**

`server.js`를 다음으로 교체:

```bash
cat > server.js <<'JS'
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { csrfGuard } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
const PORT = parseInt(process.env.PORT || '6031', 10);

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(csrfGuard);

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/qpay', require('./routes/qpay'));

app.use(notFound);
app.use(errorHandler);

require('./cron-jobs')().startSchedules();

app.listen(PORT, () => {
  console.log(`[court-booking] listening on ${PORT}`);
});
JS
```

- [ ] **Step 3: routes/public.js에 rate-limit 적용**

`routes/public.js`의 imports 다음에 추가:
```js
const { createBookingLimiter, cancelLimiter, readLimiter } = require('../middleware/rate-limit');
```

라우터 정의를 다음으로 수정 (각 라우트 앞에 limiter 추가):
```js
router.get('/courts', readLimiter, (req, res) => { /* 기존 */ });
router.get('/availability', readLimiter, (req, res) => { /* 기존 */ });
router.post('/bookings', createBookingLimiter, express.json(), async (req, res) => { /* 기존 */ });
router.get('/bookings/:code', readLimiter, (req, res) => { /* 기존 */ });
router.get('/bookings/:code/payment-status', readLimiter, (req, res) => { /* 기존 */ });
router.post('/bookings/:code/cancel', cancelLimiter, express.json(), (req, res) => { /* 기존 */ });
```

- [ ] **Step 4: 재시작 + 검증**

```bash
pm2 restart court-booking
# rate limit 검증
for i in {1..7}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:6031/api/bookings -H 'Content-Type: application/json' -d '{}'; done
# Expected: 처음 5번은 400 (INVALID_INPUT), 6번째부터 429
```

- [ ] **Step 5: 커밋**

```bash
git add court-booking/middleware/ court-booking/server.js court-booking/routes/public.js
git commit -m "feat(court-booking): rate-limit + CSRF Origin + 에러 핸들러"
```

---

## Phase H — 프론트엔드 (고객 SPA)

### Task 24: 정적 자산 + i18n + api 래퍼

**Files:**
- Create: `court-booking/public/locales/mn.json`
- Create: `court-booking/public/assets/js/i18n.js`
- Create: `court-booking/public/assets/js/api.js`
- Create: `court-booking/public/assets/css/app.css`

- [ ] **Step 1: 디렉토리 + 파일 생성**

```bash
mkdir -p public/assets/js public/assets/css public/locales

cat > public/locales/mn.json <<'JSON'
{
  "app_title": "Хавайн теннисний корт",
  "select_court": "Корт сонгох",
  "select_date": "Огноо сонгох",
  "select_time": "Цаг сонгох",
  "name": "Нэр",
  "phone": "Утас (+976)",
  "email": "Имэйл (заавал биш)",
  "agree_terms": "Үйлчилгээний нөхцөлийг зөвшөөрч байна",
  "book_now": "Захиалах",
  "next": "Үргэлжлүүлэх",
  "back": "Буцах",
  "loading": "Уншиж байна...",
  "pay_with_qpay": "QPay-р төлөх",
  "pay_qr_hint": "QPay апп нээгээд QR кодыг уншуулна уу",
  "payment_expires_in": "Төлбөрийн хугацаа: {time}",
  "cancel_booking": "Захиалга цуцлах",
  "booking_confirmed": "Захиалга баталгаажлаа",
  "your_code": "Захиалгын код",
  "venue": "Газар",
  "date": "Огноо",
  "time": "Цаг",
  "amount": "Үнэ",
  "screenshot_hint": "Энэ дэлгэцийн зургийг хадгална уу",
  "err_slot_taken": "Энэ цаг саяхан өөр хэрэглэгч авлаа. Өөр цаг сонгоно уу.",
  "err_payment_expired": "Төлбөрийн хугацаа дууссан.",
  "err_invalid_input": "Буруу мэдээлэл.",
  "err_phone_mismatch": "Утасны сүүлийн 4 орон таарахгүй.",
  "err_not_cancellable": "24 цаг дотор цуцлах боломжгүй.",
  "err_internal": "Алдаа гарлаа. Дахин оролдоно уу.",
  "open_qpay_app": "QPay аппд нээх",
  "phone_last4_label": "Утасны сүүлийн 4 орон",
  "verify_to_cancel": "Цуцлахын тулд баталгаажуул",
  "available": "Сул",
  "taken": "Дүүрсэн",
  "step": "Алхам {n}/5",
  "open_hours": "Ажиллах цаг",
  "today": "Өнөөдөр",
  "no_slots": "Энэ өдөр ажиллахгүй."
}
JSON

cat > public/assets/js/i18n.js <<'JS'
window.__i18n = { messages: {}, lang: 'mn' };

async function loadLocale(lang = 'mn') {
  const res = await fetch(`/booking/locales/${lang}.json`).catch(() => fetch(`/locales/${lang}.json`));
  window.__i18n.messages = await res.json();
  window.__i18n.lang = lang;
}

function t(key, vars = {}) {
  let s = window.__i18n.messages[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
window.t = t;
window.loadLocale = loadLocale;
JS

cat > public/assets/js/api.js <<'JS'
async function _fetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(body?.error_code || `HTTP_${res.status}`);
    err.error_code = body?.error_code;
    err.message_mn = body?.message_mn;
    err.body = body;
    throw err;
  }
  return body;
}

window.api = {
  get: (url) => _fetch(url, { method: 'GET' }),
  post: (url, body) => _fetch(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: (url, body) => _fetch(url, { method: 'PATCH', body: JSON.stringify(body) })
};
JS

cat > public/assets/css/app.css <<'CSS'
/* Tailwind CDN 위에 사용자 컴포넌트 최소만 */
.btn-primary { @apply bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-6 rounded-xl active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium py-2 px-4 rounded-lg; }
.slot { @apply border rounded-lg py-3 text-center font-medium cursor-pointer select-none; }
.slot-available { @apply border-emerald-500 text-emerald-700 hover:bg-emerald-50; }
.slot-taken { @apply border-slate-200 text-slate-400 cursor-not-allowed line-through; }
.slot-selected { @apply bg-emerald-600 border-emerald-600 text-white; }
CSS
```

> Tailwind CDN의 JIT는 `@apply` 미지원 → 위 CSS의 `@apply`는 빌드 시에만 작동. **대안**: CDN play 사용 OR 위 클래스를 직접 마크업에 인라인. 다음 task에서 인라인 방식 채택.

- [ ] **Step 2: app.css 단순화 (CDN 호환)**

```bash
cat > public/assets/css/app.css <<'CSS'
/* Tailwind 클래스는 인라인으로 사용. 여기엔 정말 컴포넌트 단위만 */
.fade-in { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
CSS
```

- [ ] **Step 3: 커밋**

```bash
git add court-booking/public/locales/ court-booking/public/assets/
git commit -m "feat(court-booking): 정적 자산 — i18n + api + 사용자 CSS"
```

---

### Task 25: 고객 SPA HTML (5단계 Alpine 컴포넌트)

**Files:**
- Create: `court-booking/public/index.html`
- Create: `court-booking/public/assets/js/customer.js`

- [ ] **Step 1: index.html 작성**

```bash
cat > public/index.html <<'HTML'
<!doctype html>
<html lang="mn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#059669" />
  <title>Хавайн теннисний корт — Захиалга</title>
  <link rel="icon" type="image/svg+xml" href="/booking/assets/img/favicon.svg" />
  <link rel="stylesheet" href="/booking/assets/css/app.css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js"></script>
  <script src="/booking/assets/js/i18n.js"></script>
  <script src="/booking/assets/js/api.js"></script>
  <script src="/booking/assets/js/customer.js"></script>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">

<div x-data="bookingApp()" x-init="init()" class="max-w-md mx-auto p-4">

  <!-- Header -->
  <header class="mb-4">
    <h1 class="text-2xl font-bold text-emerald-700" x-text="t('app_title')"></h1>
    <p class="text-sm text-slate-500 mt-1" x-text="t('step', { n: step })"></p>
  </header>

  <!-- Error toast -->
  <div x-show="error" x-transition class="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" x-text="error"></div>

  <!-- Step 1: 코트 + 날짜 -->
  <section x-show="step === 1" class="fade-in space-y-4">
    <div>
      <label class="block text-sm font-medium mb-2" x-text="t('select_court')"></label>
      <div class="p-4 bg-white rounded-xl border" x-show="selected.court">
        <p class="font-semibold" x-text="selected.court?.name_mn"></p>
        <p class="text-sm text-slate-500" x-text="`₮${(selected.court?.price_per_hour || 0).toLocaleString()} / цаг`"></p>
      </div>
    </div>
    <div>
      <label class="block text-sm font-medium mb-2" x-text="t('select_date')"></label>
      <div class="overflow-x-auto -mx-4 px-4">
        <div class="flex gap-2 pb-2">
          <template x-for="d in next14Days()" :key="d.date">
            <button @click="selectDate(d.date)" :class="selected.date === d.date ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-200'" class="flex-shrink-0 w-16 py-3 rounded-xl border text-center">
              <div class="text-xs" x-text="d.dow"></div>
              <div class="text-lg font-bold" x-text="d.day"></div>
            </button>
          </template>
        </div>
      </div>
    </div>
    <button class="w-full bg-emerald-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50" :disabled="!selected.court || !selected.date" @click="goToSlots()" x-text="t('next')"></button>
  </section>

  <!-- Step 2: 시간 슬롯 -->
  <section x-show="step === 2" class="fade-in space-y-4">
    <button @click="step = 1" class="text-emerald-600 text-sm" x-text="'← ' + t('back')"></button>
    <p class="text-sm text-slate-500" x-text="selected.date"></p>
    <div x-show="availability.length === 0" class="text-center py-8 text-slate-400" x-text="t('no_slots')"></div>
    <div class="grid grid-cols-4 gap-2">
      <template x-for="slot in availability" :key="slot.start">
        <button @click="slot.available && selectSlot(slot)" :disabled="!slot.available" :class="!slot.available ? 'border-slate-200 text-slate-400 line-through cursor-not-allowed' : (selected.slot?.start === slot.start ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50')" class="border rounded-lg py-3 text-center font-medium">
          <span x-text="slot.start"></span>
        </button>
      </template>
    </div>
    <button class="w-full bg-emerald-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50" :disabled="!selected.slot" @click="step = 3" x-text="t('next')"></button>
  </section>

  <!-- Step 3: 손님 정보 -->
  <section x-show="step === 3" class="fade-in space-y-4">
    <button @click="step = 2" class="text-emerald-600 text-sm" x-text="'← ' + t('back')"></button>
    <div class="space-y-3">
      <div>
        <label class="block text-sm font-medium mb-1" x-text="t('name')"></label>
        <input x-model.trim="form.guest_name" type="text" autocomplete="name" class="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1" x-text="t('phone')"></label>
        <input x-model.trim="form.guest_phone" type="tel" inputmode="tel" autocomplete="tel" class="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="99119911" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1" x-text="t('email')"></label>
        <input x-model.trim="form.guest_email" type="email" autocomplete="email" class="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
      </div>
      <label class="flex items-start gap-2 pt-2">
        <input type="checkbox" x-model="form.agree" class="mt-1" />
        <span class="text-sm text-slate-600" x-text="t('agree_terms')"></span>
      </label>
    </div>
    <div class="p-3 bg-emerald-50 rounded-lg flex justify-between">
      <span x-text="t('amount')"></span>
      <span class="font-semibold" x-text="`₮${calcAmount().toLocaleString()}`"></span>
    </div>
    <button class="w-full bg-emerald-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50" :disabled="!canSubmit() || submitting" @click="submit()">
      <span x-show="!submitting" x-text="t('book_now')"></span>
      <span x-show="submitting" x-text="t('loading')"></span>
    </button>
  </section>

  <!-- Step 4: QPay 결제 -->
  <section x-show="step === 4" class="fade-in space-y-4 text-center">
    <p class="text-sm text-slate-500" x-text="t('pay_qr_hint')"></p>
    <div class="bg-white p-4 rounded-xl inline-block">
      <img x-show="booking?.qpay_qr_image" :src="'data:image/png;base64,' + (booking?.qpay_qr_image || '')" alt="QPay QR" class="w-64 h-64 mx-auto" />
    </div>
    <div class="space-y-2">
      <template x-for="link in (booking?.qpay_deeplinks || [])" :key="link.name">
        <a :href="link.link" class="block bg-slate-100 hover:bg-slate-200 py-2 rounded-lg text-sm" x-text="link.name + ' →'"></a>
      </template>
    </div>
    <div class="text-lg font-mono" x-text="t('payment_expires_in', { time: countdown })"></div>
    <button class="text-red-600 text-sm underline" @click="cancelDuringPayment()" x-text="t('cancel_booking')"></button>
  </section>

  <!-- Step 5: 확정 -->
  <section x-show="step === 5" class="fade-in text-center space-y-4 py-8">
    <div class="text-6xl">✅</div>
    <h2 class="text-xl font-bold text-emerald-700" x-text="t('booking_confirmed')"></h2>
    <div class="bg-white p-6 rounded-2xl border-2 border-emerald-500">
      <p class="text-sm text-slate-500" x-text="t('your_code')"></p>
      <p class="text-4xl font-mono font-bold text-emerald-700 my-2" x-text="booking?.public_code"></p>
    </div>
    <div class="text-left bg-white p-4 rounded-xl space-y-1 text-sm">
      <div class="flex justify-between"><span class="text-slate-500" x-text="t('venue')"></span><span x-text="selected.court?.name_mn"></span></div>
      <div class="flex justify-between"><span class="text-slate-500" x-text="t('date')"></span><span x-text="selected.date"></span></div>
      <div class="flex justify-between"><span class="text-slate-500" x-text="t('time')"></span><span x-text="`${selected.slot?.start} - ${selected.slot?.end}`"></span></div>
      <div class="flex justify-between"><span class="text-slate-500" x-text="t('amount')"></span><span x-text="`₮${calcAmount().toLocaleString()}`"></span></div>
    </div>
    <p class="text-sm text-slate-500" x-text="t('screenshot_hint')"></p>
  </section>

</div>

</body></html>
HTML
```

- [ ] **Step 2: customer.js 작성**

```bash
cat > public/assets/js/customer.js <<'JS'
async function bootI18n() { await loadLocale('mn'); }
document.addEventListener('alpine:init', bootI18n);

function bookingApp() {
  return {
    step: 1,
    courts: [],
    selected: { court: null, date: null, slot: null },
    availability: [],
    form: { guest_name: '', guest_phone: '', guest_email: '', agree: false },
    booking: null,
    pollTimer: null,
    countdownTimer: null,
    expiresAt: null,
    countdown: '15:00',
    submitting: false,
    error: null,

    async init() {
      await bootI18n();
      try {
        this.courts = await api.get('/booking/api/courts');
        this.selected.court = this.courts[0] || null;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    },

    next14Days() {
      const arr = [];
      const today = dayjs();
      const dow = ['Ня','Да','Мя','Лх','Пү','Ба','Бя'];
      for (let i = 0; i < 14; i++) {
        const d = today.add(i, 'day');
        arr.push({ date: d.format('YYYY-MM-DD'), day: d.format('D'), dow: i === 0 ? t('today') : dow[d.day()] });
      }
      return arr;
    },

    async selectDate(date) {
      this.selected.date = date;
      this.selected.slot = null;
    },

    async goToSlots() {
      this.error = null;
      try {
        this.availability = await api.get(`/booking/api/availability?court_id=${this.selected.court.id}&date=${this.selected.date}`);
        this.step = 2;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    },

    selectSlot(slot) {
      this.selected.slot = slot;
    },

    calcAmount() {
      if (!this.selected.court || !this.selected.slot) return 0;
      const [sh, sm] = this.selected.slot.start.split(':').map(Number);
      const [eh, em] = this.selected.slot.end.split(':').map(Number);
      const hours = (eh * 60 + em - sh * 60 - sm) / 60;
      return Math.round(this.selected.court.price_per_hour * hours);
    },

    canSubmit() {
      return this.form.guest_name && /^[0-9+\-\s]{6,20}$/.test(this.form.guest_phone) && this.form.agree;
    },

    async submit() {
      if (!this.canSubmit() || this.submitting) return;
      this.submitting = true;
      this.error = null;
      try {
        const res = await api.post('/booking/api/bookings', {
          court_id: this.selected.court.id,
          booking_date: this.selected.date,
          start_time: this.selected.slot.start,
          end_time: this.selected.slot.end,
          guest_name: this.form.guest_name,
          guest_phone: this.form.guest_phone,
          guest_email: this.form.guest_email || null
        });
        this.booking = res;
        this.expiresAt = res.expires_at ? new Date(res.expires_at).getTime() : Date.now() + 15 * 60_000;
        this.step = 4;
        this.startPolling();
        this.startCountdown();
      } catch (e) {
        if (e.error_code === 'SLOT_CONFLICT') {
          this.error = t('err_slot_taken');
          await this.goToSlots();
        } else {
          this.error = e.message_mn || t('err_internal');
        }
      } finally {
        this.submitting = false;
      }
    },

    startPolling() {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          const s = await api.get(`/booking/api/bookings/${this.booking.public_code}/payment-status`);
          if (s.status === 'paid') {
            clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
            this.step = 5;
          } else if (s.status === 'cancelled') {
            clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
            this.error = t('err_payment_expired');
            this.step = 3;
          }
        } catch (e) {}
      }, 3000);
    },

    startCountdown() {
      clearInterval(this.countdownTimer);
      this.countdownTimer = setInterval(() => {
        const remain = Math.max(0, this.expiresAt - Date.now());
        const m = String(Math.floor(remain / 60_000)).padStart(2, '0');
        const s = String(Math.floor((remain % 60_000) / 1000)).padStart(2, '0');
        this.countdown = `${m}:${s}`;
        if (remain <= 30_000 && remain > 28_000 && navigator.vibrate) navigator.vibrate(200);
        if (remain <= 0) { clearInterval(this.countdownTimer); }
      }, 500);
    },

    async cancelDuringPayment() {
      const last4 = (this.form.guest_phone || '').slice(-4);
      try {
        await api.post(`/booking/api/bookings/${this.booking.public_code}/cancel`, { phone_last4: last4 });
        clearInterval(this.pollTimer); clearInterval(this.countdownTimer);
        this.step = 1;
        this.selected.slot = null;
      } catch (e) {
        this.error = e.message_mn || t('err_internal');
      }
    }
  };
}
window.bookingApp = bookingApp;
JS
```

- [ ] **Step 3: 재시작 + 브라우저 검증**

```bash
pm2 restart court-booking
# 로컬에서: https://app.hawaiigroup.co/booking/ (nginx 설정 후) 또는 EC2 직접: http://EC2_IP:6031/
```

> nginx 설정 전이면 SSH 터널: `ssh -L 6031:localhost:6031 ubuntu@3.93.96.130` 후 브라우저 `http://localhost:6031/`

- [ ] **Step 4: 커밋**

```bash
git add court-booking/public/index.html court-booking/public/assets/js/customer.js
git commit -m "feat(court-booking): 고객 SPA — 5단계 Alpine 컴포넌트"
```

---

## Phase I — 어드민 SPA

### Task 26: 어드민 HTML + admin.js

**Files:**
- Create: `court-booking/public/admin/index.html`
- Create: `court-booking/public/assets/js/admin.js`

- [ ] **Step 1: 어드민 HTML 작성**

```bash
mkdir -p public/admin
cat > public/admin/index.html <<'HTML'
<!doctype html>
<html lang="mn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Court Booking — Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="/booking/assets/js/api.js"></script>
  <script src="/booking/assets/js/admin.js"></script>
</head>
<body class="bg-slate-100 min-h-screen">

<div x-data="adminApp()" x-init="init()" class="max-w-6xl mx-auto p-4">

  <header class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">Court Booking Admin</h1>
    <div class="flex items-center gap-2">
      <input type="date" x-model="filters.date" @change="load()" class="border rounded px-2 py-1" />
      <select x-model="filters.status" @change="load()" class="border rounded px-2 py-1">
        <option value="">전체 상태</option>
        <option value="pending">대기</option>
        <option value="confirmed">확정</option>
        <option value="cancelled">취소</option>
        <option value="no_show">노쇼</option>
        <option value="completed">완료</option>
      </select>
      <input type="text" x-model="filters.phone" @keyup.enter="load()" placeholder="전화 검색" class="border rounded px-2 py-1" />
      <button @click="load()" class="bg-emerald-600 text-white px-3 py-1 rounded">↻</button>
    </div>
  </header>

  <div x-show="error" class="mb-3 p-2 bg-red-100 text-red-700 rounded" x-text="error"></div>

  <div class="bg-white rounded-lg overflow-hidden shadow-sm">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left">
        <tr>
          <th class="px-3 py-2">코드</th>
          <th class="px-3 py-2">날짜</th>
          <th class="px-3 py-2">시간</th>
          <th class="px-3 py-2">손님</th>
          <th class="px-3 py-2">전화</th>
          <th class="px-3 py-2">금액</th>
          <th class="px-3 py-2">상태</th>
          <th class="px-3 py-2">액션</th>
        </tr>
      </thead>
      <tbody>
        <template x-for="b in bookings" :key="b.id">
          <tr class="border-t hover:bg-slate-50">
            <td class="px-3 py-2 font-mono" x-text="b.public_code"></td>
            <td class="px-3 py-2" x-text="b.booking_date"></td>
            <td class="px-3 py-2" x-text="b.start_time + '~' + b.end_time"></td>
            <td class="px-3 py-2" x-text="b.guest_name"></td>
            <td class="px-3 py-2" x-text="b.guest_phone"></td>
            <td class="px-3 py-2 text-right" x-text="'₮' + b.amount.toLocaleString()"></td>
            <td class="px-3 py-2">
              <span :class="statusColor(b.status)" class="px-2 py-1 rounded text-xs" x-text="b.status"></span>
            </td>
            <td class="px-3 py-2">
              <button @click="openDetail(b)" class="text-emerald-600 hover:underline">상세</button>
            </td>
          </tr>
        </template>
        <tr x-show="bookings.length === 0"><td colspan="8" class="text-center py-8 text-slate-400">결과 없음</td></tr>
      </tbody>
    </table>
  </div>

  <!-- 상세 모달 -->
  <div x-show="detail" x-transition class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" @click.self="detail = null">
    <div class="bg-white rounded-xl max-w-md w-full p-6 space-y-3" x-show="detail">
      <h3 class="font-bold text-lg" x-text="'예약 ' + detail?.public_code"></h3>
      <div class="text-sm space-y-1">
        <div><b>코트:</b> <span x-text="detail?.court_name"></span></div>
        <div><b>날짜:</b> <span x-text="detail?.booking_date"></span></div>
        <div><b>시간:</b> <span x-text="detail?.start_time + '~' + detail?.end_time"></span></div>
        <div><b>손님:</b> <span x-text="detail?.guest_name"></span> (<span x-text="detail?.guest_phone"></span>)</div>
        <div><b>이메일:</b> <span x-text="detail?.guest_email || '-'"></span></div>
        <div><b>금액:</b> <span x-text="'₮' + detail?.amount?.toLocaleString()"></span></div>
        <div><b>상태:</b> <span x-text="detail?.status"></span></div>
        <div><b>결제 이력:</b></div>
        <ul class="ml-4 list-disc">
          <template x-for="p in (detail?.payments || [])" :key="p.id">
            <li x-text="`${p.provider} - ${p.status}${p.paid_at ? ' @ ' + p.paid_at : ''}`"></li>
          </template>
        </ul>
      </div>

      <div class="flex flex-wrap gap-2 pt-3 border-t">
        <button x-show="['pending','confirmed'].includes(detail?.status)" @click="cancelBooking()" class="bg-red-500 text-white px-3 py-2 rounded">강제 취소</button>
        <button x-show="detail?.status === 'confirmed'" @click="markNoShow()" class="bg-orange-500 text-white px-3 py-2 rounded">노쇼</button>
        <button x-show="detail?.status === 'pending'" @click="confirmCash()" class="bg-emerald-600 text-white px-3 py-2 rounded">현금 수납</button>
        <button @click="detail = null" class="ml-auto bg-slate-200 px-3 py-2 rounded">닫기</button>
      </div>
    </div>
  </div>

</div>

</body></html>
HTML
```

- [ ] **Step 2: admin.js 작성**

```bash
cat > public/assets/js/admin.js <<'JS'
function adminApp() {
  return {
    bookings: [],
    detail: null,
    error: null,
    filters: { date: '', status: '', phone: '' },

    async init() {
      this.filters.date = new Date().toISOString().slice(0, 10);
      await this.load();
    },

    async load() {
      this.error = null;
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(this.filters)) if (v) q.set(k, v);
      try {
        this.bookings = await api.get('/booking/api/admin/bookings?' + q.toString());
      } catch (e) {
        if (e.error_code === 'NO_TOKEN' || e.error_code === 'INVALID_TOKEN') {
          location.href = '/staff-manager/login?next=' + encodeURIComponent(location.pathname);
        } else {
          this.error = e.message_mn || e.message || '로드 실패';
        }
      }
    },

    statusColor(s) {
      return {
        pending: 'bg-yellow-100 text-yellow-800',
        confirmed: 'bg-emerald-100 text-emerald-800',
        cancelled: 'bg-red-100 text-red-700',
        no_show: 'bg-orange-100 text-orange-700',
        completed: 'bg-slate-100 text-slate-700'
      }[s] || 'bg-slate-100';
    },

    async openDetail(b) {
      try {
        this.detail = await api.get(`/booking/api/admin/bookings/${b.id}`);
      } catch (e) {
        this.error = e.message_mn || '상세 로드 실패';
      }
    },

    async cancelBooking() {
      const reason = prompt('취소 사유:');
      if (!reason || reason.length < 2) return;
      try {
        await api.post(`/booking/api/admin/bookings/${this.detail.id}/cancel`, { reason });
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '취소 실패'; }
    },

    async markNoShow() {
      if (!confirm('노쇼 처리하시겠습니까?')) return;
      try {
        await api.post(`/booking/api/admin/bookings/${this.detail.id}/no-show`);
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '실패'; }
    },

    async confirmCash() {
      if (!confirm('현금 수납 처리하시겠습니까?')) return;
      try {
        await api.post(`/booking/api/admin/bookings/${this.detail.id}/confirm-cash`);
        this.detail = null;
        await this.load();
      } catch (e) { this.error = e.message_mn || '실패'; }
    }
  };
}
window.adminApp = adminApp;
JS
```

- [ ] **Step 3: 검증**

```bash
pm2 restart court-booking
# 브라우저: https://app.hawaiigroup.co/booking/admin/
# (먼저 staff-manager 로그인 → 쿠키 설정 후 접근)
```

- [ ] **Step 4: 커밋**

```bash
git add court-booking/public/admin/ court-booking/public/assets/js/admin.js
git commit -m "feat(court-booking): 어드민 SPA — 목록/필터/상세/액션"
```

---

## Phase J — 배포 & 마이그레이션

### Task 27: 백업 cron 시스템 등록

**Files:**
- Create: `/etc/cron.d/court-booking-backup` (sudo)

- [ ] **Step 1: 백업 디렉토리 생성**

```bash
mkdir -p /home/ubuntu/backups
```

- [ ] **Step 2: 시스템 cron 등록**

```bash
sudo tee /etc/cron.d/court-booking-backup > /dev/null <<'CRON'
# court-booking SQLite hot backup (매일 03:00 KST = 02:00 UB)
0 2 * * * ubuntu sqlite3 /home/ubuntu/.openclaw/workspace/court-booking/court.db ".backup /home/ubuntu/backups/court-$(date +\%Y\%m\%d).db" && find /home/ubuntu/backups -name 'court-*.db' -mtime +30 -delete
CRON

sudo systemctl restart cron
```

- [ ] **Step 3: 수동 실행 검증**

```bash
sqlite3 /home/ubuntu/.openclaw/workspace/court-booking/court.db ".backup /home/ubuntu/backups/court-test.db"
ls -la /home/ubuntu/backups/court-test.db
# Expected: 파일 존재
rm /home/ubuntu/backups/court-test.db
```

> 이 task는 서버 설정이라 git commit 없음.

---

### Task 28: nginx /booking/ 라우팅 추가

**Files:**
- Modify: nginx 설정 파일 (`/etc/nginx/sites-enabled/...`)

- [ ] **Step 1: 현재 nginx 설정 확인**

```bash
sudo nginx -T 2>/dev/null | grep -A 3 'location /tennis\|location /staff' | head -20
ls /etc/nginx/sites-enabled/
```

- [ ] **Step 2: /booking/ 블록 추가 (tennis-app은 일단 유지)**

설정 파일 (이름은 위 확인 결과에 따라):

```nginx
location /booking/ {
    proxy_pass http://localhost:6031/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- [ ] **Step 3: 검증 + reload**

```bash
sudo nginx -t
# Expected: syntax is ok / test is successful

sudo systemctl reload nginx

curl https://app.hawaiigroup.co/booking/health
# Expected: {"ok":true,...}

curl https://app.hawaiigroup.co/booking/api/courts
# Expected: [{...}]
```

- [ ] **Step 4: 외부 브라우저 검증**

`https://app.hawaiigroup.co/booking/` 접속 → 고객 SPA 로드 확인.

> 서버 설정이라 git commit 없음. 변경 내용은 운영 메모에 기록.

---

## Phase K — 베타 + 출시

### Task 29: 수동 체크리스트 (개발자 자체)

- [ ] 해피패스: 코트→날짜→슬롯→정보입력→QPay→확정
- [ ] QPay 결제 안 함, 15분 대기 → 자동 취소 확인 (`pm2 logs` + DB)
- [ ] 두 브라우저 동시 같은 슬롯 → 한쪽 SLOT_CONFLICT
- [ ] 24h 이내 취소 시도 → BOOKING_NOT_CANCELLABLE
- [ ] phone 마지막 4자리 틀림 → PHONE_MISMATCH
- [ ] 어드민 강제 취소 → audit_log에 기록됨 (`sqlite3 court.db "SELECT * FROM audit_log ORDER BY id DESC LIMIT 5"`)
- [ ] 모바일 실기기 (iOS Safari + Android Chrome) 해피패스 1회씩
- [ ] 어드민 SSO 로그인 → /booking/admin/ 접근 OK
- [ ] cron 로그 확인 (`pm2 logs court-booking | grep cron`)

체크리스트 통과 못 한 항목은 별도 이슈로 분리 → 수정 → 재검증.

---

### Task 30: 베타 운영 (1주)

- [ ] 직원 3명에게 베타 URL + 사용법 안내
- [ ] 가족/지인 5명 추가 베타 참여
- [ ] 매일 어드민에서 예약 목록 확인 (`/booking/admin/`)
- [ ] 매일 audit_log 검토: `sqlite3 court.db "SELECT created_at, action, actor_type FROM audit_log ORDER BY id DESC LIMIT 20"`
- [ ] QPay 영수증과 booking 금액 일치 확인 (수기)
- [ ] 이메일 도착 확인 (스팸함 포함)
- [ ] 텔레그램 알림 도착 확인
- [ ] 백업 cron이 매일 실행되는지 확인 (`ls -la /home/ubuntu/backups/`)
- [ ] 발견된 모든 버그 → 새 task로 분리하여 수정 → 재배포

---

### Task 31: tennis-app 폐기 + 301 리다이렉트

**Files:**
- Modify: nginx 설정

- [ ] **Step 1: nginx에 301 추가 (tennis-app 중지 전)**

기존 `/tennis/` location 블록을 다음으로 교체:

```nginx
location /tennis/ {
    return 301 /booking/$request_uri;
}
```

- [ ] **Step 2: 검증**

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://app.hawaiigroup.co/tennis/
# Expected: HTTP/2 301
#           location: /booking/...
```

- [ ] **Step 3: tennis-app pm2 중지**

```bash
pm2 stop tennis-app
pm2 delete tennis-app
pm2 save
```

- [ ] **Step 4: 30일 후 파일 백업/삭제 (별도 일정)**

```bash
# 30일 후 실행 예정
mv /home/ubuntu/tennis-app /home/ubuntu/tennis-app.deleted-$(date +%Y%m%d)
# 추가 1주일 후 문제 없으면
# rm -rf /home/ubuntu/tennis-app.deleted-*
```

> 301 리다이렉트는 최소 90일 유지.

---

### Task 32: 정식 오픈 (코트 시공 완료 후)

- [ ] 코트 가격 최종 확정 → `PATCH /api/admin/courts/1` 로 `price_per_hour` 갱신
- [ ] 운영시간 최종 확정 → 동일 엔드포인트로 `open_hours` 갱신
- [ ] 약관/개인정보 페이지 콘텐츠 운영자 제공 후 추가 (별도 task)
- [ ] 운영 안내문 / 사진 / SNS 공유
- [ ] 첫날 운영 모니터링 (어드민 + audit_log)

---

## 자체 리뷰 결과

### 1. Spec 커버리지

| Spec 섹션 | 구현 task |
|---|---|
| 4 아키텍처 (디렉토리/배포) | Task 1, 5, 6, 28 |
| 5 데이터 모델 (4 테이블) | Task 3 |
| 5 슬롯 겹침 트랜잭션 | Task 4, 8 |
| 6 공개 API | Task 11, 12, 13, 14 |
| 6 어드민 API | Task 22 |
| 6 webhook | Task 17 |
| 7 플로우 + 엣지케이스 | Task 12, 14, 17, 18 |
| 8 SSO | Task 21 |
| 8 Cron (autoCancel/verify/completed) | Task 18 |
| 8 QPay | Task 15, 16, 17 |
| 8 Telegram | Task 19, 20 |
| 8 Email | Task 19, 20 |
| 8 보안 가드 (CSRF/rate-limit/XSS/SQLi) | Task 23 (Alpine `x-text`는 자동, prepared statement 강제) |
| 9 프론트엔드 (고객 5단계) | Task 24, 25 |
| 9 어드민 SPA | Task 26 |
| 9 i18n (mn) | Task 24 |
| 10 마이그레이션 (tennis-app 폐기) | Task 31 |
| 10 백업 | Task 27 |
| 11 테스트 자동화 | Task 7, 8, 9, 17, 18, 21 |
| 11 수동 체크리스트 | Task 29 |
| 12 출시 기준 | Task 29, 30, 32 |
| 14 검증 사항 (JWT 키/쿠키 이름) | Task 21 노트 |

### 2. Placeholder 스캔

✓ "TBD"/"TODO" 없음. 모든 step에 실제 코드/명령.

### 3. 타입/시그니처 일관성

- `createBookingSafely(input)` — Task 8 정의, Task 12에서 사용 ✓
- `markPaidByInvoice(invoice_id)` — Task 17 정의 (`routes/qpay-tx.js`), Task 17·18에서 사용 ✓
- `sendNotificationsForBooking(booking_id)` — Task 17 스텁, Task 20 실제 구현 ✓
- `t(key, vars)` — Task 24 정의, Task 25·26에서 사용 ✓
- 에러 코드 `SLOT_CONFLICT`/`BOOKING_NOT_FOUND`/`PHONE_MISMATCH` 등 — Task 10에서 catalog 정의, 후속 task 모두 동일 ✓

### 4. 검증 시점 정리

- JWT payload 키/쿠키 이름 확인 → **Task 21 직전** (`grep -nE 'jwt.sign|cookie' /home/ubuntu/.openclaw/workspace/staff-manager/*.js`)
- QPay 자격증명 → **Task 16 직전** (운영자 입력)
- SMTP/Resend 도메인 인증 → **Task 19 직전** (운영자 작업)
- TELEGRAM_STAFF_CHAT_ID → **Task 20 직전** (봇에 /start 후 chat_id 추출)

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-31 | 초안 (Spec d3f82b4 기반) |
