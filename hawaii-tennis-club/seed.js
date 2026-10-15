// 테스트용 샘플 데이터 — 회원 10명(관리자 2명 포함), 일정 5개, 공지 3개, 회비 2개월치.
// 실행: npm run seed        (이미 있는 건 건너뛴다)
//       npm run seed:reset  (회원·일정·공지·회비를 모두 지우고 새로 넣는다)
const { open, ensureFirstAdmin, getSettings, hashPin, today, thisMonth } = require('./lib/db');

const RESET = process.argv.includes('--reset');
const db = open();

// 샘플 회원 — 울란바토르 동호인 클럽을 가정한 몽골 이름 + 한국인 대표
const MEMBERS = [
  { name: '안재성',        phone: '99000000', pin: '1234', role: 'admin',  title: '대표',             level: 'advanced',     joined: '2026-03-02' },
  { name: 'Ганбат',       phone: '99118822', pin: '1234', role: 'admin',  title: '코치',             level: 'advanced',     joined: '2026-03-02' },
  { name: 'Батбаяр',      phone: '88110044', pin: '1111', role: 'member', title: null,               level: 'intermediate', joined: '2026-03-10' },
  { name: 'Энхтүвшин',    phone: '99224455', pin: '1111', role: 'member', title: null,               level: 'intermediate', joined: '2026-04-01' },
  { name: 'Сарнай',       phone: '95556677', pin: '1111', role: 'member', title: null,               level: 'beginner',     joined: '2026-04-18' },
  { name: 'Долгорсүрэн',  phone: '94443322', pin: '1111', role: 'member', title: null,               level: 'newbie',       joined: '2026-05-06' },
  { name: 'Мөнхбат',      phone: '89991100', pin: '1111', role: 'member', title: null,               level: 'advanced',     joined: '2026-05-20' },
  { name: 'Оюунчимэг',    phone: '85550099', pin: '1111', role: 'member', title: null,               level: 'beginner',     joined: '2026-06-11' },
  { name: '김도현',        phone: '99887766', pin: '1111', role: 'member', title: null,               level: 'intermediate', joined: '2026-07-02' },
  { name: 'Тэмүүжин',     phone: '80012345', pin: '1111', role: 'member', title: null,               level: 'newbie',       joined: '2026-09-15', status: 'dormant' },
];

// 일정 5개 — 오늘 기준 앞뒤로 흩어 둔다
const EVENTS = [
  { d: +1,  title: 'Тогтмол цугларалт · 정기모임',      kind: 'regular',    s: '19:00', e: '21:00', courts: 3, memo: '라켓·공 준비. 초급은 1번 코트.' },
  { d: +3,  title: 'Шинэ гишүүдийн танилцах · 신입 환영', kind: 'event',      s: '18:00', e: '20:00', courts: 2, memo: '신입 회원 환영 모임 — 간단한 다과 준비합니다.' },
  { d: +8,  title: 'Клубын дотоод тэмцээн · 내부 대회',   kind: 'tournament', s: '09:00', e: '17:00', courts: 5, memo: '복식 토너먼트. 참가비 10,000₮. 점심 제공.' },
  { d: +15, title: 'Тогтмол цугларалт · 정기모임',        kind: 'regular',    s: '19:00', e: '21:00', courts: 3, memo: null },
  { d: -4,  title: 'Тогтмол цугларалт · 정기모임',        kind: 'regular',    s: '19:00', e: '21:00', courts: 3, memo: '지난 모임 — 12명 참석' },
];

const NOTICES = [
  { title: '11 сарын хуваарь · 11월 일정 안내', pinned: 1,
    body: '11월 정기모임은 매주 화·목 19:00–21:00 입니다.\n코트는 3면 사용하며, 초급자는 1번 코트에서 코치와 함께 연습합니다.\n\n11 сарын тогтмол цугларалт: Мя, Пү гарагт 19:00–21:00.' },
  { title: 'Гишүүний хураамж · 회비 안내', pinned: 1,
    body: '월회비 200,000₮ 는 매월 10일까지 납부 부탁드립니다.\n현금·계좌이체·QPay 모두 가능합니다.\n\nСарын хураамж 200,000₮ — сар бүрийн 10-ны дотор.' },
  { title: 'Шинэ торны талаар · 새 네트 교체', pinned: 0,
    body: '2번 코트 네트를 새것으로 교체했습니다. 사용 후 장력 조절 손잡이는 원위치해 주세요.' },
];

