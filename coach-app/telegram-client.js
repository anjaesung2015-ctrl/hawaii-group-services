// 사장님 텔레그램 알림 — 환경변수 없으면 silently skip
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '8171404664';

function notify(text, opts = {}) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) {
      console.warn('[telegram] BOT_TOKEN not set, skipping notification');
      return resolve({ skipped: true });
    }
    const body = JSON.stringify({
      chat_id: opts.chat_id || MANAGER_CHAT_ID,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          console.error('[telegram] failed', res.statusCode, data);
          resolve({ ok: false, status: res.statusCode, body: data });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); console.error('[telegram] timeout'); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => { console.error('[telegram] error', e.message); resolve({ ok: false, error: e.message }); });
    req.write(body);
    req.end();
  });
}

module.exports = { notify };
