// 회비 미납자에게 알림 — 1:1 채팅 메시지(보내는 사람 이름으로) + 폰 알림.
// 폰 알림을 안 켠 회원도 앱 채팅에서 보게 하려고 채팅으로도 남긴다. 낼 금액 = 그 달 월회비 + 안 낸 입회비.
// 회비 탭 📣 버튼(routes/dues.js)과 자동 알림(lib/jobs.js)이 같이 쓴다.
const { getSettings, MONTHLY_EXEMPT_SQL, FEE_FREE_SQL, monthlyFeeFor } = require('./db');

// 그 달에 낼 돈이 남은 회원 → Map(id → { name, monthly, joining })
function owedFor(db, month) {
  const s = getSettings(db);
  const monthly = db.prepare(`
    SELECT m.id, m.name, m.joined_at, d.amount FROM member m
    LEFT JOIN due d ON d.member_id = m.id AND d.kind='monthly' AND d.period = ?
    WHERE m.status='active' AND m.program='club' AND (d.id IS NULL OR d.paid_at IS NULL)
      AND NOT ${MONTHLY_EXEMPT_SQL}`).all(month, month);
  const joining = db.prepare(`SELECT d.member_id, m.name, SUM(d.amount) AS amount FROM due d JOIN member m ON m.id = d.member_id
                              WHERE d.kind='joining' AND d.paid_at IS NULL AND m.status='active' AND m.program='club'
                                AND NOT ${FEE_FREE_SQL} GROUP BY d.member_id`).all();
  const owed = new Map();
  for (const r of monthly) owed.set(r.id, { name: r.name, monthly: r.amount ?? monthlyFeeFor(r.joined_at, month, s.monthly_fee), joining: 0 });
  for (const j of joining) {
    const o = owed.get(j.member_id) || { name: j.name, monthly: 0, joining: 0 };
    o.joining = j.amount;
    owed.set(j.member_id, o);
  }
  return owed;
}

async function sendDuesReminders(db, notify, { senderId, month, overdue = false }) {
  const s = getSettings(db);
  const owed = owedFor(db, month);
  owed.delete(senderId);   // 보내는 사람 자신에게는 안 보낸다
  if (!owed.size) return { members: 0, pushed: 0, names: [] };

  const money = (n) => `${Number(n).toLocaleString('en-US')}${s.currency}`;
  const [y, mo] = month.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const bank = s.bank_account ? `\n\n🏦 ${s.bank_name || ''} ${s.bank_account}${s.bank_holder ? ` (${s.bank_holder})` : ''}\nPlease write your name in the transfer note.` : '';
  const insRoom = db.prepare("INSERT OR IGNORE INTO chat_room (kind, a_id, b_id) VALUES ('dm',?,?)");
  const getRoom = db.prepare("SELECT id FROM chat_room WHERE kind='dm' AND a_id=? AND b_id=?");
  const insMsg = db.prepare('INSERT INTO chat_msg (room_id, member_id, body) VALUES (?,?,?)');

  const sent = [];
  db.transaction(() => {
    for (const [id, o] of owed) {
      const parts = [];
      if (o.joining) parts.push(`Joining fee ${money(o.joining)}`);
      if (o.monthly) parts.push(`${monthName} dues ${money(o.monthly)}`);
      const total = o.joining + o.monthly;
      const body = `Hello ${o.name}, this is a friendly reminder from Hawaii Tennis Club.\n` +
        `Not paid yet: ${parts.join(' + ')} = ${money(total)}.\n` +
        `${overdue ? 'The deadline (the 5th) has passed — please' : 'Please'} pay as soon as you can. Thank you! 🎾${bank}`;
      const [a, b] = senderId < id ? [senderId, id] : [id, senderId];
      insRoom.run(a, b);
      const room = getRoom.get(a, b).id;
      insMsg.run(room, senderId, body);
      sent.push({ id, name: o.name, total, room, body });
    }
  })();

  let pushed = 0;
  if (notify) {
    for (const x of sent) {
      const r = await notify.toMembers([x.id], { title: '💳 Dues reminder', body: x.body.split('\n')[1].slice(0, 120), url: `#chat-${x.room}` });
      pushed += r.sent ? 1 : 0;
    }
  }
  return { members: sent.length, pushed, names: sent.map(x => x.name) };
}

module.exports = { owedFor, sendDuesReminders };
