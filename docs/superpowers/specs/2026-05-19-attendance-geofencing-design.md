# 근태 50m 지오펜싱 설계

**작성일:** 2026-05-19
**대상 서비스:** staff-manager (포트 6010, `/staff-manager/`)
**관련 파일:** `staff-manager/server.js`, `staff-manager/report-routes.js`, `staff-manager/public/index.html`

## 목적

직원이 사업장 내(반경 50m)에서만 출/퇴근 체크인 가능하도록 지오펜싱 추가. 원격·재택 부정 체크인 방지.

## 요구사항 (브레인스토밍 결과)

1. **기준점:** 사업장(business)별 좌표. 직원은 본인 `staff.business`의 좌표 기준으로 검증.
2. **좌표 등록:** UI 없음. 사장(admin) 또는 매니저(manager)가 해당 사업장에서 첫 체크인 할 때 GPS 좌표가 자동으로 기준점으로 등록(bootstrap).
3. **위반 처리:** 하드 차단(체크인 거부) + 사장이 관리 화면에서 강제 체크인 가능.
4. **적용 범위:** 출근·퇴근 양쪽 모두.
5. **강제 체크인 권한:** admin 전체, manager는 본인 사업장 직원만.
6. **GPS 정확도 보정:** `거리 - 보고된 정확도 ≤ 50m`이면 통과 (GPS 노이즈 보정).
7. **정확도 하한:** 보고된 정확도 > 100m이면 GPS 신호 약함으로 간주, 재시도 안내.

## 데이터 모델

### 신규 테이블: `business_locations`
```sql
CREATE TABLE business_locations (
  business TEXT PRIMARY KEY,           -- staff.business 값과 일치
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,                        -- 부트스트랩 시 GPS 정확도(m)
  set_by_staff_id INTEGER,              -- 누가 부트스트랩했는지
  set_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (set_by_staff_id) REFERENCES staff(id)
);
```

### `attendance` 테이블 컬럼 추가 (감사용)
```sql
ALTER TABLE attendance ADD COLUMN check_in_lat REAL;
ALTER TABLE attendance ADD COLUMN check_in_lng REAL;
ALTER TABLE attendance ADD COLUMN check_in_accuracy REAL;
ALTER TABLE attendance ADD COLUMN check_out_lat REAL;
ALTER TABLE attendance ADD COLUMN check_out_lng REAL;
ALTER TABLE attendance ADD COLUMN check_out_accuracy REAL;
ALTER TABLE attendance ADD COLUMN check_in_override_by INTEGER;   -- 강제 체크인한 user id
ALTER TABLE attendance ADD COLUMN check_out_override_by INTEGER;
```

마이그레이션은 `try { db.exec(...) } catch {}` 방식으로 멱등 처리 (staff-manager 기존 패턴 따름).

## 백엔드 변경

### 1. 기존 PIN 기반 체크인/아웃 확장
파일: `staff-manager/report-routes.js`
대상: `POST /api/reports/attendance/check-in`, `POST /api/reports/attendance/check-out`

#### 요청 형식 변경
```json
{ "lat": 47.918873, "lng": 106.917701, "accuracy": 15.2 }
```

#### 처리 흐름 (양쪽 동일)
1. lat/lng/accuracy 누락 시 → 400 `{error: 'location_required'}`
2. accuracy > 100 → 400 `{error: 'gps_too_inaccurate', accuracy_m}`
3. `staff.business` 조회 → 없는 직원이면 → 400 `{error: 'no_business_assigned'}`
4. `business_locations` 조회:
   - **없음 & 요청자 staff.role IN ('admin','manager')** → INSERT 후 정상 체크인 (bootstrap)
   - **없음 & 일반 직원** → 400 `{error: 'business_not_configured', business}`
   - **있음** → 다음 단계
5. Haversine 거리 계산
6. `distance_m - accuracy_m > 50` → 403 `{error: 'out_of_range', distance_m, accuracy_m, threshold_m: 50}`
7. 통과 시 기존 attendance INSERT/UPDATE에 lat/lng/accuracy도 함께 저장

