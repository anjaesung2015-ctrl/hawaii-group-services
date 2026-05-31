---
name: court-booking-1단계-design
description: Hawaii Sports 테니스 코트 셀프 예약 시스템 1단계(MVP) 디자인 명세서
date: 2026-05-31
status: Approved (브레인스토밍 완료)
service_path: .openclaw/workspace/court-booking/
replaces: tennis-app
authors: 안재성 (Jaesung), Claude
---

# Court Booking System — 1단계 (MVP) Design

## 1. 목적 & 배경

Hawaii Sports 센터 부지에 신설되는 하드코트 1면(시공 견적 ₮55M~₮85M, 약 3.5주 시공)에 대한 **고객 셀프 예약 + QPay 결제** 시스템.

- 코트 시공 완료 시점(약 1~2개월 후) 맞춰 정식 출시
- 기존 `tennis-app`(정적 PWA, 빈 껍데기)은 폐기 후 대체
- hawaii-group-services `.openclaw/workspace/` 패턴 그대로 적용 (Express 5 + better-sqlite3 + node-cron)

## 2. 범위 (1단계 = MVP)

### 포함
- 코트 목록 조회
- 1시간 단위 가용성 캘린더 (오늘 ~ +14일)
- 비회원 셀프 예약 (이름/전화/이메일 선택)
- QPay 결제 (15분 타임아웃, 자동 취소)
- 예약 확정 → 이메일(고객, 선택) + Telegram(직원)
- 어드민 대시보드 (예약 목록, 강제 취소, 노쇼 마킹, 현금 수납 처리)
- 어드민 SSO (staff-manager JWT 쿠키 공유)
- 몽골어 1언어

### 제외 (후순위 또는 영구 폐기)
- ❌ **RentalRequest (단체 대관)** — 코트 1면이라 영구 폐기
- ⏸ Member / MembershipPlan / 회원 할인 — 4단계
- ⏸ PricingRule (피크/오프피크) — 2단계
- ⏸ Refund UI — 3단계 (1단계엔 SQL 직접 처리)
- ⏸ BlockedTime UI — Phase 1.5 (1단계엔 SQL 직접 처리)
- ⏸ AuditLog 조회 UI — 3단계 (로그는 1단계부터 쌓음)
- ⏸ 다국어 (en/ko) — Phase 1.5 / 3단계
- ❌ PWA / Service Worker / 오프라인 — 본질적으로 온라인 작업
- ❌ SMS 게이트웨이 — 추가 비용. Phase 2 이후 검토

## 3. 의사결정 요약

| # | 결정 | 근거 |
|---|---|---|
| 1 | 공개 셀프 예약 웹 (vs 어드민 전용) | 코트 1면이라도 24시간 무인 예약 가능, 손님 셀프가 핵심 가치 |
| 2 | MVP 최소 범위 (셀프 + QPay만, 회원/대관 제외) | 검증 우선, 4~6주 출시 |
| 3 | QPay 15분 + 하드락 | 업계 표준, 결제 마찰 적당, 슬롯 회전 보장 |
| 4 | 기존 서비스 패턴 따라가기 (SQLite + Express + 정적 public/) | 학습곡선 0, 운영 일관성 |
| 5 | staff-manager SSO (JWT 공유) | 어드민 계정 중복 관리 회피 |
| 6 | 알림: 화면 + 이메일 + 직원 Telegram (고객 SMS ✗) | 비용 절약, 직원 텔레그램은 이미 있는 인프라 |
| 7 | tennis-app 대체 (데이터 마이그레이션 ✗) | tennis-app은 빈 PWA, 마이그레이션 불필요 |
| 8 | 코트 1면 → RentalRequest 영구 폐기 | 1면은 단체대관 흐름이 본질적으로 안 맞음 |
| 9 | PostgreSQL → SQLite 재설계 | EC2에 PG 없음, 모든 서비스 SQLite 사용 |
| 10 | 접근법 A (모놀리식 단일 server.js + public/) | 빌드 X, 단일 배포, 패턴 정합 |

## 4. 아키텍처 & 배포

### 시스템 위치

