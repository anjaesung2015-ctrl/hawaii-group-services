const test = require('node:test');
const assert = require('node:assert');
const { extractDates } = require('../dates');

// 2026-08-10 은 월요일 (그 주: 월10 화11 수12 목13 금14 토15 일16)
const MON = '2026-08-10';
const TUE = '2026-08-11';

test('토요일부터 캠프 → 그 주 토요일', () => {
  assert.deepStrictEqual(extractDates('토요일부터 캠프. 프로그램 잘준비하기', MON), ['2026-08-15']);
});

test('이번주 금요일', () => {
  assert.deepStrictEqual(extractDates('이번주 금요일 회의', MON), ['2026-08-14']);
});

test('다음주 월요일 → 한 주 뒤', () => {
  assert.deepStrictEqual(extractDates('다음주 월요일 출장', MON), ['2026-08-17']);
});

test('담주도 다음주로 본다', () => {
  assert.deepStrictEqual(extractDates('담주 화요일 미팅', MON), ['2026-08-18']);
});

test('지난주 목요일 → 한 주 전', () => {
  assert.deepStrictEqual(extractDates('지난주 목요일 마감', MON), ['2026-08-06']);
});

test('일요일은 그 주의 마지막 날', () => {
  assert.deepStrictEqual(extractDates('일요일 휴무', MON), ['2026-08-16']);
});

test('기준일이 주중이어도 그 주로 계산한다', () => {
  assert.deepStrictEqual(extractDates('월요일 정산', TUE), ['2026-08-10']);
});

test('토요일~일요일 은 범위', () => {
  assert.deepStrictEqual(extractDates('토요일~일요일 캠프', MON), ['2026-08-15', '2026-08-16']);
});

test('요일과 날짜를 같이 써도 둘 다 잡는다', () => {
  assert.deepStrictEqual(extractDates('금요일 준비, 8월 20일 대회', MON), ['2026-08-14', '2026-08-20']);
});

test('없는 요일은 무시한다', () => {
  assert.deepStrictEqual(extractDates('오요일 어쩌구', MON), []);
  assert.deepStrictEqual(extractDates('요일별 정리', MON), []);
});

test('기준 날짜가 없으면(연도만 주면) 요일은 건너뛴다', () => {
  assert.deepStrictEqual(extractDates('토요일부터 캠프', 2026), []);
});

test('기존 날짜 인식은 그대로 동작한다', () => {
  assert.deepStrictEqual(extractDates('8/15 대회', MON), ['2026-08-15']);
  assert.deepStrictEqual(extractDates('8월11일 12일 작업', MON), ['2026-08-11', '2026-08-12']);
  assert.deepStrictEqual(extractDates('8월 대회', MON), []);
});
