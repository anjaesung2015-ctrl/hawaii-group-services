# 심플 업무보고 시스템 재구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** staff-manager를 오늘/내일(체크박스+메모) + 주/월/년(자유메모) 단순 업무보고 앱으로 재구축한다. **매니저/총매니저만 사용**(코치·일반직원 제외), PIN 완전 제거. court-booking/POS/비서가 의존하는 SSO·staff/users 테이블·로그인 경로는 보존한다.

**Architecture:** 기존 slim server.js는 SSO용 `/api/login`만 남기고 새 `report-simple.js` 라우터를 마운트. 새 프론트(index.html + app.js)는 이름-선택/사장님-비번 로그인으로 `report_sess` 쿠키만 발급하며, court-booking/POS가 쓰는 `staff_token`은 전용 `login.html`(기존 username/password SSO)에서만 발급한다. 데이터는 새 `report_items` 테이블 하나.

**Tech Stack:** Node.js 20 + Express 4, better-sqlite3 11, jsonwebtoken, cookie-parser, bcryptjs (모두 이미 설치됨). 테스트는 의존성 없는 `node:test` + 내장 `fetch`.

**작업 위치:** EC2 `~/.openclaw/workspace/staff-manager` (git 루트는 `~/.openclaw/workspace`, 브랜치 main). SSH: `ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@<IP>` (최근 IP 3.93.96.130).

**절대 보존 (다른 서비스 의존):**
- `staff.db`의 `staff`(19행)·`users`(4행) 테이블 — POS·ceo-secretary가 파일 직접 read
- `/api/login` (username/password → `staff_token` JWT, payload `{id,username,name,role,staff_id}`, 서명키 `STAFF_MGR_SECRET` 기본값 `'staff-mgr-2026-secret'`) — court-booking/POS SSO 검증
- `staff_token` 쿠키 형식: `path=/;max-age=2592000;SameSite=Lax` + `staff_user` JSON 쿠키
- `/staff-manager/login` 경로 — court-booking 미로그인 리다이렉트 대상
- ⚠️ `STAFF_MGR_SECRET`는 `.env`에 넣지 말 것. staff-manager와 court-booking 둘 다 기본값 fallback을 쓰므로 값을 세팅하면 서명 불일치로 SSO가 깨진다.

---

## File Structure

| 파일 | 역할 | 처리 |
|---|---|---|
| `report-simple.js` | 새 업무보고 라우터 팩토리 `createReportRoutes(db, opts)` | 생성 |
| `test/report-simple.test.js` | 라우터 단위 테스트 (node:test, in-memory DB) | 생성 |
| `public/login.html` | SSO 로그인 폼(username/password → staff_token). court-booking 리다이렉트용 | 생성 |
| `public/index.html` | 새 업무보고 단일 페이지 (마크업+스타일) | 덮어쓰기 (기존 백업) |
| `public/app.js` | 프론트 로직 (탭/항목/로그인) | 생성 |
| `server.js` | slim 재작성: `/api/login` 보존 + `/login` 라우트 + report 라우터 마운트 | 덮어쓰기 (기존 백업) |
| `migrate_report_items.js` | `report_items` 테이블 생성 + staff.db 백업 | 생성 |
| `.env` | `BOSS_REPORT_PW` 추가 | 수정 |
| 기존 `report-routes.js`, 옛 index.html 등 | `*.bak-simple-20260806`로 백업 후 미참조 | 백업 |

---

## Task 1: 백업 + report_items 마이그레이션

**Files:**
- Create: `staff-manager/migrate_report_items.js`
- Backup: `staff-manager/staff.db` → `staff.db.bak-simple-20260806`

- [ ] **Step 1: staff.db와 교체 대상 파일 백업**

```bash
cd ~/.openclaw/workspace/staff-manager
cp staff.db staff.db.bak-simple-20260806
cp server.js server.js.bak-simple-20260806
cp public/index.html public/index.html.bak-simple-20260806
echo "backup done"; ls -la *.bak-simple-20260806 public/*.bak-simple-20260806
```

Expected: 3개 백업 파일 생성 확인.

- [ ] **Step 2: 마이그레이션 스크립트 작성**

Create `migrate_report_items.js`:

```js
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  item_date TEXT NOT NULL,
  title TEXT,
  memo TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
)`);

