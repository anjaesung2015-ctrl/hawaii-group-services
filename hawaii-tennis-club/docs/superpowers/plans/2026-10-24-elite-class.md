# 하와이 엘리트선수반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클럽 앱 안에 엘리트선수반(선수 명단·훈련 일정·출석·수강료·공지)을 동호인반과 서버 단에서 분리해 넣는다.

**Architecture:** `member.program`(club|elite)으로 계정을 가르고, 선수반 데이터는 `elite_*` 테이블 4개에 따로 둔다. 동호인 라우터 7개는 `auth.requireClub`으로 선수 계정을 403 처리하고, 동호인 쪽 회원 집계·알림 쿼리에는 `program='club'` 조건을 단다. 선수반 API는 `/api/elite/*`(라우터 4개 파일), 화면은 선수용 `views/elite-me.js`와 관리자용 `views/elite.js`.

**Tech Stack:** Express 4 + better-sqlite3 + 순수 ES 모듈 프론트(PWA), 테스트 `node --test` (test/helper.js 의 makeApp/loginAs).

**Spec:** `docs/superpowers/specs/2026-10-24-elite-class-design.md`

**작업 위치:** EC2 `~/.openclaw/workspace/hawaii-tennis-club` (git 루트는 `~/.openclaw/workspace`). 테스트 `npm test`. 배포 `pm2 restart hawaii-tennis-club`.

**⚠ 이 코드베이스의 함정 (꼭 지킬 것)**
- node 스크립트로 파일을 고칠 때 `String.replace(a, b)`의 b 안 `$$`는 `$`가 된다 → Edit 도구나 `split/join`을 쓸 것.
- 프론트 경로는 전부 상대 경로(`api/...`). `test/i18n.test.js`가 강제한다. 화면에서 쓰는 `t('키')`와 index.html `data-i18n` 키는 모두 i18n.js `DICT.en`에 있어야 한다(같은 테스트).
- 화면 파일을 바꾸면 `public/sw.js`의 `CACHE` 번호를 올린다.
- 새 겹(body 직속 오버레이)을 만들면 `public/js/backnav.js` LAYERS 에 넣는다. 이번 작업은 기존 `openModal`(#modalRoot)만 쓴다.

---

## File Structure

| 파일 | 할 일 |
|---|---|
| `lib/db.js` (수정) | member 새 칸 6개, elite_* 테이블 4개, `elite_fee` 설정(기본 800000), `PROGRAMS` |
| `lib/auth.js` (수정) | req.me 에 program·elite_coach, `requireClub`·`requireEliteStaff`·`requireElite`·`isEliteStaff` |
| `lib/notify.js` (수정) | 동호인 대상 쿼리에 `program='club'`, `toElite`(선수+관리자)·`toElitePlayers` |
| `lib/jobs.js` (수정) | 동호인 회비 알림에 club 조건, 선수반 훈련 하루 전 18시·수강료 20일 10시 알림 |
| `lib/elite.js` (새) | 선수반 공용: `parseSession`, `eliteFeeOf`, `activePlayers` |
| `routes/elite-players.js` (새) | 선수 명단 CRUD·PIN 재설정, 선수반 코치 지정(오너) |
| `routes/elite-sessions.js` (새) | 훈련 CRUD·요일 반복 등록·출석 |
| `routes/elite-fees.js` (새) | 수강료 현황표·체크·내 수강료 |
| `routes/elite-notices.js` (새) | 선수반 공지 CRUD |
| `routes/events.js` (수정) | `expand` 내보내기(반복 등록 공용), requireClub |
| `routes/{dues,notices,posts,members,officers,chat}.js` (수정) | requireClub + club 조건 |
| `routes/settings.js` (수정) | `elite_fee` 저장(오너) |
| `routes/auth.js` (수정) | publicMe 에 program·elite_coach |
| `server.js`, `test/helper.js` (수정) | `/api/elite/*` 4개 마운트 |
| `public/index.html` (수정) | 선수용 탭 3개 + 관리자 Elite 탭, 메뉴 `club-only` |
| `public/js/app.js` (수정) | program 별 탭·첫 화면·메뉴, 선수는 회칙 동의·채팅 배지 건너뜀 |
| `public/js/views/elite-me.js` (새) | 선수 화면: Training · Fees · Notices |
| `public/js/views/elite.js` (새) | 관리자 Elite 탭: Players · Schedule · Attendance · Fees · Notices |
| `public/js/i18n.js`, `public/css/app.css`, `public/sw.js` (수정) | 문구·스타일·캐시 |
| `test/elite-*.test.js` (새 5개) | 벽·명단·일정/출석·수강료·공지/알림 |

---

### Task 1: DB — 새 칸·테이블·설정

**Files:**
- Modify: `lib/db.js` (DEFAULTS, migrate 의 member 칸 추가 블록 뒤, getSettings, exports)
- Test: `test/elite-db.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수반 DB — 새 칸·테이블·기본 수강료
const test = require('node:test');
const assert = require('node:assert');
const { makeApp } = require('./helper');

test('기존 회원은 program=club, 선수반 칸과 테이블이 생긴다', async () => {
  const app = makeApp();
  const cols = app.db.prepare('PRAGMA table_info(member)').all().map(c => c.name);
  for (const c of ['program', 'elite_coach', 'birth_year', 'parent_name', 'parent_phone', 'elite_fee', 'assigned_coach_id']) {
    assert.ok(cols.includes(c), c);
  }
  assert.strictEqual(app.db.prepare('SELECT program FROM member WHERE id=?').get(app.memberId).program, 'club');
  for (const t of ['elite_session', 'elite_attendance', 'elite_due', 'elite_notice']) {
    assert.ok(app.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
  }
  assert.throws(() => app.db.prepare("UPDATE member SET program='pro' WHERE id=?").run(app.memberId));
  app.close();
});

test('기본 선수반 수강료는 800,000₮', async () => {
  const app = makeApp();
  assert.strictEqual(app.dbmod.getSettings(app.db).elite_fee, 800000);
  app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/elite-db.test.js`
Expected: FAIL — `program` 칸 없음.

- [ ] **Step 3: Implement**

`DEFAULTS`에 `bank_holder` 다음 줄:
```js
  elite_fee: '800000',   // 엘리트선수반 기본 월 수강료 (선수별 금액이 없을 때)
```

`migrate`에서 `if (!mcols.includes('photo')) ...` 줄 바로 다음:
```js
  // 엘리트선수반 — 같은 회원 테이블에 program 으로 가른다. 기존 회원은 전부 'club'
  if (!mcols.includes('program')) db.exec("ALTER TABLE member ADD COLUMN program TEXT NOT NULL DEFAULT 'club' CHECK (program IN ('club','elite'))");
  if (!mcols.includes('elite_coach')) db.exec('ALTER TABLE member ADD COLUMN elite_coach INTEGER NOT NULL DEFAULT 0');   // 선수반 관리 권한 (오너가 줌)
  for (const [c, type] of [['birth_year', 'INTEGER'], ['parent_name', 'TEXT'], ['parent_phone', 'TEXT'], ['elite_fee', 'INTEGER'],
                           ['assigned_coach_id', 'INTEGER REFERENCES member(id) ON DELETE SET NULL']]) {
    if (!mcols.includes(c)) db.exec(`ALTER TABLE member ADD COLUMN ${c} ${type}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS elite_session (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      session_date TEXT NOT NULL,
      start_time   TEXT NOT NULL,
      end_time     TEXT NOT NULL,
      court        TEXT,
      coach_id     INTEGER REFERENCES member(id) ON DELETE SET NULL,
      memo         TEXT,
      reminded_at  TEXT,
      created_by   INTEGER REFERENCES member(id) ON DELETE SET NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_elite_session_date ON elite_session(session_date, start_time);
    CREATE TABLE IF NOT EXISTS elite_attendance (
      session_id INTEGER NOT NULL REFERENCES elite_session(id) ON DELETE CASCADE,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      status     TEXT NOT NULL CHECK (status IN ('present','absent')),
      checked_by INTEGER REFERENCES member(id) ON DELETE SET NULL,
      checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (session_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS elite_due (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
      period     TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      paid_at    TEXT,
      method     TEXT CHECK (method IN ('cash','transfer','qpay')),
      note       TEXT,
      updated_at TEXT,
      UNIQUE (member_id, period)
    );
    CREATE TABLE IF NOT EXISTS elite_notice (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      photo      TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES member(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT
    );
  `);
```

`getSettings` 반환 객체 끝에:
```js
    elite_fee: Number(out.elite_fee || DEFAULTS.elite_fee),
```

상단 상수 `DUE_KINDS` 다음 줄 `const PROGRAMS = ['club', 'elite'];`, exports 의 `DUE_KINDS,` 뒤에 `PROGRAMS,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/elite-db.test.js` → PASS. `npm test` → 기존 237 + 2 통과.

- [ ] **Step 5: Commit**

```bash
git add lib/db.js test/elite-db.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 DB — member.program·선수 칸, elite_* 테이블, 기본 수강료 800,000₮"
```

---

### Task 2: 권한 벽 — requireClub 과 club 조건

**Files:**
- Modify: `lib/auth.js:66,74-87`, `routes/auth.js` (publicMe), `lib/notify.js:45-53`, `lib/jobs.js` (remindDues 쿼리)
- Modify: `routes/{events,dues,notices,posts,members,officers,chat}.js` (router.use 줄 + 아래 조건)
- Create: `lib/elite.js`
- Test: `test/elite-wall.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수반 벽 — 선수 계정은 동호인 화면에 못 들어오고, 동호인 집계·알림에 안 섞인다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

// 선수 하나를 DB 에 바로 넣는다 (선수 등록 API 는 Task 3)
function addPlayer(app, phone = '77001122', name = 'Temuulen') {
  return app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, program)
                         VALUES (?,?,?,'member','advanced','active','2026-10-01','elite')`)
    .run(name, phone, app.dbmod.hashPin('2222')).lastInsertRowid;
}

test('선수 계정은 동호인 API 7곳에서 403, 내 정보·알림·설정·회칙은 된다', async () => {
  const app = makeApp();
  addPlayer(app);
  const p = await loginAs(app.base, '77001122', '2222');
  for (const path of ['/events', '/dues/me', '/notices', '/posts', '/members', '/officers', '/chat/rooms']) {
    assert.strictEqual((await p.call(path)).status, 403, path);
  }
  const me = (await p.call('/auth/me')).data.me;
  assert.strictEqual(me.program, 'elite');
  for (const path of ['/settings', '/docs/rules?lang=ko', '/push/status']) {
    assert.notStrictEqual((await p.call(path)).status, 403, path);
  }
  app.close();
});

test('선수는 동호인 명단·회비 현황표·미납자에 안 나온다', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.ok(!(await a.call('/members')).data.some(m => m.id === pid));
  assert.ok(!(await a.call('/dues/grid')).data.rows.some(r => r.member_id === pid));
  assert.ok(!(await a.call('/dues/unpaid')).data.rows.some(r => r.member_id === pid));
  app.close();
});

test('동호인 임원은 선수를 고치거나 PIN 을 바꾸거나 지울 수 없다 (404)', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  const a = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await a.call(`/members/${pid}`, { method: 'PATCH', body: { name: 'x' } })).status, 404);
  assert.strictEqual((await a.call(`/members/${pid}/pin`, { method: 'POST', body: { pin: '1234' } })).status, 404);
  assert.strictEqual((await a.call(`/members/${pid}`, { method: 'DELETE' })).status, 404);
  assert.strictEqual((await a.call('/dues/mark', { method: 'PUT', body: { member_id: pid, paid: true } })).status, 404);
  assert.strictEqual((await a.call('/chat/dm', { method: 'POST', body: { member_id: pid } })).status, 404);
  app.close();
});

