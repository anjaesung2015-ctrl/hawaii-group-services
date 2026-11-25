'use strict';
// 인사 관리: 근무표 · 휴가 · 결재 · 구성원 · 급여
// 권한은 직원 관리와 같은 범위를 쓴다
//   대표·사장님(isBoss) : 전부 / 총매니저 : 두 사업장 일반 직원 / 매니저 : 자기 사업장 일반 직원 / 직원 : 본인
// 급여는 대표·사장님만 만들고, 직원은 확정된 자기 명세서만 본다.

const LEAVE_KINDS = ['연차', '반차', '병가', '무급', '경조사'];
const APPR_KINDS = ['구매·발주', '비용', '근무 변경', '기타'];
const DAYS = 6;   // 월~토 (일요일 휴무)
// 몽골 근로자 부담: 사회보험 11.5%, 소득세 10% (사회보험 뺀 금액에) — 화면에서 끌 수 있다
const SI_RATE = 0.115, PIT_RATE = 0.10;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isHM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const dow = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
function mondayOf(iso) { const w = dow(iso); return addDays(iso, w === 0 ? -6 : 1 - w); }
// 일요일을 뺀 날짜 목록
function workDates(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) if (dow(d) !== 0) out.push(d);
  return out;
}
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,\s₮]/g, '')); return Number.isFinite(n) ? n : NaN; };
const clip = (v, n = 500) => String(v ?? '').trim().slice(0, n);