const cols = db.prepare("PRAGMA table_info(report_items)").all().map(c => c.name);
console.log('report_items columns:', cols.join(','));
console.log('staff count:', db.prepare("SELECT COUNT(*) c FROM staff WHERE is_active=1").get().c);
```

- [ ] **Step 3: 마이그레이션 실행**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node migrate_report_items.js
```
Expected 출력:
```
report_items columns: id,staff_id,period,item_date,title,memo,done,created_at,updated_at
staff count: 19
```

- [ ] **Step 4: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/migrate_report_items.js && \
git commit -m "feat(staff-manager): report_items 테이블 마이그레이션 + 백업"
```

---

## Task 2: report-simple.js — 로그인/세션

**Files:**
- Create: `staff-manager/report-simple.js`
- Test: `staff-manager/test/report-simple.test.js`

- [ ] **Step 1: 테스트 작성 (로그인/세션)**

Create `test/report-simple.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const createReportRoutes = require('../report-simple');

const SECRET = 'test-secret';
const BOSS = 'boss123';

function makeServer() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1)`);
  db.prepare("INSERT INTO staff (name, role) VALUES ('미가','총매니저'),('바트','매니저'),('코치김','코치'),('직원박','직원')").run();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report`;
  return { db, server, base };
}

// set-cookie 캡처 헬퍼
function cookieOf(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/report_sess=([^;]+)/);
  return m ? `report_sess=${m[1]}` : '';
}

test('staff-list는 매니저/총매니저만 반환(코치·직원 제외)', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/staff-list`);
  const list = await res.json();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(list.map(s => s.name).sort(), ['미가','바트']);
  server.close();
});

test('직원 이름 로그인 성공 → report_sess 쿠키 발급', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'미가' }) });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, false);
  assert.strictEqual(body.name, '미가');
  assert.match(res.headers.get('set-cookie') || '', /report_sess=/);
  server.close();
});

test('없는 직원 로그인 → 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'없는사람' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('매니저가 아닌 직원(코치) 이름 로그인 → 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'코치김' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test('사장님 비번 로그인 성공 → isBoss true', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ boss_pw: BOSS }) });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.isBoss, true);
  server.close();
});

test('사장님 비번 틀림 → 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ boss_pw: 'wrong' }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

module.exports = { makeServer, cookieOf, SECRET, BOSS };
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node --test test/ 2>&1 | tail -15
```
Expected: FAIL — `Cannot find module '../report-simple'`.

- [ ] **Step 3: report-simple.js 최소 구현 (로그인 부분)**

Create `report-simple.js`:

```js
const express = require('express');
const jwt = require('jsonwebtoken');

const PERIODS = ['today', 'tomorrow', 'week', 'month', 'year'];

module.exports = function createReportRoutes(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const bossPw = opts.bossPw || '';
  const MANAGER_ROLES = opts.managerRoles || ['매니저', '총매니저']; // 매니저/총매니저만 사용
  const roleIn = MANAGER_ROLES.map(() => '?').join(',');
  const router = express.Router();

  db.exec(`CREATE TABLE IF NOT EXISTS report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    item_date TEXT NOT NULL,
    title TEXT,
    memo TEXT,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);

  const COOKIE = { path: '/staff-manager', maxAge: 2592000000, sameSite: 'Lax', httpOnly: true };

  router.get('/staff-list', (req, res) => {
    res.json(db.prepare(`SELECT id, name FROM staff WHERE is_active=1 AND role IN (${roleIn}) ORDER BY name`).all(...MANAGER_ROLES));
  });

  router.post('/login', (req, res) => {
    const { name, boss_pw } = req.body || {};
    if (boss_pw !== undefined) {
      if (!bossPw || boss_pw !== bossPw) return res.status(401).json({ error: 'bad_password' });
      const token = jwt.sign({ isBoss: true }, secret, { expiresIn: '30d' });
      res.cookie('report_sess', token, COOKIE);
      return res.json({ ok: true, isBoss: true });
    }
    const st = db.prepare(`SELECT id, name FROM staff WHERE name=? AND is_active=1 AND role IN (${roleIn})`).get(name, ...MANAGER_ROLES);
    if (!st) return res.status(401).json({ error: 'unknown_staff' });
    const token = jwt.sign({ staff_id: st.id, name: st.name, isBoss: false }, secret, { expiresIn: '30d' });
    res.cookie('report_sess', token, COOKIE);
    res.json({ ok: true, isBoss: false, staff_id: st.id, name: st.name });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('report_sess', { path: '/staff-manager' });
    res.json({ ok: true });
  });

  function requireSess(req, res, next) {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  }

  function targetStaffId(req, provided) {
    if (req.rsess.isBoss) return provided ? Number(provided) : null;
    return req.rsess.staff_id;
  }

  router.use(requireSess);

  // items routes added in Task 3

  return router;
};
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node --test test/ 2>&1 | tail -15
```
Expected: 6 tests PASS (staff-list 필터, 이름 로그인, 없는 직원 401, 코치 401, 사장님 성공, 사장님 401).

- [ ] **Step 5: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/report-simple.js staff-manager/test/report-simple.test.js && \
git commit -m "feat(staff-manager): report-simple 로그인/세션 + 테스트"
```