test('동호인 공지 알림은 선수에게 안 간다', async () => {
  const app = makeApp();
  const pid = addPlayer(app);
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(pid, 'https://fcm/elite', 'k', 'a');
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(app.memberId, 'https://fcm/club', 'k', 'a');
  const a = await loginAs(app.base, '99000000', '1234');
  await a.call('/notices', { method: 'POST', body: { title: 'Club night', body: 'Friday' } });
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/club']);
  app.close();
});

module.exports = { addPlayer };
```

(push_sub 칸 이름은 `routes/push.js`의 INSERT 와 맞춘다 — 실행 전 `grep -n "INSERT INTO push_sub" routes/push.js` 로 확인.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/elite-wall.test.js` → FAIL (선수가 200을 받음, me.program undefined).

- [ ] **Step 3: Implement**

`lib/auth.js` attach 의 SELECT 칸 끝에 `, program, elite_coach` 추가. requireOwner 아래:
```js
  // 선수반 관리자 = 오너 또는 오너가 지정한 선수반 코치 (둘 다 동호인 계정)
  const isEliteStaff = (me) => !!me && me.program !== 'elite' && !!(me.is_owner || me.elite_coach);

  // 동호인 화면 — 선수반 계정(program='elite')은 들어오지 못한다
  const requireClub = (req, res, next) =>
    req.me ? (req.me.program === 'elite' ? res.status(403).json({ error: 'club_only' }) : next())
           : res.status(401).json({ error: 'login_required' });

  const requireEliteStaff = (req, res, next) =>
    req.me ? (isEliteStaff(req.me) ? next() : res.status(403).json({ error: 'elite_staff_only' }))
           : res.status(401).json({ error: 'login_required' });

  // 선수반 화면 — 선수 본인 또는 선수반 관리자
  const requireElite = (req, res, next) =>
    req.me ? ((req.me.program === 'elite' || isEliteStaff(req.me)) ? next() : res.status(403).json({ error: 'elite_only' }))
           : res.status(401).json({ error: 'login_required' });
```
return 객체에 `requireClub, requireEliteStaff, requireElite, isEliteStaff` 추가.

`routes/auth.js` publicMe 끝 줄을:
```js
  is_owner: !!m.is_owner, is_coach: !!m.is_coach, photo: m.photo || null,
  program: m.program || 'club', elite_coach: !!m.elite_coach,
```

`lib/notify.js`: activeMembers·admins 의 `WHERE status='active'` 를 `WHERE status='active' AND program='club'` 로. 그리고 admins 아래에:
```js
  // 선수반 — 활동 선수 / 선수반 관리자(오너·선수반 코치)
  const elitePlayers = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='elite'
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);
  const eliteStaff = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='club' AND (is_owner=1 OR elite_coach=1)
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);
```
return 에:
```js
    toElitePlayers: (payload, exclude = []) => sendTo(elitePlayers(exclude), payload).catch(() => ({ sent: 0, failed: 0 })),
    toElite: (payload, exclude = []) => sendTo([...elitePlayers(exclude), ...eliteStaff(exclude)], payload).catch(() => ({ sent: 0, failed: 0 })),
```

`lib/jobs.js` remindDues 쿼리 `WHERE m.status='active' AND` → `WHERE m.status='active' AND m.program='club' AND`.

7개 라우터의 `router.use(auth.requireMember);` → `router.use(auth.requireClub);` (events, dues, notices, posts, members, officers, chat).

`routes/members.js` — `router.use(auth.requireClub);` 바로 아래:
```js
  // :id 는 동호인 회원만 — 선수반 선수는 /api/elite/players 에서 다룬다
  router.param('id', (req, res, next, id) =>
    db.prepare("SELECT 1 FROM member WHERE id=? AND program='club'").get(id) ? next() : res.status(404).json({ error: 'not_found' }));
```
GET 의 `FROM member ORDER BY` → `FROM member WHERE program='club' ORDER BY`.

`routes/dues.js`: grid 쿼리 `WHERE status='active' ORDER BY name` → `WHERE status='active' AND program='club' ORDER BY name`; unpaid 쿼리 `WHERE m.status='active' AND` → `WHERE m.status='active' AND m.program='club' AND`; mark 의 `SELECT id FROM member WHERE id=?` → `SELECT id FROM member WHERE id=? AND program='club'`.

`routes/chat.js` dm: `"SELECT id FROM member WHERE id=? AND status='active'"` → `"SELECT id FROM member WHERE id=? AND status='active' AND program='club'"`.

`routes/officers.js:39` `'SELECT id FROM member WHERE id=?'` → `"SELECT id FROM member WHERE id=? AND program='club'"`.

`lib/elite.js` (새 파일, 이후 Task 들이 씀):
```js
// 선수반 공용 — 훈련 칸 검사, 선수별 수강료, 활동 선수 목록
const { getSettings } = require('./db');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseSession(b = {}) {
  const title = String(b.title || '').trim().slice(0, 80);
  const session_date = YMD.test(b.session_date || '') ? b.session_date : null;
  const start_time = HHMM.test(b.start_time || '') ? b.start_time : null;
  const end_time = HHMM.test(b.end_time || '') ? b.end_time : null;
  if (!title) return { error: 'title_required' };
  if (!session_date) return { error: 'bad_date' };
  if (!start_time || !end_time) return { error: 'bad_time' };
  if (end_time <= start_time) return { error: 'end_before_start' };
  const coach = Number(b.coach_id) || null;
  return {
    title, session_date, start_time, end_time,
    court: String(b.court || '').trim().slice(0, 40) || null,
    coach_id: coach,
    memo: String(b.memo || '').trim().slice(0, 500) || null,
  };
}

// 그 선수의 월 수강료 — 선수별 금액, 없으면 설정의 기본값
const eliteFeeOf = (db, m) => (m.elite_fee > 0 ? m.elite_fee : getSettings(db).elite_fee);

const activePlayers = (db) => db.prepare(`SELECT id, name, phone, level, birth_year, photo, elite_fee, assigned_coach_id
                                          FROM member WHERE program='elite' AND status='active' ORDER BY name`).all();

// 코치로 고를 수 있는 사람 = 오너 또는 선수반 코치
const isStaffId = (db, id) => !!db.prepare(
  "SELECT 1 FROM member WHERE id=? AND program='club' AND (is_owner=1 OR elite_coach=1)").get(id);

module.exports = { parseSession, eliteFeeOf, activePlayers, isStaffId, YMD, HHMM };
```

- [ ] **Step 4: Run tests**

Run: `node --test test/elite-wall.test.js` → PASS. `npm test` → 전부 통과 (기존 테스트는 전부 club 계정이라 영향 없어야 함).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.js lib/notify.js lib/jobs.js lib/elite.js routes test/elite-wall.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 벽 — requireClub, 동호인 명단·회비·알림·채팅·조직도에서 선수 제외"
```

---

### Task 3: 선수 명단 API + 선수반 코치 지정

**Files:**
- Create: `routes/elite-players.js`
- Modify: `server.js` (마운트), `test/helper.js` (마운트)
- Test: `test/elite-players.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수 명단 — 오너·선수반 코치만 관리, 동호인 임원은 403
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

const player = (over = {}) => ({ name: 'Temuulen', phone: '77001122', birth_year: 2011, level: 'advanced',
  parent_name: 'Bold', parent_phone: '99887766', elite_fee: 700000, ...over });

async function makeStaffCoach(app) {
  // 동호인 임원 하나 + 선수반 코치 하나 (오너가 지정)
  const owner = await loginAs(app.base, '99000000', '1234');
  const c = await owner.call('/members', { method: 'POST', body: { name: 'Coach B', phone: '88002233', pin: '3333' } });
  await owner.call(`/elite/coaches/${c.data.id}`, { method: 'PUT', body: { on: true } });
  return { owner, coachId: c.data.id, coach: await loginAs(app.base, '88002233', '3333') };
}

test('오너가 선수를 등록하면 선수는 그 번호와 PIN 으로 로그인한다', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  const r = await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) });
  assert.strictEqual(r.status, 200);
  const p = await loginAs(app.base, '77001122', '2222');
  assert.strictEqual((await p.call('/auth/me')).data.me.program, 'elite');
  const list = (await owner.call('/elite/players')).data;
  assert.deepStrictEqual([list.length, list[0].birth_year, list[0].parent_phone, list[0].elite_fee], [1, 2011, '99887766', 700000]);
  app.close();
});

test('PIN 을 비우면 번호 뒤 4자리, 동호인 회원 번호와 겹치면 409', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player() })).data.first_pin, '1122');
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player({ phone: '88110044' }) })).status, 409);
  assert.strictEqual((await owner.call('/elite/players', { method: 'POST', body: player({ phone: '12' }) })).status, 400);
  app.close();
});

test('동호인 임원·일반 회원·선수는 명단을 못 본다, 선수반 코치는 본다', async () => {
  const app = makeApp();
  const { owner, coach } = await makeStaffCoach(app);
  await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) });
  // 동호인 임원 (오너 아님, 선수반 코치 아님)
  const s = await owner.call('/members', { method: 'POST', body: { name: 'Secretary', phone: '88004455', pin: '4444' } });
  await owner.call(`/members/${s.data.id}`, { method: 'PATCH', body: { role: 'admin' } });
  const staff = await loginAs(app.base, '88004455', '4444');
  const member = await loginAs(app.base, '88110044', '1111');
  const p = await loginAs(app.base, '77001122', '2222');
  assert.strictEqual((await staff.call('/elite/players')).status, 403);
  assert.strictEqual((await member.call('/elite/players')).status, 403);
  assert.strictEqual((await p.call('/elite/players')).status, 403);
  assert.strictEqual((await coach.call('/elite/players')).status, 200);
  app.close();
});

test('선수반 코치 지정은 오너만, 선수에게는 못 준다', async () => {
  const app = makeApp();
  const { coach, coachId } = await makeStaffCoach(app);
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await coach.call(`/elite/coaches/${coachId}`, { method: 'PUT', body: { on: false } })).status, 403);
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player() })).data.id;
  assert.strictEqual((await owner.call(`/elite/coaches/${pid}`, { method: 'PUT', body: { on: true } })).status, 404);
  const staff = (await owner.call('/elite/staff')).data;
  assert.ok(staff.some(x => x.id === coachId) && staff.some(x => x.id === app.adminId));
  app.close();
});

