const test = require('node:test');
const assert = require('node:assert');
const { ubTodayStr, bookingWindow, isWithinWindow } = require('../booking-window');

const TODAY = '2026-06-11';

test('bookingWindow: 오늘 포함 14일 → min=오늘, max=오늘+13', () => {
  const w = bookingWindow({ days: 14, today: TODAY });
  assert.strictEqual(w.min, '2026-06-11');
  assert.strictEqual(w.max, '2026-06-24');
  assert.strictEqual(w.days, 14);
});

test('isWithinWindow: 오늘은 가능', () => {
  assert.strictEqual(isWithinWindow('2026-06-11', { days: 14, today: TODAY }), true);
});

test('isWithinWindow: 오늘+13(마지막날)은 가능', () => {
  assert.strictEqual(isWithinWindow('2026-06-24', { days: 14, today: TODAY }), true);
});

test('isWithinWindow: 오늘+14는 거절', () => {
  assert.strictEqual(isWithinWindow('2026-06-25', { days: 14, today: TODAY }), false);
});

test('isWithinWindow: 어제는 거절', () => {
  assert.strictEqual(isWithinWindow('2026-06-10', { days: 14, today: TODAY }), false);
});

test('days 변경이 반영됨 (7일이면 max=오늘+6)', () => {
  const w = bookingWindow({ days: 7, today: TODAY });
  assert.strictEqual(w.max, '2026-06-17');
});

test('ubTodayStr: UTC+8 경계 — 16:30Z는 울란바토르로 다음날', () => {
  const now = new Date('2026-06-11T16:30:00Z'); // +8h = 2026-06-12 00:30
  assert.strictEqual(ubTodayStr(now), '2026-06-12');
});