---

## Task 3: report-simple.js — 항목 CRUD

**Files:**
- Modify: `staff-manager/report-simple.js` (requireSess 뒤에 items 라우트 추가)
- Test: `staff-manager/test/report-simple.test.js` (테스트 추가)

- [ ] **Step 1: 항목 CRUD 테스트 추가**

`test/report-simple.test.js` 하단(`module.exports` 위)에 추가:

```js
// staff_id로 서명한 report_sess 쿠키 생성 (login 우회)
const jwt = require('jsonwebtoken');
function staffCookie(staff_id, name) {
  return 'report_sess=' + jwt.sign({ staff_id, name, isBoss: false }, SECRET, { expiresIn: '1d' });
}
function bossCookie() {
  return 'report_sess=' + jwt.sign({ isBoss: true }, SECRET, { expiresIn: '1d' });
}

test('세션 없으면 items 조회 401', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/items?period=today&date=2026-08-06`);
  assert.strictEqual(res.status, 401);
  server.close();
});

test('직원: 항목 추가 후 조회하면 나온다', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'코트 청소', memo:'' }) });
  assert.strictEqual(post.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers:{ cookie } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '코트 청소');
  assert.strictEqual(items[0].staff_id, 1);
  server.close();
});

test('직원: done 토글 PATCH', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'레슨' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 200);
  const get = await fetch(`${base}/items?period=today&date=2026-08-06`, { headers:{ cookie } });
  const items = await get.json();
  assert.strictEqual(items[0].done, 1);
  server.close();
});

