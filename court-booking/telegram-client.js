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

// 임의 Bot API 메서드 호출 (JSON)
function call(method, payload) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN not set'));
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.ok) resolve(j.result);
          else reject(new Error(j.description || method + ' fail'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// 인라인 버튼 포함 메시지 전송. replyMarkup = { inline_keyboard: [[...]] }
function sendWithButtons(chatId, text, replyMarkup, opts = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode || 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup
  });
}

// 버튼 탭에 대한 토스트 응답 (호출해야 버튼 로딩 표시가 사라짐)
function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

// 기존 메시지 본문 수정 (승인/거절 결과 반영). parse_mode 미지정 = 평문(HTML 주입 안전)
function editMessageText(chatId, messageId, text, opts = {}) {
  const payload = { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true };
  if (opts.parse_mode) payload.parse_mode = opts.parse_mode;
  // reply_markup: { inline_keyboard: [] } 를 주면 기존 버튼 제거
  if (opts.reply_markup !== undefined) payload.reply_markup = opts.reply_markup;
  return call('editMessageText', payload);
}

module.exports = { send, sendWithRetry, call, sendWithButtons, answerCallbackQuery, editMessageText };