#### Haversine 구현
```js
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
```

### 2. 신규 강제 체크인 엔드포인트
파일: `staff-manager/server.js` (admin JWT auth 사용 — 기존 `auth` 미들웨어)

```
POST /api/attendance/force-check-in
POST /api/attendance/force-check-out
Body: { staff_id, date, reason }
```

#### 권한 체크
- `req.user.role === 'admin'` → 모든 직원 가능
- `req.user.role === 'manager'` → 대상 직원의 `staff.business`가 매니저의 사업장(`getMyBusiness(req)`)과 같을 때만 (server.js의 기존 패턴 따름)
- 그 외 → 403

#### 동작
- 해당 (staff_id, date) attendance row 조회:
  - 없음 → INSERT (해당 type만 채움)
  - 있음 + 해당 type이 NULL → UPDATE
  - 있음 + 해당 type이 이미 값 있음 → 덮어쓰기 (사장이 의도적으로 호출했으니 신뢰)
- `check_in/check_out`에 현재 시각(ISO)
- `check_in_override_by` 또는 `check_out_override_by`에 `req.user.id`
- `note`에 `[강제 in/out by ${req.user.name}: ${reason}]` 형태로 줄바꿈 후 append (기존 note 보존)

## 프론트엔드 변경

### 1. 직원 근태 화면 (`public/index.html` PIN 인증 영역)

#### 출/퇴근 버튼 클릭 핸들러
```js
async function checkInWithLocation(endpoint) {
  setButtonLoading(true);
  let coords;
  try {
    coords = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve(pos.coords),
        err => reject(err),
        { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
      );
    });
  } catch (err) {
    setButtonLoading(false);
    if (err.code === 1) return showModal('위치 권한이 거부됐습니다. 브라우저 설정에서 허용해주세요.');
    if (err.code === 3) return showModal('위치 확인 시간 초과. 야외에서 다시 시도하세요.');
    return showModal('위치 확인 실패: ' + err.message);
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy })
  });
  setButtonLoading(false);
  const data = await res.json();
  if (!res.ok) return handleCheckInError(res.status, data);
  showToast('체크인 완료');
  refreshAttendance();
}

function handleCheckInError(status, data) {
  if (data.error === 'out_of_range') {
    showModal(`사업장에서 약 ${Math.round(data.distance_m)}m 떨어져 있습니다.\n사장님께 강제 체크인을 요청하세요.`);
  } else if (data.error === 'business_not_configured') {
    showModal(`${data.business} 사업장 위치가 아직 등록되지 않았습니다.\n사장님이 먼저 한 번 체크인하시면 자동 등록됩니다.`);
  } else if (data.error === 'gps_too_inaccurate') {
    showModal(`GPS 신호가 약합니다 (정확도 ${Math.round(data.accuracy_m)}m). 야외에서 다시 시도하세요.`);
  } else if (data.error === 'no_business_assigned') {
    showModal('소속 사업장이 지정되지 않았습니다. 사장님께 문의하세요.');
  } else if (data.error === 'location_required') {
    showModal('위치 정보가 필요합니다.');
  } else {
    showModal('체크인 실패: ' + (data.error || '알 수 없는 오류'));
  }
}
```

### 2. 관리 화면 (admin/manager 로그인 영역)

근태 관리 탭에 새 섹션 추가:

```
⚠️ 강제 체크인
─────────────────────────
직원: [드롭다운: 본인 사업장 직원만 (admin은 전체)]
날짜: [date input, 기본 오늘]
종류: ( ) 출근  ( ) 퇴근
사유: [textarea]
[강제 체크인 실행]
```

## 첫 부트스트랩 시나리오

