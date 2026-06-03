const { prepare } = require('./db');
const tg = require('./telegram-client');
const email = require('./email-client');

function fetchBookingForNotify(booking_id) {
  return prepare(`
    SELECT b.id, b.public_code, b.booking_date, b.start_time, b.end_time, b.amount,
           b.guest_name, b.guest_phone, b.guest_email, COALESCE(c.name_ko, c.name_mn) AS court_name
    FROM booking b JOIN court c ON c.id = b.court_id WHERE b.id = ?
  `).get(booking_id);
}

async function sendStaffTelegram(b) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_STAFF_CHAT_ID) return { skipped: true };
  const text = `🎾 <b>Шинэ захиалга</b>
Код: <code>${b.public_code}</code>
${b.guest_name} (${b.guest_phone})
${b.court_name}
${b.booking_date} ${b.start_time}~${b.end_time}
₮${b.amount.toLocaleString()}`;
  return tg.send(process.env.TELEGRAM_STAFF_CHAT_ID, text);
}

async function sendNotificationsForBooking(booking_id) {
  const b = fetchBookingForNotify(booking_id);
  if (!b) return;
  const results = await Promise.allSettled([
    email.sendConfirmation(b).catch(e => { console.error('[email]', e.message); throw e; }),
    sendStaffTelegram(b).catch(e => { console.error('[telegram]', e.message); throw e; })
  ]);
  console.log('[notify]', b.public_code, results.map(r => r.status));
}

// 신규 예약 → 사장님에게 [승인]/[거절] 버튼 알림. 입금 확인 후 탭하면 webhook이 처리.
async function sendApprovalRequest(booking_id) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_STAFF_CHAT_ID) return { skipped: true };
  const b = fetchBookingForNotify(booking_id);
  if (!b) return { skipped: true };
  const rate = parseFloat(process.env.DEPOSIT_RATE || '0.5');
  const deposit = Math.round(b.amount * rate);
  const text = `🎾 <b>새 예약 — 승인 대기</b>
코드: <code>${b.public_code}</code>
이름: ${b.guest_name} (${b.guest_phone})
코트: ${b.court_name}
일시: ${b.booking_date} ${b.start_time}~${b.end_time}
금액: ₮${b.amount.toLocaleString()}
계약금: ₮${deposit.toLocaleString()} (${Math.round(rate * 100)}%)

계약금 입금 확인 후 아래 버튼을 누르세요.`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ 승인', callback_data: `cbk:approve:${b.id}` },
      { text: '❌ 거절', callback_data: `cbk:reject:${b.id}` }
    ]]
  };
  return tg.sendWithButtons(process.env.TELEGRAM_STAFF_CHAT_ID, text, keyboard);
}

module.exports = { sendNotificationsForBooking, sendApprovalRequest };
