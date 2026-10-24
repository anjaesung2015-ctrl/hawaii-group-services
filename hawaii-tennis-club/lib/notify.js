// 폰 알림(웹 푸시) — 공지·새 글·댓글·일정·회비를 회원 폰으로 밀어 보낸다.
// 텔레그램 봇 없이 서버 → 폰으로 직접 가고 비용이 들지 않는다.
// VAPID 키는 data/vapid.json 에 한 번 만들어 두고 계속 쓴다(바뀌면 기존 구독이 모두 끊긴다).
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'data', 'vapid.json');
const SUBJECT = process.env.PUSH_SUBJECT || 'mailto:anjaesung2015@gmail.com';

function loadKeys(webpush) {
  try {
    const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    if (k.publicKey && k.privateKey) return k;
  } catch (e) { /* 없으면 새로 만든다 */ }
  const k = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(k, null, 2), { mode: 0o600 });
  return k;
}

// opts.send 를 주면 그걸 쓴다 (테스트에서 실제로 밖으로 내보내지 않기 위해)
function createNotifier(db, opts = {}) {
  let keys = null;
  let sender = opts.send || null;

  if (!sender) {
    const webpush = require('web-push');
    keys = loadKeys(webpush);
    webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
    sender = (sub, payload) => webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 86400 }
    );
  }

  const publicKey = () => (keys ? keys.publicKey : (opts.publicKey || 'test-public-key'));

  const subsFor = (ids) => {
    if (!ids || !ids.length) return [];
    return db.prepare(`SELECT s.* FROM push_sub s JOIN member m ON m.id = s.member_id
                       WHERE s.member_id IN (${ids.map(() => '?').join(',')}) AND m.status='active'`).all(...ids);
  };

  const activeMembers = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='club'
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);

  const admins = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='club' AND role='admin'
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);

  // 선수반 — 활동 선수 / 선수반 관리자(오너·선수반 코치)
  const elitePlayers = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='elite'
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);
  const eliteStaff = (exclude = []) =>
    db.prepare(`SELECT id FROM member WHERE status='active' AND program='club' AND (is_owner=1 OR elite_coach=1)
                ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''}`)
      .pluck().all(...exclude);

  // 보내다 실패한 구독은 지운다 (앱을 지운 폰, 만료된 구독 — 410/404)
  async function sendTo(ids, payload) {
    const subs = subsFor(ids);
    if (!subs.length) return { sent: 0, failed: 0 };
    let sent = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try { await sender(s, payload); sent += 1; }
      catch (e) {
        failed += 1;
        const code = e?.statusCode;
        if (code === 404 || code === 410) db.prepare('DELETE FROM push_sub WHERE id=?').run(s.id);
      }
    }));
    return { sent, failed };
  }

  return {
    publicKey,
    // 알림은 '덤'이다 — 실패해도 글·공지 저장을 되돌리지 않는다. 그래서 전부 catch 한다.
    toAll: (payload, exclude = []) => sendTo(activeMembers(exclude), payload).catch(() => ({ sent: 0, failed: 0 })),
    toAdmins: (payload, exclude = []) => sendTo(admins(exclude), payload).catch(() => ({ sent: 0, failed: 0 })),
    toElitePlayers: (payload, exclude = []) => sendTo(elitePlayers(exclude), payload).catch(() => ({ sent: 0, failed: 0 })),
    toElite: (payload, exclude = []) => sendTo([...elitePlayers(exclude), ...eliteStaff(exclude)], payload).catch(() => ({ sent: 0, failed: 0 })),
    toMembers: (ids, payload) => sendTo(ids, payload).catch(() => ({ sent: 0, failed: 0 })),
    subscribed: (memberId) => db.prepare('SELECT COUNT(*) c FROM push_sub WHERE member_id=?').get(memberId).c > 0,
  };
}

module.exports = { createNotifier, KEY_FILE };
