# 하와이 엘리트선수반 — 설계

2026-10-24 · 사장님 결정 사항을 정리한 문서. 구현 계획은 이 문서를 바탕으로 따로 쓴다.

## 목표

하와이테니스클럽 앱 안에서 동호인반과 **따로** 엘리트선수반을 운영한다:
선수 명단 · 훈련 일정 · 출석 · 수강료 · 선수반 공지.

## 결정 사항 (사장님 답)

| 질문 | 결정 |
|---|---|
| 어디서 관리 | 클럽 앱 안 (coach-app 아님, 별도 앱 아님) |
| 관리 항목 | 선수 명단, 수강료, 훈련 일정, **출석**, **선수반 공지** |
| 선수 로그인 | 한다 — 선수 본인 또는 (주니어면) 부모 번호로 |
| 선수가 보는 범위 | **선수반 화면만**. 동호인 게시판·채팅·회비·명단·공지는 안 보인다 |
| 수강료 | 선수마다 다름 (선수별 월 금액) |
| 관리자 | 오너 + 오너가 지정한 선수반 코치. 동호인 임원(회장·총무 등)은 선수반을 못 본다 |

## 접근 방식

**선수반 데이터를 별도 테이블로, 같은 앱·같은 로그인.**
기존 일정(event)·회비(due) 테이블에 칸을 붙이는 방식은 버린다 — 기존 화면·집계·미납 알림
모든 곳에 필터를 넣어야 하고, 하나라도 빠지면 주니어 선수가 성인 동호인 데이터에 섞인다.

## 계정과 권한

새 칸 (`member`):

- `program TEXT NOT NULL DEFAULT 'club'` — `'club'` | `'elite'`. 기존 회원은 전부 `club`.
- `elite_coach INTEGER NOT NULL DEFAULT 0` — 선수반 관리 권한. 오너만 켜고 끈다. `club` 계정에만.
- 선수 정보: `birth_year INTEGER`, `parent_name TEXT`, `parent_phone TEXT`,
  `elite_fee INTEGER`(그 선수의 월 수강료, 비우면 설정의 기본값), `assigned_coach_id`(담당 코치, member.id, SET NULL).
  레벨은 기존 `member.level`을 그대로 쓴다.

권한 세 갈래:

1. **선수(`program='elite'`)** — 로그인은 기존과 같다(전화번호 8자리 + PIN 4자리).
   주니어는 부모 번호로 계정을 만든다. **번호 하나 = 계정 하나**라 형제는 번호를 달리해야 한다(알려진 한계).
2. **선수반 관리자** = 오너 또는 `elite_coach=1`. 기존 클럽 화면 + 하단 **Elite** 탭.
3. **동호인 임원(admin)** — 선수반 API 전부 403. 기존 클럽 권한은 그대로.

서버 벽:

- `auth.requireClub` 새로 추가 = 로그인 + `program='club'`. events · dues · notices · posts ·
  members · officers · chat 라우터의 `requireMember`를 이것으로 바꾼다 → 선수 계정은 403.
  auth(/me·PIN·사진·프로필) · push · settings · docs(회칙)는 선수도 쓴다.
- `auth.requireEliteStaff` = 오너 또는 `elite_coach=1`.
- `auth.requireElite` = 선수 본인 또는 선수반 관리자.
- 동호인 쪽 회원 목록 쿼리 5곳에 `program='club'` 조건: 회원 명단(routes/members.js),
  회비 현황표·미납자(routes/dues.js 2곳), 매월 10일 미납 알림(lib/jobs.js),
  알림 대상 activeMembers·admins(lib/notify.js). → 선수는 동호인 알림·집계에 안 나온다.
- 로그인(auth/login)은 program을 가리지 않는다. 선수 계정의 `/auth/me`에 `program`이 나간다.

## 화면

**선수(또는 부모)** — 하단 탭 3개만:

1. **Training** — 다가오는 훈련(날짜·시간·코트·코치), 지난 훈련은 내 출석(✓/✗) 표시.
2. **Fees** — 내 월별 수강료·납부 여부 + 계좌 카드(기존 `bankCard` 재사용, 머리글 "Elite tuition").
3. **Notices** — 선수반 공지.