test('직원은 남의 항목 수정 불가 403', async () => {
  const { server, base } = makeServer();
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'내꺼' }) });
  const { id } = await post.json();
  const patch = await fetch(`${base}/items/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json', cookie: staffCookie(2,'바트')}, body: JSON.stringify({ done: true }) });
  assert.strictEqual(patch.status, 403);
  server.close();
});

test('사장님은 특정 직원 항목 조회 가능', async () => {
  const { server, base } = makeServer();
  await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'today', item_date:'2026-08-06', title:'미가일' }) });
  const get = await fetch(`${base}/items?staff_id=1&period=today&date=2026-08-06`, { headers:{ cookie: bossCookie() } });
  const items = await get.json();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, '미가일');
  server.close();
});

test('잘못된 period → 400', async () => {
  const { server, base } = makeServer();
  const res = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie: staffCookie(1,'미가')}, body: JSON.stringify({ period:'decade', item_date:'2026-08-06', title:'x' }) });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('직원: 항목 삭제', async () => {
  const { server, base } = makeServer();
  const cookie = staffCookie(1, '미가');
  const post = await fetch(`${base}/items`, { method:'POST', headers:{'Content-Type':'application/json', cookie}, body: JSON.stringify({ period:'week', item_date:'2026-08-03', memo:'주간목표' }) });
  const { id } = await post.json();
  const del = await fetch(`${base}/items/${id}`, { method:'DELETE', headers:{ cookie } });
  assert.strictEqual(del.status, 200);
  const get = await fetch(`${base}/items?period=week&date=2026-08-03`, { headers:{ cookie } });
  assert.strictEqual((await get.json()).length, 0);
  server.close();
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node --test test/ 2>&1 | tail -20
```
Expected: 새 테스트들 FAIL (items 라우트 없어 404/401 mismatch).

- [ ] **Step 3: items 라우트 구현**

`report-simple.js`의 `// items routes added in Task 3` 주석을 아래로 교체:

```js
  router.get('/items', (req, res) => {
    const { period, date } = req.query;
    if (period && !PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    const sid = targetStaffId(req, req.query.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    let sql = "SELECT * FROM report_items WHERE staff_id=?"; const p = [sid];
    if (period) { sql += " AND period=?"; p.push(period); }
    if (date) { sql += " AND item_date=?"; p.push(date); }
    sql += " ORDER BY id";
    res.json(db.prepare(sql).all(...p));
  });

  router.post('/items', (req, res) => {
    const { period, item_date, title, memo } = req.body || {};
    if (!PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    if (!item_date) return res.status(400).json({ error: 'item_date_required' });
    const sid = targetStaffId(req, req.body.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    const r = db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,?,?)")
      .run(sid, period, item_date, title || '', memo || '');
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== req.rsess.staff_id) return res.status(403).json({ error: 'forbidden' });
    const fields = []; const vals = [];
    const body = req.body || {};
    for (const k of ['title', 'memo', 'done']) if (k in body) { fields.push(k + '=?'); vals.push(k === 'done' ? (body[k] ? 1 : 0) : body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'no_changes' });
    fields.push("updated_at=datetime('now','localtime')");
    vals.push(req.params.id);
    db.prepare("UPDATE report_items SET " + fields.join(', ') + " WHERE id=?").run(...vals);
    res.json({ ok: true });
  });

  router.delete('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== req.rsess.staff_id) return res.status(403).json({ error: 'forbidden' });
    db.prepare("DELETE FROM report_items WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: 테스트 실행 → 전체 통과**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node --test test/ 2>&1 | tail -20
```
Expected: 13 tests PASS, 0 fail.

- [ ] **Step 5: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/report-simple.js staff-manager/test/report-simple.test.js && \
git commit -m "feat(staff-manager): report-simple 항목 CRUD + 권한 테스트"
```

---

## Task 4: SSO 로그인 페이지 보존 (login.html)

court-booking이 미로그인 시 `/staff-manager/login`으로 리다이렉트하고 `staff_token` 쿠키를 기대한다. 기존엔 118KB index.html이 이 폼을 품고 있었으므로, 분리된 전용 페이지로 보존한다.

**Files:**
- Create: `staff-manager/public/login.html`

- [ ] **Step 1: login.html 작성**

Create `public/login.html`:

```html
<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>직원 로그인</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
  form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:280px}
  h1{font-size:18px;margin:0 0 16px}
  input{width:100%;box-sizing:border-box;padding:10px;margin:6px 0;border:1px solid #ddd;border-radius:8px;font-size:15px}
  button{width:100%;padding:11px;margin-top:8px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;cursor:pointer}
  .err{color:#dc2626;font-size:13px;min-height:16px;margin-top:6px}
</style></head>
<body>
<form id="f">
  <h1>직원 로그인</h1>
  <input id="u" placeholder="아이디" autocomplete="username">
  <input id="p" type="password" placeholder="비밀번호" autocomplete="current-password">
  <button type="submit">로그인</button>
  <div class="err" id="e"></div>
</form>
<script>
// 상대 경로: /staff-manager/login 에서 로드되므로 ./api/login → /staff-manager/api/login
const params = new URLSearchParams(location.search);
const next = params.get('next') || '/staff-manager/';
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e'); e.textContent = '';
  try {
    const r = await fetch('./api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value })
    });
    if (!r.ok) { e.textContent = '아이디 또는 비밀번호가 틀렸습니다'; return; }
    const { token, user } = await r.json();
    document.cookie = 'staff_token=' + token + ';path=/;max-age=2592000;SameSite=Lax';
    document.cookie = 'staff_user=' + encodeURIComponent(JSON.stringify(user)) + ';path=/;max-age=2592000;SameSite=Lax';
    location.href = next;
  } catch (err) { e.textContent = '연결 오류'; }
});
</script>
</body></html>
```

- [ ] **Step 2: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/public/login.html && \
git commit -m "feat(staff-manager): SSO 로그인 페이지 분리 보존 (login.html)"
```

---

## Task 5: server.js slim 재작성

