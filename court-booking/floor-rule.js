// 1층 공유바닥 동시사용 규칙 (SPEC 4.1, 종목 모드)
// group_name 형식: 'floor1-tennis' | 'floor1-basketball' | 'floor1-volleyball' | 'floor2' | 'outdoor'
//   - floor = '-' 앞부분 (같은 floor면 물리적으로 같은 바닥)
//   - sport = '-' 뒷부분 ('-' 없으면 그룹 자체가 단독 코트)
//
// 규칙: 한 종목만 쓰면 그 종목 최대까지(코트 수로 한정).
//       두 종목 이상 섞이면 종목당 1면까지.
function floorOf(group) { return String(group).split('-')[0]; }
function sportOf(group) {
  const p = String(group).split('-');
  return p.length > 1 ? p.slice(1).join('-') : group;
}

// targetGroup을 추가했을 때 같은 floor 동시규칙을 위반하는가?
// otherGroups: 같은 시간대에 겹치는 '다른 코트' 예약들의 group_name 배열
function violatesFloorRule(targetGroup, otherGroups) {
  const fl = floorOf(targetGroup);
  const counts = {};
  for (const g of otherGroups) {
    if (floorOf(g) !== fl) continue;            // 같은 floor만
    counts[sportOf(g)] = (counts[sportOf(g)] || 0) + 1;
  }
  counts[sportOf(targetGroup)] = (counts[sportOf(targetGroup)] || 0) + 1;
  const sports = Object.keys(counts);
  if (sports.length <= 1) return false;          // 단일 종목 → 허용
  return Object.values(counts).some(c => c > 1); // 섞이면 종목당 1면 초과 시 위반
}

module.exports = { floorOf, sportOf, violatesFloorRule };