☰ 메뉴: My photo · Change PIN · 알림 켜기 · 로그아웃 (동호인 전용 항목은 숨김).

**오너·선수반 코치** — 기존 앱 + 하단 **Elite** 탭. 탭 안에 칸 5개(위쪽 seg 버튼):

1. **Players** — 사진·이름·출생연도·레벨·담당 코치·부모 연락처·월 수강료. 추가/수정/탈퇴, PIN 재설정.
   선수 추가 = 전화번호 + 이름(+ 첫 PIN, 비우면 번호 뒤 4자리 — 회원 추가와 같은 규칙).
2. **Schedule** — 훈련 등록(제목·날짜·시작/끝·코트·담당 코치·메모). 요일 반복 등록(기존 `events/bulk`
   방식 그대로: 요일+기간, 같은 제목·날짜·시간은 건너뜀, 최대 120개). 수정·삭제.
3. **Attendance** — 훈련 하나를 누르면 활동 선수 명단 + ✓(출석)/✗(결석)/—(미체크) 토글.
4. **Fees** — 월별 현황표(선수별 금액·납부 체크·현금/계좌이체/QPay), 미납자. 기본 월 수강료 설정은 오너만.
5. **Notices** — 선수반 공지 쓰기·고치기·지우기·상단 고정, 사진 1장 (동호인 공지와 같은 모양).

## 데이터

```sql
elite_session (id, title, date, start_time, end_time, court, coach_id → member SET NULL,
               memo, created_by → member SET NULL, created_at)
elite_attendance (session_id → elite_session CASCADE, member_id → member CASCADE,
                  status CHECK IN ('present','absent'), checked_by, checked_at,
                  PRIMARY KEY (session_id, member_id))
elite_due (id, member_id → member CASCADE, period 'YYYY-MM', amount, paid_at, method CHECK IN
           ('cash','transfer','qpay'), note, UNIQUE (member_id, period))
elite_notice (id, title, body, pinned, photo, created_by → member SET NULL, created_at, updated_at)
```

설정(`setting`)에 `elite_fee`(기본 월 수강료). 수강료 줄은 동호인 회비와 같은 원칙 —
미리 만들지 않고 체크할 때 그 시점 금액(선수별 `elite_fee`, 없으면 기본값)으로 생성, 지난 기록은 불변.

## 알림 (웹 푸시, 기존 notifier 재사용)

- 선수반 공지 → 활동 선수 전원 + 선수반 관리자 (작성자 제외).
- 새 훈련 등록(단건) → 활동 선수 전원. 반복 등록은 한 번만 요약 알림.
- 훈련 하루 전 18시 → 활동 선수(동호인 일정 알림과 같은 방식, `elite_session.reminded_at`).
- 매월 10일 10시 → 그 달 수강료 미납 선수(`setting.elite_due_reminder_month`로 월 1회).

## 범위 밖 (이번에 안 함)

- 가입 신청서에서 "선수반" 선택 — 선수는 코치가 직접 등록.
- 선수반 채팅·게시판, 훈련 일지·대회 기록.
- 한 부모 번호로 여러 자녀 — 번호 하나 = 계정 하나.
- 선수반 공지 자동 번역 (동호인 공지만 번역).

## 테스트 (구현 전에 먼저)

- 권한 벽: 선수 → 동호인 API 7개 403 · 동호인 임원 → 선수반 API 403 · 선수반 코치/오너 → 200 ·
  선수는 남의 수강료·출석을 못 봄.
- 섞이지 않음: 선수가 동호인 명단·회비 현황표·미납자·10일 알림·공지 푸시에 안 나옴.
- 일정 반복 등록(건너뜀·120개 제한), 출석 토글, 수강료(선수별 금액·기본값·체크 시점 금액 고정),
  공지 푸시 대상, 하루 전·10일 알림 1회 보장.
- 선수 삭제 시 출석·수강료 CASCADE, 사진 파일 삭제.
