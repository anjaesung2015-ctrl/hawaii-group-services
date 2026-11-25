'use strict';
// 인사 관리: 근무표 · 결재 · 구성원
// 권한은 직원 관리와 같은 범위를 쓴다
//   대표·사장님(isBoss) : 전부 / 총매니저 : 두 사업장 일반 직원 / 매니저 : 자기 사업장 일반 직원 / 직원 : 본인

const APPR_KINDS = ['구매·발주', '비용', '근무 변경', '기타'];
const DAYS = 6;   // 월~토 (일요일 휴무)

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
  db.exec(`CREATE TABLE IF NOT EXISTS report_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    amount INTEGER, body TEXT, status TEXT NOT NULL,
    mgr_by TEXT, mgr_at TEXT, mgr_comment TEXT, boss_by TEXT, boss_at TEXT, boss_comment TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  const cols = () => db.prepare("PRAGMA table_info(report_users)").all().map(c => c.name);
  const have = cols();
  for (const [c, def] of [['phone', 'TEXT'], ['hire_date', 'TEXT'], ['birth', 'TEXT'], ['profile_memo', 'TEXT'],
    ['left_date', 'TEXT']]) {
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
  const attOn = (sid, d) => { try { return db.prepare("SELECT check_in, check_out FROM report_attendance WHERE staff_id=? AND work_date=?").get(sid, d); } catch (e) { return null; } };

  router.get('/hr/shifts', (req, res) => {
    const week = mondayOf(isDate(req.query.week) ? req.query.week : bizToday());
    const days = Array.from({ length: DAYS }, (_, i) => addDays(week, i));
    const today = bizToday();
    const q = db.prepare("SELECT wdate, start, end, note FROM report_shifts WHERE staff_id=? AND wdate>=? AND wdate<=?");
    const rows = visible(req).map(u => {
      const cells = {}, att = {};
      for (const s of q.all(u.id, days[0], days[DAYS - 1])) cells[s.wdate] = { start: s.start, end: s.end, note: s.note || '' };
      for (const d of days) {
        const a = attOn(u.id, d), sh = cells[d];
        if (sh && d <= today) {
          const late = a?.check_in ? Math.max(0, toMin(a.check_in) - toMin(sh.start)) : null;
          att[d] = { in: a?.check_in || null, out: a?.check_out || null, late,
            absent: !a?.check_in && d < today };
        } else if (a?.check_in) att[d] = { in: a.check_in, out: a.check_out || null, late: null, absent: false };
      }
      return { staff_id: u.id, name: u.name, job: u.job, label: label(u), site: siteOf(u), cells, att, editable: canManage(req, u) && (req.rsess.isBoss || u.id !== Number(req.rsess.staff_id)) };
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
  router.get('/hr/members', (req, res) => {
    const scope = staffScope(req);
    if (!scope) return res.status(403).json({ error: 'forbidden' });
    const rows = visible(req, { inactive: true }).filter(u => req.rsess.isBoss || u.id !== Number(req.rsess.staff_id));
    res.json(rows.map(u => {
      const o = { id: u.id, name: u.name, job: u.job, label: label(u), is_active: u.is_active };
      for (const k of PROFILE) o[k] = u[k] ?? null;
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
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare(`UPDATE report_users SET ${f.join(', ')} WHERE id=?`).run(...v, u.id);
    res.json({ ok: true });
  });

  return { mondayOf };
};