test('선수 수정·탈퇴·PIN 재설정·삭제(사진 정리 포함)', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player() })).data.id;
  assert.strictEqual((await owner.call(`/elite/players/${pid}`, { method: 'PATCH', body: { elite_fee: '', status: 'dormant' } })).status, 200);
  const row = app.db.prepare('SELECT elite_fee, status FROM member WHERE id=?').get(pid);
  assert.deepStrictEqual([row.elite_fee, row.status], [null, 'dormant']);
  assert.strictEqual((await owner.call(`/elite/players/${pid}/pin`, { method: 'POST', body: { pin: '9999' } })).status, 200);
  assert.strictEqual((await owner.call(`/elite/players/${app.memberId}`, { method: 'PATCH', body: { name: 'x' } })).status, 404, '동호인 회원은 여기서 못 고친다');
  assert.strictEqual((await owner.call(`/elite/players/${pid}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) c FROM member WHERE id=?').get(pid).c, 0);
  app.close();
});

module.exports = { player, makeStaffCoach };
```

- [ ] **Step 2: Run** `node --test test/elite-players.test.js` → FAIL (404, 라우트 없음).

- [ ] **Step 3: Implement `routes/elite-players.js`**

```js
// 선수반 선수 명단 — 오너·선수반 코치가 관리한다. 선수(또는 부모)는 이 번호·PIN 으로 로그인해 선수반 화면만 본다.
const express = require('express');
const { hashPin, normalizePhone, validPhone, validPin, today, LEVELS } = require('../lib/db');
const { removePhoto, setMemberPhoto } = require('../lib/photos');
const { isStaffId } = require('../lib/elite');

const PLAYER_COLS = `id, name, phone, level, status, photo, birth_year, parent_name, parent_phone, elite_fee,
                     assigned_coach_id, joined_at, memo`;

module.exports = function elitePlayerRoutes(db, auth) {
  const router = express.Router();

  // 코치로 고를 수 있는 사람 (오너 + 선수반 코치) — 일정·명단의 담당 코치 칸
  router.get('/staff', auth.requireElite, (req, res) => {
    res.json(db.prepare(`SELECT id, name, photo, is_owner, elite_coach FROM member
                         WHERE program='club' AND status='active' AND (is_owner=1 OR elite_coach=1) ORDER BY is_owner DESC, name`).all());
  });

  // 선수반 코치 지정·해제 — 오너만, 동호인 계정에만
  router.put('/coaches/:id', auth.requireOwner, (req, res) => {
    const m = db.prepare("SELECT id, is_owner FROM member WHERE id=? AND program='club'").get(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    db.prepare('UPDATE member SET elite_coach=? WHERE id=?').run(req.body?.on ? 1 : 0, m.id);
    res.json({ ok: true });
  });

  router.use('/players', auth.requireEliteStaff);

  // :id 는 선수만
  router.param('pid', (req, res, next, id) =>
    db.prepare("SELECT 1 FROM member WHERE id=? AND program='elite'").get(id) ? next() : res.status(404).json({ error: 'not_found' }));

  router.get('/players', (req, res) => {
    res.json(db.prepare(`SELECT ${PLAYER_COLS} FROM member WHERE program='elite' ORDER BY status='dormant', name`).all());
  });

  router.post('/players', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40);
    const phone = normalizePhone(b.phone);
    const pin = String(b.pin || '').trim() || phone.slice(-4);
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    if (db.prepare('SELECT id FROM member WHERE phone=?').get(phone)) return res.status(409).json({ error: 'phone_taken' });
    const f = fields(db, b);
    if (f.error) return res.status(400).json({ error: f.error });
    const r = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at, program,
                                              birth_year, parent_name, parent_phone, elite_fee, assigned_coach_id, memo)
                          VALUES (?,?,?,'member',?,'active',?,'elite',?,?,?,?,?,?)`)
      .run(name, phone, hashPin(pin), f.level ?? 'beginner', today(),
           f.birth_year ?? null, f.parent_name ?? null, f.parent_phone ?? null, f.elite_fee ?? null, f.assigned_coach_id ?? null, f.memo ?? null);
    res.json({ ok: true, id: r.lastInsertRowid, first_pin: pin });
  });

  router.patch('/players/:pid', (req, res) => {
    const b = req.body || {};
    const f = fields(db, b);
    if (f.error) return res.status(400).json({ error: f.error });
    if ('name' in b) {
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'name_required' });
      f.name = name;
    }
    if ('phone' in b) {
      const phone = normalizePhone(b.phone);
      if (!validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
      if (db.prepare('SELECT id FROM member WHERE phone=? AND id<>?').get(phone, req.params.pid)) return res.status(409).json({ error: 'phone_taken' });
      f.phone = phone;
    }
    if ('status' in b) f.status = b.status === 'dormant' ? 'dormant' : 'active';
    const keys = Object.keys(f);
    if (!keys.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare(`UPDATE member SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => f[k]), req.params.pid);
    res.json({ ok: true });
  });

  router.post('/players/:pid/pin', (req, res) => {
    const pin = String(req.body?.pin || '');
    if (!validPin(pin)) return res.status(400).json({ error: 'pin_4_digits' });
    db.prepare('UPDATE member SET pin_hash=? WHERE id=?').run(hashPin(pin), req.params.pid);
    res.json({ ok: true });
  });

  router.put('/players/:pid/photo', (req, res) => {
    if (!req.body?.photo_data) return res.status(400).json({ error: 'bad_photo' });
    try { res.json({ ok: true, photo: setMemberPhoto(db, req.params.pid, req.body.photo_data) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // 삭제하면 출석·수강료 기록도 같이 사라진다(CASCADE). 기록을 남기려면 탈퇴(status=dormant)로.
  router.delete('/players/:pid', (req, res) => {
    const m = db.prepare('SELECT photo FROM member WHERE id=?').get(req.params.pid);
    db.prepare('DELETE FROM member WHERE id=?').run(req.params.pid);
    removePhoto(m.photo);
    res.json({ ok: true });
  });

  return router;
};

// 선택 칸들 — 보낸 것만 돌려준다. 빈 값은 NULL 로(선수별 수강료를 비우면 기본값을 쓴다)
function fields(db, b) {
  const f = {};
  if ('level' in b) { if (!LEVELS.includes(b.level)) return { error: 'bad_level' }; f.level = b.level; }
  if ('birth_year' in b) {
    const y = b.birth_year === '' || b.birth_year == null ? null : Number(b.birth_year);
    if (y !== null && !(Number.isInteger(y) && y >= 1940 && y <= 2030)) return { error: 'bad_birth_year' };
    f.birth_year = y;
  }
  for (const k of ['parent_name', 'memo']) if (k in b) f[k] = String(b[k] || '').trim().slice(0, 200) || null;
  if ('parent_phone' in b) f.parent_phone = normalizePhone(b.parent_phone) || null;
  if ('elite_fee' in b) {
    const n = b.elite_fee === '' || b.elite_fee == null ? null : Number(b.elite_fee);
    if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 100000000)) return { error: 'bad_elite_fee' };
    f.elite_fee = n === null ? null : Math.round(n);
  }
  if ('assigned_coach_id' in b) {
    const id = Number(b.assigned_coach_id) || null;
    if (id && !isStaffId(db, id)) return { error: 'bad_coach' };
    f.assigned_coach_id = id;
  }
  return f;
}
```

`server.js` 의 `/api/invite` 줄 아래와 `test/helper.js` 의 같은 자리에:
```js
app.use('/api/elite', require('./routes/elite-players')(db, auth));       // 엘리트선수반 — 명단·코치
```
(helper.js 는 `'../routes/elite-players'`.)

- [ ] **Step 4: Run** `node --test test/elite-players.test.js` → PASS, `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/elite-players.js server.js test/helper.js test/elite-players.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 명단 API — 오너·선수반 코치만, 선수 로그인 계정 생성, 코치 지정은 오너"
```

---

### Task 4: 훈련 일정 · 반복 등록 · 출석 API

**Files:**
- Create: `routes/elite-sessions.js`
- Modify: `routes/events.js` (끝에 `module.exports.expand = expand;`), `server.js`, `test/helper.js`
- Test: `test/elite-sessions.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수반 훈련 일정·출석
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-players.test');

const ses = (over = {}) => ({ title: 'Elite training', session_date: '2030-05-06', start_time: '16:00', end_time: '18:00', court: '1-2', ...over });

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) })).data.id;
  const p2 = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344', pin: '2222' }) })).data.id;
  return { owner, pid, p2, p: await loginAs(app.base, '77001122', '2222') };
}

test('관리자가 훈련을 만들고, 선수는 다가오는 훈련을 본다 (만들기는 못 함)', async () => {
  const app = makeApp();
  const { owner, p } = await setup(app);
  const r = await owner.call('/elite/sessions', { method: 'POST', body: ses({ coach_id: app.adminId }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await owner.call('/elite/sessions', { method: 'POST', body: ses({ end_time: '15:00' }) })).status, 400);
  assert.strictEqual((await owner.call('/elite/sessions', { method: 'POST', body: ses({ coach_id: app.memberId }) })).status, 400, '선수반 코치가 아니면 담당 불가');
  const list = (await p.call('/elite/sessions')).data;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].coach_name, '대표');
  assert.strictEqual((await p.call('/elite/sessions', { method: 'POST', body: ses() })).status, 403);
  app.close();
});

test('요일 반복 등록 — 같은 제목·날짜·시간은 건너뛰고 120개 제한', async () => {
  const app = makeApp();
  const { owner } = await setup(app);
  const body = { ...ses(), from: '2030-05-06', to: '2030-05-19', weekdays: [1, 3, 5] };   // 월수금 2주 = 6회
  const r1 = (await owner.call('/elite/sessions/bulk', { method: 'POST', body })).data;
  assert.deepStrictEqual([r1.count, r1.skipped], [6, 0]);
  const r2 = (await owner.call('/elite/sessions/bulk', { method: 'POST', body })).data;
  assert.deepStrictEqual([r2.count, r2.skipped], [0, 6]);
  const big = await owner.call('/elite/sessions/bulk', { method: 'POST', body: { ...body, to: '2031-12-31', weekdays: [0, 1, 2, 3, 4, 5, 6] } });
  assert.strictEqual(big.status, 400);
  app.close();
});

test('출석 — 관리자가 ✓/✗ 를 남기고 지울 수 있다, 선수는 내 출석만 본다', async () => {
  const app = makeApp();
  const { owner, pid, p2, p } = await setup(app);
  const sid = (await owner.call('/elite/sessions', { method: 'POST', body: ses() })).data.id;
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: pid, status: 'present' } });
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: p2, status: 'absent' } });
  const one = (await owner.call(`/elite/sessions/${sid}`)).data;
  assert.deepStrictEqual(one.roster.map(r => [r.name, r.status]), [['Anu', 'absent'], ['Temuulen', 'present']]);
  await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: p2, status: null } });
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`)).data.roster.find(r => r.id === p2).status, null);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: app.memberId, status: 'present' } })).status, 404);
  const mine = (await p.call('/elite/sessions')).data[0];
  assert.strictEqual(mine.my_status, 'present');
  assert.strictEqual((await p.call(`/elite/sessions/${sid}`)).status, 403, '선수는 다른 선수 출석 명단을 못 본다');
  app.close();
});

