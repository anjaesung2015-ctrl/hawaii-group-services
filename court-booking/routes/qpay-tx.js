// markPaidByInvoice를 db 주입 받게 분리 (테스트 가능성)
module.exports = (db) => {
  function markPaidByInvoice(invoice_id) {
    const tx = db.transaction(() => {
      const p = db.prepare(`SELECT id, booking_id, status FROM payment WHERE qpay_invoice_id=?`).get(invoice_id);
      if (!p) return { changed: false, reason: 'NOT_FOUND' };
      if (p.status === 'paid') return { changed: false, reason: 'ALREADY_PAID' };
      if (p.status !== 'awaiting') return { changed: false, reason: `STATE_${p.status}` };

      db.prepare(`UPDATE payment SET status='paid', paid_at=datetime('now') WHERE id=?`).run(p.id);
      db.prepare(`UPDATE booking SET status='confirmed', confirmed_at=datetime('now') WHERE id=? AND status='pending'`).run(p.booking_id);
      return { changed: true, booking_id: p.booking_id };
    });
    return tx.immediate();
  }
  return { markPaidByInvoice };
};
