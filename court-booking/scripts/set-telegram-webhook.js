// 텔레그램 webhook 등록/조회. 실행: node scripts/set-telegram-webhook.js [info]
// allowed_updates=['callback_query'] → 버튼 콜백만 수신(공유봇의 일반 메시지엔 영향 최소).
require('dotenv').config();
const tg = require('../telegram-client');

const URL = process.env.TELEGRAM_WEBHOOK_URL
  || 'https://app.hawaiigroup.co/booking/api/telegram/webhook';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

(async () => {
  const mode = process.argv[2];
  if (mode === 'info') {
    console.log(await tg.call('getWebhookInfo', {}));
    return;
  }
  if (mode === 'delete') {
    console.log(await tg.call('deleteWebhook', { drop_pending_updates: true }));
    return;
  }
  if (!SECRET) { console.error('TELEGRAM_WEBHOOK_SECRET 미설정'); process.exit(1); }
  const r = await tg.call('setWebhook', {
    url: URL,
    secret_token: SECRET,
    allowed_updates: ['callback_query'],
    drop_pending_updates: true,
  });
  console.log('setWebhook:', r, '\nurl:', URL);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
