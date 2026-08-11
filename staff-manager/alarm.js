// 텔레그램 아침 알람 — 그날 할 일 + 내일 일정 미리 알림
const express = require('express');
const jwt = require('jsonwebtoken');
const { extractDates } = require('./dates');

const PERIOD_KO = { today: '오늘', tomorrow: '내일', week: '주간', month: '월간', year: '연간' };

async function telegramSend(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 미설정');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('telegram ' + r.status);
  return true;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

module.exports = function createAlarm(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const send = opts.send || telegramSend;
  const router = express.Router();

  db.exec(`CREATE TABLE IF NOT EXISTS report_alarm (
    staff_id INTEGER PRIMARY KEY,
    chat_id TEXT,
    enabled INTEGER DEFAULT 1,
    send_at TEXT DEFAULT '09:00',
    last_sent TEXT
  )`);

  // ---- 메시지 만들기 ----
  // 그날 할 일이 하나도 없고 내일 일정도 없으면 null (보내지 않는다)
  function buildMessage(staffId, name, date) {
    const tomorrow = addDays(date, 1);
    const todays = db.prepare(
      "SELECT title, memo, done FROM report_items WHERE staff_id=? AND period IN ('today','tomorrow') AND item_date=? ORDER BY id"
    ).all(staffId, date);

    // 내일 걸린 것: 내일 날짜 항목 + 어느 글에든 내일 날짜가 적힌 것
    const tomorrowItems = db.prepare(
      "SELECT title, memo FROM report_items WHERE staff_id=? AND period IN ('today','tomorrow') AND item_date=? ORDER BY id"
    ).all(staffId, tomorrow);

    const mentions = [];
    for (const row of db.prepare("SELECT period, item_date, title, memo FROM report_items WHERE staff_id=?").all(staffId)) {
      const year = Number(String(row.item_date).slice(0, 4)) || Number(date.slice(0, 4));
      const text = (row.title || '') + ' ' + (row.memo || '');
      if (extractDates(text, year).includes(tomorrow)) {
        mentions.push({ period: row.period, text: [row.title, row.memo].filter(Boolean).join(' · ') });
      }
    }

    if (!todays.length && !tomorrowItems.length && !mentions.length) return null;

    const lines = [`<b>${name}</b> — ${date.slice(5).replace('-', '/')} 업무`];
    if (todays.length) {
      lines.push('', '오늘 할 일');
      for (const it of todays) {
        lines.push(`${it.done ? '✅' : '⬜'} ${it.title || '(제목 없음)'}${it.memo ? ' · ' + it.memo : ''}`);
      }
      const done = todays.filter(i => i.done).length;
      lines.push(`(${done}/${todays.length} 완료)`);
    }
    if (tomorrowItems.length || mentions.length) {
      lines.push('', '내일 예정');
      for (const it of tomorrowItems) lines.push(`• ${it.title || '(제목 없음)'}${it.memo ? ' · ' + it.memo : ''}`);
      for (const m of mentions) lines.push(`• ${m.text}  [${PERIOD_KO[m.period] || m.period}]`);
    }
    return lines.join('\n');
  }

  // ---- 발송 ----
  // date: 'YYYY-MM-DD', now: 'HH:MM'. 설정 시각이 지났고 오늘 아직 안 보냈으면 보낸다.
  async function tick(date, now) {
    const rows = db.prepare(`
      SELECT a.staff_id, a.chat_id, a.send_at, a.last_sent, u.name
      FROM report_alarm a JOIN report_users u ON u.id = a.staff_id
      WHERE a.enabled=1 AND a.chat_id IS NOT NULL AND a.chat_id <> ''
    `).all();
    let sent = 0;
    for (const r of rows) {
      if (r.last_sent === date) continue;
      if (String(now) < String(r.send_at || '09:00')) continue;
      const msg = buildMessage(r.staff_id, r.name, date);
      // 보낼 내용이 없어도 오늘 몫은 처리한 것으로 남겨 중복 시도를 막는다
      if (!msg) { db.prepare("UPDATE report_alarm SET last_sent=? WHERE staff_id=?").run(date, r.staff_id); continue; }
      try {
        await send(r.chat_id, msg);
        db.prepare("UPDATE report_alarm SET last_sent=? WHERE staff_id=?").run(date, r.staff_id);
        sent++;
      } catch (e) {
        console.error('[alarm] 발송 실패 staff', r.staff_id, e.message);   // 다음 tick에 다시 시도
      }
    }
    return sent;
  }

  // ---- 설정 API ----
  router.use((req, res, next) => {
    const tkn = req.cookies?.report_sess;
    if (!tkn) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(tkn, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  });

  function whose(req, provided) {
    if (req.rsess.isBoss) return provided ? Number(provided) : Number(req.rsess.staff_id) || null;
    return Number(req.rsess.staff_id);   // 직원은 언제나 본인
  }

  router.get('/', (req, res) => {
    const id = whose(req, req.query.staff_id);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const row = db.prepare("SELECT staff_id, chat_id, enabled, send_at FROM report_alarm WHERE staff_id=?").get(id);
    res.json(row || { staff_id: id, chat_id: '', enabled: 0, send_at: '09:00' });
  });

  router.post('/', (req, res) => {
    const id = whose(req, req.body?.staff_id);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const { chat_id, enabled, send_at } = req.body || {};
    const at = send_at || '09:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) return res.status(400).json({ error: 'bad_time' });
    db.prepare(`INSERT INTO report_alarm (staff_id, chat_id, enabled, send_at) VALUES (?,?,?,?)
      ON CONFLICT(staff_id) DO UPDATE SET chat_id=excluded.chat_id, enabled=excluded.enabled, send_at=excluded.send_at`)
      .run(id, String(chat_id || '').trim(), enabled ? 1 : 0, at);
    res.json({ ok: true });
  });

  router.post('/test', async (req, res) => {
    const id = whose(req, req.body?.staff_id);
    const row = db.prepare("SELECT a.chat_id, u.name FROM report_alarm a JOIN report_users u ON u.id=a.staff_id WHERE a.staff_id=?").get(id);
    if (!row || !row.chat_id) return res.status(400).json({ error: 'no_chat_id' });
    try {
      await send(row.chat_id, `[업무보고] 알람 테스트입니다. ${row.name} 님, 이 메시지가 보이면 설정이 끝났습니다.`);
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: 'send_failed', detail: e.message });
    }
  });

  return { router, tick, buildMessage };
};