**Files:**
- Modify (덮어쓰기): `staff-manager/server.js`
- Modify: `staff-manager/.env`

- [ ] **Step 1: .env에 사장님 비번 추가**

Run (비번은 원하는 값으로 교체):
```bash
cd ~/.openclaw/workspace/staff-manager && grep -q BOSS_REPORT_PW .env || echo "BOSS_REPORT_PW=hawaii2026" >> .env && cat .env | sed 's/=.*/=***/'
```
Expected: `TELEGRAM_BOT_TOKEN=***` 와 `BOSS_REPORT_PW=***` 표시.

- [ ] **Step 2: server.js 덮어쓰기**

`server.js` 전체를 아래로 교체:

```js
require("dotenv").config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 6010;
const SECRET = process.env.STAFF_MGR_SECRET || 'staff-mgr-2026-secret';
const BOSS_PW = process.env.BOSS_REPORT_PW || '';
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// ===== SSO 로그인 (보존 — court-booking/POS 의존) =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(401).json({ error: '로그인 실패' });
  const pwMatch = user.password.startsWith('$2') ? bcrypt.compareSync(password, user.password) : (user.password === password);
  if (!pwMatch) return res.status(401).json({ error: '로그인 실패' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, staff_id: user.staff_id }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, staff_id: user.staff_id } });
});

// court-booking 리다이렉트 대상 /staff-manager/login → SSO 로그인 폼
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ===== 새 업무보고 API =====
const createReportRoutes = require('./report-simple');
app.use('/api/report', createReportRoutes(db, { secret: SECRET, bossPw: BOSS_PW }));

// 정적 파일 (index.html = 새 업무보고 앱)
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

app.listen(PORT, () => console.log(`Staff Manager (simple report) on port ${PORT}`));
```

- [ ] **Step 3: 문법/부팅 확인 (포트 충돌 방지 위해 임시 포트로 로드 검증)**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && node -e "require('./report-simple'); console.log('report-simple loads OK')" && node --check server.js && echo "server.js syntax OK"
```
Expected: `report-simple loads OK` + `server.js syntax OK`.

- [ ] **Step 4: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/server.js && \
git commit -m "feat(staff-manager): server.js slim 재작성 (SSO 보존 + report 마운트)"
```

---

## Task 6: 새 프론트엔드 (index.html + app.js)

**Files:**
- Create: `staff-manager/public/app.js`
- Modify (덮어쓰기): `staff-manager/public/index.html`

- [ ] **Step 1: index.html 작성**

`public/index.html` 전체를 아래로 교체:

```html
<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>업무보고</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f6f8;color:#1f2937}
  header{background:#fff;padding:12px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #e5e7eb;position:sticky;top:0}
  header select,header button{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#fff}
  header .grow{flex:1}
  .boss-btn{cursor:pointer}
  .tabs{display:flex;gap:4px;padding:10px 12px;overflow-x:auto}
  .tabs button{white-space:nowrap;padding:8px 14px;border:0;border-radius:20px;background:#e5e7eb;font-size:14px;cursor:pointer}
  .tabs button.active{background:#2563eb;color:#fff}
  main{padding:0 12px 40px;max-width:640px;margin:0 auto}
  .item{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:8px 0;display:flex;gap:10px;align-items:center}
  .item input[type=checkbox]{width:20px;height:20px;flex-shrink:0}
  .item .ti{flex:1;border:0;font-size:15px;outline:none}
  .item .memo{width:38%;border:0;border-left:1px solid #eee;padding-left:8px;font-size:13px;color:#6b7280;outline:none}
  .item.done .ti{text-decoration:line-through;color:#9ca3af}
  .item .del{border:0;background:none;color:#d1d5db;font-size:18px;cursor:pointer}
  .add{width:100%;padding:11px;border:1px dashed #cbd5e1;border-radius:10px;background:#fff;color:#2563eb;font-size:14px;cursor:pointer;margin-top:4px}
  textarea.free{width:100%;min-height:180px;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:15px;font-family:inherit;margin-top:8px}
  .hint{color:#9ca3af;font-size:13px;padding:4px 2px}
  #loginView{display:flex;flex-direction:column;gap:10px;max-width:320px;margin:60px auto;padding:0 16px}
  #loginView select,#loginView input,#loginView button{padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px}
  #loginView button{background:#2563eb;color:#fff;border:0;cursor:pointer}
  .saved{color:#16a34a;font-size:12px;margin-left:8px}
</style></head>
<body>
  <div id="loginView">
    <h2 style="text-align:center">업무보고</h2>
    <select id="nameSel"><option value="">이름을 선택하세요</option></select>
    <button id="staffLoginBtn">직원 로그인</button>
    <div class="hint" style="text-align:center">— 또는 —</div>
    <input id="bossPw" type="password" placeholder="사장님 비밀번호">
    <button id="bossLoginBtn">사장님 로그인</button>
    <div class="err" id="loginErr" style="color:#dc2626;text-align:center;font-size:13px"></div>
  </div>

  <div id="appView" style="display:none">
    <header>
      <strong id="whoami"></strong>
      <select id="bossStaffSel" style="display:none"></select>
      <span class="grow"></span>
      <span class="saved" id="savedMsg"></span>
      <button id="logoutBtn">로그아웃</button>
    </header>
    <div class="tabs" id="tabs">
      <button data-p="today" class="active">오늘</button>
      <button data-p="tomorrow">내일</button>
      <button data-p="week">주간</button>
      <button data-p="month">월간</button>
      <button data-p="year">연간</button>
    </div>
    <main id="content"></main>
  </div>
  <script src="app.js"></script>
</body></html>
```

