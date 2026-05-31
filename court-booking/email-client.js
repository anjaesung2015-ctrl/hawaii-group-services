const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporter;
}

function confirmationHtml(b) {
  return `<!doctype html>
<html lang="mn"><body style="font-family:sans-serif">
<h2>🎾 Захиалга баталгаажлаа</h2>
<p>Танай захиалгын код: <b style="font-size:1.5em">${b.public_code}</b></p>
<table style="border-collapse:collapse">
  <tr><td style="padding:4px 12px"><b>Корт</b></td><td>${b.court_name}</td></tr>
  <tr><td style="padding:4px 12px"><b>Өдөр</b></td><td>${b.booking_date}</td></tr>
  <tr><td style="padding:4px 12px"><b>Цаг</b></td><td>${b.start_time} - ${b.end_time}</td></tr>
  <tr><td style="padding:4px 12px"><b>Үнэ</b></td><td>₮${b.amount.toLocaleString()}</td></tr>
</table>
<p style="color:#666">Энэ имэйлийг хадгална уу. Кортод ирэхдээ кодоо үзүүлнэ үү.</p>
</body></html>`;
}

async function sendConfirmation(booking) {
  if (!booking.guest_email) return { skipped: true };
  if (!process.env.SMTP_HOST) { console.warn('[email] SMTP_HOST not set'); return { skipped: true }; }
  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: booking.guest_email,
    subject: `Захиалга баталгаажлаа — ${booking.public_code}`,
    html: confirmationHtml(booking)
  });
  return { messageId: info.messageId };
}

module.exports = { sendConfirmation };