const tx = db.transaction(() => {
  if (RESET) {
    db.prepare('DELETE FROM rsvp').run();
    db.prepare('DELETE FROM due').run();
    db.prepare('DELETE FROM event').run();
    db.prepare('DELETE FROM notice').run();
    db.prepare('DELETE FROM member').run();
    console.log('  (기존 데이터를 지웠습니다)');
  }

  ensureFirstAdmin(db);
  const { monthly_fee, joining_fee } = getSettings(db);

  // ---- 회원 ----
  const insMember = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, title, level, status, joined_at)
                                VALUES (?,?,?,?,?,?,?,?)`);
  const ids = {};
  for (const m of MEMBERS) {
    const found = db.prepare('SELECT id FROM member WHERE phone=?').get(m.phone);
    if (found) {
      // 서버가 첫 실행 때 만들어 둔 관리자 행이 있으면 샘플 이름·직책으로 맞춰준다
      db.prepare(`UPDATE member SET name=?, role=?, title=?, level=?, status=?, joined_at=? WHERE id=?`)
        .run(m.name, m.role, m.title, m.level, m.status || 'active', m.joined, found.id);
      ids[m.name] = found.id;
      continue;
    }
    const r = insMember.run(m.name, m.phone, hashPin(m.pin), m.role, m.title, m.level, m.status || 'active', m.joined);
    ids[m.name] = r.lastInsertRowid;
  }

  // ---- 회비: 지난달·이번달. 몇 명은 일부러 미납으로 남겨 둔다 ----
  const prev = shift(thisMonth(), -1);
  const cur = thisMonth();
  const insDue = db.prepare(`INSERT INTO due (member_id, kind, period, amount, paid_at, method)
                             VALUES (?,?,?,?,?,?) ON CONFLICT(member_id, kind, period) DO NOTHING`);
  const unpaidThisMonth = new Set(['Сарнай', 'Долгорсүрэн', '김도현']);
  const methods = ['cash', 'transfer', 'qpay'];
  let i = 0;
  for (const m of MEMBERS) {
    if ((m.status || 'active') !== 'active') continue;
    const id = ids[m.name];
    insDue.run(id, 'monthly', prev, monthly_fee, `${prev}-08`, methods[i % 3]);
    if (!unpaidThisMonth.has(m.name)) insDue.run(id, 'monthly', cur, monthly_fee, `${cur}-05`, methods[(i + 1) % 3]);
    // 입회비는 가입한 달에 받은 것으로 (두 명만 미납으로 남겨 둔다)
    const paidJoin = !['Оюунчимэг', '김도현'].includes(m.name);
    insDue.run(id, 'joining', m.joined.slice(0, 7), joining_fee, paidJoin ? m.joined : null, paidJoin ? 'transfer' : null);
    i += 1;
  }

  // ---- 일정 + 참석 ----
  const insEvent = db.prepare(`INSERT INTO event (title, kind, event_date, start_time, end_time, courts, memo, created_by)
                               VALUES (?,?,?,?,?,?,?,?)`);
  const insRsvp = db.prepare(`INSERT INTO rsvp (event_id, member_id, answer) VALUES (?,?,?)
                              ON CONFLICT(event_id, member_id) DO UPDATE SET answer=excluded.answer`);
  const answers = ['yes', 'yes', 'yes', 'maybe', 'yes', 'no', 'yes', 'maybe', 'yes', 'no'];
  const adminId = ids['안재성'];

  EVENTS.forEach((e, idx) => {
    const date = addDays(today(), e.d);
    const dup = db.prepare('SELECT id FROM event WHERE title=? AND event_date=?').get(e.title, date);
    if (dup) return;
    const r = insEvent.run(e.title, e.kind, date, e.s, e.e, e.courts, e.memo, adminId);
    // 사람마다 조금씩 다르게 답한 것으로
    MEMBERS.forEach((m, k) => {
      if ((m.status || 'active') !== 'active') return;
      if ((k + idx) % 5 === 4) return;                  // 몇 명은 아직 무응답
      insRsvp.run(r.lastInsertRowid, ids[m.name], answers[(k + idx) % answers.length]);
    });
  });

  // ---- 공지 ----
  const insNotice = db.prepare('INSERT INTO notice (title, body, pinned, created_by) VALUES (?,?,?,?)');
  for (const n of NOTICES) {
    if (db.prepare('SELECT id FROM notice WHERE title=?').get(n.title)) continue;
    insNotice.run(n.title, n.body, n.pinned, adminId);
  }
});

tx();

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}
function shift(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

const count = (q) => db.prepare(q).get().c;
console.log('');
console.log('  샘플 데이터를 넣었습니다');
console.log(`   회원 ${count('SELECT COUNT(*) c FROM member')}명 (관리자 ${count("SELECT COUNT(*) c FROM member WHERE role='admin'")}명)`);
console.log(`   일정 ${count('SELECT COUNT(*) c FROM event')}개 · 참석응답 ${count('SELECT COUNT(*) c FROM rsvp')}건`);
console.log(`   공지 ${count('SELECT COUNT(*) c FROM notice')}개 · 회비 ${count('SELECT COUNT(*) c FROM due')}줄`);
console.log('');
console.log('  로그인 (전화번호 / PIN)');
console.log('   관리자 : 99000000 / 1234   (안재성 · 대표)');
console.log('   관리자 : 99118822 / 1234   (Ганбат · 코치)');
console.log('   회원   : 88110044 / 1111   (Батбаяр)');
console.log('');
db.close();
