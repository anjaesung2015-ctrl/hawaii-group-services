// 때가 되면 알아서 보내는 알림 두 가지.
//  1) 일정 하루 전 저녁 — "내일 19시 정기모임, 참석 체크해 주세요"
//  2) 매월 5일 아침(회칙 제11조 납부 기한) — 아직 회비를 안 낸 사람에게만
// 10분마다 깨어나 확인한다. 같은 것을 두 번 보내지 않도록 보낸 표시를 남긴다.
const { getSettings, thisMonth, MONTHLY_EXEMPT_SQL } = require('./db');
const { eliteFeeOf } = require('./elite');

const TICK_MS = 10 * 60 * 1000;
const UB = 'Asia/Ulaanbaatar';
const FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: UB, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

// '2026-10-15 18:30' → { date, hour, day }
function ubNow(now = new Date()) {
  const s = FMT.format(now).replace('T', ' ');
  return { date: s.slice(0, 10), hour: Number(s.slice(11, 13)), day: Number(s.slice(8, 10)), stamp: s };
}
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function createJobs(db, notify, opts = {}) {
  const now = opts.now || (() => new Date());
  const EVENT_HOUR = opts.eventHour ?? 18;   // 전날 저녁 6시
  const DUE_HOUR = opts.dueHour ?? 10;       // 아침 10시
  const DUE_DAY = opts.dueDay ?? 5;          // 매월 5일 (회칙: 월회비는 매월 5일까지)
  const ELITE_DUE_DAY = opts.eliteDueDay ?? 20;
  const ELITE_QUIET_HOUR = 21;   // 늦게 등록한 선수에게 보낼 때도 밤에는 보내지 않는다   // 선수반 수강료 매월 20일

  // 내일 있는 일정을 아직 안 알렸으면 알린다
  async function remindEvents() {
    const t = ubNow(now());
    if (t.hour < EVENT_HOUR) return { sent: 0 };
    const tomorrow = addDays(t.date, 1);
    const rows = db.prepare(`SELECT * FROM event WHERE event_date=? AND reminded_at IS NULL`).all(tomorrow);
    let sent = 0;
    for (const e of rows) {
      // 먼저 보낸 표시를 남긴다 — 알림이 실패해도 다음 깨어남에 또 보내지 않게
      db.prepare('UPDATE event SET reminded_at=? WHERE id=?').run(t.stamp, e.id);
      const r = await notify.toAll({
        title: `🎾 내일 ${e.start_time} ${e.title}`,
        body: `코트 ${e.courts}면 · 참석 여부를 알려주세요`,
        url: '#schedule',
      });
      sent += r.sent;
    }
    return { sent, events: rows.length };
  }

  // 이번 달 회비를 안 낸 사람에게만 (한 달에 한 번)
  async function remindDues() {
    const t = ubNow(now());
    if (t.day < DUE_DAY || t.hour < DUE_HOUR) return { sent: 0 };
    const month = t.date.slice(0, 7);   // 주입된 시계와 같은 기준
    const key = 'due_reminder_month';
    const done = db.prepare('SELECT v FROM setting WHERE k=?').get(key)?.v;
    if (done === month) return { sent: 0, already: true };

    db.prepare('INSERT INTO setting (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, month);

    const unpaid = db.prepare(`
      SELECT m.id FROM member m
      LEFT JOIN due d ON d.member_id=m.id AND d.kind='monthly' AND d.period=?
      WHERE m.status='active' AND m.program='club' AND (d.id IS NULL OR d.paid_at IS NULL)
        AND NOT ${MONTHLY_EXEMPT_SQL}`).pluck().all(month, month);
    if (!unpaid.length) return { sent: 0, unpaid: 0 };

    const { monthly_fee, currency } = getSettings(db);
    const r = await notify.toMembers(unpaid, {
      title: '💳 회비 안내',
      body: `이번 달 회비 ${monthly_fee.toLocaleString('en-US')}${currency} 가 아직 확인되지 않았습니다 (매월 5일까지)`,
      url: '#dues',
    });
    return { sent: r.sent, unpaid: unpaid.length };
  }

  // 선수반 — 내일 훈련을 아직 안 알렸으면 선수에게
  async function remindEliteSessions() {
    const t = ubNow(now());
    if (t.hour < EVENT_HOUR) return { sent: 0 };
    const rows = db.prepare('SELECT * FROM elite_session WHERE session_date=? AND reminded_at IS NULL').all(addDays(t.date, 1));
    let sent = 0;
    for (const s of rows) {
      db.prepare('UPDATE elite_session SET reminded_at=? WHERE id=?').run(t.stamp, s.id);
      const r = await notify.toElitePlayers({
        title: `🎾 Tomorrow ${s.start_time} ${s.title}`,
        body: s.court ? `Court ${s.court}` : 'Elite training',
        url: '#training',
      });
      sent += r.sent;
    }
    return { sent, sessions: rows.length };
  }

  // 선수반 수강료 — 매월 20일 10시부터, 그 달 안 낸 선수에게 한 번씩.
  // 받은 달을 선수마다 적어 두므로 20일 뒤에 등록했거나 알림을 늦게 켠 선수도 (10~21시 사이) 한 번 받는다.
  // 폰 알림이 실제로 간 선수만 '받음'으로 적는다 — 알림을 아직 안 켠 선수는 켠 뒤에 받는다.
  async function remindEliteFees() {
    const t = ubNow(now());
    if (t.day < ELITE_DUE_DAY || t.hour < DUE_HOUR || t.hour >= ELITE_QUIET_HOUR) return { sent: 0 };
    const month = t.date.slice(0, 7);   // 주입된 시계와 같은 기준
    const unpaid = db.prepare(`SELECT m.id, m.elite_fee FROM member m
                               LEFT JOIN elite_due d ON d.member_id=m.id AND d.period=?
                               WHERE m.program='elite' AND m.status='active' AND (d.id IS NULL OR d.paid_at IS NULL)
                                 AND (m.elite_reminded_month IS NULL OR m.elite_reminded_month <> ?)`).all(month, month);
    let sent = 0;
    const { currency } = getSettings(db);
    for (const m of unpaid) {
      const r = await notify.toMembers([m.id], {
        title: '💳 Elite tuition',
        body: `This month's tuition ${eliteFeeOf(db, m).toLocaleString('en-US')}${currency} is not confirmed yet (due by the 20th)`,
        url: '#fees',
      });
      if (r.sent) db.prepare('UPDATE member SET elite_reminded_month=? WHERE id=?').run(month, m.id);
      sent += r.sent;
    }
    return { sent, unpaid: unpaid.length };
  }

  async function tick() {
    try { await remindEvents(); } catch (e) { console.error('[jobs] 일정 알림 실패:', e.message); }
    try { await remindDues(); } catch (e) { console.error('[jobs] 회비 알림 실패:', e.message); }
    try { await remindEliteSessions(); } catch (e) { console.error('[jobs] 선수반 훈련 알림 실패:', e.message); }
    try { await remindEliteFees(); } catch (e) { console.error('[jobs] 선수반 수강료 알림 실패:', e.message); }
  }

  let timer = null;
  return {
    remindEvents,
    remindDues,
    remindEliteSessions,
    remindEliteFees,
    tick,
    start() {
      if (timer) return;
      timer = setInterval(tick, TICK_MS);
      timer.unref?.();          // 테스트나 종료를 붙잡지 않게
      tick();                   // 켤 때 한 번
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { createJobs, ubNow, TICK_MS };
