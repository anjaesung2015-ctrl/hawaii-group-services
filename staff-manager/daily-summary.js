// daily-summary.js — 매일 21:00에 사장님 텔레그램으로 종합 요약 발송
const cron = require('node-cron');
const { sendWithRetry } = require('./telegram-client');

function todayStr() { return new Date().toISOString().slice(0, 10); }
function dayKoChar() { return ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()]; }

function buildSummary(db, mode = 'simple') {
  const date = todayStr();
  const dayKo = dayKoChar();
  const all = db.prepare("SELECT id,name,name_mn,work_days FROM staff WHERE is_active=1 ORDER BY name").all();
  const expected = all.filter(s => !s.work_days || s.work_days.includes(dayKo));
  const submitted = db.prepare(`SELECT wr.*, s.name FROM work_reports wr JOIN staff s ON s.id=wr.staff_id
    WHERE wr.report_type='daily' AND wr.report_date=? ORDER BY wr.submitted_at`).all(date);
  const submittedIds = new Set(submitted.map(r => r.staff_id));
  const missing = expected.filter(s => !submittedIds.has(s.id));
  let body = `📊 <b>${date} (${dayKo}) 일일보고 종합</b>\n✅ 제출 ${submitted.length}/${expected.length}명\n`;
  if (mode === 'simple') {
    body += '\n' + submitted.map(s => {
      const time = (s.submitted_at || '').slice(11, 16);
      const ko = (s.field_today_ko || s.field_today || '').replace(/\n/g, ' ').slice(0, 80);
      return `• <b>${s.name}</b> (${time}) — ${ko}`;
    }).join('\n');
  } else if (mode === 'detail') {
    body += '\n' + submitted.map(s => `▼ <b>${s.name}</b>\n📝 ${s.field_today_ko || s.field_today || ''}\n📅 ${s.field_tomorrow_ko || s.field_tomorrow || ''}`).join('\n\n');
  } else if (mode === 'names_only') {
    body += '\n' + submitted.map(s => `• ${s.name}`).join('\n');
  }
  body += `\n\n⏳ 미제출 ${missing.length}명`;
  if (missing.length) body += `: ${missing.map(m => m.name).join(' · ')}`;
  return body;
}

async function runSummary(db) {
  const settings = Object.fromEntries(db.prepare("SELECT key,value FROM report_settings").all().map(r => [r.key, r.value]));
  if (!settings.telegram_chat_id) return;
  try {
    await sendWithRetry(settings.telegram_chat_id, buildSummary(db, settings.summary_mode || 'simple'));
  } catch (e) {
    db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)").run(null, 'summary_fail', (e.message || '').slice(0, 200));
  }
}

function start(db) {
  cron.schedule('* * * * *', () => {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const setting = db.prepare("SELECT value FROM report_settings WHERE key='daily_summary_time'").get();
    if (setting && setting.value === `${hh}:${mm}`) runSummary(db);
  });
  console.log('[daily-summary] cron started');
}

module.exports = { start, runSummary, buildSummary };
