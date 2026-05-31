const { prepare } = require('./db');
const tg = require('./telegram-client');
const email = require('./email-client');

function fetchBookingForNotify(booking_id) {
  return prepare(`
    SELECT b.id, b.public_code, b.booking_date, b.start_time, b.end_time, b.amount,
           b.guest_name, b.guest_phone, b.guest_email, c.name_mn AS court_name
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

module.exports = { sendNotificationsForBooking };