test('지난 훈련은 ?past=1, 수정·삭제는 관리자만', async () => {
  const app = makeApp();
  const { owner, p } = await setup(app);
  const sid = (await owner.call('/elite/sessions', { method: 'POST', body: ses({ session_date: '2020-01-06' }) })).data.id;
  assert.strictEqual((await p.call('/elite/sessions')).data.length, 0);
  assert.strictEqual((await p.call('/elite/sessions?past=1')).data.length, 1);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`, { method: 'PATCH', body: { court: '5' } })).status, 200);
  assert.strictEqual((await p.call(`/elite/sessions/${sid}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await owner.call(`/elite/sessions/${sid}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('새 훈련 알림은 선수에게 (동호인은 안 받음)', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(pid, 'https://fcm/elite', 'k', 'a');
  app.db.prepare("INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)").run(app.memberId, 'https://fcm/club', 'k', 'a');
  await owner.call('/elite/sessions', { method: 'POST', body: ses() });
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/elite']);
  app.close();
});
```

- [ ] **Step 2: Run** `node --test test/elite-sessions.test.js` → FAIL.

- [ ] **Step 3: Implement**

`routes/events.js` 맨 끝에 한 줄:
```js
module.exports.expand = expand;   // 선수반 반복 등록(routes/elite-sessions.js)도 같은 날짜 계산을 쓴다
```

`routes/elite-sessions.js`:
```js
// 선수반 훈련 일정·출석 — 관리(오너·선수반 코치), 선수는 다가오는 훈련과 내 출석만 본다.
const express = require('express');
const { today } = require('../lib/db');
const { parseSession, isStaffId, YMD } = require('../lib/elite');
const { expand } = require('./events');

const SELECT = `SELECT s.*, c.name AS coach_name FROM elite_session s LEFT JOIN member c ON c.id = s.coach_id`;
const md = (d) => d.slice(5).replace('-', '/');

module.exports = function eliteSessionRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireElite);

  const checkCoach = (s) => (s.coach_id && !isStaffId(db, s.coach_id) ? 'bad_coach' : null);
  const myStatus = db.prepare('SELECT status FROM elite_attendance WHERE session_id=? AND member_id=?');

  router.get('/', (req, res) => {
    const past = req.query.past === '1';
    const rows = past
      ? db.prepare(`${SELECT} WHERE s.session_date < ? ORDER BY s.session_date DESC, s.start_time DESC LIMIT 60`).all(today())
      : db.prepare(`${SELECT} WHERE s.session_date >= ? ORDER BY s.session_date, s.start_time LIMIT 200`).all(today());
    res.json(rows.map(s => ({ ...s, my_status: myStatus.get(s.id, req.me.id)?.status || null })));
  });

  // 하나 + 출석 명단(활동 선수 전원, 체크 안 했으면 null) — 관리자만
  router.get('/:id', auth.requireEliteStaff, (req, res) => {
    const s = db.prepare(`${SELECT} WHERE s.id=?`).get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const roster = db.prepare(`SELECT m.id, m.name, m.photo, a.status FROM member m
                               LEFT JOIN elite_attendance a ON a.member_id = m.id AND a.session_id = ?
                               WHERE m.program='elite' AND (m.status='active' OR a.status IS NOT NULL)
                               ORDER BY m.name`).all(s.id);
    res.json({ ...s, roster });
  });

  router.post('/', auth.requireEliteStaff, (req, res) => {
    const s = parseSession(req.body);
    if (s.error) return res.status(400).json({ error: s.error });
    const bad = checkCoach(s);
    if (bad) return res.status(400).json({ error: bad });
    const r = db.prepare(`INSERT INTO elite_session (title, session_date, start_time, end_time, court, coach_id, memo, created_by)
                          VALUES (?,?,?,?,?,?,?,?)`)
      .run(s.title, s.session_date, s.start_time, s.end_time, s.court, s.coach_id, s.memo, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid });
    notify?.toElitePlayers({ title: `🎾 ${s.title}`, body: `${md(s.session_date)} ${s.start_time}~${s.end_time}`, url: '#training' });
  });

  // 반복 등록 — 요일 + 기간 (동호인 일정 /events/bulk 와 같은 규칙)
  router.post('/bulk', auth.requireEliteStaff, (req, res) => {
    const b = req.body || {};
    const from = YMD.test(b.from || '') ? b.from : null;
    const to = YMD.test(b.to || '') ? b.to : null;
    if (!from || !to || to < from) return res.status(400).json({ error: 'bad_range' });
    const weekdays = [...new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!weekdays.length) return res.status(400).json({ error: 'weekdays_required' });
    const base = parseSession({ ...b, session_date: from });
    if (base.error) return res.status(400).json({ error: base.error });
    const bad = checkCoach(base);
    if (bad) return res.status(400).json({ error: bad });
    const dates = expand(from, to, weekdays);
    if (!dates.length) return res.status(400).json({ error: 'no_dates' });
    if (dates.length > 120) return res.status(400).json({ error: 'too_many_dates', count: dates.length });

    const dup = db.prepare('SELECT id FROM elite_session WHERE title=? AND session_date=? AND start_time=?');
    const ins = db.prepare(`INSERT INTO elite_session (title, session_date, start_time, end_time, court, coach_id, memo, created_by)
                            VALUES (?,?,?,?,?,?,?,?)`);
    const r = db.transaction(() => {
      const created = [];
      let skipped = 0;
      for (const d of dates) {
        if (dup.get(base.title, d, base.start_time)) { skipped += 1; continue; }
        ins.run(base.title, d, base.start_time, base.end_time, base.court, base.coach_id, base.memo, req.me.id);
        created.push(d);
      }
      return { created, skipped };
    })();
    res.json({ ok: true, count: r.created.length, skipped: r.skipped, dates: r.created });
    if (r.created.length) {
      notify?.toElitePlayers({
        title: `🎾 ${base.title}`,
        body: `${md(r.created[0])} ~ ${md(r.created[r.created.length - 1])} · ${r.created.length} sessions · ${base.start_time}`,
        url: '#training',
      });
    }
  });

  router.patch('/:id', auth.requireEliteStaff, (req, res) => {
    const cur = db.prepare('SELECT * FROM elite_session WHERE id=?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const s = parseSession({ ...cur, ...req.body });
    if (s.error) return res.status(400).json({ error: s.error });
    const bad = checkCoach(s);
    if (bad) return res.status(400).json({ error: bad });
    db.prepare(`UPDATE elite_session SET title=?, session_date=?, start_time=?, end_time=?, court=?, coach_id=?, memo=? WHERE id=?`)
      .run(s.title, s.session_date, s.start_time, s.end_time, s.court, s.coach_id, s.memo, cur.id);
    res.json({ ok: true });
  });

  router.delete('/:id', auth.requireEliteStaff, (req, res) => {
    const r = db.prepare('DELETE FROM elite_session WHERE id=?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // 출석 — status: 'present' | 'absent' | null(체크 지우기)
  router.put('/:id/attendance', auth.requireEliteStaff, (req, res) => {
    const s = db.prepare('SELECT id FROM elite_session WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const mid = Number(req.body?.member_id);
    if (!db.prepare("SELECT 1 FROM member WHERE id=? AND program='elite'").get(mid)) return res.status(404).json({ error: 'player_not_found' });
    const st = req.body?.status;
    if (st == null) db.prepare('DELETE FROM elite_attendance WHERE session_id=? AND member_id=?').run(s.id, mid);
    else if (st === 'present' || st === 'absent') {
      db.prepare(`INSERT INTO elite_attendance (session_id, member_id, status, checked_by) VALUES (?,?,?,?)
                  ON CONFLICT(session_id, member_id) DO UPDATE SET status=excluded.status, checked_by=excluded.checked_by,
                  checked_at=datetime('now','localtime')`).run(s.id, mid, st, req.me.id);
    } else return res.status(400).json({ error: 'bad_status' });
    res.json({ ok: true, status: st ?? null });
  });

  return router;
};
```

마운트 (`server.js`·`test/helper.js`, elite-players 줄 다음):
```js
app.use('/api/elite/sessions', require('./routes/elite-sessions')(db, auth, notify));
```

⚠ elite-players 라우터가 `/api/elite` 에 먼저 붙어 있다. `/api/elite/sessions` 는 elite-players 안에 해당 경로가 없으니 다음 라우터로 넘어간다 — 단, elite-players 의 `router.use('/players', ...)` 는 `/players` 로 시작할 때만 걸리므로 영향 없음. **sessions 를 elite-players 보다 먼저 마운트**해서 의도를 분명히 한다.

- [ ] **Step 4: Run** `node --test test/elite-sessions.test.js` → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/elite-sessions.js routes/events.js server.js test/helper.js test/elite-sessions.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 훈련 일정·요일 반복 등록·출석 API"
```

---

### Task 5: 수강료 API

**Files:**
- Create: `routes/elite-fees.js`
- Modify: `routes/settings.js` (elite_fee), `server.js`, `test/helper.js`
- Test: `test/elite-fees.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수반 수강료 — 선수별 금액(없으면 기본 800,000₮), 체크 시점 금액 고정, 선수는 내 것만
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-players.test');

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const a = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222', elite_fee: 700000 }) })).data.id;
  const b = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344', elite_fee: '' }) })).data.id;
  return { owner, a, b, p: await loginAs(app.base, '77001122', '2222') };
}

test('현황표 — 선수별 금액, 비운 선수는 기본 800,000₮', async () => {
  const app = makeApp();
  const { owner, a, b } = await setup(app);
  const g = (await owner.call('/elite/fees/grid?month=2030-05')).data;
  assert.strictEqual(g.default_fee, 800000);
  assert.strictEqual(g.due_day, 20);
  assert.strictEqual(g.rows.find(r => r.member_id === a).amount, 700000);
  assert.strictEqual(g.rows.find(r => r.member_id === b).amount, 800000);
  assert.deepStrictEqual([g.summary.players, g.summary.paid, g.summary.unpaid], [2, 0, 2]);
  app.close();
});

test('체크하면 그때 금액으로 고정 — 나중에 금액을 바꿔도 낸 기록은 그대로', async () => {
  const app = makeApp();
  const { owner, a } = await setup(app);
  const r = await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: true, method: 'transfer', paid_at: '2030-05-18' } });
  assert.deepStrictEqual([r.data.amount, r.data.method, r.data.paid_at], [700000, 'transfer', '2030-05-18']);
  await owner.call(`/elite/players/${a}`, { method: 'PATCH', body: { elite_fee: 900000 } });
  const row = (await owner.call('/elite/fees/grid?month=2030-05')).data.rows.find(x => x.member_id === a);
  assert.deepStrictEqual([row.amount, row.paid], [700000, true]);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: false } });
  assert.strictEqual((await owner.call('/elite/fees/grid?month=2030-05')).data.rows.find(x => x.member_id === a).paid, false);
  app.close();
});

test('선수는 내 수강료만 보고 체크는 못 한다, 동호인 회원은 403', async () => {
  const app = makeApp();
  const { owner, a, p } = await setup(app);
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, period: '2030-05', paid: true } });
  const me = (await p.call('/elite/fees/me')).data;
  assert.strictEqual(me.fee, 700000);
  assert.strictEqual(me.due_day, 20);
  assert.deepStrictEqual(me.rows.map(r => [r.period, r.amount, !!r.paid_at]), [['2030-05', 700000, true]]);
  assert.strictEqual((await p.call('/elite/fees/grid')).status, 403);
  assert.strictEqual((await p.call('/elite/fees/mark', { method: 'PUT', body: { member_id: a, paid: true } })).status, 403);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/elite/fees/me')).status, 403);
  app.close();
});

