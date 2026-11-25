// 매니저 일일 보고 — 사업장(피트니스/센터)마다 하루 한 장.
// 매니저(직무가 'xx-매니저')가 매출·인원·과제·결정 필요 사항을 적고, 사장님이 확인·코멘트한다.
// 총매출·달성률·직원 체크리스트 완료율은 저장하지 않고 그때그때 계산한다.
const NUM = ['headcount', 'cash', 'card', 'transfer', 'target', 'new_members', 'renewals', 'churn', 'pos_diff', 'court_util'];
const TEXT = ['task_result', 'missing', 'progress', 'solved', 'decision', 'tomorrow'];
const SIGNED = ['pos_diff'];   // POS 차이는 음수도 된다

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

module.exports = function mountDailyReport(router, db, { bizToday, notify, bossRowId, chk }) {
  db.exec(`CREATE TABLE IF NOT EXISTS report_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site TEXT NOT NULL,
    rdate TEXT NOT NULL,
    staff_id INTEGER,
    headcount INTEGER, cash INTEGER, card INTEGER, transfer INTEGER, target INTEGER,
    new_members INTEGER, renewals INTEGER,
    missing TEXT, progress TEXT, solved TEXT, decision TEXT,
    settle_ok INTEGER NOT NULL DEFAULT 0,
    boss_ok INTEGER NOT NULL DEFAULT 0,
    boss_comment TEXT,
    submitted_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    UNIQUE (site, rdate)
  )`);
  // 칸 추가 (설명서의 21시 보고 7항목에 맞춤)
  const dcols = db.prepare("PRAGMA table_info(report_daily)").all().map(c => c.name);
  for (const [c, type] of [['churn', 'INTEGER'], ['pos_diff', 'INTEGER'], ['court_util', 'INTEGER'], ['task_result', 'TEXT'], ['tomorrow', 'TEXT']]) {
    if (!dcols.includes(c)) db.exec(`ALTER TABLE report_daily ADD COLUMN ${c} ${type}`);
  }

  const SITES = chk.sites();
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  // 이 사람이 매니저인 사업장 (아니면 null)
  function managerSite(staffId) {
    const u = db.prepare("SELECT job FROM report_users WHERE id=? AND is_active=1").get(staffId);
    if (!u || !u.job) return null;
    const j = chk.job(u.job);
    return (j && (j.role === '매니저' || j.role === '총매니저')) ? j.site : null;
  }

  function whoSees(req) {
    if (req.rsess.isBoss) return SITES;
    const s = managerSite(Number(req.rsess.staff_id));
    if (s === '전체') return SITES;   // 총매니저
    return s ? [s] : [];
  }
  // 쓸 수 있는 사업장: 각 사업장 매니저만 (대표·사장님·총매니저는 확인만)
  function writable(req) {
    if (req.rsess.isBoss) return [];
    const s = managerSite(Number(req.rsess.staff_id));
    return (s && s !== '전체') ? [s] : [];
  }

  // 그 사업장 직원(매니저 제외)의 그날 체크리스트 완료율
  function checklistOf(site, date) {
    const people = db.prepare("SELECT id, name, job FROM report_users WHERE is_active=1 AND role='staff' AND job IS NOT NULL ORDER BY id").all()
      .filter(p => { const j = chk.job(p.job); return j && j.site === site && j.role !== '매니저'; });
    const cnt = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(done),0) done FROM report_items WHERE staff_id=? AND item_date=? AND tpl_key IS NOT NULL");
    let total = 0, done = 0;
    const list = people.map(p => {
      const c = cnt.get(p.id, date);
      total += c.total; done += c.done;
      return { staff_id: p.id, name: p.name, job: p.job, total: c.total, done: c.done };
    });
    return { total, done, people: list };
  }

  function withCalc(r) {
    if (!r) return null;
    const parts = [r.cash, r.card, r.transfer].filter(v => v != null);
    const sales = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
    const rate = (sales != null && r.target) ? Math.round(sales / r.target * 100) : null;
    const who = r.staff_id ? db.prepare("SELECT name FROM report_users WHERE id=?").get(r.staff_id)?.name : null;
    return { ...r, sales, rate, by: who || null };
  }

  router.get('/daily', (req, res) => {
    const date = String(req.query.date || bizToday());
    if (!isDate(date)) return res.status(400).json({ error: 'bad_date' });
    const sites = whoSees(req);
    if (!sites.length) return res.status(403).json({ error: 'manager_only' });
    const get = db.prepare("SELECT * FROM report_daily WHERE site=? AND rdate=?");
    res.json({
      date,
      today: bizToday(),
      editable: canWrite(date) ? writable(req) : [],
      sites: sites.map(site => ({ site, report: withCalc(get.get(site, date)), checklist: checklistOf(site, date),
        tasks: chk.managerDayTasks(site, date).map(t => ({ ko: t.ko, mn: t.mn, out: t.out || '', ex: t.ex || null })) })),
    });
  });

  // 매니저는 오늘 것과 어제 것(자정 넘겨 쓰는 경우)만 쓸 수 있다
  function canWrite(date) {
    const t = bizToday();
    return date === t || date === addDays(t, -1);
  }

  function toNum(v, signed) {
    if (v === '' || v == null) return null;
    const n = Math.round(Number(String(v).replace(/[,\s₮%]/g, '')));
    if (!Number.isFinite(n)) return undefined;
    return (n >= 0 || signed) ? n : undefined;
  }

  router.put('/daily', async (req, res) => {
    if (req.rsess.isBoss) return res.status(403).json({ error: 'manager_only' });
    const sid = Number(req.rsess.staff_id);
    const site = managerSite(sid);
    if (!site || site === '전체') return res.status(403).json({ error: 'manager_only' });
    const b = req.body || {};
    const date = String(b.date || bizToday());
    if (!isDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (!canWrite(date)) return res.status(403).json({ error: 'past_locked' });

    const vals = {};
    for (const k of NUM) {
      const n = toNum(b[k], SIGNED.includes(k));
      if (n === undefined) return res.status(400).json({ error: 'bad_number', field: k });
      vals[k] = n;
    }
    for (const k of TEXT) vals[k] = String(b[k] ?? '').trim().slice(0, 2000);
    vals.settle_ok = b.settle_ok ? 1 : 0;

    const prev = db.prepare("SELECT id FROM report_daily WHERE site=? AND rdate=?").get(site, date);
    const cols = [...NUM, ...TEXT, 'settle_ok'];
    if (prev) {
      db.prepare("UPDATE report_daily SET " + cols.map(c => c + '=?').join(', ') + ", staff_id=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(...cols.map(c => vals[c]), sid, prev.id);
    } else {
      db.prepare("INSERT INTO report_daily (site, rdate, staff_id, " + cols.join(', ') + ") VALUES (?,?,?," + cols.map(() => '?').join(',') + ")")
        .run(site, date, sid, ...cols.map(c => vals[c]));
    }

    // 처음 올라올 때만 사장님께 알린다 (고칠 때마다 울리면 시끄럽다). 알림 실패해도 보고는 저장된다.
    let notified = false;
    if (!prev && notify) {
      const r = withCalc(db.prepare("SELECT * FROM report_daily WHERE site=? AND rdate=?").get(site, date));
      const c = checklistOf(site, date);
      const fmt = n => n == null ? '-' : Number(n).toLocaleString('ko-KR') + '₮';
      const lines = [`📊 ${site} 일일보고 ${date.slice(5).replace('-', '/')} (${r.by || ''})`,
        `총매출 ${fmt(r.sales)}` + (r.rate != null ? ` · 목표 대비 ${r.rate}%` : '') + (r.pos_diff != null ? ` · POS 차이 ${r.pos_diff}` : ''),
        `직원 체크 ${c.done}/${c.total}`];
      if (r.decision) lines.push(`대표 결정 필요: ${r.decision}`);
      try { await notify(bossRowId(), lines.join('\n'), '일일 보고'); notified = true; }
      catch (e) { /* 알림 받을 곳이 없거나 실패 */ }
    }
    res.json({ ok: true, created: !prev, notified });
  });

  // 사장님 확인·코멘트
  router.patch('/daily/boss', (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: 'boss_only' });
    const { site, date } = req.body || {};
    if (!SITES.includes(site) || !isDate(date)) return res.status(400).json({ error: 'bad_request' });
    const r = db.prepare("SELECT id FROM report_daily WHERE site=? AND rdate=?").get(site, date);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const f = [], v = [];
    if ('boss_ok' in req.body) { f.push('boss_ok=?'); v.push(req.body.boss_ok ? 1 : 0); }
    if ('boss_comment' in req.body) { f.push('boss_comment=?'); v.push(String(req.body.boss_comment || '').trim().slice(0, 2000)); }
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare("UPDATE report_daily SET " + f.join(', ') + " WHERE id=?").run(...v, r.id);
    res.json({ ok: true });
  });

  return { managerSite, checklistOf, writable, whoSees, SITES, addDays,
    reportOf: (site, date) => withCalc(db.prepare("SELECT * FROM report_daily WHERE site=? AND rdate=?").get(site, date)) };
};
