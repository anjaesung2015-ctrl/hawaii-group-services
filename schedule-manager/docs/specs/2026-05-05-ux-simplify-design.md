# Schedule-Manager UX 단순화 설계 (2026-05-05)

## 목표
지금 사이드바 4개 메뉴 뒤에 5개 화면(주간/연간/캘린더/타임블록/타임노트/타임라인)이 숨어있어서 진입 불가. 이걸 메뉴 늘리지 않고 「일정」 안에 통합해서 클릭 수를 줄인다. 사용자 1명(admin/재성).

## 비목표
- 새로운 데이터 모델/테이블 추가 안 함
- API 신규 추가 안 함 (기존 그대로)
- 디자인 시스템/리팩토링 안 함 (단일 index.html 구조 유지)

## 변경 사항

### 1. 사이드바 (변경 없음)
🏠 대시보드 / 📅 일정 / 🚩 마일스톤 / 🎯 목표 — 4개 그대로.

### 2. 「일정」 화면에 뷰 토글
상단에 5개 탭:
`[오늘] [주간] [월간] [연간] [타임라인]`

- **오늘**: 그날 일정 + timeblock(시간대 계획) + timenote(회고)를 세로 스크롤로 한 페이지에 배치
- **주간**: 기존 loadWeekly() 그대로
- **월간**: 기존 loadCalendar() 그대로
- **연간**: 기존 loadYear() 그대로
- **타임라인**: 기존 loadTimeline() 그대로

탭 상태는 URL hash로 유지 (`#calendar/week` 등). 새로고침/뒤로가기 시 같은 뷰 복귀.

기존 9개 섹션 중 `sec-weekly, sec-year, sec-calendar, sec-timeblock, sec-timenote, sec-timeline`은 `sec-calendar` 하나의 자식 뷰로 흡수. `sec-dashboard, sec-milestones, sec-goals` 3개는 그대로.

### 3. 빠른 추가 FAB
모든 섹션 공통으로 우하단에 `+` 플로팅 버튼. 누르면 `openEventModal()` 호출. 모달은 기존 그대로.

### 4. 모바일 하단 탭바
좁은 화면(≤768px)에서 사이드바를 하단 고정 탭바로 변경. 4개 아이콘 가로 배치. 데스크톱에선 기존 좌측 사이드바 유지.

### 5. 백업/사용 안 하는 파일 정리
- `public/index.html.bak-simplify-20260502-013627` 삭제
- 진입 경로 없던 함수/섹션의 dead-code 흔적 정리 (있다면)

## 동작/데이터 흐름
- API 변화 없음. 기존 `/api/events`, `/api/timeblocks`, `/api/time-notes`, `/api/dashboard`, `/api/milestones`, `/api/goals` 그대로 사용
- 라우팅: `showSec(name)`에 sub-view 인자 추가 → `showSec('calendar', 'today'|'week'|'month'|'year'|'timeline')`
- `location.hash` 파싱 강화: `#calendar/week` → main='calendar', sub='week'

## 테스트 (수동 체크)
- [ ] 사이드바 「일정」 클릭 → 기본 [오늘] 탭이 열림
- [ ] [주간] 탭 클릭 후 새로고침 → [주간] 그대로 유지 (URL hash)
- [ ] [오늘] 탭에서 그날 일정/타임블록/타임노트 모두 보임
- [ ] FAB `+` 버튼이 5개 섹션 모두에서 우하단에 나타남, 클릭 시 모달 열림
- [ ] 모바일 폭(개발자도구 375px)에서 사이드바가 하단 탭바로 변경
- [ ] 데스크톱에서는 좌측 사이드바 유지
- [ ] 592개 일정 데이터 그대로 보임 (DB 변경 없음 확인)

## 위험/고려사항
- 단일 `index.html` 77KB가 더 커짐 → 그러나 새 코드는 ~150줄 추가 수준이라 OK
- timenote가 현재 2개만 입력됨 → 「오늘」 탭에 노출되면 입력 빈도 늘어날 가능성 (의도된 효과)
- 모바일 탭바는 화면 하단을 차지 → `padding-bottom` 보정 필요

## 롤아웃
1. 변경 전 `index.html` 백업 (`index.html.bak-uxsimplify-YYYYMMDD`)
2. 라이브 배포 (혼자 사용이라 단계적 출시 불필요)
3. 1주일 사용 후 「오늘」 탭의 timeblock/timenote 사용 빈도 점검 → 안 쓰면 후속 정리