test('기본 수강료는 오너가 설정에서 바꾼다', async () => {
  const app = makeApp();
  const owner = await loginAs(app.base, '99000000', '1234');
  assert.strictEqual((await owner.call('/settings', { method: 'PUT', body: { elite_fee: 850000 } })).data.elite_fee, 850000);
  assert.strictEqual((await owner.call('/settings', { method: 'PUT', body: { elite_fee: -1 } })).status, 400);
  app.close();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`routes/settings.js` 의 `for (const k of ['monthly_fee', 'joining_fee'])` → `for (const k of ['monthly_fee', 'joining_fee', 'elite_fee'])`.

`routes/elite-fees.js`:
```js
// 선수반 수강료 — 매월 20일까지. 한 줄 = 선수 한 명의 한 달치. 줄은 체크할 때 그 시점 금액으로 만든다(지난 기록 불변).
const express = require('express');
const { getSettings, today, thisMonth, METHODS } = require('../lib/db');
const { eliteFeeOf } = require('../lib/elite');

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DUE_DAY = 20;

module.exports = function eliteFeeRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireElite);

  router.get('/me', (req, res) => {
    if (req.me.program !== 'elite') return res.status(403).json({ error: 'elite_only' });
    const m = db.prepare('SELECT elite_fee FROM member WHERE id=?').get(req.me.id);
    res.json({
      fee: eliteFeeOf(db, m), due_day: DUE_DAY, currency: getSettings(db).currency,
      rows: db.prepare('SELECT period, amount, paid_at, method FROM elite_due WHERE member_id=? ORDER BY period DESC').all(req.me.id),
    });
  });

  router.get('/grid', auth.requireEliteStaff, (req, res) => {
    const month = PERIOD.test(req.query.month || '') ? req.query.month : thisMonth();
    const s = getSettings(db);
    const players = db.prepare(`SELECT id, name, phone, photo, elite_fee FROM member
                                WHERE program='elite' AND status='active' ORDER BY name`).all();
    const dues = new Map(db.prepare('SELECT * FROM elite_due WHERE period=?').all(month).map(d => [d.member_id, d]));
    const rows = players.map(p => {
      const d = dues.get(p.id);
      return { member_id: p.id, name: p.name, phone: p.phone, photo: p.photo,
               amount: d ? d.amount : eliteFeeOf(db, p), paid: !!d?.paid_at, paid_at: d?.paid_at || null,
               method: d?.method || null, note: d?.note || null };
    });
    const paid = rows.filter(r => r.paid);
    res.json({
      month, currency: s.currency, default_fee: s.elite_fee, due_day: DUE_DAY, rows,
      summary: { players: rows.length, paid: paid.length, unpaid: rows.length - paid.length,
                 collected: paid.reduce((t, r) => t + r.amount, 0) },
    });
  });

  router.put('/mark', auth.requireEliteStaff, (req, res) => {
    const b = req.body || {};
    const p = db.prepare("SELECT id, elite_fee FROM member WHERE id=? AND program='elite'").get(Number(b.member_id));
    if (!p) return res.status(404).json({ error: 'player_not_found' });
    const period = PERIOD.test(b.period || '') ? b.period : thisMonth();
    const paid = !!b.paid;
    const method = METHODS.includes(b.method) ? b.method : (paid ? 'cash' : null);
    const paid_at = paid ? (/^\d{4}-\d{2}-\d{2}$/.test(b.paid_at || '') ? b.paid_at : today()) : null;
    const note = String(b.note || '').trim() || null;
    db.prepare(`INSERT INTO elite_due (member_id, period, amount, paid_at, method, note, updated_at)
                VALUES (?,?,?,?,?,?, datetime('now','localtime'))
                ON CONFLICT(member_id, period) DO UPDATE SET paid_at=excluded.paid_at, method=excluded.method,
                  note=COALESCE(excluded.note, elite_due.note), updated_at=excluded.updated_at`)
      .run(p.id, period, eliteFeeOf(db, p), paid_at, method, note);
    res.json({ ok: true, ...db.prepare('SELECT * FROM elite_due WHERE member_id=? AND period=?').get(p.id, period) });
  });

  return router;
};

module.exports.DUE_DAY = DUE_DAY;
```

마운트: `app.use('/api/elite/fees', require('./routes/elite-fees')(db, auth));` (sessions 줄 다음, elite-players 보다 앞).

- [ ] **Step 4: Run** → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/elite-fees.js routes/settings.js server.js test/helper.js test/elite-fees.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 수강료 API — 선수별 금액·기본 800,000₮·20일 납부, 선수는 내 것만"
```

---

### Task 6: 선수반 공지 API + 알림(하루 전·20일)

**Files:**
- Create: `routes/elite-notices.js`
- Modify: `lib/jobs.js` (remindEliteSessions·remindEliteFees, tick), `server.js`, `test/helper.js`
- Test: `test/elite-notices.test.js`

- [ ] **Step 1: Write the failing test**

```js
// 선수반 공지 + 자동 알림
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');
const { player } = require('./elite-players.test');
const { createJobs } = require('../lib/jobs');

const clock = (stamp) => () => new Date(stamp.replace(' ', 'T') + '+08:00');
const sub = (app, id, ep) => app.db.prepare('INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)').run(id, ep, 'k', 'a');

async function setup(app) {
  const owner = await loginAs(app.base, '99000000', '1234');
  const pid = (await owner.call('/elite/players', { method: 'POST', body: player({ pin: '2222' }) })).data.id;
  return { owner, pid, p: await loginAs(app.base, '77001122', '2222') };
}

test('공지 — 관리자가 쓰고 선수가 읽는다, 동호인은 403, 알림은 선수에게만', async () => {
  const app = makeApp();
  const { owner, pid, p } = await setup(app);
  sub(app, pid, 'https://fcm/elite');
  sub(app, app.memberId, 'https://fcm/club');
  const r = await owner.call('/elite/notices', { method: 'POST', body: { title: 'Camp', body: 'Bring rackets', pinned: true } });
  assert.strictEqual(r.status, 200);
  await app.settle();
  assert.deepStrictEqual(app.sent.map(s => s.endpoint), ['https://fcm/elite']);
  assert.strictEqual((await p.call('/elite/notices')).data[0].title, 'Camp');
  assert.strictEqual((await p.call('/elite/notices', { method: 'POST', body: { title: 'x', body: 'y' } })).status, 403);
  const m = await loginAs(app.base, '88110044', '1111');
  assert.strictEqual((await m.call('/elite/notices')).status, 403);
  assert.strictEqual((await owner.call(`/elite/notices/${r.data.id}`, { method: 'PATCH', body: { title: 'Camp 2' } })).status, 200);
  assert.strictEqual((await owner.call(`/elite/notices/${r.data.id}`, { method: 'DELETE' })).status, 200);
  app.close();
});

test('훈련 하루 전 18시 알림 — 선수에게 한 번만', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  sub(app, pid, 'https://fcm/elite');
  await owner.call('/elite/sessions', { method: 'POST', body: { title: 'Elite', session_date: '2030-05-07', start_time: '16:00', end_time: '18:00' } });
  await app.settle();
  app.sent.length = 0;
  let jobs = createJobs(app.db, app.notify, { now: clock('2030-05-06 17:00') });
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 0);
  jobs = createJobs(app.db, app.notify, { now: clock('2030-05-06 18:10') });
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 1);
  assert.strictEqual((await jobs.remindEliteSessions()).sent, 0);
  app.close();
});

test('수강료 알림 — 20일 10시부터, 안 낸 선수에게만, 한 달에 한 번', async () => {
  const app = makeApp();
  const { owner, pid } = await setup(app);
  const p2 = (await owner.call('/elite/players', { method: 'POST', body: player({ name: 'Anu', phone: '77003344' }) })).data.id;
  sub(app, pid, 'https://fcm/a');
  sub(app, p2, 'https://fcm/b');
  const month = app.dbmod.thisMonth();
  await owner.call('/elite/fees/mark', { method: 'PUT', body: { member_id: p2, period: month, paid: true } });
  let jobs = createJobs(app.db, app.notify, { now: clock(`${month}-19 10:30`) });
  assert.strictEqual((await jobs.remindEliteFees()).sent, 0);
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-20 10:30`) });
  const r = await jobs.remindEliteFees();
  assert.deepStrictEqual([r.unpaid, r.sent], [1, 1]);
  assert.strictEqual(app.sent[0].endpoint, 'https://fcm/a');
  assert.match(app.sent[0].payload.body, /800,000/);
  jobs = createJobs(app.db, app.notify, { now: clock(`${month}-21 10:30`) });
  assert.strictEqual((await jobs.remindEliteFees()).already, true);
  app.close();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`routes/elite-notices.js`:
```js
// 선수반 공지 — 오너·선수반 코치가 쓰고, 선수가 읽는다. 동호인 공지와 따로.
const express = require('express');
const { savePhoto, removePhoto } = require('../lib/photos');

module.exports = function eliteNoticeRoutes(db, auth, notify) {
  const router = express.Router();
  router.use(auth.requireElite);

  router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT n.*, m.name AS author FROM elite_notice n LEFT JOIN member m ON m.id = n.created_by
                         ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`).all());
  });

  router.post('/', auth.requireEliteStaff, (req, res) => {
    const b = parse(req.body);
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = null;
    try { photo = savePhoto(req.body?.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
    const r = db.prepare('INSERT INTO elite_notice (title, body, photo, pinned, created_by) VALUES (?,?,?,?,?)')
      .run(b.title, b.body, photo, b.pinned, req.me.id);
    res.json({ ok: true, id: r.lastInsertRowid, photo });
    notify?.toElite({ title: `📣 ${b.title}`, body: b.body.slice(0, 120), url: '#enotices' }, [req.me.id]);
  });

  router.patch('/:id', auth.requireEliteStaff, (req, res) => {
    const n = db.prepare('SELECT * FROM elite_notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    const b = parse({ ...n, ...req.body });
    if (b.error) return res.status(400).json({ error: b.error });
    let photo = n.photo;
    if (req.body?.photo_data) {
      try { photo = savePhoto(req.body.photo_data); } catch (e) { return res.status(400).json({ error: e.message }); }
      removePhoto(n.photo);
    } else if (req.body?.remove_photo) { removePhoto(n.photo); photo = null; }
    db.prepare(`UPDATE elite_notice SET title=?, body=?, photo=?, pinned=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title, b.body, photo, b.pinned, n.id);
    res.json({ ok: true, photo });
  });

  router.delete('/:id', auth.requireEliteStaff, (req, res) => {
    const n = db.prepare('SELECT * FROM elite_notice WHERE id=?').get(req.params.id);
    if (!n) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM elite_notice WHERE id=?').run(n.id);
    removePhoto(n.photo);
    res.json({ ok: true });
  });

  return router;
};

