// telegram-client.js — 텔레그램 메시지 송신
const https = require('https');

function getToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function send(chatId, text, opts = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN not set'));
    if (!chatId) return reject(new Error('chat_id missing'));
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || 'HTML',
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 8000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.ok) resolve(j.result);
          else reject(new Error(j.description || 'tg fail'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function sendWithRetry(chatId, text, opts = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await send(chatId, text, opts); }
    catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { send, sendWithRetry };
