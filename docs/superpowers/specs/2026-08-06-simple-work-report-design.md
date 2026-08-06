# 심플 업무보고 시스템 재구축 설계

- **날짜:** 2026-08-06
- **대상 서비스:** staff-manager (포트 6010, `/staff-manager/`)
- **목표:** 5/31 이후 미사용 상태인 복잡한 staff-manager 프론트(118KB)와 얽힌 보고/근태/체크리스트 기능을 걷어내고, "완전히 심플한" 업무보고 앱으로 재구축한다.

## 1. 배경

- 기존 staff-manager는 업무보고(work_reports, 6필드+몽골어번역), 템플릿 체크리스트/할당(daily_tasks 1006행), 근태 지오펜싱(attendance 0행), PIN 인증, 직원관리가 한 서비스에 엉켜 있음.
- `index.html`이 118KB, 백업 파일만 14개. 데이터는 2026-05-31 이후 멈춤 → 복잡도 때문에 사실상 방치됨.
- 사용자 요청: 오늘/내일/주/월/년 단위의 아주 단순한 업무보고로 전면 재작성.

## 2. 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 사용 주체 | 공유형 — 직원 + 사장님 |
| 시간 구조 | 오늘 중심, 주/월/년은 방향 참고 |
| 오늘/내일 항목 | 체크박스 + 짧은 메모 |
| 주/월/년 항목 | 자유 메모칸 (체크박스 아님) |
| 로그인 | **매니저만 사용**. 매니저/총매니저=이름 선택(PIN/비번 없음), 사장님(대표)=비밀번호. 코치·일반직원 제외 |
| 보기 권한 | 사장님=전체, 직원=본인 것만 |
| 몽골어 번역 | 제거 (직원이 한국어로 작성) |
| 근태/PIN/직원관리 UI | 제거 |
| 옛 데이터(1006행 등) | 백업만 남기고 폐기 |

## 3. 절대 보존 (다른 서비스 의존성)

갈아엎어도 아래는 반드시 유지 — 안 그러면 court-booking/POS/비서가 깨진다.

| 보존 대상 | 이유 |
|---|---|
| `staff.db`의 `staff`(19명)·`users`(4계정) 테이블 | POS·ceo-secretary가 이 DB 파일을 직접 읽음 |
| `/api/login` (username/password → `staff_token` JWT, payload `{id,username,name,role,staff_id}`, 서명키 `STAFF_MGR_SECRET`) | court-booking·POS의 SSO가 이 토큰을 검증 |
| `/staff-manager/login` 경로 | court-booking이 미로그인 시 여기로 리다이렉트 |

→ SSO 로그인 기계장치는 뒤에 유지하고, 앞단(업무보고 UI)만 새로 만든다.

## 4. 아키텍처

- 기존과 동일 스택: Node.js/Express + SQLite(`staff.db`) + pm2, 포트 6010 유지.
- 프론트: 바닐라 단일 페이지(`public/index.html`), 서버 렌더링 최소.
- 서버 파일 구조 정리:
  - `server.js` — 앱 부팅, 정적 서빙, SSO용 `/api/login`(기존 유지), 새 보고 라우트 마운트.
  - `report-simple.js`(신규) — 새 업무보고 API. 기존 `report-routes.js`는 백업 후 제거.
  - 제거 대상 파일은 `*.bak-simple-20260806`로 백업 후 삭제/미참조.

## 5. 데이터 모델 (신규 테이블)

```sql
CREATE TABLE report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  period TEXT NOT NULL,          -- today | tomorrow | week | month | year
  item_date TEXT NOT NULL,       -- 오늘/내일=해당 날짜, 주/월/년=기준일(주 시작일/월 1일/연 1월1일)
  title TEXT,                    -- 오늘/내일: 체크 항목 제목
  memo TEXT,                     -- 오늘/내일: 짧은 메모 / 주·월·년: 자유 메모 본문
  done INTEGER DEFAULT 0,        -- 오늘/내일만 사용
  created_at TEXT DEFAULT (datetime(now,localtime)),
  updated_at TEXT,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
```

