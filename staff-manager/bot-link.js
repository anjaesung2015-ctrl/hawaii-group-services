// 업무보고 전용 봇으로 직원 텔레그램을 자동 연결한다.
// 직원이 앱에서 '텔레그램 연결'을 누르면 1회용 토큰이 담긴 링크가 열리고,
// 봇에서 시작을 누르면 그 사람의 chat_id가 저장된다. 사장님 손이 필요 없다.
//
// 이 봇은 /start <토큰> 외에는 아무 말도 처리하지 않는다 (챗봇 노릇을 하지 않는다).
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TTL_MS = 10 * 60 * 1000;   // 링크는 10분만 유효

module.exports = function createBotLink(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const token = opts.botToken || process.env.REPORT_BOT_TOKEN || '';
  const username = opts.botUsername || '';
  const now = opts.now || (() => Date.now());
  const send = opts.send || (async (chatId, text) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('telegram ' + r.status);
    return true;
  });

  db.exec(`CREATE TABLE IF NOT EXISTS report_link_token (
    token TEXT PRIMARY KEY,
    staff_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_alarm (
    staff_id INTEGER PRIMARY KEY, chat_id TEXT, enabled INTEGER DEFAULT 1,
    send_at TEXT DEFAULT '09:00', last_sent TEXT
  )`);

  function issue(staffId) {
    db.prepare("DELETE FROM report_link_token WHERE staff_id=? OR expires_at < ?").run(staffId, now());
    const tok = crypto.randomBytes(18).toString('base64url');
    db.prepare("INSERT INTO report_link_token (token, staff_id, expires_at) VALUES (?,?,?)")
      .run(tok, staffId, now() + TTL_MS);
    return { token: tok, url: `https://t.me/${username}?start=${tok}`, expires_in: TTL_MS / 1000 };
  }

  // 텔레그램 업데이트 1건 처리. /start <토큰> 만 본다.
  async function handleUpdate(update) {
    const m = update && (update.message || update.edited_message);
    const text = m && typeof m.text === 'string' ? m.text.trim() : '';
    const chatId = m && m.chat && m.chat.id;
    if (!chatId || !/^\/start\s+\S/.test(text)) return false;

    const tok = text.split(/\s+/)[1];
    const row = db.prepare("SELECT * FROM report_link_token WHERE token=?").get(tok);
    if (!row || row.used || row.expires_at < now()) return false;

    const user = db.prepare("SELECT id, name FROM report_users WHERE id=? AND is_active=1").get(row.staff_id);
    if (!user) return false;

    db.prepare(`INSERT INTO report_alarm (staff_id, chat_id, enabled) VALUES (?,?,1)
      ON CONFLICT(staff_id) DO UPDATE SET chat_id=excluded.chat_id, enabled=1`).run(user.id, String(chatId));
    db.prepare("UPDATE report_link_token SET used=1 WHERE token=?").run(tok);

    try {
      await send(chatId, `✅ ${user.name} 님, 업무보고 알림이 연결되었습니다.\n이제 여기로 아침 알림과 사장님 지시가 옵니다.`);
    } catch (e) { console.error('[link] 확인 메시지 실패:', e.message); }
    return true;
  }

  // ---- 폴링 ----
  // 업무보고 전용 봇이라 다른 서비스와 충돌하지 않는다. 토큰이 없으면 아예 돌지 않는다.
  let running = false;
  async function start() {
    if (!token || running) return false;
    running = true;
    let offset = 0;
    (async function loop() {
      while (running) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message"]`,
            { signal: AbortSignal.timeout(60000) });
          const d = await r.json();
          if (d.ok) {
            for (const u of d.result) {
              offset = u.update_id + 1;
              try { await handleUpdate(u); } catch (e) { console.error('[link] 처리 오류:', e.message); }
            }
          } else if (d.error_code === 409) {
            console.error('[link] 다른 곳에서 같은 봇을 수신 중입니다. 폴링을 멈춥니다.');
            running = false;
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 3000));   // 네트워크 오류면 잠시 쉬고 재시도
        }
      }
    })();
    return true;
  }
  function stop() { running = false; }

  // ---- API ----
  const router = express.Router();
  router.use((req, res, next) => {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  });

  function whose(req) {
    if (req.rsess.isBoss) {
      const given = req.query.staff_id || req.body?.staff_id;
      return given ? Number(given) : Number(req.rsess.staff_id) || null;
    }
    return Number(req.rsess.staff_id);
  }

  router.get('/link', (req, res) => {
    const id = whose(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    const row = db.prepare("SELECT chat_id FROM report_alarm WHERE staff_id=?").get(id);
    res.json({ linked: !!(row && row.chat_id), bot: username || null, ready: !!token });
  });

  router.post('/link', (req, res) => {
    const id = whose(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    if (!username) return res.status(503).json({ error: 'bot_not_configured' });
    res.json(issue(id));
  });

  router.delete('/link', (req, res) => {
    const id = whose(req);
    if (!id) return res.status(400).json({ error: 'staff_id_required' });
    db.prepare(`INSERT INTO report_alarm (staff_id, chat_id, enabled) VALUES (?, '', 0)
      ON CONFLICT(staff_id) DO UPDATE SET chat_id='', enabled=0`).run(id);
    res.json({ ok: true });
  });

  return { router, issue, handleUpdate, start, stop };
};
