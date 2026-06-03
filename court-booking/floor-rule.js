// 1층 코트 물리적 칸(column) 겹침 규칙 (2026-06-03 칸 모델)
// 각 1층 코트가 차지하는 '칸'(floor_cols, 왼→오 1·2·3):
//   테니스1·배구1='1', 테니스2·배구2='2', 테니스3·배구3='3'
//   농구는 큰 코트라 2칸: 농구a='23'(가운데+오른쪽), 농구b='12'(왼쪽+가운데)
//   2층·야외 = null (독립)
// 규칙: 칸이 겹치면 동시 사용 불가. 단, 농구끼리는 충돌 안 함(농구 2면 동시 OK).
// 결과: 농구a→테2·3·배2·3 차단(테1·배1 가능), 농구b→테1·2·배1·2 차단(테3·배3 가능),
//       농구 2면=테·배 전부 차단, 같은 번호 테니스↔배구 동시 불가.
function isBasket(group) { return String(group).endsWith('-basketball'); }

// target/other: { cols: '23'|'1'|null, group_name }
function violatesFloorRule(target, others) {
  const tc = target && target.cols;
  if (!tc) return false;                       // 1층 코트 아니면 무관
  const tCols = tc.split('');
  const tBasket = isBasket(target.group_name);
  return (others || []).some(o => {
    if (!o || !o.cols) return false;
    if (tBasket && isBasket(o.group_name)) return false;  // 농구끼리는 안 막음
    return o.cols.split('').some(ch => tCols.includes(ch));
  });
}

module.exports = { isBasket, violatesFloorRule };