- 오늘/내일: 한 항목 = 한 체크박스(title) + 메모(memo), done 토글.
- 주/월/년: 항목 하나에 자유 메모(memo)만 사용, done 무시. (기간별 1개 자유 메모칸으로 취급)
- 이름 목록은 기존 `staff` 중 `is_active=1 AND role IN ('매니저','총매니저')` 재활용. 코치·일반직원·대표는 목록에서 제외.
- **날짜 롤오버:** 탭은 상대 날짜로 조회한다. 오늘 탭 = 오늘 날짜, 내일 탭 = 오늘+1. 따라서 어제 "내일"로 적어둔 항목은 오늘이 되면 그 item_date가 오늘과 일치해 자동으로 "오늘" 탭에 나타난다. 별도 이동 로직 불필요.

## 6. 화면 (한 페이지)

```
┌───────────────────────────────────────┐
│  [내 이름 ▼]              (사장님 🔒)    │
├───────────────────────────────────────┤
│  오늘 · 내일 │ 주 · 월 · 년(방향 참고)   │
├───────────────────────────────────────┤
│  ☐ 코트 청소       [메모…]              │
│  ☑ 레슨 준비 완료  [볼 30개]            │
│  + 항목 추가                            │
└───────────────────────────────────────┘
```

- 상단: 매니저 이름 드롭다운 선택 → 본인 보고. 사장님은 🔒 클릭 후 비번 → 전체 매니저 드롭다운 노출, 골라서 조회.
- 탭: [오늘][내일] = 체크리스트, [주][월][년] = 자유 메모칸.
- 오늘/내일 각 항목: 체크박스 + 제목 + 짧은 메모 인라인 편집, 항목 추가/삭제.

## 7. 로그인/세션 (보안 경계)

- 직원 이름-선택 로그인 → 가벼운 **report 세션 쿠키**(`report_sess`, 예: 서명된 staff_id + isBoss=false)만 발급. 보고 앱 전용.
- **중요:** 이름-선택 로그인은 SSO용 `staff_token`을 절대 발급하지 않는다. (이름만으로 court-booking/POS까지 뚫리면 안 됨)
- 사장님 비번: `.env`의 `BOSS_REPORT_PW`(신규). 통과 시 `report_sess`에 isBoss=true. 사장님은 SSO admin 계정과 별개로 취급(보고 앱 전용 권한).
- 기존 `/api/login`(username/password → staff_token)은 SSO 호환용으로 그대로 둔다.

## 8. API (신규, report-simple.js)

- `GET  /api/staff-list` — 이름 드롭다운용 (id, name).
- `POST /api/report/login` — {name} 또는 {boss_pw} → report_sess 쿠키.
- `GET  /api/report/items?staff_id=&period=&date=` — 조회(직원=본인 강제, 사장=지정 staff).
- `POST /api/report/items` — 항목 추가 {period,item_date,title,memo}.
- `PATCH /api/report/items/:id` — {done|title|memo} 수정.
- `DELETE /api/report/items/:id` — 삭제.
- 권한: report_sess 없으면 401. 직원은 자기 staff_id만, 사장(isBoss)은 전체 허용.

## 9. 마이그레이션/철거 순서

1. `staff.db` 전체 백업(`staff.db.bak-simple-20260806`).
2. `report_items` 테이블 생성.
3. 기존 프론트/라우트/번역/근태/체크리스트 파일 `*.bak-simple-20260806` 백업 후 서비스에서 미참조 처리.
4. `staff`·`users` 테이블 및 `/api/login`·`/staff-manager/login`은 그대로 유지.
5. 옛 보고 테이블(work_reports, daily_tasks 등)은 삭제하지 않고 남겨두되(백업 겸) 새 UI에서 미참조.
6. pm2 restart staff-manager 후 court-booking/POS 로그인 회귀 확인.

## 10. 비목표 (YAGNI)

- 텔레그램 저녁 요약: 이번엔 미포함. 나중에 얹기 쉽게 서버 훅 지점만 주석으로 남김.
- 몽골어 번역, 근태 지오펜싱, PIN 인증 UI, 템플릿/할당 시스템: 전부 제외.
- 과거 기록 조회 UI(날짜 피커 히스토리): 제외.

## 11. 검증

- court-booking `/staff-manager/login` 리다이렉트 → 로그인 → 예약 접근 정상.
- POS 로그인(users JOIN staff) 정상.
- 직원 이름 선택 → 오늘 항목 추가/체크/메모 저장, 새로고침 후 유지.
- 사장님 비번 → 다른 직원 보고 조회 가능, 직원 세션으로는 타인 조회 401.