module.exports = function mountHR(router, db, ctx) {
  const { bizToday, notify, bossRowId, staffScope, userAllowed, chk } = ctx;

  db.exec(`CREATE TABLE IF NOT EXISTS report_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, wdate TEXT NOT NULL,
    start TEXT NOT NULL, end TEXT NOT NULL, note TEXT, updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(staff_id, wdate))`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_leave (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, kind TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL, reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, comment TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    amount INTEGER, body TEXT, status TEXT NOT NULL,
    mgr_by TEXT, mgr_at TEXT, mgr_comment TEXT, boss_by TEXT, boss_at TEXT, boss_comment TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, month TEXT NOT NULL,
    pay_type TEXT, pay_rate INTEGER, hours REAL, work_days INTEGER, unpaid_days REAL,
    base INTEGER, unpaid_deduct INTEGER, bonus INTEGER DEFAULT 0, gross INTEGER,
    tax INTEGER DEFAULT 1, si INTEGER, pit INTEGER, other_deduct INTEGER DEFAULT 0, net INTEGER,
    note TEXT, confirmed INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(staff_id, month))`);
  const cols = () => db.prepare("PRAGMA table_info(report_users)").all().map(c => c.name);
  const have = cols();
  for (const [c, def] of [['phone', 'TEXT'], ['hire_date', 'TEXT'], ['birth', 'TEXT'], ['profile_memo', 'TEXT'],
    ['left_date', 'TEXT'], ['annual_leave', 'REAL DEFAULT 15'], ['pay_type', "TEXT DEFAULT 'month'"], ['pay_rate', 'INTEGER']]) {
    if (!have.includes(c)) db.exec(`ALTER TABLE report_users ADD COLUMN ${c} ${def}`);
  }

  // ---- 공통 ----
  const meId = (req) => req.rsess.isBoss ? (req.rsess.admin ? Number(req.rsess.staff_id) : bossRowId()) : Number(req.rsess.staff_id);
  const actorName = (req) => req.rsess.isBoss ? (req.rsess.admin ? (req.rsess.name || '사장님') : '대표') : (req.rsess.name || '');
  const user = (id) => db.prepare("SELECT * FROM report_users WHERE id=?").get(Number(id));
  const jobOf = (u) => chk.job(u?.job);
  const siteOf = (u) => jobOf(u)?.site || null;
  const isMgrJob = (u) => ['매니저', '총매니저'].includes(jobOf(u)?.role);
  const bossTargets = () => [bossRowId(), ...db.prepare("SELECT id FROM report_users WHERE role='admin' AND is_active=1").all().map(r => r.id)];
  // 이 직원을 맡은 매니저들 (사업장 매니저 + 총매니저)
  function managersOf(u) {
    if (!u || u.role !== 'staff' || isMgrJob(u)) return [];   // 사장님·매니저 신청은 대표에게
    const site = siteOf(u);
    return db.prepare("SELECT id, job FROM report_users WHERE is_active=1 AND role='staff' AND job IS NOT NULL").all()
      .filter(m => { const j = chk.job(m.job); return j && (j.role === '총매니저' || (j.role === '매니저' && j.site === site)); })
      .map(m => m.id);
  }
  // 이 사람의 결재·승인권: 대표 = 전부, 매니저 = 자기 범위의 일반 직원
  function canManage(req, u) {
    if (req.rsess.isBoss) return true;
    const scope = staffScope(req);
    return !!scope && userAllowed(scope, u);
  }
  // 목록에 보일 사람: 대표 전부, 매니저 범위 + 본인, 직원 본인
  function visible(req, { inactive = false } = {}) {
    const all = db.prepare(`SELECT * FROM report_users WHERE role='staff' ${inactive ? '' : 'AND is_active=1'} ORDER BY is_active DESC, id`).all();
    if (req.rsess.isBoss) return all;
    const me = Number(req.rsess.staff_id);
    const scope = staffScope(req);
    return all.filter(u => u.id === me || (scope && userAllowed(scope, u)));
  }
  const send = async (ids, text, title) => {
    if (!notify) return;
    for (const id of [...new Set(ids)].filter(Boolean)) { try { await notify(id, text, title); } catch (e) { /* 알림 실패는 무시 */ } }
  };
  const label = (u) => { const j = jobOf(u); return j ? j.label_ko : ''; };

  // ================= 근무표 =================
  const leaveOn = db.prepare("SELECT kind FROM report_leave WHERE staff_id=? AND status='approved' AND start_date<=? AND end_date>=?");
  const attOn = (sid, d) => { try { return db.prepare("SELECT check_in, check_out FROM report_attendance WHERE staff_id=? AND work_date=?").get(sid, d); } catch (e) { return null; } };

  router.get('/hr/shifts', (req, res) => {
    const week = mondayOf(isDate(req.query.week) ? req.query.week : bizToday());
    const days = Array.from({ length: DAYS }, (_, i) => addDays(week, i));
    const today = bizToday();
    const q = db.prepare("SELECT wdate, start, end, note FROM report_shifts WHERE staff_id=? AND wdate>=? AND wdate<=?");
    const rows = visible(req).map(u => {
      const cells = {}, leave = {}, att = {};
      for (const s of q.all(u.id, days[0], days[DAYS - 1])) cells[s.wdate] = { start: s.start, end: s.end, note: s.note || '' };
      for (const d of days) {
        const l = leaveOn.get(u.id, d, d);
        if (l) leave[d] = l.kind;
        const a = attOn(u.id, d), sh = cells[d];
        if (sh && d <= today) {
          const late = a?.check_in ? Math.max(0, toMin(a.check_in) - toMin(sh.start)) : null;
          att[d] = { in: a?.check_in || null, out: a?.check_out || null, late,
            absent: !a?.check_in && !l && d < today };
        } else if (a?.check_in) att[d] = { in: a.check_in, out: a.check_out || null, late: null, absent: false };
      }
      return { staff_id: u.id, name: u.name, job: u.job, label: label(u), site: siteOf(u), cells, leave, att, editable: canManage(req, u) && (req.rsess.isBoss || u.id !== Number(req.rsess.staff_id)) };
    });
    res.json({ week, days, today, rows });
  });

  router.put('/hr/shifts', (req, res) => {
    const { staff_id, date, start, end, note, off } = req.body || {};
    const u = user(staff_id);
    if (!u || u.role !== 'staff') return res.status(404).json({ error: 'not_found' });
    if (!canManage(req, u) || (!req.rsess.isBoss && u.id === Number(req.rsess.staff_id))) return res.status(403).json({ error: 'forbidden' });
    if (!isDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (off) { db.prepare("DELETE FROM report_shifts WHERE staff_id=? AND wdate=?").run(u.id, date); return res.json({ ok: true, off: true }); }
    if (!isHM(start) || !isHM(end)) return res.status(400).json({ error: 'bad_time' });
    db.prepare(`INSERT INTO report_shifts (staff_id, wdate, start, end, note) VALUES (?,?,?,?,?)
      ON CONFLICT(staff_id, wdate) DO UPDATE SET start=excluded.start, end=excluded.end, note=excluded.note, updated_at=datetime('now','localtime')`)
      .run(u.id, date, start, end, clip(note, 100));
    res.json({ ok: true });
  });

  // 지난주 근무표를 이번 주로 복사 (비어 있는 칸만)
  router.post('/hr/shifts/copy', (req, res) => {
    const week = mondayOf(isDate(req.body?.week) ? req.body.week : bizToday());
    const prev = addDays(week, -7);
    const ins = db.prepare("INSERT OR IGNORE INTO report_shifts (staff_id, wdate, start, end, note) VALUES (?,?,?,?,?)");
    let n = 0;
    for (const u of visible(req)) {
      if (!canManage(req, u) || (!req.rsess.isBoss && u.id === Number(req.rsess.staff_id))) continue;
      for (const s of db.prepare("SELECT wdate, start, end, note FROM report_shifts WHERE staff_id=? AND wdate>=? AND wdate<?").all(u.id, prev, week)) {
        n += ins.run(u.id, addDays(s.wdate, 7), s.start, s.end, s.note).changes;
      }
    }
    res.json({ ok: true, copied: n });
  });

  // ================= 휴가 =================
  function leaveDays(kind, from, to) { return kind === '반차' ? 0.5 : workDates(from, to).length; }
  function balance(u, year) {
    const used = db.prepare(`SELECT COALESCE(SUM(days),0) n FROM report_leave WHERE staff_id=? AND kind IN ('연차','반차')
      AND status IN ('approved','pending') AND substr(start_date,1,4)=?`).get(u.id, year).n;
    const allow = u.annual_leave ?? 15;
    return { allow, used, left: allow - used };
  }
  const leaveRow = (l) => { const u = user(l.staff_id); return { ...l, name: u?.name || '', label: label(u) }; };

  router.get('/hr/leave', (req, res) => {
    const me = Number(req.rsess.staff_id);
    const year = bizToday().slice(0, 4);
    const mine = req.rsess.isBoss && !req.rsess.admin ? [] : db.prepare("SELECT * FROM report_leave WHERE staff_id=? ORDER BY id DESC LIMIT 50").all(me).map(leaveRow);
    const meU = user(me);
    const others = visible(req, { inactive: true }).filter(u => u.id !== me);
    const ids = new Set(others.map(u => u.id));
    const all = ids.size ? db.prepare(`SELECT * FROM report_leave WHERE staff_id IN (${[...ids].join(',')}) ORDER BY id DESC LIMIT 200`).all() : [];
    res.json({
      kinds: LEAVE_KINDS,
      balance: meU && meU.role === 'staff' ? balance(meU, year) : null,
      mine,
      todo: all.filter(l => l.status === 'pending' && canManage(req, user(l.staff_id))).map(leaveRow),
      team: all.filter(l => l.status !== 'pending' || !canManage(req, user(l.staff_id))).slice(0, 60).map(leaveRow),
      balances: others.filter(u => u.is_active).map(u => ({ staff_id: u.id, name: u.name, ...balance(u, year) })),
    });
  });

  router.post('/hr/leave', async (req, res) => {
    if (req.rsess.isBoss && !req.rsess.admin) return res.status(400).json({ error: 'boss_no_leave' });
    const u = user(req.rsess.staff_id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const { kind, start_date } = req.body || {};
    const end_date = kind === '반차' ? start_date : (req.body?.end_date || start_date);
    if (!LEAVE_KINDS.includes(kind)) return res.status(400).json({ error: 'bad_kind' });
    if (!isDate(start_date) || !isDate(end_date) || end_date < start_date) return res.status(400).json({ error: 'bad_date' });
    const days = leaveDays(kind, start_date, end_date);
    if (!days) return res.status(400).json({ error: 'no_workdays' });
    if (['연차', '반차'].includes(kind) && balance(u, start_date.slice(0, 4)).left < days) return res.status(400).json({ error: 'no_balance' });
    const r = db.prepare("INSERT INTO report_leave (staff_id, kind, start_date, end_date, days, reason) VALUES (?,?,?,?,?,?)")
      .run(u.id, kind, start_date, end_date, days, clip(req.body?.reason));
    const mg = managersOf(u);
    await send(mg.length ? mg : bossTargets(),
      `🌴 휴가 신청: ${u.name} ${kind} ${start_date.slice(5)}${end_date !== start_date ? '~' + end_date.slice(5) : ''} (${days}일)` + (req.body?.reason ? `\n${clip(req.body.reason)}` : ''), '휴가 신청');
    res.json({ ok: true, id: r.lastInsertRowid, days });
  });

  router.patch('/hr/leave/:id', async (req, res) => {
    const l = db.prepare("SELECT * FROM report_leave WHERE id=?").get(req.params.id);
    if (!l) return res.status(404).json({ error: 'not_found' });
    const act = req.body?.action;
    const u = user(l.staff_id);
    if (act === 'cancel') {
      if (l.staff_id !== Number(req.rsess.staff_id) || l.status !== 'pending') return res.status(403).json({ error: 'forbidden' });
      db.prepare("UPDATE report_leave SET status='cancelled' WHERE id=?").run(l.id);
      return res.json({ ok: true });
    }
    if (!['approve', 'reject'].includes(act)) return res.status(400).json({ error: 'bad_action' });
    if (!canManage(req, u)) return res.status(403).json({ error: 'forbidden' });
    if (l.status !== 'pending' && !req.rsess.isBoss) return res.status(409).json({ error: 'decided' });
    const st = act === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE report_leave SET status=?, decided_by=?, decided_at=datetime('now','localtime'), comment=? WHERE id=?")
      .run(st, actorName(req), clip(req.body?.comment), l.id);
    await send([l.staff_id], `🌴 휴가 ${st === 'approved' ? '승인 ✅' : '반려 ❌'}: ${l.kind} ${l.start_date.slice(5)}${l.end_date !== l.start_date ? '~' + l.end_date.slice(5) : ''}` +
      (req.body?.comment ? `\n${clip(req.body.comment)}` : ''), '휴가');
    res.json({ ok: true, status: st });
  });

  // ================= 결재 =================
  // status: mgr(매니저 승인 대기) → boss(대표 승인 대기) → approved / rejected / cancelled
  const apRow = (a) => { const u = user(a.staff_id); return { ...a, name: u?.name || '', label: label(u) }; };
  function canAct(req, a) {
    if (!['mgr', 'boss'].includes(a.status)) return false;
    if (req.rsess.isBoss) return true;
    return a.status === 'mgr' && canManage(req, user(a.staff_id));
  }

  router.get('/hr/approvals', (req, res) => {
    const me = Number(req.rsess.staff_id);
    const mine = req.rsess.isBoss && !req.rsess.admin ? [] : db.prepare("SELECT * FROM report_approvals WHERE staff_id=? ORDER BY id DESC LIMIT 50").all(me).map(apRow);
    const ids = visible(req, { inactive: true }).map(u => u.id).filter(id => id !== me);
    const all = ids.length ? db.prepare(`SELECT * FROM report_approvals WHERE staff_id IN (${ids.join(',')}) ORDER BY id DESC LIMIT 200`).all() : [];
    // 대표는 매니저 단계에 있는 것도 본다 (바로 최종 승인 가능)
    res.json({ kinds: APPR_KINDS, mine,
      todo: all.filter(a => canAct(req, a)).map(apRow),
      done: all.filter(a => !canAct(req, a)).slice(0, 60).map(apRow) });
  });

  router.post('/hr/approvals', async (req, res) => {
    if (req.rsess.isBoss && !req.rsess.admin) return res.status(400).json({ error: 'boss_no_request' });
    const u = user(req.rsess.staff_id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const kind = req.body?.kind, title = clip(req.body?.title, 120);
    if (!APPR_KINDS.includes(kind)) return res.status(400).json({ error: 'bad_kind' });
    if (!title) return res.status(400).json({ error: 'title_required' });
    const amount = num(req.body?.amount);
    if (Number.isNaN(amount) || (amount != null && amount < 0)) return res.status(400).json({ error: 'bad_amount' });
    const mg = req.rsess.isBoss ? [] : managersOf(u);
    const status = mg.length ? 'mgr' : 'boss';
    const r = db.prepare("INSERT INTO report_approvals (staff_id, kind, title, amount, body, status) VALUES (?,?,?,?,?,?)")
      .run(u.id, kind, title, amount, clip(req.body?.body, 2000), status);
    await send(status === 'mgr' ? mg : bossTargets(),
      `🧾 결재 요청: ${u.name} · ${kind}\n${title}${amount != null ? `\n${amount.toLocaleString('ko-KR')}₮` : ''}`, '결재 요청');
    res.json({ ok: true, id: r.lastInsertRowid, status });
  });

  router.patch('/hr/approvals/:id', async (req, res) => {
    const a = db.prepare("SELECT * FROM report_approvals WHERE id=?").get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not_found' });
    const act = req.body?.action, comment = clip(req.body?.comment);
    if (act === 'cancel') {
      if (a.staff_id !== Number(req.rsess.staff_id) || !['mgr', 'boss'].includes(a.status)) return res.status(403).json({ error: 'forbidden' });
      db.prepare("UPDATE report_approvals SET status='cancelled' WHERE id=?").run(a.id);
      return res.json({ ok: true });
    }
    if (!['approve', 'reject'].includes(act)) return res.status(400).json({ error: 'bad_action' });
    if (!canAct(req, a)) return res.status(403).json({ error: 'forbidden' });
    const who = actorName(req);
    let st;
    if (req.rsess.isBoss) {
      st = act === 'approve' ? 'approved' : 'rejected';
      db.prepare("UPDATE report_approvals SET status=?, boss_by=?, boss_at=datetime('now','localtime'), boss_comment=? WHERE id=?").run(st, who, comment, a.id);
    } else {
      st = act === 'approve' ? 'boss' : 'rejected';
      db.prepare("UPDATE report_approvals SET status=?, mgr_by=?, mgr_at=datetime('now','localtime'), mgr_comment=? WHERE id=?").run(st, who, comment, a.id);
      if (st === 'boss') {
        const u = user(a.staff_id);
        await send(bossTargets(), `🧾 결재 요청 (${who} 승인): ${u?.name || ''} · ${a.kind}\n${a.title}${a.amount != null ? `\n${a.amount.toLocaleString('ko-KR')}₮` : ''}`, '결재 요청');
      }
    }
    const msg = st === 'approved' ? '최종 승인 ✅' : st === 'rejected' ? '반려 ❌' : `${who} 승인 → 대표 결재 대기`;
    await send([a.staff_id], `🧾 결재 ${msg}: ${a.title}` + (comment ? `\n${comment}` : ''), '결재');
    res.json({ ok: true, status: st });
  });

  // ================= 구성원 · 조직도 =================
  // 조직도는 누구나 (이름·직무만)
  router.get('/hr/org', (req, res) => {
    const staff = db.prepare("SELECT id, name, job FROM report_users WHERE role='staff' AND is_active=1 ORDER BY id").all();
    const admins = db.prepare("SELECT name FROM report_users WHERE role='admin' AND is_active=1 ORDER BY id").all().map(r => r.name);
    const gm = [], sites = {};
    for (const u of staff) {
      const j = jobOf(u);
      if (j?.role === '총매니저') { gm.push(u.name); continue; }
      const site = j?.site || '미지정';
      const s = sites[site] = sites[site] || { site, managers: [], staff: [] };
      if (j?.role === '매니저') s.managers.push(u.name);
      else s.staff.push({ name: u.name, label: j ? j.label_ko : '', role: j?.role || '' });
    }
    const order = ['피트니스', '센터', '미지정'];
    res.json({ ceo: '대표', admins, gm, sites: Object.values(sites).sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site)) });
  });

  const PROFILE = ['phone', 'hire_date', 'birth', 'profile_memo', 'left_date'];
  const PAYF = ['annual_leave', 'pay_type', 'pay_rate'];
  router.get('/hr/members', (req, res) => {
    const scope = staffScope(req);
    if (!scope) return res.status(403).json({ error: 'forbidden' });
    const year = bizToday().slice(0, 4);
    const rows = visible(req, { inactive: true }).filter(u => req.rsess.isBoss || u.id !== Number(req.rsess.staff_id));
    res.json(rows.map(u => {
      const o = { id: u.id, name: u.name, job: u.job, label: label(u), is_active: u.is_active, leave: balance(u, year) };
      for (const k of PROFILE) o[k] = u[k] ?? null;
      if (req.rsess.isBoss) for (const k of PAYF) o[k] = u[k] ?? null;
      return o;
    }));
  });
  router.patch('/hr/members/:id', (req, res) => {
    const u = user(req.params.id);
    if (!u || u.role !== 'staff') return res.status(404).json({ error: 'not_found' });
    if (!canManage(req, u)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {}, f = [], v = [];
    for (const k of PROFILE) if (k in b) {
      const val = b[k] === '' || b[k] == null ? null : clip(b[k], 300);
      if (['hire_date', 'birth', 'left_date'].includes(k) && val && !isDate(val)) return res.status(400).json({ error: 'bad_date' });
      f.push(k + '=?'); v.push(val);
    }
    if (req.rsess.isBoss) {
      if ('pay_type' in b) { if (!['month', 'hour'].includes(b.pay_type)) return res.status(400).json({ error: 'bad_pay_type' }); f.push('pay_type=?'); v.push(b.pay_type); }
      for (const k of ['pay_rate', 'annual_leave']) if (k in b) {
        const n = num(b[k]);
        if (Number.isNaN(n) || (n != null && n < 0)) return res.status(400).json({ error: 'bad_number' });
        f.push(k + '=?'); v.push(n);
      }
    } else if (PAYF.some(k => k in b)) return res.status(403).json({ error: 'boss_only' });
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare(`UPDATE report_users SET ${f.join(', ')} WHERE id=?`).run(...v, u.id);
    res.json({ ok: true });
  });

  // ================= 급여 =================
  function monthRange(month) { return [`${month}-01`, addDays(addDays(`${month}-01`, 32).slice(0, 8) + '01', -1)]; }
  function workOf(u, month) {
    const [from, to] = monthRange(month);
    let minutes = 0, days = 0;
    try {
      for (const a of db.prepare("SELECT check_in, check_out FROM report_attendance WHERE staff_id=? AND work_date>=? AND work_date<=?").all(u.id, from, to)) {
        if (a.check_in) days++;
        if (a.check_in && a.check_out) minutes += Math.max(0, toMin(a.check_out) - toMin(a.check_in));
      }
    } catch (e) { /* 근태 표 없음 */ }
    let unpaid = 0;
    for (const l of db.prepare("SELECT kind, start_date, end_date, days FROM report_leave WHERE staff_id=? AND status='approved' AND kind='무급' AND end_date>=? AND start_date<=?").all(u.id, from, to)) {
      unpaid += workDates(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date).length;
    }
    return { hours: Math.round(minutes / 6) / 10, work_days: days, unpaid_days: unpaid };
  }
  function calc(u, month, adj = {}) {
    const w = workOf(u, month);
    const type = u.pay_type || 'month', rate = u.pay_rate || 0;
    const base = type === 'hour' ? Math.round(w.hours * rate) : rate;
    const unpaid_deduct = type === 'month' ? Math.round(rate / 26 * w.unpaid_days) : 0;
    const bonus = adj.bonus || 0, other = adj.other_deduct || 0, tax = adj.tax === 0 ? 0 : 1;
    const gross = Math.max(0, base - unpaid_deduct + bonus);
    const si = tax ? Math.round(gross * SI_RATE) : 0;
    const pit = tax ? Math.round((gross - si) * PIT_RATE) : 0;
    return { pay_type: type, pay_rate: rate, ...w, base, unpaid_deduct, bonus, gross, tax, si, pit, other_deduct: other, net: gross - si - pit - other };
  }
  const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));

  router.get('/hr/payroll', (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: 'boss_only' });
    const month = isMonth(req.query.month) ? req.query.month : bizToday().slice(0, 7);
    const saved = db.prepare("SELECT * FROM report_payroll WHERE staff_id=? AND month=?");
    const rows = db.prepare("SELECT * FROM report_users WHERE role IN ('staff','admin') ORDER BY role<>'admin', id").all()
      .map(u => ({ u, s: saved.get(u.id, month) }))
      .filter(({ u, s }) => u.is_active || s)
      .map(({ u, s }) => ({ staff_id: u.id, name: u.name, label: u.role === 'admin' ? '사장님' : label(u),
        calc: calc(u, month, s ? { bonus: s.bonus, other_deduct: s.other_deduct, tax: s.tax } : {}),
        saved: s ? { ...s } : null, note: s?.note || '', confirmed: s?.confirmed || 0 }));
    const tot = rows.reduce((a, r) => { const c = r.saved && r.confirmed ? r.saved : r.calc; a.gross += c.gross; a.net += c.net; return a; }, { gross: 0, net: 0 });
    res.json({ month, rows, total: tot, rates: { si: SI_RATE, pit: PIT_RATE } });
  });

  router.put('/hr/payroll', (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: 'boss_only' });
    const b = req.body || {};
    const u = user(b.staff_id);
    if (!u || !['staff', 'admin'].includes(u.role)) return res.status(404).json({ error: 'not_found' });
    if (!isMonth(b.month)) return res.status(400).json({ error: 'bad_month' });
    const bonus = num(b.bonus) ?? 0, other = num(b.other_deduct) ?? 0;
    if ([bonus, other].some(n => Number.isNaN(n) || n < 0)) return res.status(400).json({ error: 'bad_number' });
    const c = calc(u, b.month, { bonus, other_deduct: other, tax: b.tax === false || b.tax === 0 ? 0 : 1 });
    db.prepare(`INSERT INTO report_payroll (staff_id, month, pay_type, pay_rate, hours, work_days, unpaid_days, base, unpaid_deduct, bonus, gross, tax, si, pit, other_deduct, net, note, confirmed)
      VALUES (@staff_id,@month,@pay_type,@pay_rate,@hours,@work_days,@unpaid_days,@base,@unpaid_deduct,@bonus,@gross,@tax,@si,@pit,@other_deduct,@net,@note,@confirmed)
      ON CONFLICT(staff_id, month) DO UPDATE SET pay_type=excluded.pay_type, pay_rate=excluded.pay_rate, hours=excluded.hours, work_days=excluded.work_days,
        unpaid_days=excluded.unpaid_days, base=excluded.base, unpaid_deduct=excluded.unpaid_deduct, bonus=excluded.bonus, gross=excluded.gross, tax=excluded.tax,
        si=excluded.si, pit=excluded.pit, other_deduct=excluded.other_deduct, net=excluded.net, note=excluded.note, confirmed=excluded.confirmed,
        updated_at=datetime('now','localtime')`)
      .run({ staff_id: u.id, month: b.month, ...c, note: clip(b.note, 300), confirmed: b.confirm ? 1 : 0 });
    if (b.confirm && notify) send([u.id], `💰 ${b.month} 급여 명세가 나왔습니다. 실수령 ${c.net.toLocaleString('ko-KR')}₮`, '급여 명세');
    res.json({ ok: true, ...c });
  });

  // 내 급여 명세 (확정된 것만)
  router.get('/hr/payslips', (req, res) => {
    if (req.rsess.isBoss && !req.rsess.admin) return res.json([]);
    res.json(db.prepare("SELECT * FROM report_payroll WHERE staff_id=? AND confirmed=1 ORDER BY month DESC LIMIT 24").all(Number(req.rsess.staff_id)));
  });

  return { mondayOf, workDates, calc };
};
module.exports.LEAVE_KINDS = LEAVE_KINDS;