function parse(b = {}) {
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (!title) return { error: 'title_required' };
  if (!body) return { error: 'body_required' };
  return { title, body, pinned: b.pinned ? 1 : 0 };
}
```

`lib/jobs.js`: 상단 require 에 `const { eliteFeeOf } = require('./elite');` 추가. remindDues 다음에:
```js
  // 선수반 — 내일 훈련을 아직 안 알렸으면 선수에게
  async function remindEliteSessions() {
    const t = ubNow(now());
    if (t.hour < EVENT_HOUR) return { sent: 0 };
    const rows = db.prepare('SELECT * FROM elite_session WHERE session_date=? AND reminded_at IS NULL').all(addDays(t.date, 1));
    let sent = 0;
    for (const s of rows) {
      db.prepare('UPDATE elite_session SET reminded_at=? WHERE id=?').run(t.stamp, s.id);
      const r = await notify.toElitePlayers({
        title: `🎾 Tomorrow ${s.start_time} ${s.title}`,
        body: s.court ? `Court ${s.court}` : 'Elite training',
        url: '#training',
      });
      sent += r.sent;
    }
    return { sent, sessions: rows.length };
  }

  // 선수반 수강료 — 매월 20일 10시, 그 달 안 낸 선수에게만 (한 달에 한 번)
  async function remindEliteFees() {
    const t = ubNow(now());
    if (t.day < ELITE_DUE_DAY || t.hour < DUE_HOUR) return { sent: 0 };
    const month = thisMonth();
    const key = 'elite_due_reminder_month';
    if (db.prepare('SELECT v FROM setting WHERE k=?').get(key)?.v === month) return { sent: 0, already: true };
    db.prepare('INSERT INTO setting (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, month);
    const unpaid = db.prepare(`SELECT m.id, m.elite_fee FROM member m
                               LEFT JOIN elite_due d ON d.member_id=m.id AND d.period=?
                               WHERE m.program='elite' AND m.status='active' AND (d.id IS NULL OR d.paid_at IS NULL)`).all(month);
    let sent = 0;
    const { currency } = getSettings(db);
    for (const m of unpaid) {
      const r = await notify.toMembers([m.id], {
        title: '💳 Elite tuition',
        body: `This month's tuition ${eliteFeeOf(db, m).toLocaleString('en-US')}${currency} is not confirmed yet (due by the 20th)`,
        url: '#fees',
      });
      sent += r.sent;
    }
    return { sent, unpaid: unpaid.length };
  }
```
`DUE_DAY` 줄 아래 `const ELITE_DUE_DAY = opts.eliteDueDay ?? 20;   // 선수반 수강료 매월 20일`. tick 에 두 줄:
```js
    try { await remindEliteSessions(); } catch (e) { console.error('[jobs] 선수반 훈련 알림 실패:', e.message); }
    try { await remindEliteFees(); } catch (e) { console.error('[jobs] 선수반 수강료 알림 실패:', e.message); }
```
반환 객체에 `remindEliteSessions, remindEliteFees,` 추가.

⚠ `lib/elite.js` 가 `lib/db.js` 를 require 하고 jobs 도 db 를 require — 순환 없음.

마운트: `app.use('/api/elite/notices', require('./routes/elite-notices')(db, auth, notify));` (fees 줄 다음).

- [ ] **Step 4: Run** → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/elite-notices.js lib/jobs.js server.js test/helper.js test/elite-notices.test.js
git commit -m "feat(hawaii-tennis-club): 선수반 공지 API + 훈련 하루 전·20일 수강료 자동 알림"
```

---

### Task 7: 화면 — 선수 탭과 관리자 Elite 탭

**Files:**
- Modify: `public/index.html`, `public/js/app.js`, `public/js/i18n.js`, `public/css/app.css`, `public/sw.js`
- Create: `public/js/views/elite-me.js`, `public/js/views/elite.js`
- Test: `test/i18n.test.js`(기존 — 새 키 누락·절대경로를 잡는다), 헤드리스 확인(Task 8)

- [ ] **Step 1: index.html**

메뉴: `rulesBtn`·`inviteBtn`·`levelBtn` 에 `club-only` 클래스 추가.

탭바 `members` 버튼 다음에 (관리자 Elite 탭 + 선수 탭 3개):
```html
    <button data-tab="elite" class="elite-staff-only" hidden>
      <svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <span data-i18n="tabElite">Elite</span>
    </button>
    <button data-tab="training" class="elite-only" hidden>
      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>
      <span data-i18n="tabTraining">Training</span>
    </button>
    <button data-tab="fees" class="elite-only" hidden>
      <svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      <span data-i18n="tabFees">Fees</span>
    </button>
    <button data-tab="enotices" class="elite-only" hidden>
      <svg viewBox="0 0 24 24"><path d="M5 9v6h3l6 4V5L8 9H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M18 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      <span data-i18n="tabNotices">Notices</span>
    </button>
```
기존 동호인 탭 7개(`home`…`members`)에 `class="club-only"` 추가(home 은 `class="active club-only"`).

- [ ] **Step 2: app.js**

import 추가:
```js
import { renderTraining, renderMyFees, renderEliteNotices } from './views/elite-me.js';
import { renderElite } from './views/elite.js';
```
VIEWS 에:
```js
  elite: renderElite,        // 오너·선수반 코치
  training: renderTraining,  // 선수
  fees: renderMyFees,
  enotices: renderEliteNotices,
```
도우미 (VIEWS 아래):
```js
const isElite = () => state.me?.program === 'elite';
const isEliteStaff = () => !!state.me && !isElite() && !!(state.me.is_owner || state.me.elite_coach);
const homeTab = () => (isElite() ? 'training' : 'home');
// 계정 종류별로 들어갈 수 있는 탭 — 선수는 선수반 탭만, 동호인은 선수반 선수 탭 빼고
const ELITE_TABS = ['training', 'fees', 'enotices'];
const allowed = (tab) => (isElite() ? ELITE_TABS.includes(tab) : !ELITE_TABS.includes(tab) && (tab !== 'elite' || isEliteStaff()));
```
`fromHash` 마지막 줄 `return VIEWS[tab] ? tab : 'home';` → `return VIEWS[tab] && allowed(tab) ? tab : homeTab();`
`goTab` 첫 줄 → `state.tab = VIEWS[tab] && allowed(tab) ? tab : homeTab();`
`render` 의 `const view = VIEWS[state.tab] || renderHome;` 유지, `$('#backBtn').hidden = state.tab === 'home';` → `$('#backBtn').hidden = state.tab === homeTab();`
`updateChatBadge` 첫 줄 → `if (!state.me || isElite() || badgeBusy) return;`
`showApp` 의 `.owner-only` 줄 다음:
```js
  $$('.club-only').forEach(el => { el.hidden = isElite() || (el.classList.contains('owner-only') && !state.me.is_owner); });
  $$('.elite-only').forEach(el => { el.hidden = !isElite(); });
  $$('.elite-staff-only').forEach(el => { el.hidden = !isEliteStaff(); });
  document.body.classList.toggle('tabs-8', isEliteStaff());
```
(⚠ `.owner-only` 와 `.club-only` 가 함께 붙은 settingsBtn 은 위 식으로 둘 다 지킨다 — settingsBtn 에는 club-only 를 붙이지 않는다. 선수는 owner 가 아니므로 이미 숨겨진다.)
로그인 핸들러와 boot 의 `askAgreeIfNeeded(state);` → `if (!isElite()) askAgreeIfNeeded(state);`
`backBtn` 핸들러의 `'#home'`·`'home'` 을 `homeTab()` 으로:
```js
$('#backBtn').onclick = () => {
  if (navDepth > 0) return history.back();
  const h = homeTab();
  history.replaceState({ tab: h }, '', `#${h}`);
  state.tab = h;
  render();
};
```
settings 모달 fields 의 bank_holder 다음:
```js
      { name: 'elite_fee', label: `${t('eliteDefaultFee')} (${state.settings.currency})`, type: 'number', value: state.settings.elite_fee, min: 0 },
```

- [ ] **Step 3: views/elite-me.js (선수 화면)**

```js
// 선수(또는 부모) 화면 — 훈련 일정·내 수강료·선수반 공지. 동호인 화면은 서버가 막는다.
import { api, esc, avatar } from '../ui.js';
import { t, fmtMoney, methodLabel } from '../i18n.js';
import { bankCard, bindBankCopy } from './dues.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (d) => `${d.slice(5).replace('-', '/')} (${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;

export function sessionCard(s, extra = '') {
  return `
    <div class="card session-card" data-session="${s.id}">
      <div class="card-row">
        <div class="session-date"><b>${esc(dayLabel(s.session_date))}</b><span>${esc(s.start_time)}–${esc(s.end_time)}</span></div>
        <div style="flex:1;min-width:0">
          <h3>${esc(s.title)}</h3>
          <div class="meta">${[s.court && `${t('court')} ${s.court}`, s.coach_name && `${t('coach')} ${s.coach_name}`].filter(Boolean).map(esc).join(' · ')}</div>
          ${s.memo ? `<div class="memo">${esc(s.memo)}</div>` : ''}
        </div>
        ${extra}
      </div>
    </div>`;
}

const statusPill = (st) => st === 'present' ? `<span class="pill">✓ ${esc(t('present'))}</span>`
  : st === 'absent' ? `<span class="pill danger">✗ ${esc(t('absent'))}</span>` : '';

export async function renderTraining(el, state) {
  const past = state.trainingPast === true;
  const rows = await api(`/elite/sessions${past ? '?past=1' : ''}`);
  el.innerHTML = `
    <div class="seg" data-seg>
      <button type="button" data-past="0" class="${past ? '' : 'on'}">${esc(t('upcomingTab'))}</button>
      <button type="button" data-past="1" class="${past ? 'on' : ''}">${esc(t('pastTab'))}</button>
    </div>
    ${rows.length ? rows.map(s => sessionCard(s, past ? statusPill(s.my_status) : '')).join('')
      : `<div class="empty">${esc(t('noTraining'))}</div>`}`;
  el.querySelectorAll('[data-past]').forEach(b => b.onclick = () => { state.trainingPast = b.dataset.past === '1'; renderTraining(el, state); });
}

export async function renderMyFees(el, state) {
  const d = await api('/elite/fees/me');
  const cur = d.currency;
  const unpaid = d.rows.filter(r => !r.paid_at).length;
  el.innerHTML = `
    ${bankCard(state.settings, t('eliteFeeHead', { day: d.due_day }))}
    <div class="stat-row">
      <div class="stat"><b>${fmtMoney(d.fee)}</b><span>${esc(t('eliteMonthly'))} ${cur}</span></div>
      <div class="stat ${unpaid ? 'warn' : ''}"><b>${unpaid}</b><span>${esc(t('unpaid'))}</span></div>
    </div>
    <div class="section-head"><h2>${esc(t('myFees'))}</h2></div>
    ${d.rows.length ? `<div class="card">${d.rows.map(r => `
      <div class="member-row">
        <div class="who"><b>${esc(r.period)}</b>
          <small>${r.paid_at ? `${esc(r.paid_at)} · ${esc(methodLabel(r.method))}` : esc(t('unpaid'))}</small></div>
        <span class="pill ${r.paid_at ? '' : 'danger'}">${fmtMoney(r.amount)}${cur}</span>
      </div>`).join('')}</div>` : `<div class="empty">${esc(t('myDuesEmpty'))}</div>`}`;
  bindBankCopy(el);
}

export function noticeCard(n, canEdit) {
  return `
    <div class="card ${n.pinned ? 'pinned' : ''}">
      <div class="card-row">
        <div style="flex:1;min-width:0">
          <h3>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3>
          <div class="meta">${esc(n.author || '')} · ${esc(String(n.created_at).slice(0, 10))}</div>
        </div>
        ${canEdit ? `<button class="btn btn-sm" data-edit-enotice="${n.id}">✏️ ${esc(t('edit'))}</button>` : ''}
      </div>
      <div class="notice-body">${esc(n.body)}</div>
      ${n.photo ? `<img class="notice-photo" src="${esc(n.photo)}" data-view-photo="${esc(n.photo)}" alt="" loading="lazy">` : ''}
    </div>`;
}

export async function renderEliteNotices(el) {
  const rows = await api('/elite/notices');
  el.innerHTML = rows.length ? rows.map(n => noticeCard(n, false)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`;
}
```
(⚠ `noNotices`·`court`·`coach`·`edit`·`upcomingTab`·`pastTab`·`unpaid`·`myDuesEmpty` 키가 i18n 에 이미 있는지 `grep -n "noNotices\|court:\|edit:" public/js/i18n.js` 로 확인하고 없으면 Step 5 에 추가.)

- [ ] **Step 4: views/elite.js (관리자 Elite 탭)**

```js
// Elite 탭 — 오너·선수반 코치. 위쪽 칸: 선수 · 일정 · 출석 · 수강료 · 공지
import { api, esc, toast, openModal, errText, pickFacePhoto, pickPhoto, avatar, today, thisMonth, shiftMonth, $$ } from '../ui.js';
import { t, levelLabel, fmtMoney, fmtMonth, methodLabel } from '../i18n.js';
import { sessionCard, dayLabel, noticeCard } from './elite-me.js';

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
const SECTIONS = ['players', 'schedule', 'attendance', 'fees', 'notices'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function renderElite(el, state) {
  const sec = SECTIONS.includes(state.eliteSec) ? state.eliteSec : 'players';
  el.innerHTML = `
    <div class="seg elite-seg">${SECTIONS.map(s => `<button type="button" data-sec="${s}" class="${s === sec ? 'on' : ''}">${esc(t('elite_' + s))}</button>`).join('')}</div>
    <div data-body><div class="empty">${esc(t('loading'))}</div></div>`;
  $$('[data-sec]', el).forEach(b => b.onclick = () => { state.eliteSec = b.dataset.sec; renderElite(el, state); });
  const body = el.querySelector('[data-body]');
  const again = () => renderElite(el, state);
  const staff = await api('/elite/staff');
  await ({ players, schedule, attendance, fees, notices })[sec](body, state, staff, again);
}

// ---------- 선수 ----------
async function players(body, state, staff, again) {
  const list = await api('/elite/players');
  const cur = state.settings.currency;
  const coachName = (id) => staff.find(s => s.id === id)?.name || '';
  body.innerHTML = `
    <button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('elitePlayerNew'))}</button>
    <div class="card">${list.length ? list.map(p => `
      <div class="member-row" data-player="${p.id}" style="cursor:pointer">
        ${avatar(p.name, p.photo, p.status === 'dormant' ? 'dormant' : '')}
        <div class="who"><b>${esc(p.name)}${p.status === 'dormant' ? ` <span class="pill grey">${esc(t('stDormant'))}</span>` : ''}</b>
          <small>${esc([p.birth_year, levelLabel(p.level), coachName(p.assigned_coach_id), p.parent_phone && `☎ ${p.parent_phone}`].filter(Boolean).join(' · '))}</small></div>
        <span class="pill grey">${fmtMoney(p.elite_fee || state.settings.elite_fee)}${cur}</span>
      </div>`).join('') : `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}</div>
    ${state.me.is_owner ? `<div class="section-head"><h2>${esc(t('eliteCoaches'))}</h2></div>
      <div class="card">${staff.map(s => `<div class="member-row">${avatar(s.name, s.photo)}<div class="who"><b>${esc(s.name)}</b>
        <small>${esc(s.is_owner ? t('roleOwner') : t('eliteCoach'))}</small></div>
        ${s.is_owner ? '' : `<button class="btn btn-sm btn-danger" data-uncoach="${s.id}">${esc(t('eliteCoachRemove'))}</button>`}</div>`).join('')}</div>
      <button class="btn" style="width:100%;margin-top:8px" data-addcoach>+ ${esc(t('eliteCoachAdd'))}</button>` : ''}`;

  body.querySelector('[data-new]').onclick = () => playerForm(null, state, staff, again);
  $$('[data-player]', body).forEach(r => r.onclick = () => playerForm(list.find(p => String(p.id) === r.dataset.player), state, staff, again));
  $$('[data-uncoach]', body).forEach(b => b.onclick = async () => {
    await api(`/elite/coaches/${b.dataset.uncoach}`, { method: 'PUT', body: { on: false } });
    toast(t('saved')); again();
  });
  const add = body.querySelector('[data-addcoach]');
  if (add) add.onclick = async () => {
    const members = (await api('/members')).filter(m => m.status !== 'dormant' && !m.is_owner && !staff.some(s => s.id === m.id));
    openModal({
      title: t('eliteCoachAdd'),
      fields: [{ name: 'id', label: t('name'), type: 'select', value: members[0]?.id || '',
                 options: members.map(m => ({ value: m.id, label: m.name })) }],
      onSave: async (v) => {
        if (!v.id) return t('required');
        await api(`/elite/coaches/${v.id}`, { method: 'PUT', body: { on: true } });
        toast(t('saved')); again();
      },
    });
  };
}

function playerForm(p, state, staff, again) {
  const isNew = !p;
  const m = openModal({
    title: isNew ? t('elitePlayerNew') : t('elitePlayerEdit'),
    fields: [
      { name: 'name', label: t('name'), value: p?.name || '' },
      { name: 'phone', label: t('elitePhone'), type: 'tel', inputmode: 'numeric', maxlength: 15, value: p?.phone || '', placeholder: '99112233' },
      ...(isNew ? [{ name: 'pin', label: t('pin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '', placeholder: '1234' }] : []),
      { name: 'birth_year', label: t('eliteBirthYear'), type: 'number', value: p?.birth_year ?? '', min: 1940, max: 2030 },
      { name: 'level', label: t('level'), type: 'select', value: p?.level || 'intermediate', options: LEVELS.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'assigned_coach_id', label: t('eliteAssignedCoach'), type: 'select', value: p?.assigned_coach_id ?? '',
        options: [{ value: '', label: '—' }, ...staff.map(s => ({ value: s.id, label: s.name }))] },
      { name: 'parent_name', label: t('eliteParentName'), value: p?.parent_name || '' },
      { name: 'parent_phone', label: t('eliteParentPhone'), type: 'tel', inputmode: 'numeric', value: p?.parent_phone || '' },
      { name: 'elite_fee', label: `${t('eliteMonthly')} (${state.settings.currency}) — ${t('eliteFeeBlank', { fee: fmtMoney(state.settings.elite_fee) })}`, type: 'number', value: p?.elite_fee ?? '', min: 0 },
      ...(isNew ? [] : [{ name: 'status', label: t('status'), type: 'select', value: p.status,
        options: [{ value: 'active', label: t('stActive') }, { value: 'dormant', label: t('stDormant') }] }]),
      { name: 'memo', label: t('memo'), value: p?.memo || '' },
    ],
    extra: isNew ? `<div class="hint">${esc(t('elitePinHint'))}</div>`
      : `<div class="photo-edit">${avatar(p.name, p.photo, 'photo-preview')}<button type="button" class="btn btn-sm" data-photo>📷 ${esc(t('photoChoose'))}</button></div>
         <button type="button" class="btn btn-sm" style="width:100%;margin-top:4px" data-pin>${esc(t('resetPin'))}</button>`,
    onDelete: isNew ? null : async () => { await api(`/elite/players/${p.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); },
    onSave: async (v) => {
      if (!v.name) return t('required');
      if (isNew) {
        const r = await api('/elite/players', { method: 'POST', body: v });
        toast(t('firstPin', { pin: r.first_pin }));
      } else {
        await api(`/elite/players/${p.id}`, { method: 'PATCH', body: v });
        toast(t('saved'));
      }
      again();
    },
  });
  const photo = m.form.querySelector('[data-photo]');
  if (photo) photo.onclick = async () => {
    const data = await pickFacePhoto();
    if (!data) return;
    try { await api(`/elite/players/${p.id}/photo`, { method: 'PUT', body: { photo_data: data } }); } catch (e) { return toast(errText(e), true); }
    m.close(); toast(t('saved')); again();
  };
  const pin = m.form.querySelector('[data-pin]');
  if (pin) pin.onclick = () => {
    m.close();
    openModal({
      title: `${p.name} · ${t('resetPin')}`,
      fields: [{ name: 'pin', label: t('newPin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '' }],
      onSave: async (v) => {
        if (!/^\d{4}$/.test(v.pin)) return t('pin4');
        await api(`/elite/players/${p.id}/pin`, { method: 'POST', body: { pin: v.pin } });
        toast(t('pinChanged'));
      },
    });
  };
}

// ---------- 일정 ----------
async function schedule(body, state, staff, again) {
  const rows = await api('/elite/sessions');
  body.innerHTML = `
    <button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('eliteSessionNew'))}</button>
    ${rows.length ? rows.map(s => sessionCard(s, `<button class="btn btn-sm" data-edit="${s.id}">✏️</button>`)).join('')
      : `<div class="empty">${esc(t('noTraining'))}</div>`}`;
  body.querySelector('[data-new]').onclick = () => sessionForm(null, staff, again);
  $$('[data-edit]', body).forEach(b => b.onclick = () => sessionForm(rows.find(s => String(s.id) === b.dataset.edit), staff, again));
}

function sessionForm(s, staff, again) {
  const isNew = !s;
  const m = openModal({
    title: isNew ? t('eliteSessionNew') : t('eliteSessionEdit'),
    fields: [
      { name: 'title', label: t('title'), value: s?.title || 'Elite training' },
      { name: 'session_date', label: t('date'), type: 'date', value: s?.session_date || today() },
      { name: 'start_time', label: t('startTime'), type: 'time', value: s?.start_time || '16:00' },
      { name: 'end_time', label: t('endTime'), type: 'time', value: s?.end_time || '18:00' },
      { name: 'court', label: t('court'), value: s?.court || '' },
      { name: 'coach_id', label: t('coach'), type: 'select', value: s?.coach_id ?? '',
        options: [{ value: '', label: '—' }, ...staff.map(x => ({ value: x.id, label: x.name }))] },
      { name: 'memo', label: t('memo'), value: s?.memo || '' },
    ],
    extra: isNew ? `
      <label class="field" style="display:flex;align-items:center;gap:9px"><input type="checkbox" data-repeat style="width:20px;height:20px"><span style="margin:0">${esc(t('repeat'))}</span></label>
      <div data-repeat-box hidden>
        <div class="weekday-chips">${WEEK.map((w, i) => `<button type="button" class="chip" data-wd="${i}">${w}</button>`).join('')}</div>
        <label class="field"><span>${esc(t('repeatUntil'))}</span><input type="date" data-until></label>
      </div>` : '',
    onDelete: isNew ? null : async () => { await api(`/elite/sessions/${s.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); },
    onSave: async (v, form) => {
      const repeat = form.querySelector('[data-repeat]')?.checked;
      if (repeat) {
        const weekdays = [...form.querySelectorAll('[data-wd].on')].map(b => Number(b.dataset.wd));
        const r = await api('/elite/sessions/bulk', { method: 'POST', body: { ...v, from: v.session_date, to: form.querySelector('[data-until]').value, weekdays } });
        toast(t('repeatDone', { n: r.count }));
      } else if (isNew) {
        await api('/elite/sessions', { method: 'POST', body: v });
        toast(t('saved'));
      } else {
        await api(`/elite/sessions/${s.id}`, { method: 'PATCH', body: v });
        toast(t('saved'));
      }
      again();
    },
  });
  const rep = m.form.querySelector('[data-repeat]');
  if (rep) {
    const box = m.form.querySelector('[data-repeat-box]');
    rep.onchange = () => { box.hidden = !rep.checked; };
    $$('[data-wd]', m.form).forEach(b => b.onclick = () => b.classList.toggle('on'));
  }
}

// ---------- 출석 ----------
async function attendance(body, state, staff, again) {
  const past = await api('/elite/sessions?past=1');
  const up = await api('/elite/sessions');
  const list = [...up.filter(s => s.session_date === today()), ...past].slice(0, 30);
  const sid = Number(state.eliteSession) || list[0]?.id;
  if (!sid) { body.innerHTML = `<div class="empty">${esc(t('noTraining'))}</div>`; return; }
  const s = await api(`/elite/sessions/${sid}`);
  const n = (st) => s.roster.filter(r => r.status === st).length;
  body.innerHTML = `
    <label class="field"><span>${esc(t('eliteSessionPick'))}</span>
      <select data-pick>${list.map(x => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(dayLabel(x.session_date))} ${esc(x.start_time)} · ${esc(x.title)}</option>`).join('')}</select></label>
    <div class="stat-row">
      <div class="stat"><b>${n('present')}</b><span>${esc(t('present'))}</span></div>
      <div class="stat ${n('absent') ? 'warn' : ''}"><b>${n('absent')}</b><span>${esc(t('absent'))}</span></div>
      <div class="stat"><b>${s.roster.length - n('present') - n('absent')}</b><span>${esc(t('notChecked'))}</span></div>
    </div>
    <div class="card">${s.roster.map(r => `
      <div class="member-row">${avatar(r.name, r.photo)}<div class="who"><b>${esc(r.name)}</b></div>
        <button class="att-btn ${r.status === 'present' ? 'on' : ''}" data-att="${r.id}" data-st="present" aria-label="${esc(t('present'))}">✓</button>
        <button class="att-btn absent ${r.status === 'absent' ? 'on' : ''}" data-att="${r.id}" data-st="absent" aria-label="${esc(t('absent'))}">✗</button>
      </div>`).join('') || `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}</div>`;
  body.querySelector('[data-pick]').onchange = (e) => { state.eliteSession = Number(e.target.value); again(); };
  $$('[data-att]', body).forEach(b => b.onclick = async () => {
    const status = b.classList.contains('on') ? null : b.dataset.st;   // 같은 것을 다시 누르면 지운다
    await api(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: Number(b.dataset.att), status } });
    state.eliteSession = sid; again();
  });
}

// ---------- 수강료 ----------
async function fees(body, state, staff, again) {
  const month = state.eliteMonth || thisMonth();
  const g = await api(`/elite/fees/grid?month=${month}`);
  const cur = g.currency;
  body.innerHTML = `
    <div class="monthbar"><button data-mv="-1">‹</button><strong>${esc(fmtMonth(month))}</strong><button data-mv="1">›</button></div>
    <div class="stat-row">
      <div class="stat"><b>${g.summary.paid}/${g.summary.players}</b><span>${esc(t('paid'))}</span></div>
      <div class="stat ${g.summary.unpaid ? 'warn' : ''}"><b>${g.summary.unpaid}</b><span>${esc(t('unpaid'))}</span></div>
      <div class="stat"><b>${fmtMoney(g.summary.collected)}</b><span>${esc(t('collected'))} ${cur}</span></div>
    </div>
    <div class="hint">${esc(t('eliteDueHint', { day: g.due_day, fee: fmtMoney(g.default_fee) + cur }))}</div>
    <div class="card"><table class="table"><tbody>${g.rows.map(r => `
      <tr><td><div style="font-weight:600">${esc(r.name)}</div>
        <small style="color:var(--muted)">${r.paid ? `${esc(r.paid_at)} · ${esc(methodLabel(r.method))}` : esc(t('unpaid'))}</small></td>
      <td class="num">${fmtMoney(r.amount)}</td>
      <td><button class="check ${r.paid ? 'paid' : ''}" data-mark="${r.member_id}" data-paid="${r.paid ? 1 : 0}" data-name="${esc(r.name)}">✓</button></td></tr>`).join('')}
    </tbody></table>${g.rows.length ? '' : `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}</div>`;
  $$('[data-mv]', body).forEach(b => b.onclick = () => { state.eliteMonth = shiftMonth(month, Number(b.dataset.mv)); again(); });
  $$('[data-mark]', body).forEach(b => b.onclick = () => {
    const member_id = Number(b.dataset.mark);
    const paid = b.dataset.paid === '1';
    const m = openModal({
      title: `${b.dataset.name} · ${fmtMonth(month)}`,
      fields: [
        { name: 'paid_at', label: t('paidAt'), type: 'date', value: today() },
        { name: 'method', label: t('method'), type: 'select', value: 'transfer',
          options: [{ value: 'cash', label: t('cash') }, { value: 'transfer', label: t('transfer') }, { value: 'qpay', label: t('qpay') }] },
        { name: 'note', label: t('memo'), value: '' },
      ],
      extra: paid ? `<button type="button" class="btn btn-danger" style="width:100%;margin-top:4px" data-unpay>${esc(t('markUnpaid'))}</button>` : '',
      saveLabel: t('markPaid'),
      onSave: async (v) => { await api('/elite/fees/mark', { method: 'PUT', body: { member_id, period: month, paid: true, ...v } }); toast(t('saved')); again(); },
    });
    const un = m.form.querySelector('[data-unpay]');
    if (un) un.onclick = async () => { await api('/elite/fees/mark', { method: 'PUT', body: { member_id, period: month, paid: false } }); m.close(); toast(t('saved')); again(); };
  });
}

// ---------- 공지 ----------
async function notices(body, state, staff, again) {
  const rows = await api('/elite/notices');
  body.innerHTML = `
    <button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('newNotice'))}</button>
    ${rows.length ? rows.map(n => noticeCard(n, true)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`}`;
  body.querySelector('[data-new]').onclick = () => noticeForm(null, again);
  $$('[data-edit-enotice]', body).forEach(b => b.onclick = () => noticeForm(rows.find(n => String(n.id) === b.dataset.editEnotice), again));
}

function noticeForm(n, again) {
  let photo = null;
  const m = openModal({
    title: n ? t('editNotice') : t('newNotice'),
    fields: [
      { name: 'title', label: t('title'), value: n?.title || '' },
      { name: 'body', label: t('body'), type: 'textarea', value: n?.body || '' },
      { name: 'pinned', label: t('pinned'), type: 'checkbox', value: !!n?.pinned },
    ],
    extra: `<button type="button" class="btn btn-sm" data-photo>📷 ${esc(t('photoChoose'))}</button> <span class="hint" data-photo-note></span>`,
    onDelete: n ? async () => { await api(`/elite/notices/${n.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); } : null,
    onSave: async (v) => {
      if (!v.title || !v.body) return t('required');
      const body = { ...v, ...(photo ? { photo_data: photo } : {}) };
      if (n) await api(`/elite/notices/${n.id}`, { method: 'PATCH', body });
      else await api('/elite/notices', { method: 'POST', body });
      toast(t('saved')); again();
    },
  });
  m.form.querySelector('[data-photo]').onclick = async () => {
    photo = await pickPhoto();
    m.form.querySelector('[data-photo-note]').textContent = photo ? '✓' : '';
  };
}
```
(⚠ `today`, `thisMonth`, `shiftMonth` 은 ui.js 에서 export 되는지 확인: `grep -n "export function today\|export const today\|thisMonth\|shiftMonth" public/js/ui.js`. dues.js 가 `thisMonth, shiftMonth` 를 ui.js 에서 가져오고 members.js 가 `today` 를 가져오므로 있다.
`newNotice`·`editNotice`·`title`·`body`·`pinned`·`date`·`startTime`·`endTime`·`repeat`·`repeatDone` 등 기존 키 이름은 notices.js·schedule.js 에서 쓰는 키를 `grep -o "t('[a-zA-Z]*')" public/js/views/notices.js public/js/views/schedule.js | sort -u` 로 확인해 그 이름을 쓴다. 다르면 이 파일을 기존 이름에 맞춘다.)

- [ ] **Step 5: i18n.js — 새 키 (DICT.en)**

```js
    tabElite: 'Elite', tabTraining: 'Training', tabFees: 'Fees',
    elite_players: 'Players', elite_schedule: 'Schedule', elite_attendance: 'Attendance', elite_fees: 'Fees', elite_notices: 'Notices',
    elitePlayerNew: 'Add player', elitePlayerEdit: 'Edit player', elitePlayersEmpty: 'No players yet',
    elitePhone: 'Phone (parent\'s for juniors)', eliteBirthYear: 'Birth year', eliteAssignedCoach: 'Coach',
    eliteParentName: 'Parent name', eliteParentPhone: 'Parent phone', eliteMonthly: 'Monthly tuition',
    eliteFeeBlank: 'blank = {fee}', elitePinHint: 'Leave PIN blank to use the last 4 digits of the phone. The player (or parent) logs in with this phone and PIN.',
    eliteCoaches: 'Elite coaches', eliteCoach: 'Elite coach', eliteCoachAdd: 'Add elite coach', eliteCoachRemove: 'Remove',
    eliteSessionNew: 'Add training', eliteSessionEdit: 'Edit training', eliteSessionPick: 'Training',
    noTraining: 'No training scheduled', present: 'Present', absent: 'Absent', notChecked: 'Not checked',
    eliteFeeHead: 'Elite tuition — pay by the {day}th of each month', myFees: 'My tuition',
    eliteDueHint: 'Due by the {day}th · default {fee}', eliteDefaultFee: 'Elite default tuition', repeatUntil: 'Until',
```
(이미 있는 키와 이름이 겹치면 새 이름을 쓴다 — `node --test test/i18n.test.js` 가 누락을 잡는다.)

- [ ] **Step 6: css (app.css 끝)**

```css
/* 엘리트선수반 */
.elite-seg { overflow-x: auto; flex-wrap: nowrap; }
.elite-seg button { white-space: nowrap; }
.session-card .session-date { display: flex; flex-direction: column; min-width: 74px; }
.session-card .session-date b { font-size: 14px; }
.session-card .session-date span { font-size: 12.5px; color: var(--muted); }
.att-btn { width: 40px; height: 36px; border-radius: 10px; border: 1px solid var(--line, #dfe7e2); background: #fff; font-size: 17px; cursor: pointer; color: var(--muted); }
.att-btn.on { background: var(--court); border-color: var(--court); color: #fff; }
.att-btn.absent.on { background: var(--danger); border-color: var(--danger); }
.weekday-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; }
.weekday-chips .chip { padding: 7px 10px; border-radius: 999px; border: 1px solid var(--line, #dfe7e2); background: #fff; cursor: pointer; }
.weekday-chips .chip.on { background: var(--court); color: #fff; border-color: var(--court); }
body.tabs-8 .tabbar button span { font-size: 9.5px; }
```

- [ ] **Step 7: sw.js `CACHE` +1** (`htc-shell-v33` → `htc-shell-v34`). SHELL 목록이 화면 파일을 나열하면 `js/views/elite.js`, `js/views/elite-me.js` 추가 (`grep -n "views/" public/sw.js` 로 확인).

- [ ] **Step 8: Run** `for f in public/js/*.js public/js/views/*.js; do node --check $f; done` 와 `npm test` (i18n 테스트 포함) → 전부 통과.

- [ ] **Step 9: Commit**

```bash
git add public test
git commit -m "feat(hawaii-tennis-club): 선수반 화면 — 선수 Training·Fees·Notices, 관리자 Elite 탭(선수·일정·출석·수강료·공지)"
```

---

### Task 8: 헤드리스 확인 → 배포

- [ ] **Step 1:** EC2 임시 인스턴스 `DB_PATH=/tmp/htc-ui/club.db PORT=6099 node server.js` (백그라운드), 관리자 회칙 동의 칸 채우기(`UPDATE member SET rules_agreed_at=datetime(), rules_version=(SELECT MAX(version) FROM doc WHERE key='rules')`).
- [ ] **Step 2:** ssh -L 6099 터널 + 헤드리스 Edge(CDP 9333). 시나리오 (부팅은 3초 이상 기다림, 해시만 바꾼 navigate 는 새로고침 아님):
  1. 오너 로그인 → Elite 탭 보임 → 선수 2명 추가 → 일정 반복 등록(월수금 2주) → 출석 ✓/✗ → 수강료 체크 → 공지 작성. 각 화면 스크린샷.
  2. 선수 로그인 → 하단 탭 3개만 보이는지, Training/Fees(계좌 카드 "pay by the 20th")/Notices 스크린샷, 콘솔 오류 없음, `#members` 로 들어가도 Training 으로 돌아오는지.
  3. 일반 동호인 회원 로그인 → Elite 탭 안 보임.
- [ ] **Step 3:** 정리 — 임시 인스턴스는 `kill $(lsof -t -i:6099)`(⚠ `pkill -f PORT=6099` 금지), `/tmp/htc-ui` 삭제, 테스트로 운영 `uploads/`에 생긴 파일 삭제, Edge·터널 종료.
- [ ] **Step 4:** `npm test` 전부 통과 확인 → `pm2 restart hawaii-tennis-club` → `curl https://app.hawaiigroup.co/booking/api/health` 200, 운영 DB 에 `member.program` 칸 생겼는지, 기존 회원 전부 `club` 인지 확인.
- [ ] **Step 5:** 메모리 업데이트(hawaii_tennis_club_app.md), 사장님께 보고: 사용법(선수 등록 → 선수에게 번호·PIN 전달 → 선수반 코치 지정).
