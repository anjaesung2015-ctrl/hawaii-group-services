const test = require('node:test');
const assert = require('node:assert');
const { stripLeadingDate } = require('../dates');

const cases = [
  // [원문, 기대]
  ['8월 19일~31일한국국제주니어 테니스대회 인솔', '한국국제주니어 테니스대회 인솔'],
  ['8월11일 12일 인조잔디코트 바닥 흙작업', '인조잔디코트 바닥 흙작업'],
  ['8월12일 샵2층 공사시작', '샵2층 공사시작'],
  ['8/15 대회 인솔', '대회 인솔'],
  ['8/15~8/20 대회 기간', '대회 기간'],
  ['2026-08-15 광복절 행사', '광복절 행사'],
  ['8월 11일, 12일, 15일 코트 작업', '코트 작업'],
  ['12일 회의', '회의'],
];

for (const [src, want] of cases) {
  test(`앞 날짜 제거: ${src.slice(0, 22)}`, () => {
    assert.strictEqual(stripLeadingDate(src), want);
  });
}

const keep = [
  ['3일간 합숙 진행', '기간 표현은 자르지 않는다'],
  ['8시부터11시까지 레슨', '시각은 날짜가 아니다'],
  ['효정이한테 전화해서 서류 받기', '날짜가 없으면 그대로'],
  ['회의 8월 15일', '뒤쪽 날짜는 건드리지 않는다'],
  ['8월 15일', '날짜뿐이면 그대로 둔다'],
  ['8/15~8/20', '범위뿐이면 그대로 둔다'],
];

for (const [src, why] of keep) {
  test(`그대로 유지(${why}): ${src.slice(0, 20)}`, () => {
    assert.strictEqual(stripLeadingDate(src), src);
  });
}

test('빈 값도 안전하다', () => {
  assert.strictEqual(stripLeadingDate(''), '');
  assert.strictEqual(stripLeadingDate(null), '');
  assert.strictEqual(stripLeadingDate(undefined), '');
});
