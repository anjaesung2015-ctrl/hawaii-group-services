# 근태 50m 지오펜싱 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** staff-manager의 PIN 기반 출/퇴근 체크인을 사업장 좌표 기준 50m 이내에서만 허용. 좌표는 관리자 첫 체크인 시 자동 부트스트랩. 사장/매니저는 강제 체크인으로 우회 가능.

**Architecture:** SQLite 마이그레이션(`business_locations` 신규 + `attendance` 컬럼 8개) → `report-routes.js`에 Haversine 검증 + 부트스트랩 로직 → `server.js`에 강제 체크인 admin 엔드포인트 → `public/index.html`에 `navigator.geolocation` 호출 + 강제 체크인 UI.

**Tech Stack:** Node.js 22, Express, better-sqlite3, vanilla JS + 브라우저 Geolocation API.

**관련 spec:** `docs/superpowers/specs/2026-05-19-attendance-geofencing-design.md`

**작업 환경:**
- 코드는 EC2(`/home/ubuntu/.openclaw/workspace/staff-manager/`)에 위치
- 편집은 `scp` 다운로드 → 로컬 편집 → `scp` 업로드 (이번 세션 패턴 따름) 또는 ssh `node -e` 직접 실행
- SSH 키: `C:\Users\Asus\Downloads\eunice-key.pem`, 대상: `ubuntu@3.93.96.130`
- 배포: `pm2 restart staff-manager` 후 검증
- 커밋: EC2 `/home/ubuntu/.openclaw/workspace`에서 `git add ... && git commit && git push`

---

## Task 1: 스키마 마이그레이션 (동작 변경 없음, 안전한 사전 작업)

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/server.js` (DB 초기화 블록 근처, 27-37 line 부근)

**목표:** `business_locations` 테이블 생성 + `attendance`에 8개 컬럼 추가. 멱등(이미 있으면 무시). 동작 영향 0.

- [ ] **Step 1: 현재 스키마 확인**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace/staff-manager && node -e \"const db=require('better-sqlite3')('staff.db'); console.log('attendance cols:'); db.pragma('table_info(attendance)').forEach(c=>console.log(' ',c.name)); console.log('has business_locations?', !!db.prepare(\\\"SELECT name FROM sqlite_master WHERE type='table' AND name='business_locations'\\\").get());\""
```
Expected: attendance에 `check_in_lat` 등 없음, `business_locations` 없음.

- [ ] **Step 2: server.js의 DB 초기화 블록 찾기**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "awk 'NR>=25 && NR<=45 {printf \"%d: %s\\n\", NR, \$0}' /home/ubuntu/.openclaw/workspace/staff-manager/server.js"
```

`staff_schema.sql` 로드 try/catch 블록(33-37 line 부근)이 보일 것임. 그 뒤에 추가 마이그레이션 코드 넣을 자리.

- [ ] **Step 3: server.js 다운로드 → 마이그레이션 코드 추가 → 업로드**

스키마 로드 블록 바로 다음에 추가:

```js
// === Geofencing migration (idempotent) ===
try {
  db.exec(`CREATE TABLE IF NOT EXISTS business_locations (
    business TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    set_by_staff_id INTEGER,
    set_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (set_by_staff_id) REFERENCES staff(id)
  )`);
} catch(e) { console.error('[migration] business_locations:', e.message); }

for (const col of [
  'check_in_lat REAL', 'check_in_lng REAL', 'check_in_accuracy REAL',
  'check_out_lat REAL', 'check_out_lng REAL', 'check_out_accuracy REAL',
  'check_in_override_by INTEGER', 'check_out_override_by INTEGER',
]) {
  try { db.exec(`ALTER TABLE attendance ADD COLUMN ${col}`); }
  catch(e) { /* "duplicate column name" 정상 — 이미 있음 */ }
}
```

작업 순서:
```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/server.js "C:\Users\Asus\AppData\Local\Temp\sm-server.js"
# (Edit 도구로 로컬 파일 수정)
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-server.js" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/server.js
```

- [ ] **Step 4: 문법 체크 + pm2 재시작**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -c /home/ubuntu/.openclaw/workspace/staff-manager/server.js && pm2 restart staff-manager && sleep 2 && pm2 status staff-manager | grep staff-manager"
```
Expected: 문법 OK, online, restart 카운트 +1.

- [ ] **Step 5: 마이그레이션 검증**

Step 1과 같은 명령 재실행:
```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace/staff-manager && node -e \"const db=require('better-sqlite3')('staff.db'); console.log('attendance cols:'); db.pragma('table_info(attendance)').forEach(c=>console.log(' ',c.name)); console.log('has business_locations?', !!db.prepare(\\\"SELECT name FROM sqlite_master WHERE type='table' AND name='business_locations'\\\").get());\""
```
Expected: attendance에 `check_in_lat`, `check_in_lng`, `check_in_accuracy`, `check_out_lat`, `check_out_lng`, `check_out_accuracy`, `check_in_override_by`, `check_out_override_by` 모두 보임. `business_locations` 테이블 존재.