1. 시스템 배포 직후: `business_locations` 비어있음
2. 사장(안재성, staff.role='admin', staff.business=X) → 사업장 X에서 PIN 로그인 → 출근 버튼 → GPS 자동으로 X 좌표 등록 + 본인 체크인 처리
3. 사장이 사업장 Y 방문 → Y 직원이 체크인 시도 → `business_not_configured` 에러 → 사장이 Y에서 직접 체크인 → Y 좌표 부트스트랩 (사장 본인 attendance는 staff.business=X 기준이라 거리 멀어 차단됨 → 사장이 본인을 force-check-in 또는 그냥 외근으로 처리)
4. 매니저가 본인 사업장에서 첫 체크인 → 그 사업장 좌표 부트스트랩 (admin이 아직 방문 안 했다면)

**중요:** 위 3번에서 사장은 본인 사업장 기준으로 검증되므로 Y 사업장 부트스트랩이 정상 동작하더라도 사장 본인의 체크인은 거리 위반으로 차단될 수 있음. 이 경우 사장이 본인을 force-check-in 사용. 받아들일만한 트레이드오프 (사장은 사용법 알고 있음).

## 잘못된 좌표 수정 절차

UI 없음. SQL 직접:
```sql
-- 잘못 등록된 좌표를 통째로 지우고 다음 admin/manager 체크인 시 재부트스트랩되게 함
DELETE FROM business_locations WHERE business='센터';
-- 또는 알고 있는 정확한 좌표로 직접 변경
UPDATE business_locations SET lat=?, lng=?, accuracy=NULL WHERE business='센터';
```
정확한 좌표 알아내는 법: 휴대폰 지도 앱(구글맵 등)에서 사업장 위치 길게 누르기 → 좌표 표시.

## 안 만드는 것 (YAGNI)

- 다중 사업장 직원 지원 (staff.business 단일 가정 유지)
- 좌표 변경 UI (DB 직접)
- 사업장 좌표 시각화 (지도 임베드)
- 부트스트랩 알림/감사 로그 (단순 INSERT만)
- 외근/출장용 별도 모드 (force-check-in으로 커버)
- 다중 좌표 (한 사업장에 여러 출입구 등) — 50m 반경이 보통 한 건물 커버

## 마이그레이션·롤백

- 마이그레이션: `CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch {}` 패턴 (staff-manager 기존 방식)
- 롤백: 기능 끄려면 프론트엔드의 GPS 호출만 빼면 됨. 백엔드는 lat/lng 없이 호출 받으면 400만 반환 — 안전.
- 부트스트랩 안 한 상태에서 직원이 체크인 시도하면 안내 모달 뜸. 시스템 전체가 멈추진 않음.

## 검증 계획

1. **부트스트랩**
   - admin PIN으로 사업장 X에서 첫 체크인 → 200 + `business_locations` 행 생성 확인
   - 일반 직원이 좌표 없는 사업장에서 시도 → 400 `business_not_configured`
2. **거리 검증**
   - 사업장 좌표에서 30m 떨어진 지점 시뮬레이션(좌표 직접 전송) → 200
   - 80m + 정확도 20m → 403 (60m > 50)
   - 80m + 정확도 50m → 200 (30m ≤ 50)
3. **GPS 정확도**
   - accuracy=150 → 400 `gps_too_inaccurate`
4. **강제 체크인**
   - admin이 임의 직원 강제 체크인 → 200, `override_by` 기록
   - manager가 다른 사업장 직원 강제 체크인 → 403
   - manager가 본인 사업장 직원 강제 체크인 → 200
5. **회귀**
   - 기존 attendance/today 조회 정상 (스키마 추가만 했으니 기존 SELECT 영향 없음)
   - 기존 admin 대시보드 출근 카운트 정상

## 커밋 계획 (예상)

1. `feat(staff-manager): add business_locations table + attendance geo columns` (마이그레이션만, 동작 변경 없음)
2. `feat(staff-manager): geofence check-in/out with bootstrap` (백엔드 핵심)
3. `feat(staff-manager): force check-in API for admin/manager` (백엔드 강제)
4. `feat(staff-manager): geolocation in attendance UI + force check-in UI` (프론트)
