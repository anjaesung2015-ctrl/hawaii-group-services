/**
 * 동호인 레슨 자동 예약 생성
 * 매주 화/목 19:00~21:00 C코트
 * cron으로 매주 일요일 자동 실행 → 다음주 화/목 예약 생성
 */
const db = require('./db');

const LESSON_CONFIG = {
  name: '동호인 레슨',
  facility_id: 3,  // C코트
  days: [2, 4],    // 화(2), 목(4)
  start_time: '19:00',
  end_time: '21:00',
  amount: 0,       // 수업 블록이라 금액은 별도 징수
  weeks_ahead: 2,  // 2주 앞까지 생성
};

function getNextDates(daysOfWeek, weeksAhead) {
  const dates = [];
  const today = new Date();
  for (let d = 0; d < weeksAhead * 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    if (daysOfWeek.includes(date.getDay())) {
      dates.push(date.toISOString().split('T')[0]);
    }
  }
  return dates;
}

function createLessonBookings() {
  const c = LESSON_CONFIG;
  const dates = getNextDates(c.days, c.weeks_ahead);
  let created = 0, skipped = 0;

  for (const date of dates) {
    // 이미 존재하는지 확인
    const exists = db.prepare(
      "SELECT id FROM bookings WHERE facility_id = ? AND booking_date = ? AND start_time = ? AND status != 'cancelled' AND customer_name = ?"
    ).get(c.facility_id, date, c.start_time, c.name);

    if (exists) {
      skipped++;
      continue;
    }

    db.prepare(
      "INSERT INTO bookings (facility_id, customer_name, start_time, end_time, booking_date, amount, payment_method, notes, status, payment_status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(c.facility_id, c.name, c.start_time, c.end_time, date, c.amount, 'lesson', '자동 생성 - 동호인 레슨', 'confirmed', 'paid', 1);
    created++;
  }

  console.log(`[${new Date().toISOString()}] 동호인 레슨: ${created}건 생성, ${skipped}건 스킵 (이미 존재)`);
}

createLessonBookings();
