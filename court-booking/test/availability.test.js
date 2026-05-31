const test = require('node:test');
const assert = require('node:assert');
const { computeSlots, computeAvailability } = require('../availability');

test('06:00~22:00은 16개 1시간 슬롯', () => {
  const slots = computeSlots({ open: '06:00', close: '22:00' });
  assert.strictEqual(slots.length, 16);
  assert.deepStrictEqual(slots[0], { start: '06:00', end: '07:00' });
  assert.deepStrictEqual(slots[15], { start: '21:00', end: '22:00' });
});

test('운영시간 short (10:00~12:00) → 2슬롯', () => {
  const slots = computeSlots({ open: '10:00', close: '12:00' });
  assert.strictEqual(slots.length, 2);
});

test('가용성 계산: 예약 1건 있으면 해당 슬롯만 false', () => {
  const open_hours = JSON.stringify({
    "0":{"open":"06:00","close":"22:00"},
    "1":{"open":"06:00","close":"22:00"},
    "2":{"open":"06:00","close":"22:00"},
    "3":{"open":"06:00","close":"22:00"},
    "4":{"open":"06:00","close":"22:00"},
    "5":{"open":"06:00","close":"22:00"},
    "6":{"open":"06:00","close":"22:00"}
  });
  const taken = [{ start_time: '10:00', end_time: '11:00' }];
  const date = '2026-07-15';
  const result = computeAvailability({ open_hours, date, taken });
  const tenSlot = result.find(s => s.start === '10:00');
  assert.strictEqual(tenSlot.available, false);
  const nineSlot = result.find(s => s.start === '09:00');
  assert.strictEqual(nineSlot.available, true);
});