- [ ] **Step 2: app.js 작성**

Create `public/app.js`:

```js
// 상대 경로 API (nginx가 /staff-manager/ 프리픽스를 벗김)
const API = 'api/report';
const CHECK_PERIODS = ['today', 'tomorrow'];
const state = { isBoss: false, staffId: null, name: '', targetStaff: null, period: 'today' };

const $ = (s) => document.querySelector(s);
async function api(pathAndQuery, opts) {
  const r = await fetch(`${API}${pathAndQuery}`, opts);
  return r;
}

// ---- 날짜 헬퍼 (KST 기준) ----
function kst(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function weekStart() {
  const d = new Date(Date.now() + 9 * 3600000);
  const day = (d.getUTCDay() + 6) % 7; // 월요일 시작
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
function monthStart() { return kst().slice(0, 7) + '-01'; }
function yearStart() { return kst().slice(0, 4) + '-01-01'; }
function itemDateFor(period) {
  return { today: kst(0), tomorrow: kst(1), week: weekStart(), month: monthStart(), year: yearStart() }[period];
}

// ---- 로그인 ----
async function loadStaffList() {
  const r = await api('/staff-list');
  const list = await r.json();
  const sel = $('#nameSel');
  const bsel = $('#bossStaffSel');
  for (const s of list) {
    sel.insertAdjacentHTML('beforeend', `<option value="${s.name}">${s.name}</option>`);
    bsel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.name}</option>`);
  }
}
async function doLogin(body) {
  const r = await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { $('#loginErr').textContent = '로그인 실패'; return; }
  const d = await r.json();
  state.isBoss = d.isBoss;
  state.staffId = d.staff_id || null;
  state.name = d.name || '사장님';
  enterApp();
}

function enterApp() {
  $('#loginView').style.display = 'none';
  $('#appView').style.display = 'block';
  if (state.isBoss) {
    $('#whoami').textContent = '사장님';
    $('#bossStaffSel').style.display = 'inline-block';
    state.targetStaff = Number($('#bossStaffSel').value);
  } else {
    $('#whoami').textContent = state.name;
    state.targetStaff = state.staffId;
  }
  render();
}

// ---- 렌더 ----
function currentStaffId() { return state.isBoss ? state.targetStaff : state.staffId; }
function qs(period) {
  const p = new URLSearchParams({ period, date: itemDateFor(period) });
  if (state.isBoss && state.targetStaff) p.set('staff_id', state.targetStaff);
  return '?' + p.toString();
}

