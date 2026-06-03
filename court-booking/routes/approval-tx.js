// 예약 승인/거절 상태 전이 (db 주입 — 테스트 가능). 멱등: pending일 때만 동작.
module.exports = (db) => {
  function applyDecision(bookingId, action) {
    const tx = db.transaction(() => {
      const b = db.prepare(`SELECT id, status, public_code FROM booking WHERE id=?`).get(bookingId);
      if (!b) return { status: 'notfound' };
      // pending(승인대기)이 아니면 이미 처리된 것 → 멱등 반환
      if (b.status !== 'pending') return { status: 'already', current: b.status, public_code: b.public_code };

      if (action === 'approve') {
        db.prepare(`UPDATE booking SET status='confirmed', confirmed_at=datetime('now')
                    WHERE id=? AND status='pending'`).run(bookingId);
        return { status: 'done', current: 'confirmed', public_code: b.public_code };
      }
      if (action === 'reject') {
        db.prepare(`UPDATE booking SET status='cancelled', cancelled_at=datetime('now'),
                      cancelled_by='telegram', cancel_reason='rejected_by_admin'
                    WHERE id=? AND status='pending'`).run(bookingId);
        return { status: 'done', current: 'cancelled', public_code: b.public_code };
      }
      return { status: 'badaction' };
    });
    return tx.immediate();
  }
  return { applyDecision };
};
