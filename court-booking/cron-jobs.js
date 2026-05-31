module.exports = (dbOverride) => {
  const db = dbOverride || require('./db').db;

  function autoCancelExpired() {
    const tx = db.transaction(() => {
      const expired = db.prepare(`
        SELECT id, booking_id FROM payment
        WHERE status='awaiting' AND awaiting_until < datetime('now')
      `).all();
      for (const p of expired) {
        db.prepare(`UPDATE payment SET status='auto_cancelled' WHERE id=?`).run(p.id);
        db.prepare(`
          UPDATE booking SET status='cancelled', cancelled_at=datetime('now'),
            cancelled_by='system', cancel_reason='payment_timeout'
          WHERE id=? AND status='pending'
        `).run(p.booking_id);
      }
      return expired.length;
    });
    return tx.immediate();
  }

  async function verifyAwaitingViaQPay() {
    const qpay = require('./qpay-client');
    const { markPaidByInvoice } = require('./routes/qpay-tx')(db);
    const rows = db.prepare(`
      SELECT id, qpay_invoice_id FROM payment
      WHERE status='awaiting' AND qpay_invoice_id IS NOT NULL
        AND created_at < datetime('now','-1 minute')
    `).all();
    let n = 0;
    for (const p of rows) {
      try {
        const check = await qpay.checkPayment(p.qpay_invoice_id);
        if ((check.rows || []).some(r => r.payment_status === 'PAID')) {
          markPaidByInvoice(p.qpay_invoice_id);
          n++;
        }
      } catch (e) {
        console.error('[verifyAwaiting]', p.qpay_invoice_id, e.message);
      }
    }
    return n;
  }

  function markCompleted() {
    return db.prepare(`
      UPDATE booking SET status='completed'
      WHERE status='confirmed'
        AND datetime(booking_date || ' ' || end_time, '+8 hours') < datetime('now','+8 hours','-10 minutes')
    `).run().changes;
  }

  function startSchedules() {
    const cron = require('node-cron');
    cron.schedule('* * * * *', () => { try { const n = autoCancelExpired(); if (n) console.log('[cron] autoCancel', n); } catch (e) { console.error(e); } });
    cron.schedule('*/5 * * * *', async () => { try { const n = await verifyAwaitingViaQPay(); if (n) console.log('[cron] verify', n); } catch (e) { console.error(e); } });
    cron.schedule('*/10 * * * *', () => { try { const n = markCompleted(); if (n) console.log('[cron] completed', n); } catch (e) { console.error(e); } });
    console.log('[cron] schedules started');
  }

  return { autoCancelExpired, verifyAwaitingViaQPay, markCompleted, startSchedules };
};
