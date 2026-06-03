// 1층 물리적 구역 규칙 (2026-06-03 구역모델로 교체)
// 1층 코트는 zone 으로 물리적 위치를 가짐: 'L'(왼쪽) | 'M'(중간) | 'R'(오른쪽)
//   - LEFT  : 농구a, 테니스1, 배구1
//   - MIDDLE: 테니스2, 배구2
//   - RIGHT : 농구b, 테니스3, 배구3
//   - 2층/야외코트는 zone=null (독립, 이 규칙과 무관)
//
// 규칙:
//   (1) 같은 zone 은 물리적으로 같은 자리 → 동시에 1개만.
//   (2) 농구 양쪽(농구a+농구b)이 모두 잡히면 중간(M)도 막힘 = 1층 전체 사용.
// 결과: 테니스 3면(L·M·R)·배구 3면 동시 OK, 농구 2면 OK,
//       농구a 1면이면 테니스1·배구1만 차단(중간·오른쪽은 가능) 등.

function isBasket(group) { return String(group).endsWith('-basketball'); }

// targetCourt: { zone, group_name } — 새로 예약하려는 코트
// otherCourts: [{ zone, group_name }] — 같은 시간대에 겹치는 '다른 코트' 예약들
function violatesFloorRule(targetCourt, otherCourts) {
  const tz = targetCourt && targetCourt.zone;
  if (!tz) return false;                       // 1층 코트가 아니면(2층/야외) 무관

  const others = (otherCourts || []).filter(c => c && c.zone); // 1층 코트만

  // (1) 같은 zone 중복 → 위반
  if (others.some(c => c.zone === tz)) return true;

  // (2) 농구 양쪽 + 중간 동시 → 위반
  const all = [targetCourt, ...others];
  const basketCount = all.filter(c => isBasket(c.group_name)).length;
  const hasMiddle = all.some(c => c.zone === 'M');
  if (basketCount >= 2 && hasMiddle) return true;

  return false;
}

module.exports = { isBasket, violatesFloorRule };
