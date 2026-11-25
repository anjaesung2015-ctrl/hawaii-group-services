// 대표 리마인드 (월~토, 몽골 시간)
//  09:40 — 오늘 요일 관리 과제가 들어간 몽골어 지시문 (피트니스·센터 따로). 월요일엔 KPI 승인 안내 추가.
//          각 사업장 매니저에게도 자기 지시문을 바로 보낸다.
//  21:30 — 두 사업장 보고 확인 목록 (도착 여부, 매출·달성률·POS 차이, 직원 체크 누락자, 결정 필요).
//          미보고 사업장 매니저에게는 몽골어 독촉을 보낸다.
// server.js 가 5분마다 tick(date, time) 을 부른다. 하루에 한 번만 보내고(report_remind), 늦어도 2시간 안에만 보낸다.
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SITE_MN = { '피트니스': 'Hawaii Fitness', '센터': 'Hawaii Спорт төв' };
const NUDGE_MN = 'Өнөөдрийн менежерийн тайлан ирээгүй байна. Одоо илгээнэ үү.';
const SLOTS = { morning: '09:40', evening: '21:30' };

function dowOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const won = n => n == null ? '-' : Number(n).toLocaleString('ko-KR') + '₮';

module.exports = function createReminders(db, { notify, bossRowId, chk, daily }) {
  db.exec(`CREATE TABLE IF NOT EXISTS report_remind (
    kind TEXT NOT NULL, rdate TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (kind, rdate)
  )`);

  const leaders = () => {
    const ids = [bossRowId(), ...db.prepare("SELECT id FROM report_users WHERE role='admin' AND is_active=1").all().map(r => r.id)];
    return [...new Set(ids.filter(Boolean))];
  };
  const managersOf = site => db.prepare("SELECT id, name, job FROM report_users WHERE is_active=1 AND role='staff' AND job IS NOT NULL").all()
    .filter(u => { const j = chk.job(u.job); return j && j.role === '매니저' && j.site === site; });

  // 매니저에게 보낼 몽골어 지시문
  function directiveMn(site, date) {
    const tasks = chk.managerDayTasks(site, date);
    const md = date.slice(5).replace('-', '/');
    const lines = [`[${SITE_MN[site] || site}] ${md} — Өнөөдрийн менежерийн ажил`];
    lines.push('• Ажилтнуудын шалгах хуудсыг 15 минутад хянах (өөрөө хийхгүй)');
    lines.push('• Өдрийн орлогыг зорилттой харьцуулах');
    tasks.forEach(t => lines.push('• ' + t.mn));
    if (dowOf(date) === 1) lines.push('• 7 хоногийн KPI + 3 гол төслөө өнөөдөр апп-д оруулж, захирлаар батлуулна');
    lines.push('21:00 хүртэл өдрийн тайлангаа апп-д илгээнэ үү.');
    return lines.join('\n');
  }

  function morning(date) {
    const lines = [`🌅 ${date.slice(5).replace('-', '/')}(${WEEK[dowOf(date)]}) 오늘 매니저 지시`];
    for (const site of daily.SITES) {
      const tasks = chk.managerDayTasks(site, date);
      lines.push('', `■ ${site}: ` + (tasks.length ? tasks.map(t => t.ko).join(' / ') : '매일 업무만'));
    }
    if (dowOf(date) === 1) lines.push('', '📈 월요일 — 매니저 주간 KPI·핵심 과제 3개 승인할 것 (주간KPI 탭)');
    lines.push('', '아래 몽골어 지시문은 각 매니저에게도 앱 알림으로 갔습니다.');
    for (const site of daily.SITES) lines.push('', directiveMn(site, date));
    return lines.join('\n');
  }

  function evening(date) {
    const lines = [`🌙 ${date.slice(5).replace('-', '/')}(${WEEK[dowOf(date)]}) 매니저 보고 확인`];
    const missing = [];
    for (const site of daily.SITES) {
      const r = daily.reportOf(site, date);
      const c = daily.checklistOf(site, date);
      const late = c.people.filter(p => p.total && p.done < p.total).map(p => `${p.name} ${p.done}/${p.total}`);
      if (!r) {
        missing.push(site);
        lines.push('', `■ ${site}: ❌ 미보고`);
      } else {
        lines.push('', `■ ${site}: ✅ 보고 (${r.by || ''})`,
          `매출 ${won(r.sales)}` + (r.rate != null ? ` · 달성률 ${r.rate}%` : '') + ` · POS 차이 ${r.pos_diff ?? '-'}` + (r.settle_ok ? ' ✓' : ' (정산 대조 안 함)'));
        if (r.task_result) lines.push(`오늘 과제 결과: ${r.task_result}`);
        if (r.decision) lines.push(`👉 결정 필요: ${r.decision}`);
      }
      lines.push(`직원 체크 ${c.done}/${c.total}` + (late.length ? ` — 누락: ${late.join(', ')}` : ''));
    }
    lines.push('', '확인: 매니저가 직원 일을 대신 하지 않았는지 · 결정 필요 항목 답하기 · 일일보고 탭에서 대표 확인 ✓');
    if (missing.length) lines.push('', `미보고(${missing.join('·')}) 매니저에게 독촉 문구를 보냈습니다:`, NUDGE_MN);
    return { text: lines.join('\n'), missing };
  }

  async function send(ids, text, title) {
    let n = 0;
    for (const id of ids) { try { await notify(id, text, title); n++; } catch (e) { /* 받을 곳 없음 */ } }
    return n;
  }

  const sent = db.prepare("SELECT 1 FROM report_remind WHERE kind=? AND rdate=?");
  const mark = db.prepare("INSERT OR IGNORE INTO report_remind (kind, rdate) VALUES (?,?)");

  async function tick(date, time) {
    if (!notify || dowOf(date) === 0) return 0;
    let n = 0;
    for (const [kind, at] of Object.entries(SLOTS)) {
      const diff = toMin(time) - toMin(at);
      if (diff < 0 || diff > 120 || sent.get(kind, date)) continue;
      mark.run(kind, date);   // 먼저 표시 — 보내다 실패해도 같은 날 두 번 울리지 않게
      if (kind === 'morning') {
        n += await send(leaders(), morning(date), '오늘 매니저 지시');
        for (const site of daily.SITES) n += await send(managersOf(site).map(m => m.id), directiveMn(site, date), 'Өнөөдрийн ажил');
      } else {
        const e = evening(date);
        n += await send(leaders(), e.text, '보고 확인');
        for (const site of e.missing) n += await send(managersOf(site).map(m => m.id), NUDGE_MN, 'Тайлан');
      }
    }
    return n;
  }

  return { tick, morning, evening, directiveMn };
};