- [ ] **Step 6: 회귀 — 기존 attendance/today 엔드포인트 정상**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e; TOKEN=\$(curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/reports/login -H 'Content-Type: application/json' -d '{\"staff_id\":12,\"pin\":\"1234\"}' -c /tmp/c.txt -o /dev/null -w '%{http_code}'); echo login=\$TOKEN; curl -sS -b /tmp/c.txt https://app.hawaiigroup.co/staff-manager/api/reports/attendance/today"
```
Expected: `login=200`, `{"date":"...","check_in":null,"check_out":null}` (스키마 추가만 했으니 기존 SELECT 정상).

- [ ] **Step 7: 커밋**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace && git add staff-manager/server.js && git commit -m 'feat(staff-manager): migrate schema for attendance geofencing

Add business_locations table and 8 attendance columns
(check_in/out_lat/lng/accuracy + check_in/out_override_by).
Idempotent: CREATE TABLE IF NOT EXISTS and try-wrapped ALTER TABLE.
No behavior change yet.' && git push"
```

---

## Task 2: Haversine + 위치 검증 헬퍼

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js` (`createReportRoutes` 함수 위쪽, module 스코프)

**목표:** Pure 함수 헬퍼 추가. 아직 라우트에선 호출 안 함 — 다음 태스크에서 연결.

- [ ] **Step 1: report-routes.js 다운로드**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js "C:\Users\Asus\AppData\Local\Temp\sm-report.js"
```

- [ ] **Step 2: 파일 상단(require들 다음, `module.exports` 앞)에 헬퍼 추가**

```js
// === Geofencing helpers ===
const GEOFENCE_RADIUS_M = 50;
const GPS_ACCURACY_LIMIT_M = 100;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 위치 검증 + 좌표 없으면 admin/manager가 bootstrap.
// 반환: { ok: true, distance_m?, bootstrapped? } 또는 { status, error, ...detail }
function validateLocation(db, staff, body) {
  const { lat, lng, accuracy } = body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof accuracy !== 'number') {
    return { status: 400, error: 'location_required' };
  }
  if (accuracy > GPS_ACCURACY_LIMIT_M) {
    return { status: 400, error: 'gps_too_inaccurate', accuracy_m: accuracy };
  }
  if (!staff.business) {
    return { status: 400, error: 'no_business_assigned' };
  }
  const loc = db.prepare('SELECT lat, lng FROM business_locations WHERE business=?').get(staff.business);
  if (!loc) {
    if (staff.role === 'admin' || staff.role === 'manager') {
      db.prepare(`INSERT INTO business_locations (business, lat, lng, accuracy, set_by_staff_id)
                  VALUES (?,?,?,?,?)`).run(staff.business, lat, lng, accuracy, staff.id);
      return { ok: true, bootstrapped: true };
    }
    return { status: 400, error: 'business_not_configured', business: staff.business };
  }
  const distance = haversineMeters(lat, lng, loc.lat, loc.lng);
  if (distance - accuracy > GEOFENCE_RADIUS_M) {
    return {
      status: 403, error: 'out_of_range',
      distance_m: Math.round(distance),
      accuracy_m: Math.round(accuracy),
      threshold_m: GEOFENCE_RADIUS_M,
    };
  }
  return { ok: true, distance_m: distance };
}
```

작업: `C:\Users\Asus\AppData\Local\Temp\sm-report.js`를 Edit 도구로 수정 후 업로드.

- [ ] **Step 3: 업로드 + 문법 체크**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-report.js" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js && ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -c /home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js && echo OK"
```
Expected: OK.

- [ ] **Step 4: pm2 재시작 + 회귀 체크**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "pm2 restart staff-manager && sleep 2 && curl -sS -b /tmp/c.txt https://app.hawaiigroup.co/staff-manager/api/reports/attendance/today"
```
Expected: 200 with `check_in/check_out` JSON (헬퍼 추가만, 호출 안 함 → 동작 동일).

- [ ] **Step 5: 헬퍼 단위 검증 (node REPL)**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace/staff-manager && node -e \"
const { haversineMeters } = (() => { const m = {}; const exp = (k,v)=>m[k]=v; eval(require('fs').readFileSync('./report-routes.js','utf8').match(/function haversineMeters[\\s\\S]*?return 2 \\* R \\* Math\\.asin\\(Math\\.sqrt\\(a\\)\\);\\n\\}/)[0] + '; exp(\\\"haversineMeters\\\", haversineMeters)'); return m; })();
// 서울시청 좌표
const d1 = haversineMeters(37.5665, 126.9780, 37.5666, 126.9781);
console.log('14m approx:', Math.round(d1), 'm');  // 약 14m
const d2 = haversineMeters(37.5665, 126.9780, 37.5670, 126.9785);
console.log('64m approx:', Math.round(d2), 'm');  // 약 64m
\""
```
Expected: 두 거리 모두 합리적 (10-100m 범위, 1m 이하 오차 무관).

- [ ] **Step 6: 커밋 안 함 (Task 3과 묶음)** — Task 3 끝나고 같이 커밋.

---

## Task 3: PIN 체크인/아웃 라우트에 검증 연결

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js` (`r.post('/attendance/check-in', ...)`, `r.post('/attendance/check-out', ...)` 두 핸들러)