async function render() {
  const period = state.period;
  const r = await api('/items' + qs(period));
  if (r.status === 401) { location.reload(); return; }
  const items = await r.json();
  const el = $('#content');
  if (CHECK_PERIODS.includes(period)) {
    el.innerHTML = items.map(renderCheckItem).join('') +
      `<button class="add" id="addBtn">+ 항목 추가</button>`;
    $('#addBtn').onclick = addCheckItem;
    el.querySelectorAll('.item').forEach(bindCheckItem);
  } else {
    const memo = items[0]?.memo || '';
    const id = items[0]?.id || '';
    el.innerHTML = `<div class="hint">${{week:'이번 주',month:'이번 달',year:'올해'}[period]} 방향/목표를 자유롭게 적어두세요.</div>
      <textarea class="free" id="freeMemo" data-id="${id}" placeholder="자유롭게 작성...">${escapeHtml(memo)}</textarea>`;
    $('#freeMemo').onblur = saveFree;
  }
}

function renderCheckItem(it) {
  return `<div class="item ${it.done ? 'done' : ''}" data-id="${it.id}">
    <input type="checkbox" ${it.done ? 'checked' : ''}>
    <input class="ti" value="${escapeHtml(it.title || '')}" placeholder="할 일">
    <input class="memo" value="${escapeHtml(it.memo || '')}" placeholder="메모">
    <button class="del">×</button>
  </div>`;
}
function bindCheckItem(node) {
  const id = node.dataset.id;
  node.querySelector('input[type=checkbox]').onchange = (e) => patch(id, { done: e.target.checked }).then(render);
  node.querySelector('.ti').onblur = (e) => patch(id, { title: e.target.value });
  node.querySelector('.memo').onblur = (e) => patch(id, { memo: e.target.value });
  node.querySelector('.del').onclick = () => api(`/items/${id}`, { method: 'DELETE' }).then(render);
}
async function addCheckItem() {
  await api('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyWithStaff({ period: state.period, item_date: itemDateFor(state.period), title: '', memo: '' })) });
  render();
}
async function saveFree(e) {
  const id = e.target.dataset.id;
  const memo = e.target.value;
  if (id) { await patch(id, { memo }); }
  else {
    const r = await api('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithStaff({ period: state.period, item_date: itemDateFor(state.period), memo })) });
    const d = await r.json(); e.target.dataset.id = d.id;
  }
  flashSaved();
}
function patch(id, body) {
  return api(`/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(flashSaved);
}
function bodyWithStaff(body) {
  if (state.isBoss && state.targetStaff) body.staff_id = state.targetStaff;
  return body;
}
function flashSaved() { const m = $('#savedMsg'); m.textContent = '저장됨'; setTimeout(() => m.textContent = '', 1200); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- 이벤트 바인딩 ----
$('#staffLoginBtn').onclick = () => { const n = $('#nameSel').value; if (!n) { $('#loginErr').textContent = '이름을 선택하세요'; return; } doLogin({ name: n }); };
$('#bossLoginBtn').onclick = () => doLogin({ boss_pw: $('#bossPw').value });
$('#logoutBtn').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
$('#bossStaffSel').onchange = (e) => { state.targetStaff = Number(e.target.value); render(); };
$('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('#tabs').querySelector('.active').classList.remove('active');
  b.classList.add('active'); state.period = b.dataset.p; render();
});

loadStaffList();
```

- [ ] **Step 3: 커밋**

```bash
cd ~/.openclaw/workspace && git add staff-manager/public/index.html staff-manager/public/app.js && \
git commit -m "feat(staff-manager): 새 업무보고 프론트 (오늘/내일 체크 + 주/월/년 자유메모)"
```

---

## Task 7: 배포 + 회귀 검증

**Files:** (없음 — 배포/검증만)

- [ ] **Step 1: 옛 파일 미참조 처리 (백업만, 삭제 안 함)**

daily-summary(텔레그램 cron)와 옛 report-routes는 새 server.js에서 이미 require하지 않으므로 자동 비활성. 확인만:
```bash
cd ~/.openclaw/workspace/staff-manager && grep -nE "daily-summary|report-routes" server.js || echo "옛 모듈 미참조 확인됨"
```
Expected: `옛 모듈 미참조 확인됨`.

- [ ] **Step 2: pm2 재시작**

Run:
```bash
cd ~/.openclaw/workspace/staff-manager && pm2 restart staff-manager && sleep 2 && pm2 logs staff-manager --lines 8 --nostream
```
Expected: `Staff Manager (simple report) on port 6010`, 에러 없음.

- [ ] **Step 3: 업무보고 API 스모크 테스트 (서버에서 직접)**

Run:
```bash
# 직원 로그인 → 쿠키 저장 → 오늘 항목 추가/조회
C=$(curl -s -i -X POST localhost:6010/api/report/login -H 'Content-Type: application/json' -d '{"name":"미가"}' | grep -oiE 'report_sess=[^;]+' | head -1)
echo "cookie=$C"
curl -s -X POST localhost:6010/api/report/items -H 'Content-Type: application/json' -H "Cookie: $C" -d '{"period":"today","item_date":"2026-08-06","title":"테스트항목"}'; echo
curl -s "localhost:6010/api/report/items?period=today&date=2026-08-06" -H "Cookie: $C"; echo
```
Expected: `{"id":N}` 후 조회에 `테스트항목` 포함. (미가가 없으면 실제 존재하는 직원 이름으로 교체)

- [ ] **Step 4: 사장님 로그인 검증**

Run (`.env`의 BOSS_REPORT_PW 값 사용):
```bash
curl -s -i -X POST localhost:6010/api/report/login -H 'Content-Type: application/json' -d '{"boss_pw":"hawaii2026"}' | grep -iE 'HTTP|set-cookie'
```
Expected: `HTTP/1.1 200` + `Set-Cookie: report_sess=...`.

- [ ] **Step 5: SSO 회귀 검증 (court-booking/POS 안 깨졌는지)**

Run:
```bash
# SSO 로그인 페이지가 뜨는지
curl -s -o /dev/null -w "%{http_code}\n" localhost:6010/login
# 기존 SSO 로그인 (admin 계정)이 staff_token을 발급하는지
curl -s -X POST localhost:6010/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | head -c 200; echo
```
Expected: `/login` → `200`, `/api/login` → `{"token":"eyJ...","user":{...}}`. (admin 비번이 다르면 실제 값으로)

- [ ] **Step 6: 브라우저 실사용 검증 (수동)**

`https://app.hawaiigroup.co/staff-manager/` 접속 후 확인 (프론트는 vanilla DOM이라 유닛테스트 대신 수동 검증):
1. 이름 드롭다운에서 직원 선택 → 직원 로그인 → 오늘 탭.
2. `+ 항목 추가` → 체크박스+제목+메모 입력 → 체크 → 새로고침 후 유지.
3. 내일 탭에 항목 추가 → (개념 검증) item_date가 내일 날짜로 저장됨.
4. 주간/월간/연간 탭 → 자유 메모 입력 후 포커스 아웃 → "저장됨" → 새로고침 유지.
5. 로그아웃 → 사장님 비번 로그인 → 상단 직원 드롭다운으로 다른 직원 보고 조회.
6. court-booking(`/booking/` admin) 미로그인 접속 → `/staff-manager/login`으로 리다이렉트 → admin 로그인 → 예약 페이지 정상 접근.

- [ ] **Step 7: 최종 커밋 & 푸시**

```bash
cd ~/.openclaw/workspace && git add -A staff-manager && \
git commit -m "chore(staff-manager): 심플 업무보고 배포 검증 완료" --allow-empty && \
git push origin main 2>&1 | tail -3
```
Expected: push 성공 (EC2 → GitHub SSH).

---

## Self-Review 결과 (작성자 점검)

- **Spec 커버리지:** 오늘/내일 체크박스+메모(Task 3·6) / 주·월·년 자유메모(Task 3·6) / 이름-선택·사장님-비번 로그인(Task 2·6) / 사장님 전체·직원 본인(Task 3 권한) / SSO·staff·users·/login 보존(Task 4·5·7) / 번역·근태·PIN 제거(Task 5에서 미마운트) / 옛 데이터 백업만(Task 1·7) / 날짜 롤오버(app.js `itemDateFor`) — 모두 태스크 존재.
- **Placeholder 스캔:** 없음. 모든 코드 블록 완전.
- **타입/시그니처 일관성:** `createReportRoutes(db, {secret, bossPw})`, 쿠키 `report_sess`, period enum `['today','tomorrow','week','month','year']`, `itemDateFor()` — Task 2/3/5/6에서 이름 일치 확인.
- **주의:** `STAFF_MGR_SECRET`는 `.env`에 추가하지 않음(기본값 유지, SSO 서명 호환). BOSS_REPORT_PW만 추가.