```
Cloudflare Tunnel (cf-tennis 유지)
        ↓
nginx (Let's Encrypt SSL)
  /tennis/   → 301 → /booking/ (90일 보존)
  /booking/  → localhost:6031 (court-booking)
  /staff-manager/, /pos/, ... (기존)
        ↓
court-booking (pm2, port 6031)
  Express 5 + better-sqlite3 + node-cron
  ├ 고객 SPA (public/index.html)
  ├ 어드민 SPA (public/admin/)
  ├ REST API (/api/*)
  ├ QPay webhook (/qpay/callback)
  └ SQLite (court.db)
        ↓ JWT 검증
staff-manager (port 6010, SSO 공급자)

외부: QPay API | Telegram API | SMTP (Resend)
```

### 디렉토리 구조

```
.openclaw/workspace/court-booking/
├── server.js                  # Express 부트, 라우터 마운트
├── package.json
├── .env                       # QPAY_*, TELEGRAM_*, JWT_SECRET, SMTP_*
├── court.db                   # SQLite
├── db.js                      # better-sqlite3 wrapper + 트랜잭션 헬퍼
├── auth.js                    # staff-manager JWT 검증
├── qpay-client.js             # QPay invoice/check
├── telegram-client.js         # staff-manager에서 복사
├── email-client.js            # nodemailer + Resend
├── cron-jobs.js               # auto_cancel + completed + safety net
├── routes/
│   ├── public.js              # /api/courts, /api/availability, /api/bookings
│   ├── admin.js               # /api/admin/* (SSO 필수)
│   └── qpay.js                # /qpay/callback
├── migrations/
│   ├── 001_init.sql
│   └── migrate.js
├── test/                      # node:test (의존성 ✗)
└── public/
    ├── index.html             # 고객 SPA
    ├── admin/index.html       # 어드민 SPA
    ├── assets/{css,js,img}/
    └── locales/mn.json
```

### 환경변수

```
PORT=6031
NODE_ENV=production
JWT_SECRET=<staff-manager와 공유>
STAFF_MANAGER_URL=http://localhost:6010
QPAY_USERNAME=
QPAY_PASSWORD=
QPAY_INVOICE_CODE=
QPAY_CALLBACK_URL=https://app.hawaiigroup.co/booking/qpay/callback
TELEGRAM_BOT_TOKEN=<공유: @Jaesung2026_bot>
TELEGRAM_STAFF_CHAT_ID=
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=booking@hawaiigroup.co
```

### 배포 흐름

| 단계 | 명령 |
|---|---|
| 1. 디렉토리 생성 | `mkdir -p .openclaw/workspace/court-booking` |
| 2. 초기화 | `npm init -y && npm i express@5 better-sqlite3 jsonwebtoken cookie-parser bcryptjs node-cron dotenv nodemailer` |
| 3. 마이그레이션 | `node migrations/migrate.js` |
| 4. pm2 등록 | `pm2 start server.js --name court-booking && pm2 save` |
| 5. nginx | `location /booking/ { proxy_pass http://localhost:6031/; }` |
| 6. tennis-app 폐기 | 베타 1주 후 진행 (10절 참조) |

## 5. 데이터 모델 (SQLite)

### 1단계 테이블 (4개)

