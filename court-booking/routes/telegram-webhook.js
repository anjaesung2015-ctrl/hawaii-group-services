// 텔레그램 webhook: 인라인 버튼(승인/거절) 콜백 처리.
// 보안 2중: ① secret 토큰 헤더 일치 ② 콜백 발신자가 승인된 staff chat_id
// allowed_updates=['callback_query']로 설정하므로 일반 메시지는 애초에 오지 않음.
const express = require('express');
const { db } = require('../db');
const { log: auditLog } = require('../audit-log');
const tg = require('../telegram-client');
const { applyDecision } = require('./approval-tx')(db);

module.exports = () => {
  const router = express.Router();

  router.post('/webhook', express.json(), async (req, res) => {
    // ① secret 검증 (Telegram이 setWebhook 시 등록한 secret을 헤더로 보냄)
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (!secret || got !== secret) return res.sendStatus(403);

    // 텔레그램엔 즉시 200 (재시도 폭주 방지). 실제 처리는 콜백 API로.
    res.sendStatus(200);

    try {
      const cq = req.body && req.body.callback_query;
      if (!cq) return; // 버튼 콜백만 처리

      const fromId = String((cq.from && cq.from.id) || '');
      const staffChat = String(process.env.TELEGRAM_STAFF_CHAT_ID || '');
      // ② 권한: 승인된 staff만
      if (!staffChat || fromId !== staffChat) {
        await tg.answerCallbackQuery(cq.id, '권한이 없습니다.').catch(() => {});
        return;
      }

      const m = /^cbk:(approve|reject):(\d+)$/.exec(cq.data || '');
      if (!m) { await tg.answerCallbackQuery(cq.id, '알 수 없는 동작입니다.').catch(() => {}); return; }
      const action = m[1];
      const bookingId = parseInt(m[2], 10);

      const result = applyDecision(bookingId, action);

      auditLog({
        actor_type: 'admin', action: `booking.${action}`,
        entity_type: 'booking', entity_id: bookingId,
        metadata: { via: 'telegram', actor_telegram: fromId, result: result.status }
      });

      // 결과를 메시지/토스트에 반영
      let suffix, toast;
      if (result.status === 'done') {
        suffix = action === 'approve' ? '\n\n✅ 승인됨' : '\n\n❌ 거절됨';
        toast = action === 'approve' ? '승인 처리했습니다.' : '거절 처리했습니다.';
      } else if (result.status === 'already') {
        const label = result.current === 'confirmed' ? '승인' : (result.current === 'cancelled' ? '거절' : result.current);
        suffix = `\n\n(이미 ${label} 처리된 예약)`;
        toast = '이미 처리된 예약입니다.';
      } else {
        suffix = '\n\n(예약을 찾을 수 없음)';
        toast = '예약을 찾을 수 없습니다.';
      }

      const chatId = cq.message && cq.message.chat && cq.message.chat.id;
      const msgId = cq.message && cq.message.message_id;
      const baseText = (cq.message && cq.message.text) || '';
      if (chatId && msgId) {
        // 결과 반영 + 버튼 제거(빈 inline_keyboard)
        await tg.editMessageText(chatId, msgId, baseText + suffix,
          { reply_markup: { inline_keyboard: [] } }).catch(() => {});
      }
      await tg.answerCallbackQuery(cq.id, toast).catch(() => {});
    } catch (e) {
      console.error('[tg-webhook]', e.message);
    }
  });

  return router;
};