**목표:** Task 2 헬퍼 호출. 위치 검증 통과 시 lat/lng/accuracy도 함께 INSERT/UPDATE. requireStaff 미들웨어가 req.staffId만 주므로 staff row를 명시 조회.

- [ ] **Step 1: 현재 핸들러 위치 확인**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "awk 'NR>=475 && NR<=500 {printf \"%d: %s\\n\", NR, \$0}' /home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js"
```
Expected: `r.post('/attendance/check-in', requireStaff, ...)` 와 `/check-out` 보임 (라인 번호는 변동 가능).

- [ ] **Step 2: check-in 핸들러 교체**

기존:
```js
r.post('/attendance/check-in', requireStaff, (req, res) => {
  const today = todayStr();
  const now = new Date().toISOString();
  const exists = db.prepare("SELECT id, check_in FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today);
  if (exists) {
    if (exists.check_in) return res.status(400).json({ error: 'already_checked_in', check_in: exists.check_in });
    db.prepare("UPDATE attendance SET check_in=? WHERE id=?").run(now, exists.id);
  } else {
    db.prepare("INSERT INTO attendance (staff_id, date, check_in) VALUES (?,?,?)").run(req.staffId, today, now);
  }
  res.json({ ok: true, check_in: now });
});
```

신규로 교체:
```js
r.post('/attendance/check-in', requireStaff, (req, res) => {
  const staff = db.prepare("SELECT id, business, role FROM staff WHERE id=?").get(req.staffId);
  if (!staff) return res.status(404).json({ error: 'staff_not_found' });
  const v = validateLocation(db, staff, req.body);
  if (!v.ok) return res.status(v.status).json(v);

  const today = todayStr();
  const now = new Date().toISOString();
  const { lat, lng, accuracy } = req.body;
  const exists = db.prepare("SELECT id, check_in FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today);
  if (exists) {
    if (exists.check_in) return res.status(400).json({ error: 'already_checked_in', check_in: exists.check_in });
    db.prepare("UPDATE attendance SET check_in=?, check_in_lat=?, check_in_lng=?, check_in_accuracy=? WHERE id=?")
      .run(now, lat, lng, accuracy, exists.id);
  } else {
    db.prepare("INSERT INTO attendance (staff_id, date, check_in, check_in_lat, check_in_lng, check_in_accuracy) VALUES (?,?,?,?,?,?)")
      .run(req.staffId, today, now, lat, lng, accuracy);
  }
  res.json({ ok: true, check_in: now, bootstrapped: v.bootstrapped || false, distance_m: v.distance_m });
});
```

- [ ] **Step 3: check-out 핸들러 교체**

기존 핸들러를 같은 패턴으로:
```js
r.post('/attendance/check-out', requireStaff, (req, res) => {
  const staff = db.prepare("SELECT id, business, role FROM staff WHERE id=?").get(req.staffId);
  if (!staff) return res.status(404).json({ error: 'staff_not_found' });
  const v = validateLocation(db, staff, req.body);
  if (!v.ok) return res.status(v.status).json(v);

  const today = todayStr();
  const now = new Date().toISOString();
  const { lat, lng, accuracy } = req.body;
  const exists = db.prepare("SELECT id, check_in, check_out FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today);
  if (!exists || !exists.check_in) return res.status(400).json({ error: 'check_in_required' });
  if (exists.check_out) return res.status(400).json({ error: 'already_checked_out', check_out: exists.check_out });
  db.prepare("UPDATE attendance SET check_out=?, check_out_lat=?, check_out_lng=?, check_out_accuracy=? WHERE id=?")
    .run(now, lat, lng, accuracy, exists.id);
  res.json({ ok: true, check_out: now, bootstrapped: v.bootstrapped || false, distance_m: v.distance_m });
});
```

(기존 check-out의 시그니처는 파일에 따라 약간 다를 수 있음 — 위치만 추가하면 됨. 위 코드는 표준 패턴.)

- [ ] **Step 4: 업로드 + 문법 + 재시작**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-report.js" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js && ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -c /home/ubuntu/.openclaw/workspace/staff-manager/report-routes.js && pm2 restart staff-manager && sleep 2 && pm2 status staff-manager | grep staff-manager"
```

- [ ] **Step 5: 검증 — 부트스트랩 (admin)**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
# 사전: 기존 business_locations 정리 (테스트 격리)
node -e \"require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').exec('DELETE FROM business_locations')\"
# 안재성 staff_id=16 (role=admin per memory) → PIN 로그인하려면 PIN 알아야 함. 일단 admin role 직원 찾기
node -e \"const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db'); db.prepare('SELECT id,name,role,business FROM staff WHERE role IN (?,?)').all('admin','manager').forEach(r=>console.log(JSON.stringify(r)));\"
"
```
Expected: admin/manager role 직원 목록 (실제 PIN 모를 수 있음 → 다음 step에서 임시 PIN으로 설정).

- [ ] **Step 6: 검증 — 테스트용 admin staff에 임시 PIN 1234 부여 후 부트스트랩 체크인**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace/staff-manager && node -e \"
const bcrypt=require('bcryptjs'); const db=require('better-sqlite3')('staff.db');
// 부트스트랩 테스트용: 안재성(role=admin, id=16)에게 임시 PIN 1234
db.prepare('UPDATE staff SET pin_hash=?, pin_fail_count=0, pin_locked_until=NULL WHERE id=16').run(bcrypt.hashSync('1234',10));
const s = db.prepare('SELECT id,name,role,business FROM staff WHERE id=16').get();
console.log('admin staff:', JSON.stringify(s));
\""
# 부트스트랩 호출 (admin이 사업장 좌표 첫 등록)
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/reports/login -H 'Content-Type: application/json' -d '{\"staff_id\":16,\"pin\":\"1234\"}' -c /tmp/admin.txt -o /dev/null -w 'login=%{http_code}\\n'
echo '--- bootstrap check-in (좌표 47.918, 106.917 = 울란바토르 임의) ---'
curl -sS -b /tmp/admin.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{\"lat\":47.918873,\"lng\":106.917701,\"accuracy\":15}'
echo
echo '--- business_locations 확인 ---'
node -e \"const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db'); db.prepare('SELECT * FROM business_locations').all().forEach(r=>console.log(JSON.stringify(r)));\"
"
```
Expected: `login=200`, 체크인 응답 `{"ok":true,"check_in":"...","bootstrapped":true,...}`, `business_locations`에 admin의 business 행 1개.

- [ ] **Step 7: 검증 — 일반 직원이 좌표 있는 사업장에서 50m 안 / 밖 / GPS 부정확**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
# 미가 (id=12, role=manager 또는 staff per business) PIN 로그인
curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/reports/login -H 'Content-Type: application/json' -d '{\"staff_id\":12,\"pin\":\"1234\"}' -c /tmp/m.txt -o /dev/null -w 'login=%{http_code}\\n'
# 미가의 business 확인
node -e \"console.log('miga business:', require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('SELECT business FROM staff WHERE id=12').get())\"
# 미가 business의 좌표가 등록돼있다면(예: admin과 같은 사업장이면 OK), 안 됐다면 다른 admin/manager로 부트스트랩 먼저
# 가정: 미가 business도 부트스트랩됨. 그렇지 않으면 이 step skip하고 노트 남김.
echo '--- 30m 안 (같은 좌표 +0.0003도 ≈ 33m) ---'
curl -sS -b /tmp/m.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{\"lat\":47.918873,\"lng\":106.917701,\"accuracy\":10}'
echo
echo '--- 100m 밖 (먼저 어제로 시간 돌리는 게 깔끔하지만 today already_checked_in 메시지 OK) ---'
# 동일 직원 두 번 호출 시 'already_checked_in' 일 수 있음 → 다른 staff_id 또는 row 삭제 후 재시도
node -e \"require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('DELETE FROM attendance WHERE staff_id=12 AND date=?').run(new Date().toISOString().split('T')[0])\"
curl -sS -b /tmp/m.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{\"lat\":47.920000,\"lng\":106.917701,\"accuracy\":10}'
echo
echo '--- GPS 부정확 (accuracy 150) ---'
curl -sS -b /tmp/m.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{\"lat\":47.918873,\"lng\":106.917701,\"accuracy\":150}'
echo
echo '--- 위치 누락 ---'
curl -sS -b /tmp/m.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{}'
echo"
```
Expected:
- 30m 안 → 200 `{ok:true, check_in, distance_m: ~30}`
- 100m 밖 → 403 `{error:"out_of_range", distance_m: ~120, ...}`
- accuracy 150 → 400 `{error:"gps_too_inaccurate", accuracy_m:150}`
- 위치 누락 → 400 `{error:"location_required"}`

- [ ] **Step 8: 검증 — 일반 직원이 좌표 없는 사업장에서 시도 (business_not_configured)**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
node -e \"require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').exec('DELETE FROM business_locations')\"
# 일반 직원(role='staff')로 시도. 직원1(id=2 가정) 또는 role='staff' 첫 직원
node -e \"const r=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('SELECT id,name,business FROM staff WHERE role=? LIMIT 1').get('staff'); console.log(JSON.stringify(r));\"
# 위에서 나온 staff_id로 PIN 1234 임시 부여 후 로그인
# (실행 명령은 staff_id 결과에 따라 조정)
STAFF_ID=2  # 결과 보고 실제 id로
node -e \"const bcrypt=require('bcryptjs'); require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('UPDATE staff SET pin_hash=?, pin_fail_count=0, pin_locked_until=NULL WHERE id=?').run(bcrypt.hashSync('1234',10), \$STAFF_ID);\"
curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/reports/login -H 'Content-Type: application/json' -d \"{\\\"staff_id\\\":\$STAFF_ID,\\\"pin\\\":\\\"1234\\\"}\" -c /tmp/s.txt -o /dev/null -w 'login=%{http_code}\\n'
curl -sS -b /tmp/s.txt -X POST https://app.hawaiigroup.co/staff-manager/api/reports/attendance/check-in -H 'Content-Type: application/json' -d '{\"lat\":47.918873,\"lng\":106.917701,\"accuracy\":15}'
echo"
```
Expected: 400 `{error:"business_not_configured", business:"..."}`.

- [ ] **Step 9: 정리 — 테스트로 변경한 admin/staff PIN과 attendance 원복**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -e \"
const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db');
// 테스트로 만든 부트스트랩 좌표 삭제
db.exec('DELETE FROM business_locations');
// 테스트로 만든 attendance row 삭제 (오늘 날짜의 staff_id 16, 12, 임시 staff)
const today = new Date().toISOString().split('T')[0];
db.prepare('DELETE FROM attendance WHERE date=? AND staff_id IN (?,?,2)').run(today, 16, 12);
console.log('cleanup done');
\""
```

> ⚠️ 안재성(id=16)과 미가(id=12)의 PIN은 1234로 남아있음. 실제 서비스 사용자에게 본인이 변경하라고 안내 필요 (이전 세션에서도 미가는 1234로 리셋한 적 있음).

- [ ] **Step 10: 커밋**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace && git add staff-manager/report-routes.js && git commit -m 'feat(staff-manager): geofence PIN check-in/out (50m + bootstrap)

Add haversineMeters + validateLocation helpers. PIN-based check-in
and check-out now require {lat, lng, accuracy} body. First admin or
manager check-in auto-bootstraps the business location. Distance is
adjusted by reported GPS accuracy; threshold 50m. Reject accuracy
> 100m. Persist coords on attendance row.' && git push"
```

---

## Task 4: 강제 체크인 admin 엔드포인트

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/server.js` (admin auth가 적용된 영역 — `app.use('/api', auth)` 다음의 라우트 영역)

**목표:** admin/manager가 GPS 우회로 직원 체크인/아웃 처리. 매니저는 본인 사업장 직원만.

- [ ] **Step 1: 적절한 삽입 위치 찾기**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "grep -n 'app.get..api.salary-summary.\\|app.listen' /home/ubuntu/.openclaw/workspace/staff-manager/server.js"
```
Expected: `/api/salary-summary` 핸들러 끝나는 위치 + `app.listen` 위치. 글로벌 에러 핸들러는 그 사이에 이미 있음 — 그 **앞**에 force-check 엔드포인트 추가.

- [ ] **Step 2: server.js에 두 엔드포인트 추가**

위치: `app.get('/api/salary-summary', ...)` 핸들러 끝 직후, 글로벌 에러 핸들러 앞.

```js
// === 강제 체크인/아웃 (사장·매니저) ===
function forceAttendance(type) {
  return (req, res) => {
    const { staff_id, date, reason } = req.body || {};
    if (!staff_id || !date || !reason) return res.status(400).json({ error: 'missing_fields' });
    const target = db.prepare("SELECT id, business FROM staff WHERE id=? AND is_active=1").get(staff_id);
    if (!target) return res.status(404).json({ error: 'staff_not_found' });

    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isAdmin && !isManager) return res.status(403).json({ error: 'forbidden' });
    if (isManager) {
      const myBiz = getMyBusiness(req);
      if (!myBiz || target.business !== myBiz) return res.status(403).json({ error: 'forbidden_business' });
    }

    const now = new Date().toISOString();
    const noteAppend = `\n[강제 ${type} by ${req.user.name}: ${reason}]`;
    const exists = db.prepare("SELECT id, check_in, check_out, note FROM attendance WHERE staff_id=? AND date=?").get(staff_id, date);
    const timeCol = type === 'in' ? 'check_in' : 'check_out';
    const overrideCol = type === 'in' ? 'check_in_override_by' : 'check_out_override_by';

    if (exists) {
      const newNote = (exists.note || '') + noteAppend;
      db.prepare(`UPDATE attendance SET ${timeCol}=?, ${overrideCol}=?, note=? WHERE id=?`)
        .run(now, req.user.id, newNote, exists.id);
    } else {
      db.prepare(`INSERT INTO attendance (staff_id, date, ${timeCol}, ${overrideCol}, note) VALUES (?,?,?,?,?)`)
        .run(staff_id, date, now, req.user.id, noteAppend.trim());
    }
    res.json({ ok: true, [timeCol]: now, override_by: req.user.id });
  };
}

app.post('/api/attendance/force-check-in',  forceAttendance('in'));
app.post('/api/attendance/force-check-out', forceAttendance('out'));
```

- [ ] **Step 3: 업로드 + 문법 + 재시작**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-server.js" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/server.js && ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -c /home/ubuntu/.openclaw/workspace/staff-manager/server.js && pm2 restart staff-manager && sleep 2 && pm2 status staff-manager | grep staff-manager"
```

- [ ] **Step 4: 검증 — admin이 임의 직원 강제 체크인**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
TOKEN=\$(curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"1234\"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"token\"])')
echo '--- admin force check-in for staff_id=12 (today) ---'
curl -sS -i -X POST https://app.hawaiigroup.co/staff-manager/api/attendance/force-check-in -H \"Authorization: Bearer \$TOKEN\" -H 'Content-Type: application/json' -d '{\"staff_id\":12,\"date\":\"2026-05-19\",\"reason\":\"GPS 안 잡힘\"}'
echo
echo '--- attendance row 확인 ---'
node -e \"const r=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('SELECT id,staff_id,date,check_in,check_in_override_by,note FROM attendance WHERE staff_id=12 AND date=?').get('2026-05-19'); console.log(JSON.stringify(r,null,2));\""
```
Expected: 200, attendance row의 `check_in_override_by=1` (admin id), `note`에 강제 메시지.

- [ ] **Step 5: 검증 — 매니저가 다른 사업장 직원 강제 체크인 (403)**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
# 매니저 ysg (유승거)로 로그인
TOKEN=\$(curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/login -H 'Content-Type: application/json' -d '{\"username\":\"ysg\",\"password\":\"1234\"}' | python3 -c 'import json,sys; print(json.load(sys.stdin).get(\"token\",\"\"))')
echo token_len=\${#TOKEN}
# ysg의 staff_id=1, business 확인
node -e \"const r=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db').prepare('SELECT id,name,business FROM staff WHERE id=1').get(); console.log('ysg:', JSON.stringify(r))\"
# ysg와 다른 business의 staff_id 찾아서 시도
TARGET=\$(node -e \"const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db'); const ysg=db.prepare('SELECT business FROM staff WHERE id=1').get().business; const r=db.prepare('SELECT id FROM staff WHERE business!=? AND is_active=1 LIMIT 1').get(ysg); console.log(r.id)\")
echo target=\$TARGET
curl -sS -i -X POST https://app.hawaiigroup.co/staff-manager/api/attendance/force-check-in -H \"Authorization: Bearer \$TOKEN\" -H 'Content-Type: application/json' -d \"{\\\"staff_id\\\":\$TARGET,\\\"date\\\":\\\"2026-05-19\\\",\\\"reason\\\":\\\"테스트\\\"}\" | head -10"
```
Expected: 403 `{"error":"forbidden_business"}`.

- [ ] **Step 6: 검증 — 매니저가 본인 사업장 직원 (200)**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "set -e
TOKEN=\$(curl -sS -X POST https://app.hawaiigroup.co/staff-manager/api/login -H 'Content-Type: application/json' -d '{\"username\":\"ysg\",\"password\":\"1234\"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"token\"])')
TARGET=\$(node -e \"const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db'); const ysg=db.prepare('SELECT business FROM staff WHERE id=1').get().business; const r=db.prepare('SELECT id FROM staff WHERE business=? AND id!=1 AND is_active=1 LIMIT 1').get(ysg); console.log(r?r.id:0)\")
echo target=\$TARGET
[ \"\$TARGET\" != \"0\" ] || { echo SKIP: no other staff in ysg business; exit 0; }
curl -sS -i -X POST https://app.hawaiigroup.co/staff-manager/api/attendance/force-check-out -H \"Authorization: Bearer \$TOKEN\" -H 'Content-Type: application/json' -d \"{\\\"staff_id\\\":\$TARGET,\\\"date\\\":\\\"2026-05-19\\\",\\\"reason\\\":\\\"퇴근 깜빡\\\"}\" | head -10"
```
Expected: 200, `check_out_override_by` 기록됨.

- [ ] **Step 7: 정리 — 테스트로 만든 강제 체크인 row 삭제**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "node -e \"
const db=require('better-sqlite3')('/home/ubuntu/.openclaw/workspace/staff-manager/staff.db');
const r = db.prepare(\\\"DELETE FROM attendance WHERE date='2026-05-19' AND (check_in_override_by IS NOT NULL OR check_out_override_by IS NOT NULL)\\\").run();
console.log('deleted', r.changes);
\""
```

> 주의: 만약 ysg/구엔/미가 user의 password가 '1234'가 아니면 위 검증은 401. 실제 password를 모르면 SQL로 임시 변경 후 테스트, 끝나면 원복.

- [ ] **Step 8: 커밋**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace && git add staff-manager/server.js && git commit -m 'feat(staff-manager): admin/manager force-check-in/out endpoints

POST /api/attendance/force-check-in and /force-check-out for cases
where GPS validation blocks a legitimate check-in. Admin can override
any staff; manager only same-business staff. Records override_by user
id and appends reason to note. Reuses staff-manager auth pattern
(role + getMyBusiness).' && git push"
```

---

## Task 5: 프론트엔드 — 직원 근태 화면 GPS 추가

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/public/index.html`

**목표:** 출/퇴근 버튼이 `navigator.geolocation`으로 좌표 얻은 뒤 API 호출. 에러별 사용자 안내.

- [ ] **Step 1: 현재 체크인/아웃 버튼 핸들러 찾기**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "grep -n 'attendance/check-in\\|attendance/check-out\\|/check-in\\|/check-out' /home/ubuntu/.openclaw/workspace/staff-manager/public/index.html | head -10"
```
Expected: API 호출 코드 라인 번호 (변동 가능).

- [ ] **Step 2: index.html 다운로드 + 핸들러 교체**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/public/index.html "C:\Users\Asus\AppData\Local\Temp\sm-index.html"
```

기존의 fetch 호출 (`fetch('/staff-manager/api/reports/attendance/check-in', { method:'POST', ...})`) 부분을 다음 헬퍼로 교체:

```js
async function getMyLocation() {
  if (!navigator.geolocation) throw new Error('GPS_NOT_SUPPORTED');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(err),
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

async function callAttendance(action) {  // action: 'check-in' | 'check-out'
  let coords;
  try {
    coords = await getMyLocation();
  } catch (err) {
    if (err && err.code === 1) return alert('위치 권한이 거부됐습니다.\n브라우저 설정에서 위치 권한을 허용해주세요.');
    if (err && err.code === 3) return alert('위치 확인 시간 초과.\n야외에서 다시 시도해주세요.');
    if (err && err.message === 'GPS_NOT_SUPPORTED') return alert('이 브라우저는 GPS를 지원하지 않습니다.');
    return alert('위치 확인 실패: ' + (err && err.message));
  }
  const res = await fetch('/staff-manager/api/reports/' + (action === 'check-in' ? 'attendance/check-in' : 'attendance/check-out'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coords),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    if (data.bootstrapped) alert('첫 체크인 — 이 위치가 사업장 기준점으로 등록됐습니다.');
    location.reload();
    return;
  }
  if (data.error === 'out_of_range') return alert(`사업장에서 약 ${data.distance_m}m 떨어져 있습니다.\n사장님께 강제 체크인을 요청하세요.`);
  if (data.error === 'business_not_configured') return alert(`${data.business} 사업장 위치가 아직 등록되지 않았습니다.\n사장님이 먼저 한 번 체크인하시면 자동 등록됩니다.`);
  if (data.error === 'gps_too_inaccurate') return alert(`GPS 신호가 약합니다 (정확도 ${data.accuracy_m}m).\n야외에서 다시 시도하세요.`);
  if (data.error === 'no_business_assigned') return alert('소속 사업장이 지정되지 않았습니다.\n사장님께 문의하세요.');
  if (data.error === 'already_checked_in') return alert('이미 출근 체크인 완료 (' + new Date(data.check_in).toLocaleTimeString() + ')');
  if (data.error === 'already_checked_out') return alert('이미 퇴근 체크아웃 완료');
  if (data.error === 'check_in_required') return alert('먼저 출근 체크인을 해주세요.');
  alert('실패: ' + (data.error || res.status));
}
```

그리고 출근/퇴근 버튼 onclick을 `callAttendance('check-in')` / `callAttendance('check-out')`으로 연결.

기존 코드가 인라인 fetch였다면 `callAttendance(...)` 호출로 교체. 새 헬퍼는 `<script>` 영역에 추가.

- [ ] **Step 3: 업로드**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-index.html" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/public/index.html
```

(staff-manager는 정적 파일이라 pm2 재시작 불필요. nginx etag도 비활성화돼있음 — server.js:31 `etag: false`)

- [ ] **Step 4: 수동 브라우저 검증**

브라우저에서 `https://app.hawaiigroup.co/staff-manager/` 열고 직원 PIN 로그인 → 출근 버튼 클릭.

기대 동작:
- 위치 권한 팝업 → 허용 → 좌표 받아서 API 호출 → 성공 모달 → 페이지 리로드
- 권한 거부 → "위치 권한이 거부됐습니다" 모달
- 휴대폰 비행기 모드 / 실내 깊은 곳 → 정확도 부족 또는 타임아웃 모달

자동 검증 불가 (Geolocation API는 브라우저 환경 필요). UI 변경은 사장님 직접 확인 권장.

- [ ] **Step 5: 커밋**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace && git add staff-manager/public/index.html && git commit -m 'feat(staff-manager): geolocation on attendance check-in/out UI

Replace direct fetch with callAttendance() that prompts the browser
for GPS coords via navigator.geolocation (timeout 10s, high accuracy)
and sends them to the server. Maps each backend error to a Korean
user message: out_of_range, business_not_configured,
gps_too_inaccurate, no_business_assigned, plus the existing
already_checked_in/out cases.' && git push"
```

---

## Task 6: 프론트엔드 — 사장 관리 화면 강제 체크인 UI

**Files:**
- Modify: `/home/ubuntu/.openclaw/workspace/staff-manager/public/index.html` (admin 영역)

**목표:** 사장/매니저가 보는 관리 화면에 "강제 체크인" 폼 추가. 직원 드롭다운(매니저면 본인 사업장만) + 날짜 + 종류 + 사유.

- [ ] **Step 1: 관리 화면의 근태 관련 섹션 찾기**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "grep -n '근태\\|attendance\\|출근\\|퇴근' /home/ubuntu/.openclaw/workspace/staff-manager/public/index.html | head -20"
```
Expected: 관리자용 근태 관리 섹션 또는 직원 목록 섹션 라인.

- [ ] **Step 2: 강제 체크인 폼 HTML 추가**

관리자/매니저 영역(role 체크된 화면)에 새 카드 추가. 위치는 근태/직원 관리 탭 근처:

```html
<div class="card" id="force-attendance-card" style="display:none">
  <h3>⚠️ 강제 체크인/아웃</h3>
  <p style="color:#666;font-size:0.9em">사업장 밖 직원을 수동으로 처리 (위치 검증 우회)</p>
  <select id="fa-staff" style="width:100%;margin-bottom:8px"></select>
  <input type="date" id="fa-date" style="width:100%;margin-bottom:8px"/>
  <label><input type="radio" name="fa-type" value="in" checked> 출근</label>
  <label style="margin-left:16px"><input type="radio" name="fa-type" value="out"> 퇴근</label>
  <textarea id="fa-reason" placeholder="사유 (예: GPS 안 잡힘, 외근)" rows="2" style="width:100%;margin-top:8px"></textarea>
  <button onclick="submitForceAttendance()" style="width:100%;margin-top:8px;background:#e67e22;color:white;padding:10px;border:none;border-radius:4px">강제 체크인 실행</button>
</div>
```

JS:
```js
async function initForceAttendanceUI(user) {
  if (user.role !== 'admin' && user.role !== 'manager') return;
  document.getElementById('force-attendance-card').style.display = '';
  document.getElementById('fa-date').value = new Date().toISOString().split('T')[0];
  // 직원 목록: 매니저면 본인 사업장 — /api/staff 가 이미 그렇게 필터링함 (server.js 70-78 line)
  const res = await fetch('/staff-manager/api/staff', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('staff_mgr_token') } });
  const list = await res.json();
  const sel = document.getElementById('fa-staff');
  sel.innerHTML = '<option value="">직원 선택...</option>' + list.map(s => `<option value="${s.id}">${s.name} (${s.business})</option>`).join('');
}

async function submitForceAttendance() {
  const staff_id = parseInt(document.getElementById('fa-staff').value, 10);
  const date = document.getElementById('fa-date').value;
  const type = document.querySelector('input[name="fa-type"]:checked').value;
  const reason = document.getElementById('fa-reason').value.trim();
  if (!staff_id || !date || !reason) return alert('직원, 날짜, 사유를 모두 입력하세요.');
  const url = '/staff-manager/api/attendance/force-check-' + (type === 'in' ? 'in' : 'out');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('staff_mgr_token'),
    },
    body: JSON.stringify({ staff_id, date, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    alert('강제 체크인 완료');
    document.getElementById('fa-reason').value = '';
  } else if (data.error === 'forbidden_business') {
    alert('본인 사업장 직원만 처리할 수 있습니다.');
  } else if (data.error === 'staff_not_found') {
    alert('해당 직원이 없습니다.');
  } else {
    alert('실패: ' + (data.error || res.status));
  }
}
```

초기화: 기존 admin 로그인 성공 콜백(예: `onAdminLogin(user)`)에서 `initForceAttendanceUI(user)` 호출. localStorage 키 이름은 기존 admin 토큰 저장 위치에 맞춰 조정.

> 주의: 기존 admin 토큰을 어디 저장하는지(localStorage / sessionStorage / 쿠키 등) 코드 읽고 맞출 것. `staff_mgr_token`은 추측 — 실제 이름 확인 후 수정.

- [ ] **Step 3: 업로드**

```bash
scp -i "C:\Users\Asus\Downloads\eunice-key.pem" "C:\Users\Asus\AppData\Local\Temp\sm-index.html" ubuntu@3.93.96.130:/home/ubuntu/.openclaw/workspace/staff-manager/public/index.html
```

- [ ] **Step 4: 수동 브라우저 검증**

`https://app.hawaiigroup.co/staff-manager/` 관리자 로그인 → 강제 체크인 카드 보이는지 확인 → 직원 드롭다운 채워졌나 확인 → 임의 직원 + 사유 입력 → 실행 → DB에 row 생성 확인.

매니저 계정으로도 로그인해서 본인 사업장 직원만 드롭다운에 나오는지 확인.

- [ ] **Step 5: 커밋**

```bash
ssh -i "C:\Users\Asus\Downloads\eunice-key.pem" ubuntu@3.93.96.130 "cd /home/ubuntu/.openclaw/workspace && git add staff-manager/public/index.html && git commit -m 'feat(staff-manager): admin force check-in/out UI

Add card visible to admin/manager users in the management view.
Dropdown is populated from /api/staff (already filtered per role +
business). Calls /api/attendance/force-check-in|out with reason.
Manager only sees their own business staff (server enforces it
again).' && git push"
```

---

## 최종 점검

- [ ] **회귀: 기존 직원이 GPS 데이터 안 보내고 호출하면?**

  Task 3 이후 위치 누락 시 400. 즉 기존 직원이 새 프론트 받기 전에 옛날 캐시로 호출하면 모두 실패. 배포 시점에 모든 직원이 새로고침 필요. 알림 또는 캐시 무효화 헤더 고려.

  실제 영향: index.html은 `etag: false`(server.js:31) — 새로고침하면 무조건 새 버전. 단, 사용자가 브라우저 탭 안 닫고 있으면 옛 JS가 메모리에 남음. 직원 채팅방에 "새로고침 한 번 해주세요" 공지 필요.

- [ ] **부트스트랩 가이드**

  배포 후 사장님이 각 사업장에서 PIN 로그인 → 출근 → 좌표 등록되는 순서로 진행 안내. 한 번에 다 못 돌면 직원들은 그 사업장 좌표 등록 전까지 `business_not_configured` 모달 보게 됨.

- [ ] **메모리 업데이트 권장**

  배포 완료 후 `memory/staff_pin_lockout_pattern.md` 옆에 `geofence_attendance.md` (project 메모리) 추가 — 부트스트랩 절차, 좌표 SQL 수정 방법, force-check-in 권한 정리.