`migrations/001_init.sql`:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- court
CREATE TABLE court (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_mn         TEXT NOT NULL,
  group_name      TEXT NOT NULL DEFAULT 'main',
  sport           TEXT NOT NULL DEFAULT 'tennis'
                  CHECK (sport IN ('tennis')),
  open_hours      TEXT NOT NULL,        -- JSON: {"0":{"open":"06:00","close":"22:00"},...}
  price_per_hour  INTEGER NOT NULL CHECK (price_per_hour > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- booking
CREATE TABLE booking (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_code     TEXT NOT NULL UNIQUE,   -- 'BK' + 4 alphanumeric
  court_id        INTEGER NOT NULL REFERENCES court(id),
  booking_date    TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC+8 로컬)
  start_time      TEXT NOT NULL,          -- 'HH:MM'
  end_time        TEXT NOT NULL,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  guest_email     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','no_show','completed')),
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  confirmed_at    TEXT,
  cancelled_at    TEXT,
  cancelled_by    TEXT,                   -- 'system' | 'customer' | JWT.sub
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

-- payment
CREATE TABLE payment (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES booking(id),
  provider          TEXT NOT NULL DEFAULT 'qpay'
                    CHECK (provider IN ('qpay','cash')),
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

-- audit_log (UI 없음, SQL 조회만)
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      TEXT,                     -- JWT.sub or NULL
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('admin','system','customer')),
  action        TEXT NOT NULL,            -- 'booking.create' 등
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  metadata      TEXT,                     -- JSON
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
```

### 슬롯 겹침 처리 (앱 트랜잭션)

SQLite는 `EXCLUDE` 제약 없음. `better-sqlite3`의 `db.transaction()`이 BEGIN IMMEDIATE로 write-lock을 즉시 잡아 race 방지:

```js
const createBookingSafely = db.transaction((input) => {
  const conflict = db.prepare(`
    SELECT id FROM booking
    WHERE court_id = ? AND booking_date = ?
      AND status NOT IN ('cancelled','no_show')
      AND start_time < ? AND end_time > ?
  `).get(input.court_id, input.booking_date, input.end_time, input.start_time);

  if (conflict) throw new Error('SLOT_CONFLICT');

  const code = generatePublicCode();
  return db.prepare(`INSERT INTO booking (...) VALUES (...)`).run({...input, public_code: code}).lastInsertRowid;
});
```

### 시드

```sql
INSERT INTO court (name_mn, group_name, sport, open_hours, price_per_hour) VALUES (
  'Хавайн теннисний корт №1', 'main', 'tennis',
  '{"0":{"open":"06:00","close":"22:00"},"1":{"open":"06:00","close":"22:00"},
    "2":{"open":"06:00","close":"22:00"},"3":{"open":"06:00","close":"22:00"},
    "4":{"open":"06:00","close":"22:00"},"5":{"open":"06:00","close":"22:00"},
    "6":{"open":"06:00","close":"22:00"}}',
  30000   -- ₮30,000/시간 (placeholder, 시공 완료 시 조정)
);
```

## 6. API 표면

### 공개 (인증 ✗)

| Method | Path | 응답 |
|---|---|---|
| GET | `/api/courts` | `[{id, name_mn, price_per_hour, open_hours}]` |
| GET | `/api/availability?court_id=&date=` | `[{start,end,available:bool}]` |
| POST | `/api/bookings` | `{public_code, qpay_qr_url, qpay_deeplink, expires_at}` |
| GET | `/api/bookings/:public_code` | `{public_code, court, date, time, status, amount}` |
| GET | `/api/bookings/:public_code/payment-status` | `{status: 'awaiting'\|'paid'\|'cancelled'}` |
| POST | `/api/bookings/:public_code/cancel` | `{ok}` (24h 전까지만) |

### 어드민 (JWT cookie 필수)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/admin/bookings?date=&status=&phone=` | 필터링 목록 |
| GET | `/api/admin/bookings/:id` | 상세 + 결제이력 |
| POST | `/api/admin/bookings/:id/cancel` | 강제 취소 (reason 필수) |
| POST | `/api/admin/bookings/:id/no-show` | 노쇼 마킹 |
| POST | `/api/admin/bookings/:id/confirm-cash` | 현금 수납 (payment(cash,paid) + booking confirmed) |
| GET | `/api/admin/courts` | 코트 관리 |
| PATCH | `/api/admin/courts/:id` | 가격/시간/active 변경 |

### Webhook & 페이지

| Method | Path | 설명 |
|---|---|---|
| POST | `/qpay/callback` | QPay 결제 콜백 |
| GET | `/` | 고객 SPA |
| GET | `/admin` | 어드민 SPA |

### 오류 응답

`{ error_code: 'SLOT_CONFLICT', message_mn: '...', message_en: '...' }`

| 코드 | 의미 |
|---|---|
| 400 | 입력 오류 |
| 401 | 어드민 인증 실패 |
| 403 | 권한 부족 |
| 404 | public_code/id 없음 |
| 409 | `SLOT_CONFLICT` / `BOOKING_NOT_CANCELLABLE` |
| 410 | `PAYMENT_EXPIRED` |
| 500 | 외부 API 오류 |

## 7. 예약 플로우 & 엣지케이스

### 해피패스

1. `GET /api/courts` → 코트 목록
2. `GET /api/availability` → 가용 슬롯
3. 손님 정보 입력 → `POST /api/bookings`
   - 트랜잭션: 슬롯 락 → `booking(pending)` + `payment(awaiting, awaiting_until=now+15m)` 생성
   - QPay 인보이스 생성 → `qpay_invoice_id` 저장
   - 응답: `{public_code, qpay_qr_url, qpay_deeplink}`
4. 화면: QR 표시 + 폴링 (3초 간격) `GET /payment-status`
5. 고객 QPay 결제 → QPay → `POST /qpay/callback`
   - QPay API로 검증 (콜백 위조 방지)
   - 트랜잭션: `payment.status='paid'` + `booking.status='confirmed'`
   - 비동기: 이메일 + 직원 텔레그램
6. 폴링이 `paid` 감지 → "예약 확정 ✓ BKQ7X2"

### 엣지케이스

| 상황 | 처리 |
|---|---|
| 15분 내 미결제 | cron 1분: `awaiting AND awaiting_until < now` → `auto_cancelled` + booking `cancelled('system','timeout')` |
| QPay 콜백 누락 | cron 5분: `awaiting AND created_at > now-15m AND created_at < now-1m` → QPay GET 직접 검증 |
| 동시 예약 충돌 | BEGIN IMMEDIATE 트랜잭션 + SELECT 겹침 → 409 `SLOT_CONFLICT`. 프론트 재조회 |
| 페이지 닫음 | 슬롯 15분 락 후 자동 해제. 손님은 `public_code`로 재조회 가능 |
| 더블클릭 | 프론트 disabled + 서버 cooldown: `phone+date+start_time` 60초 내 중복 → 기존 booking 반환 |
| 콜백 멱등성 | `qpay_invoice_id UNIQUE` + `status='paid'` 시 no-op |
| 24h 이내 취소 | 손님 차단, "운영자 문의" 안내 |
| 부분 환불 | 1단계 미지원, 어드민 SQL 처리 + 환불은 QPay/은행 수동 |

## 8. SSO + Cron + 외부 통합

### SSO (`auth.js`)

staff-manager와 `JWT_SECRET` 공유. 로컬 검증, 네트워크 호출 ✗.

```js
function requireAdmin(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ','');
  if (!token) return res.status(401).json({ error_code: 'NO_TOKEN' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!['super_admin','manager','staff'].includes(payload.role))
      return res.status(403).json({ error_code: 'INSUFFICIENT_ROLE' });
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error_code: 'INVALID_TOKEN' });
  }
}
```

**검증 필요** (구현 시작 시): staff-manager JWT payload 키 이름 (`sub`/`role`/`email`), 쿠키 이름, 쿠키 도메인. 다르면 어댑터 추가.

### Cron (`cron-jobs.js`)

```js
cron.schedule('* * * * *',  autoCancelExpiredPayments);   // 1분
cron.schedule('*/5 * * * *', verifyAwaitingPayments);     // 5분 (QPay 안전망)
cron.schedule('*/10 * * * *', markCompletedBookings);     // 10분
```

| Cron | 동작 | 안전성 |
|---|---|---|
| autoCancel | `awaiting AND awaiting_until < now` → cancelled. 트랜잭션 1개 | 15분 후 슬롯 해제 보장 |
| verifyAwaiting | 콜백 누락 대비. QPay GET 직접 조회 | 결제 누락 5% 미만 보장 |
| markCompleted | `confirmed AND booking_date+end_time < now-10m` → completed | 통계용 |

중복 실행 방지: SQLite WAL + 트랜잭션 (단일 프로세스). pm2 cluster 사용 ✗.

### QPay (`qpay-client.js`)

QPay v2:
- `POST /v2/auth/token` → 토큰 (24h 캐시)
- `POST /v2/invoice` → `{invoice_id, qr_text, qr_image, urls}`
- `GET /v2/payment/check?object_id=` → 검증

콜백 핸들러는 항상 QPay API 직접 재검증 (위조 방지) + 멱등.

### Telegram (`telegram-client.js`)

staff-manager에서 **그대로 복사**. 직원용 알림만:

```
🎾 새 예약
코드: BKQ7X2
Bat (99119911)
2026-07-15 18:00~19:00
₮30,000
```

`TELEGRAM_STAFF_CHAT_ID`로 발송. 실패해도 booking 확정에 영향 ✗.

### Email (`email-client.js`)

nodemailer + Resend 무료(100/day). 고객용 확정 이메일만. `guest_email` 없으면 skip. 실패해도 booking 확정에 영향 ✗.

### 통합 매트릭스

| 통합 | 실패 시 동작 |
|---|---|
| SSO (staff-manager) | 401, 로그인 페이지로 |
| QPay 인보이스 생성 | 500, 트랜잭션 롤백 |
| QPay 콜백 | cron 안전망 5분 |
| Telegram (직원) | log만 |
| Email (손님) | log만 |

## 9. 프론트엔드 구조

### 스택 (빌드 ✗)

| 도구 | 용도 |
|---|---|
| Tailwind CSS (CDN, JIT) | 스타일 |
| Alpine.js v3 (~15KB) | 상태/반응성 |
| vanilla fetch | API |
| dayjs (CDN) | 날짜 |
| qrcode.js (CDN, 폴백) | QR (QPay 응답에 qr_image 있으면 불필요) |

### 고객 SPA — 5단계 뷰 (단일 페이지, Alpine `x-show`)

1. **코트 + 날짜 선택** — 캘린더, 오늘~+14일
2. **시간 슬롯 선택** — 1시간 단위, 예약된 슬롯 disabled
3. **손님 정보 입력** — 이름*, 전화*, 이메일, 약관 동의
4. **QPay 결제 (15분 카운트다운)** — QR + deeplink + 폴링
5. **확정** — 확인번호 표시, 캡처/공유 유도

### 어드민 SPA

1페이지 + 액션 모달. 날짜 필터 + 상태 필터 + 전화번호 검색. 코트 설정은 settings 모달로 간소화.

### 모바일 우선

- Tailwind 모바일 → md/lg 분기
- 슬롯 그리드 모바일 4열 / 데스크톱 8열
- `inputmode="tel"`, `autocomplete="tel"` 등
- 터치 타겟 ≥ 44×44px
- 카운트다운 30초 전 `navigator.vibrate(200)`

### i18n

`i18n.js` + `locales/mn.json` (1단계 약 40개 키). `t('key', {vars})` 헬퍼. en/ko는 같은 키로 파일만 추가.

### PWA / 추가

| 항목 | 1단계 |
|---|---|
| manifest.json | ✗ |
| Service Worker | ✗ |
| 다크모드 | ✗ |
| 코트 사진 1~2장 | ✓ |

## 10. 마이그레이션 (tennis-app 폐기)

### 현재 상태
- pm2 슬롯 14: `tennis-app` (uptime 39일, /usr/bin/serve)
- `/home/ubuntu/tennis-app/` (Vite PWA, ~30KB, API 호출 0)
- DB/사용자 데이터 ✗ → **마이그레이션 불필요**

### 절차 (court-booking 베타 1주 후)

```bash
# Phase 1: nginx 301 리다이렉트
# location /tennis/ { return 301 /booking/$request_uri; }
# location /booking/ { proxy_pass http://localhost:6031/; }
sudo nginx -t && sudo systemctl reload nginx

# Phase 2: tennis-app 중지
pm2 stop tennis-app
pm2 delete tennis-app
pm2 save

# Phase 3 (30일 후): 파일 백업 후 삭제
mv /home/ubuntu/tennis-app /home/ubuntu/tennis-app.deleted-$(date +%Y%m%d)
```

301 리다이렉트 보존: **최소 90일**.

### 백업

```bash
# /etc/cron.d/court-booking-backup
0 3 * * * ubuntu sqlite3 /home/ubuntu/.openclaw/workspace/court-booking/court.db \
  ".backup /home/ubuntu/backups/court-$(date +\%Y\%m\%d).db" && \
  find /home/ubuntu/backups -name 'court-*.db' -mtime +30 -delete
```

### 롤백

| 문제 | 롤백 |
|---|---|
| 시작 실패 | pm2 stop + nginx /booking/ 주석. tennis-app 그대로 |
| QPay 다중 실패 | 어드민 토글로 신규 예약 차단 (`court.active=0`) + 텔레그램 알림 |
| DB 손상 | pm2 stop → 최근 백업 복원 → pm2 start |
| 정전 | pm2 startup 설정으로 자동 복구 |

## 11. 테스트 전략

기존 서비스 테스트 없음 → 무거운 프레임워크 ✗. 그러나 슬롯/결제는 자동화 필수.

### 자동화 (`node:test`, 의존성 ✗)

```bash
node --test test/
```

**커버 우선순위**:
1. 슬롯 겹침 (정확/부분/인접 경계)
2. public_code 생성 (충돌 시 재시도)
3. QPay 콜백 멱등성 (같은 invoice 2번)
4. cron auto-cancel (시간 mocking)
5. JWT 검증 (만료/위조)
6. 가용성 계산 (요일별)

### 수동 (체크리스트)

**1차 (개발자)**:
- 해피패스 (선택 → 예약 → 결제 → 확정)
- 15분 미결제 자동 취소
- 두 브라우저 동시 같은 슬롯 → 한쪽 SLOT_CONFLICT
- 24h 이내 취소 차단
- 어드민 강제 취소 → audit_log 기록
- 모바일 실기기 (iOS Safari + Android Chrome)

**2차 (베타 1주)**:
- 직원 3명 × 5건 = 15건
- 가족/지인 5명 × 2건 = 10건
- 텔레그램 알림 도착
- 이메일 도착 (스팸함 포함)
- QPay 영수증과 booking 금액 일치

### 부하 테스트
1단계 스킵. 코트 1면 + MVP = 동시 시도 매우 적음.

## 12. 출시 기준 (Go/No-Go)

| 항목 | 기준 |
|---|---|
| 자동화 테스트 | 전부 통과 |
| QPay 실거래 | 베타 10건 무사고 |
| 콜백 누락 | 5% 미만 |
| 슬롯 충돌 버그 | 0건 |
| 어드민 SSO | staff-manager 계정으로 1회 정상 로그인 |
| 모바일 UX | iPhone Safari + Android Chrome 2회 무사고 |
| 백업 cron | 1회 실행 확인 |

## 13. 로드맵 (Phase 1.5+)

| Phase | 범위 | 예상 |
|---|---|---|
| **1단계** | 이 문서 (MVP) | 4~6주 |
| **Phase 1.5** | BlockedTime 어드민 UI, en 추가 | +2주 |
| **2단계** | PricingRule (피크/오프피크) | TBD |
| **3단계** | Refund UI, AuditLog 조회, ko 추가 | TBD |
| **4단계** | Member + MembershipPlan + 회원 할인 | TBD |
| **영구 폐기** | RentalRequest (1면 한정) | ❌ |

## 14. Open Questions / 구현 시 검증 사항

구현 1주차에 staff-manager 코드 확인 후 정합 필요:

1. **JWT payload 키 이름** — `sub` vs `user_id` vs `id`? `role` 이름?
2. **JWT 쿠키 이름** — `token`? `staff_token`? 다른가?
3. **쿠키 도메인 설정** — `app.hawaiigroup.co` 전체 커버하는가? `/booking/`도?
4. **JWT 만료/갱신 정책** — court-booking이 만료 처리만 하면 되는가, 갱신도 책임지나?

추가:

5. **QPay 계정** — 인보이스 코드 발급 받았는가? 테스트/프로덕션 분리?
6. **Resend 도메인 인증** — `hawaiigroup.co` SPF/DKIM 설정 필요. 운영자 작업
7. **TELEGRAM_STAFF_CHAT_ID** — 직원 단톡방에 봇 추가하고 chat_id 추출
8. **코트 가격 ₮30,000/시간** — 시공 완료 시점에 시장 조사 후 확정
9. **운영시간 06:00~22:00** — 디폴트, 운영자 결정 필요
10. **약관/개인정보처리방침** — 별도 페이지 필요. 콘텐츠 운영자 제공

## 15. 변경 이력

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-05-31 | 초안 작성 (브레인스토밍 6개 섹션 승인) | Jaesung + Claude |
