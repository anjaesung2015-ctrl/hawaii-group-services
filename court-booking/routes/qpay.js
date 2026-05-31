const express = require('express');
const { db } = require('../db');
const qpay = require('../qpay-client');
const { markPaidByInvoice } = require('./qpay-tx')(db);
const { log: auditLog } = require('../audit-log');

const router = express.Router();

// QPay → 우리
router.post('/callback', express.json(), async (req, res) => {
  const invoice_id = req.query.qpay_invoice_id || req.body?.qpay_invoice_id || req.query.invoice_id || req.body?.invoice_id;
  if (!invoice_id) return res.status(400).end();

  try {
    // 위조 방지: QPay에 직접 재검증
    const check = await qpay.checkPayment(invoice_id);
    const paid = (check.rows || []).some(r => r.payment_status === 'PAID');
    if (!paid) return res.status(200).end();

    const result = markPaidByInvoice(invoice_id);

    if (result.changed) {
      auditLog({
        actor_type: 'system', action: 'payment.paid',
        entity_type: 'booking', entity_id: result.booking_id,
        metadata: { invoice_id }
      });
      const { sendNotificationsForBooking } = require('../notifications');
      setImmediate(() => sendNotificationsForBooking(result.booking_id).catch(e => console.error('[notify]', e.message)));
    }

    res.status(200).end();
  } catch (e) {
    console.error('[qpay/callback]', e.message);
    res.status(200).end();
  }
});

module.exports = router;
