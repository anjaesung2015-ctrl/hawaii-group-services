// 롤링 예약 윈도우: 오늘(울란바토르 UTC+8) 포함 N일만 예약 가능.
// 서버가 단일 진실원 — 프론트는 /api/config의 min/max를 사용, 백엔드는 예약 시 재검증.
const WINDOW_DAYS = parseInt(process.env.BOOKING_WINDOW_DAYS || '14', 10);

// 서버 시간대와 무관하게 울란바토르(UTC+8, DST 없음) 기준 오늘 'YYYY-MM-DD' 반환.
function ubTodayStr(now = new Date()) {
  const ub = new Date(now.getTime() + 8 * 3600 * 1000);
  return ub.toISOString().slice(0, 10);
}

// { min: 오늘, max: 오늘+(days-1), days }
function bookingWindow({ days = WINDOW_DAYS, today = ubTodayStr() } = {}) {
  const start = new Date(today + 'T00:00:00Z');
  const max = new Date(start.getTime() + (days - 1) * 86400000).toISOString().slice(0, 10);
  return { min: today, max, days };
}

// dateStr('YYYY-MM-DD')가 윈도우 안인지. 문자열 비교 = 날짜 비교(동일 포맷 전제).
function isWithinWindow(dateStr, opts = {}) {
  const { min, max } = bookingWindow(opts);
  return dateStr >= min && dateStr <= max;
}

module.exports = { WINDOW_DAYS, ubTodayStr, bookingWindow, isWithinWindow };
