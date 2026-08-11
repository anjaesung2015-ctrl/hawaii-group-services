# 사장님 개인 업무관리창 설계 (2026-08-11)

## 배경
업무보고 시스템(staff-manager, /staff-manager/)에서 사장님은 `BOSS_REPORT_PW`로 로그인해
직원 5명의 보고만 열람·수정할 수 있다. 사장님 본인의 업무를 적을 공간이 없다.

## 목표
사장님도 직원과 **완전히 동일한** 개인 업무공간(오늘/내일 체크리스트 + 주/월/년 자유메모)을 갖는다.

## 비목표 (YAGNI)
- 직원 현황 요약 대시보드
- 사장님 전용 탭 구성(프로젝트/아이디어 등)
- 사장님 비밀번호의 화면 변경 (계속 .env `BOSS_REPORT_PW`로 관리)

## 데이터 설계
`report_users`에 `role TEXT NOT NULL DEFAULT 'staff'` 컬럼 추가.
`('사장님', role='boss', is_active=1)` 행 1개를 부팅 시 멱등 삽입(`ON CONFLICT(name) DO NOTHING`).
`pin_hash`는 `'!'` 플레이스홀더 — 이름 로그인 쿼리가 `role='staff'`만 조회하므로 도달 불가.

업무 데이터는 **기존 `report_items`를 그대로 사용**한다. 신규 테이블 없음.
마이그레이션은 `report-simple.js` 부팅 시 자동 수행(별도 스크립트 불필요, 테스트 DB에도 동일 적용).

## API 변경
| 엔드포인트 | 변경 |
|---|---|
| `GET /staff-list` | `WHERE is_active=1 AND role='staff'` — 사장님 행 제외 |
| `POST /login` (이름) | 조회 조건에 `AND role='staff'` 추가 |
| `POST /login` (사장님) | JWT payload에 `staff_id`(사장님 행 id) 포함, 응답에 `my_id` 반환 |
| `targetStaffId()` | 사장님이 `staff_id`를 안 보내면 본인 공간으로 폴백 |
| `POST /reset-password` | 대상이 `role='boss'`면 403 `boss_row` |

items CRUD(`GET/POST/PATCH/DELETE /items`)는 코드 변경 없음 — 사장님은 이미 임의 `staff_id`로 접근 가능.

## 화면 설계
헤더의 기존 직원 선택 드롭다운 맨 위에 `🏠 내 업무`(value=`my_id`) 항목을 추가하고
로그인 직후 기본 선택으로 둔다. 탭·체크리스트·자유메모 렌더 코드는 그대로 재사용 — 새 화면 없음.

`비번변경` 패널: 사장님이 `내 업무`를 선택한 상태면 폼 대신
"사장님 비밀번호는 서버 설정(.env)에서 관리합니다" 안내만 표시한다.

## 권한
- 직원 세션은 서버가 항상 본인 `staff_id`로 강제 → 사장님 업무 열람·수정 불가
- 로그인 이름 목록에 사장님이 없으므로 직원이 사장님 계정 로그인 시도 불가
- 사장님 행은 비번 리셋 대상에서 제외

## 테스트 (5건 추가, 기존 20건 유지)
1. `/staff-list`에 사장님 미포함
2. 사장님 로그인 응답에 `my_id` 포함
3. 사장님이 본인 공간에 항목 생성·조회 가능
4. 직원이 사장님 항목 조회 시 본인 것만 반환 / 수정 시 403
5. `reset-password` 대상이 사장님 행이면 403
