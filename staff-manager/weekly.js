// 주간 KPI — 사업장마다 한 주(월요일 시작)에 한 장.
// 월요일: 매니저가 이번 주 목표·핵심 과제 3개를 올리고 대표가 승인한다.
// 주중: 과제 진행 상황을 고친다. 토요일: 잘된 점·문제·다음 주 계획(주간 결산)을 적는다.
// 매출 실적은 그 주 일일보고 합계로 자동 계산한다.
const NUM = ['target', 'new_members', 'renewal_rate', 'churn', 'court_util'];
const TEXT = ['last_result', 'good', 'problems', 'next_plan'];

function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay();                       // 0=일
  t.setUTCDate(t.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return t.toISOString().slice(0, 10);
}

module.exports = function mountWeekly(router, db, { bizToday, notify, bossRowId, chk, daily }) {
  db.exec(`CREATE TABLE IF NOT EXISTS report_weekly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site TEXT NOT NULL,
    week_start TEXT NOT NULL,
    staff_id INTEGER,
    target INTEGER, new_members INTEGER, renewal_rate INTEGER, churn INTEGER, court_util INTEGER,
    tasks TEXT,
    last_result TEXT, good TEXT, problems TEXT, next_plan TEXT,
    boss_ok INTEGER NOT NULL DEFAULT 0,
    boss_comment TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    UNIQUE (site, week_start)
  )`);

  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  // 그 주 월~토 일일보고 합계
  function actualOf(site, week) {
    const end = daily.addDays(week, 5);
    const rows = db.prepare("SELECT cash, card, transfer FROM report_daily WHERE site=? AND rdate BETWEEN ? AND ?").all(site, week, end);
    let sum = 0, any = false;
    for (const r of rows) for (const v of [r.cash, r.card, r.transfer]) if (v != null) { sum += v; any = true; }
    return { actual: any ? sum : null, days: rows.length };
  }

  function view(site, week) {
    const r = db.prepare("SELECT * FROM report_weekly WHERE site=? AND week_start=?").get(site, week);
    const a = actualOf(site, week);
    if (!r) return { kpi: null, ...a, rate: null };
    let tasks = [];
    try { tasks = JSON.parse(r.tasks || '[]'); } catch (e) { tasks = []; }
    const by = r.staff_id ? db.prepare("SELECT name FROM report_users WHERE id=?").get(r.staff_id)?.name : null;
    const rate = (a.actual != null && r.target) ? Math.round(a.actual / r.target * 100) : null;
    return { kpi: { ...r, tasks, by: by || null }, ...a, rate };
  }

  // 매니저는 이번 주와 지난주(월요일에 지난주 결과를 마무리) 것만 쓴다
  function canWrite(week) {
    const cur = mondayOf(bizToday());
    return week === cur || week === daily.addDays(cur, -7);
  }

  router.get('/weekly', (req, res) => {
    const week = mondayOf(String(req.query.week || bizToday()));
    if (!isDate(week)) return res.status(400).json({ error: 'bad_date' });
    const sites = daily.whoSees(req);
    if (!sites.length) return res.status(403).json({ error: 'manager_only' });
    res.json({
      week, current: mondayOf(bizToday()),
      editable: canWrite(week) ? daily.writable(req) : [],
      sites: sites.map(site => ({ site, ...view(site, week) })),
    });
  });

  function toNum(v) {
    if (v === '' || v == null) return null;
    const n = Math.round(Number(String(v).replace(/[,\s₮%]/g, '')));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  router.put('/weekly', async (req, res) => {
    const [site] = daily.writable(req);
    if (!site) return res.status(403).json({ error: 'manager_only' });
    const b = req.body || {};
    const week = mondayOf(String(b.week || bizToday()));
    if (!canWrite(week)) return res.status(403).json({ error: 'past_locked' });

    const vals = {};
    for (const k of NUM) {
      const n = toNum(b[k]);
      if (n === undefined) return res.status(400).json({ error: 'bad_number', field: k });
      vals[k] = n;
    }
    for (const k of TEXT) vals[k] = String(b[k] ?? '').trim().slice(0, 3000);
    const tasks = (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 3).map(t => ({
      t: String(t?.t || '').trim().slice(0, 300), goal: String(t?.goal || '').trim().slice(0, 100),
      due: String(t?.due || '').trim().slice(0, 40), progress: String(t?.progress || '').trim().slice(0, 500),
      done: t?.done ? 1 : 0,
    }));
    vals.tasks = JSON.stringify(tasks);
    const sid = Number(req.rsess.staff_id);

    const prev = db.prepare("SELECT id FROM report_weekly WHERE site=? AND week_start=?").get(site, week);
    const cols = [...NUM, ...TEXT, 'tasks'];
    if (prev) {
      db.prepare("UPDATE report_weekly SET " + cols.map(c => c + '=?').join(', ') + ", staff_id=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(...cols.map(c => vals[c]), sid, prev.id);
    } else {
      db.prepare("INSERT INTO report_weekly (site, week_start, staff_id, " + cols.join(', ') + ") VALUES (?,?,?," + cols.map(() => '?').join(',') + ")")
        .run(site, week, sid, ...cols.map(c => vals[c]));
    }

    let notified = false;
    if (!prev && notify) {
      const fmt = n => n == null ? '-' : Number(n).toLocaleString('ko-KR') + '₮';
      const lines = [`📈 ${site} 주간 KPI ${week.slice(5).replace('-', '/')} 주 — 승인 요청`, `목표 ${fmt(vals.target)}`];
      tasks.filter(t => t.t).forEach((t, i) => lines.push(`${'①②③'[i]} ${t.t}` + (t.goal ? ` (${t.goal})` : '')));
      try { await notify(bossRowId(), lines.join('\n'), '주간 KPI'); notified = true; } catch (e) { /* 받을 곳 없음 */ }
    }
    res.json({ ok: true, created: !prev, notified });
  });

  router.patch('/weekly/boss', (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: 'boss_only' });
    const { site } = req.body || {};
    const week = isDate(req.body?.week) ? mondayOf(req.body.week) : null;
    if (!daily.SITES.includes(site) || !week) return res.status(400).json({ error: 'bad_request' });
    const r = db.prepare("SELECT id FROM report_weekly WHERE site=? AND week_start=?").get(site, week);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const f = [], v = [];
    if ('boss_ok' in req.body) { f.push('boss_ok=?'); v.push(req.body.boss_ok ? 1 : 0); }
    if ('boss_comment' in req.body) { f.push('boss_comment=?'); v.push(String(req.body.boss_comment || '').trim().slice(0, 2000)); }
    if (!f.length) return res.status(400).json({ error: 'no_changes' });
    db.prepare("UPDATE report_weekly SET " + f.join(', ') + " WHERE id=?").run(...v, r.id);
    res.json({ ok: true });
  });

  return { mondayOf, view };
};
module.exports.mondayOf = mondayOf;
