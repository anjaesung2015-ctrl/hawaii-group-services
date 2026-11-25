// 인사 탭: 근무표 · 휴가 · 결재 · 구성원 · 급여  (app.js 다음에 불러온다)
const HR_T = {
  ko: {
    shift: '근무표', leave: '휴가', appr: '결재', member: '구성원', pay: '급여', myPay: '내 명세서',
    weekOf: '{m}/{d} 주', copyPrev: '지난주 복사', copied: '{n}칸 복사됨', off: '휴무', save: '저장', del: '휴무로',
    start: '시작', end: '끝', note: '메모', editCell: '{name} · {date}', late: '지각 +{m}분', absent: '결근', inOk: '출근 {t}',
    noStaff: '보이는 직원이 없습니다', shiftHint: '칸을 누르면 근무 시간을 넣을 수 있어요 (일요일 휴무)',
    balance: '올해 연차', left: '남음 {n}일', used: '사용 {n}일 / {a}일', kind: '종류', from: '시작일', to: '끝일', reason: '사유',
    request: '신청', myList: '내 신청', todo: '내가 승인할 것', team: '최근 처리', approve: '승인', reject: '반려', cancel: '취소',
    comment: '코멘트(선택)', days: '{n}일', none: '없음', balances: '직원 연차 현황',
    st_pending: '승인 대기', st_approved: '승인', st_rejected: '반려', st_cancelled: '취소', st_mgr: '매니저 승인 대기', st_boss: '대표 승인 대기',
    title: '제목', amount: '금액(₮)', body: '내용', apprHint: '직원 → 매니저 → 대표 순서로 승인됩니다',
    org: '조직도', ceo: '대표', admin: '사장님', gm: '총매니저', mgr: '매니저', members: '구성원 정보',
    phone: '연락처', hire: '입사일', birth: '생일', memo: '메모', leftDate: '퇴사일', payType: '급여 방식', payRate: '금액(₮)',
    annual: '연차 일수', perMonth: '월급', perHour: '시급', inactive: '퇴사', saved: '저장됨',
    month: '{y}년 {m}월', hours: '근무 {h}시간 · {d}일', unpaid: '무급 {n}일', base: '기본', bonus: '추가 지급', otherDed: '기타 공제',
    tax: '사회보험 11.5% · 소득세 10%', gross: '지급액', si: '사회보험', pit: '소득세', net: '실수령', confirm: '확정(직원에게 보이기)',
    confirmed: '확정됨', draft: '임시', total: '합계 지급 {g} · 실수령 {n}', noRate: '급여 금액 미입력 — 구성원에서 넣어 주세요',
    payHint: '근무시간은 출퇴근 기록, 무급은 승인된 무급 휴가로 자동 계산합니다. 세율은 꼭 확인하세요.', noSlip: '확정된 명세서가 없습니다',
    fail: '저장 실패', noBalance: '연차가 부족합니다', badDate: '날짜를 확인하세요',
  },
  mn: {
    shift: 'Ээлжийн хуваарь', leave: 'Чөлөө', appr: 'Зөвшөөрөл', member: 'Ажилтнууд', pay: 'Цалин', myPay: 'Миний цалин',
    weekOf: '{m}/{d} долоо хоног', copyPrev: 'Өмнөх 7 хоногийг хуулах', copied: '{n} нүд хуулсан', off: 'Амралт', save: 'Хадгалах', del: 'Амралт болгох',
    start: 'Эхлэх', end: 'Дуусах', note: 'Тэмдэглэл', editCell: '{name} · {date}', late: 'Хоцорсон +{m} мин', absent: 'Тасалсан', inOk: 'Ирсэн {t}',
    noStaff: 'Харагдах ажилтан алга', shiftHint: 'Нүдэн дээр дарж ажлын цаг оруулна (Ням амарна)',
    balance: 'Энэ жилийн ээлжийн амралт', left: 'Үлдсэн {n} өдөр', used: 'Ашигласан {n} / {a}', kind: 'Төрөл', from: 'Эхлэх өдөр', to: 'Дуусах өдөр', reason: 'Шалтгаан',
    request: 'Хүсэх', myList: 'Миний хүсэлт', todo: 'Миний батлах', team: 'Сүүлд шийдсэн', approve: 'Батлах', reject: 'Татгалзах', cancel: 'Цуцлах',
    comment: 'Тайлбар (заавал биш)', days: '{n} өдөр', none: 'Алга', balances: 'Ажилтны амралтын үлдэгдэл',
    st_pending: 'Хүлээгдэж буй', st_approved: 'Батлагдсан', st_rejected: 'Татгалзсан', st_cancelled: 'Цуцалсан', st_mgr: 'Менежер батлахыг хүлээж байна', st_boss: 'Захирал батлахыг хүлээж байна',
    title: 'Гарчиг', amount: 'Дүн (₮)', body: 'Агуулга', apprHint: 'Ажилтан → Менежер → Захирал дарааллаар батлагдана',
    org: 'Бүтэц', ceo: 'Захирал', admin: 'Эзэн', gm: 'Ерөнхий менежер', mgr: 'Менежер', members: 'Ажилтны мэдээлэл',
    phone: 'Утас', hire: 'Ажилд орсон', birth: 'Төрсөн өдөр', memo: 'Тэмдэглэл', leftDate: 'Гарсан өдөр', payType: 'Цалингийн хэлбэр', payRate: 'Дүн (₮)',
    annual: 'Амралтын өдөр', perMonth: 'Сарын', perHour: 'Цагийн', inactive: 'Гарсан', saved: 'Хадгалсан',
    month: '{y} оны {m} сар', hours: '{h} цаг · {d} өдөр', unpaid: 'Цалингүй {n} өдөр', base: 'Үндсэн', bonus: 'Нэмэлт', otherDed: 'Бусад суутгал',
    tax: 'НДШ 11.5% · ХХОАТ 10%', gross: 'Олгох', si: 'НДШ', pit: 'ХХОАТ', net: 'Гарт олгох', confirm: 'Баталгаажуулах (ажилтанд харагдана)',
    confirmed: 'Батлагдсан', draft: 'Түр', total: 'Нийт олгох {g} · гарт {n}', noRate: 'Цалингийн дүн оруулаагүй',
    payHint: 'Ажлын цагийг ирц, цалингүйг батлагдсан чөлөөнөөс тооцно. Хувь хэмжээг шалгана уу.', noSlip: 'Батлагдсан цалингийн хуудас алга',
    fail: 'Хадгалж чадсангүй', noBalance: 'Амралтын өдөр хүрэлцэхгүй', badDate: 'Огноог шалгана уу',
  },
};
const LEAVE_MN = { 연차: 'Ээлжийн амралт', 반차: 'Хагас өдөр', 병가: 'Өвчний', 무급: 'Цалингүй', 경조사: 'Гэр бүлийн' };
const APPR_MN = { '구매·발주': 'Худалдан авалт', 비용: 'Зардал', '근무 변경': 'Ээлж солих', 기타: 'Бусад' };
function ht(k, vars) {
  let s = (HR_T[LANG] && HR_T[LANG][k]) || HR_T.ko[k] || k;
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]);
  return s;
}
const kindL = (k) => LANG === 'mn' ? (LEAVE_MN[k] || APPR_MN[k] || k) : k;
async function hrCall(path, method, body) {
  const r = await api(path, method ? { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined } : undefined);
  let data = null; try { data = await r.json(); } catch (e) { }
  return { ok: r.ok, status: r.status, data };
}
const hrState = { tab: 'shift', weekOff: 0, edit: null, monthOff: 0 };
const isCeo = () => state.isBoss && state.name === '대표';   // 대표 본인(휴가·결재 신청 없음)
const isMgrUser = () => state.isBoss || !!state.managerSite;
const fmtN = (n) => n == null ? '-' : Number(n).toLocaleString('ko-KR');
const dshort = (iso) => iso ? iso.slice(5).replace('-', '/') : '';
const stBadge = (s) => `<span class="hst ${s}">${ht('st_' + s)}</span>`;

function hrTabs() {
  const tabs = [['shift', ht('shift')], ['leave', ht('leave')], ['appr', ht('appr')], ['member', ht('member')], ['pay', state.isBoss ? ht('pay') : ht('myPay')]];
  return `<div class="hrtabs">` + tabs.map(([k, l]) => `<button data-hr="${k}" class="${hrState.tab === k ? 'on' : ''}">${l}</button>`).join('') + `</div>`;
}
async function renderHR() {
  const el = $('#content');
  const fn = { shift: hrShift, leave: hrLeave, appr: hrAppr, member: hrMember, pay: hrPay }[hrState.tab] || hrShift;
  let body = '';
  try { body = await fn(); } catch (e) { body = `<div class="empty">${t('noEntry')}</div>`; }
  if (body === null) { location.reload(); return; }
  el.innerHTML = hrTabs() + body;
  el.querySelectorAll('[data-hr]').forEach(b => b.onclick = () => { hrState.tab = b.dataset.hr; hrState.edit = null; renderHR(); });
  const bind = { shift: bindShift, leave: bindLeave, appr: bindAppr, member: bindMember, pay: bindPay }[hrState.tab];
  if (bind) bind(el);
}

// ---------- 근무표 ----------
function weekStart(off) {
  const [y, m, d] = kst(0).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 7 * off));
  return dt.toISOString().slice(0, 10);
}
let SHIFTS = null;
function shiftCell(r, d, today) {
  const s = r.cells[d], lv = r.leave[d], a = r.att[d];
  let main = lv ? `<span class="lv">🌴 ${escapeHtml(kindL(lv))}</span>` : s ? `<b>${s.start}–${s.end}</b>` : `<span class="m">${ht('off')}</span>`;
  if (s && s.note) main += `<div class="m">${escapeHtml(s.note)}</div>`;
  let st = '';
  if (a) {
    if (a.absent) st = `<div class="bad">${ht('absent')}</div>`;
    else if (a.late) st = `<div class="bad">${ht('late', { m: a.late })}</div>`;
    else if (a.in) st = `<div class="good">✓ ${a.in}${a.out ? '–' + a.out : ''}</div>`;
  }
  const sel = hrState.edit && hrState.edit.sid === r.staff_id && hrState.edit.date === d;
  return `<td class="${d === today ? 'today' : ''}${r.editable ? ' ed' : ''}${sel ? ' sel' : ''}" ${r.editable ? `data-cell="${r.staff_id}|${d}"` : ''}>${main}${st}</td>`;
}
async function hrShift() {
  const r = await hrCall(`/hr/shifts?week=${weekStart(hrState.weekOff)}`);
  if (r.status === 401) return null;
  SHIFTS = r.data;
  const w = SHIFTS;
  const [, m, d] = w.week.split('-').map(Number);
  const past = hrState.weekOff !== 0;
  const bar = `<div class="daybar${past ? ' past' : ''}"><button data-wk="-1">‹</button><span>${ht('weekOf', { m, d })}</span><button data-wk="1">›</button>` +
    (past ? `<button class="back" data-wk="0">${t('goToday')}</button>` : '') + `</div>`;
  if (!w.rows.length) return bar + `<div class="empty">${ht('noStaff')}</div>`;
  const anyEd = w.rows.some(x => x.editable);
  const head = `<tr><th></th>` + w.days.map((x, i) => `<th class="${x === w.today ? 'today' : ''}">${t('dow' + (i + 1))}<br><span class="m">${dshort(x)}</span></th>`).join('') + `</tr>`;
  const body = w.rows.map(x => `<tr><th class="nm">${escapeHtml(x.name)}<div class="m">${escapeHtml(x.label || '')}</div></th>` +
    w.days.map(dd => shiftCell(x, dd, w.today)).join('') + `</tr>`).join('');
  let editor = '';
  if (hrState.edit) {
    const row = w.rows.find(x => x.staff_id === hrState.edit.sid);
    const cur = row && row.cells[hrState.edit.date];
    if (row) editor = `<div class="card shed"><b>${ht('editCell', { name: escapeHtml(row.name), date: dshort(hrState.edit.date) })}</b>
      <div class="row"><label>${ht('start')}<input type="time" id="shS" value="${cur ? cur.start : '09:00'}"></label>
      <label>${ht('end')}<input type="time" id="shE" value="${cur ? cur.end : '18:00'}"></label></div>
      <input id="shN" placeholder="${ht('note')}" value="${escapeHtml(cur ? cur.note : '')}">
      <div class="row"><button class="save" id="shSave">${ht('save')}</button><button id="shOff">${ht('del')}</button><button id="shX">×</button></div></div>`;
  }
  return bar + (anyEd ? `<div class="hint">${ht('shiftHint')} <button class="mini" id="shCopy">${ht('copyPrev')}</button> <span id="shMsg"></span></div>` : '') +
    editor + `<div class="shwrap"><table class="shift">${head}${body}</table></div>`;
}
function bindShift(el) {
  el.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => {
    const v = Number(b.dataset.wk); hrState.weekOff = v === 0 ? 0 : hrState.weekOff + v; hrState.edit = null; renderHR();
  });
  el.querySelectorAll('[data-cell]').forEach(c => c.onclick = () => {
    const [sid, date] = c.dataset.cell.split('|'); hrState.edit = { sid: Number(sid), date }; renderHR();
  });
  const put = async (body) => {
    const r = await hrCall('/hr/shifts', 'PUT', { staff_id: hrState.edit.sid, date: hrState.edit.date, ...body });
    if (r.ok) { flashSaved(); hrState.edit = null; renderHR(); }
  };
  const sv = el.querySelector('#shSave');
  if (sv) sv.onclick = () => put({ start: $('#shS').value, end: $('#shE').value, note: $('#shN').value });
  const of = el.querySelector('#shOff'); if (of) of.onclick = () => put({ off: true });
  const x = el.querySelector('#shX'); if (x) x.onclick = () => { hrState.edit = null; renderHR(); };
  const cp = el.querySelector('#shCopy');
  if (cp) cp.onclick = async () => {
    const r = await hrCall('/hr/shifts/copy', 'POST', { week: SHIFTS.week });
    if (r.ok) { await renderHR(); const m = $('#shMsg'); if (m) m.textContent = ht('copied', { n: r.data.copied }); }
  };
}

// ---------- 휴가 ----------
function leaveLine(l, acts) {
  const span = l.start_date === l.end_date ? dshort(l.start_date) : `${dshort(l.start_date)}~${dshort(l.end_date)}`;
  return `<div class="hline"><div><b>${escapeHtml(l.name)}</b> ${escapeHtml(kindL(l.kind))} ${span} <span class="m">(${ht('days', { n: l.days })})</span> ${stBadge(l.status)}` +
    (l.reason ? `<div class="m">${escapeHtml(l.reason)}</div>` : '') +
    (l.decided_by ? `<div class="m">✍ ${escapeHtml(l.decided_by)}${l.comment ? ' · ' + escapeHtml(l.comment) : ''}</div>` : '') + `</div>${acts || ''}</div>`;
}
const decideBtns = (kind, id) => `<div class="acts"><input class="cmt" data-cmt="${id}" placeholder="${ht('comment')}">` +
  `<button class="ok" data-${kind}="${id}" data-act="approve">${ht('approve')}</button><button class="no" data-${kind}="${id}" data-act="reject">${ht('reject')}</button></div>`;
async function hrLeave() {
  const r = await hrCall('/hr/leave');
  if (r.status === 401) return null;
  const d = r.data;
  let h = '';
  if (!isCeo()) {
    const b = d.balance;
    const today = kst(0);
    h += `<div class="card"><h3>🌴 ${ht('leave')}` + (b ? ` <span class="m">${ht('balance')}: <b>${ht('left', { n: b.left })}</b> · ${ht('used', { n: b.used, a: b.allow })}</span>` : '') + `</h3>
      <div class="row"><label>${ht('kind')}<select id="lvK">${d.kinds.map(k => `<option value="${k}">${escapeHtml(kindL(k))}</option>`).join('')}</select></label>
      <label>${ht('from')}<input type="date" id="lvS" value="${today}"></label><label id="lvEw">${ht('to')}<input type="date" id="lvE" value="${today}"></label></div>
      <input id="lvR" placeholder="${ht('reason')}"><button class="save" id="lvGo">${ht('request')}</button><span id="lvMsg" class="m"></span>
      ${d.mine.length ? `<h4>${ht('myList')}</h4>` + d.mine.map(l => leaveLine(l, l.status === 'pending' ? `<div class="acts"><button data-lvc="${l.id}">${ht('cancel')}</button></div>` : '')).join('') : ''}</div>`;
  }
  if (d.todo.length) h += `<div class="card"><h3>✅ ${ht('todo')} <span class="m">${d.todo.length}</span></h3>` + d.todo.map(l => leaveLine(l, decideBtns('lv', l.id))).join('') + `</div>`;
  if (d.balances.length) h += `<div class="card"><h3>${ht('balances')}</h3><table class="htab">` +
    d.balances.map(b => `<tr><td>${escapeHtml(b.name)}</td><td>${ht('left', { n: b.left })}</td><td class="m">${ht('used', { n: b.used, a: b.allow })}</td></tr>`).join('') + `</table></div>`;
  if (d.team.length) h += `<div class="card"><h3>${ht('team')}</h3>` + d.team.map(l => leaveLine(l)).join('') + `</div>`;
  return h || `<div class="empty">${ht('none')}</div>`;
}
function bindLeave(el) {
  const k = el.querySelector('#lvK');
  if (k) {
    const sync = () => { const w = $('#lvEw'); if (w) w.style.display = k.value === '반차' ? 'none' : ''; };
    k.onchange = sync; sync();
    $('#lvGo').onclick = async () => {
      const r = await hrCall('/hr/leave', 'POST', { kind: k.value, start_date: $('#lvS').value, end_date: $('#lvE').value, reason: $('#lvR').value });
      const m = $('#lvMsg');
      if (r.ok) { flashSaved(); renderHR(); }
      else if (m) { m.style.color = '#dc2626'; m.textContent = r.data && r.data.error === 'no_balance' ? ht('noBalance') : r.data && /date|workdays/.test(r.data.error) ? ht('badDate') : ht('fail'); }
    };
  }
  el.querySelectorAll('[data-lvc]').forEach(b => b.onclick = async () => { await hrCall(`/hr/leave/${b.dataset.lvc}`, 'PATCH', { action: 'cancel' }); renderHR(); });
  el.querySelectorAll('[data-lv]').forEach(b => b.onclick = async () => {
    const c = el.querySelector(`[data-cmt="${b.dataset.lv}"]`);
    await hrCall(`/hr/leave/${b.dataset.lv}`, 'PATCH', { action: b.dataset.act, comment: c ? c.value : '' }); flashSaved(); renderHR();
  });
}

// ---------- 결재 ----------
function apLine(a, acts) {
  const steps = (a.mgr_by ? `<div class="m">① ${escapeHtml(a.mgr_by)} ${a.status === 'rejected' && !a.boss_by ? '❌' : '✅'}${a.mgr_comment ? ' · ' + escapeHtml(a.mgr_comment) : ''}</div>` : '') +
    (a.boss_by ? `<div class="m">② ${escapeHtml(a.boss_by)} ${a.status === 'approved' ? '✅' : '❌'}${a.boss_comment ? ' · ' + escapeHtml(a.boss_comment) : ''}</div>` : '');
  return `<div class="hline"><div><b>${escapeHtml(a.title)}</b> ${stBadge(a.status)}<div class="m">${escapeHtml(a.name)} · ${escapeHtml(kindL(a.kind))} · ${dshort(a.created_at.slice(0, 10))}` +
    (a.amount != null ? ` · <b>${fmtN(a.amount)}₮</b>` : '') + `</div>` + (a.body ? `<div class="pre">${escapeHtml(a.body)}</div>` : '') + steps + `</div>${acts || ''}</div>`;
}
async function hrAppr() {
  const r = await hrCall('/hr/approvals');
  if (r.status === 401) return null;
  const d = r.data;
  let h = '';
  if (!isCeo()) {
    h += `<div class="card"><h3>🧾 ${ht('appr')}</h3><div class="hint">${ht('apprHint')}</div>
      <div class="row"><label>${ht('kind')}<select id="apK">${d.kinds.map(k => `<option value="${k}">${escapeHtml(kindL(k))}</option>`).join('')}</select></label>
      <label>${ht('amount')}<input id="apA" inputmode="numeric"></label></div>
      <input id="apT" placeholder="${ht('title')}"><textarea id="apB" placeholder="${ht('body')}"></textarea>
      <button class="save" id="apGo">${ht('request')}</button><span id="apMsg" class="m"></span>
      ${d.mine.length ? `<h4>${ht('myList')}</h4>` + d.mine.map(a => apLine(a, ['mgr', 'boss'].includes(a.status) ? `<div class="acts"><button data-apc="${a.id}">${ht('cancel')}</button></div>` : '')).join('') : ''}</div>`;
  }
  if (d.todo.length) h += `<div class="card"><h3>✅ ${ht('todo')} <span class="m">${d.todo.length}</span></h3>` + d.todo.map(a => apLine(a, decideBtns('ap', a.id))).join('') + `</div>`;
  if (d.done.length) h += `<div class="card"><h3>${ht('team')}</h3>` + d.done.map(a => apLine(a)).join('') + `</div>`;
  return h || `<div class="empty">${ht('none')}</div>`;
}
function bindAppr(el) {
  const go = el.querySelector('#apGo');
  if (go) go.onclick = async () => {
    const r = await hrCall('/hr/approvals', 'POST', { kind: $('#apK').value, title: $('#apT').value, amount: $('#apA').value, body: $('#apB').value });
    const m = $('#apMsg');
    if (r.ok) { flashSaved(); renderHR(); } else if (m) { m.style.color = '#dc2626'; m.textContent = ht('fail'); }
  };
  el.querySelectorAll('[data-apc]').forEach(b => b.onclick = async () => { await hrCall(`/hr/approvals/${b.dataset.apc}`, 'PATCH', { action: 'cancel' }); renderHR(); });
  el.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => {
    const c = el.querySelector(`[data-cmt="${b.dataset.ap}"]`);
    await hrCall(`/hr/approvals/${b.dataset.ap}`, 'PATCH', { action: b.dataset.act, comment: c ? c.value : '' }); flashSaved(); renderHR();
  });
}

// ---------- 구성원 ----------
function orgHtml(o) {
  const names = (a) => a.map(n => `<span class="pill">${escapeHtml(n)}</span>`).join('') || `<span class="m">-</span>`;
  return `<div class="card org"><h3>🏢 ${ht('org')}</h3>
    <div class="lvl"><span class="role">${ht('ceo')}</span>${names([LANG === 'mn' ? ht('ceo') : '대표'])}</div>
    ${o.admins.length ? `<div class="lvl"><span class="role">${ht('admin')}</span>${names(o.admins)}</div>` : ''}
    ${o.gm.length ? `<div class="lvl"><span class="role">${ht('gm')}</span>${names(o.gm)}</div>` : ''}
    <div class="sites">${o.sites.map(s => `<div class="site"><h4>${escapeHtml(s.site === '피트니스' ? t('siteFit') : s.site === '센터' ? t('siteCen') : s.site)}</h4>
      <div class="lvl"><span class="role">${ht('mgr')}</span>${names(s.managers)}</div>
      ${s.staff.map(x => `<div class="mem">${escapeHtml(x.name)} <span class="m">${escapeHtml(x.label)}</span></div>`).join('')}</div>`).join('')}</div></div>`;
}
function memberForm(u) {
  const f = (k, lab, type = 'text') => `<label>${lab}<input data-mf="${k}" type="${type}" value="${escapeHtml(u[k] ?? '')}"></label>`;
  const pay = state.isBoss ? `<label>${ht('payType')}<select data-mf="pay_type"><option value="month" ${u.pay_type !== 'hour' ? 'selected' : ''}>${ht('perMonth')}</option><option value="hour" ${u.pay_type === 'hour' ? 'selected' : ''}>${ht('perHour')}</option></select></label>` +
    f('pay_rate', ht('payRate')) + f('annual_leave', ht('annual')) : '';
  return `<details class="memrow ${u.is_active ? '' : 'off'}"><summary><b>${escapeHtml(u.name)}</b> <span class="m">${escapeHtml(u.label || '')}${u.is_active ? '' : ' · ' + ht('inactive')} · ${ht('left', { n: u.leave.left })}</span></summary>
    <div class="grid">${f('phone', ht('phone'), 'tel')}${f('hire_date', ht('hire'), 'date')}${f('birth', ht('birth'), 'date')}${f('left_date', ht('leftDate'), 'date')}${pay}
    <label class="full">${ht('memo')}<textarea data-mf="profile_memo">${escapeHtml(u.profile_memo || '')}</textarea></label></div>
    <button class="save" data-msave="${u.id}">${ht('save')}</button><span class="m" data-mmsg="${u.id}"></span></details>`;
}
async function hrMember() {
  const o = await hrCall('/hr/org');
  if (o.status === 401) return null;
  let h = orgHtml(o.data);
  if (isMgrUser()) {
    const m = await hrCall('/hr/members');
    if (m.ok && m.data.length) h += `<div class="card"><h3>👤 ${ht('members')}</h3>` + m.data.map(memberForm).join('') + `</div>`;
  }
  return h;
}
function bindMember(el) {
  el.querySelectorAll('[data-msave]').forEach(b => b.onclick = async () => {
    const box = b.closest('.memrow'), body = {};
    box.querySelectorAll('[data-mf]').forEach(i => { body[i.dataset.mf] = i.value; });
    const r = await hrCall(`/hr/members/${b.dataset.msave}`, 'PATCH', body);
    const m = el.querySelector(`[data-mmsg="${b.dataset.msave}"]`);
    if (m) { m.style.color = r.ok ? '#16a34a' : '#dc2626'; m.textContent = r.ok ? ht('saved') : ht('fail'); }
  });
}

// ---------- 급여 ----------
function monthOf(off) {
  const [y, m] = kst(0).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + off, 1));
  return d.toISOString().slice(0, 7);
}
function slipHtml(s) {
  const [y, m] = s.month.split('-');
  const row = (k, v, cls) => `<tr class="${cls || ''}"><td>${k}</td><td>${fmtN(v)}₮</td></tr>`;
  return `<div class="card slip"><h3>💰 ${ht('month', { y, m: Number(m) })}</h3><table class="htab">` +
    `<tr><td class="m" colspan="2">${ht('hours', { h: s.hours, d: s.work_days })}${s.unpaid_days ? ' · ' + ht('unpaid', { n: s.unpaid_days }) : ''}</td></tr>` +
    row(ht('base'), s.base) + (s.unpaid_deduct ? row(ht('unpaid', { n: s.unpaid_days }), -s.unpaid_deduct) : '') + (s.bonus ? row(ht('bonus'), s.bonus) : '') +
    row(ht('gross'), s.gross, 'b') + (s.tax ? row(ht('si'), -s.si) + row(ht('pit'), -s.pit) : '') + (s.other_deduct ? row(ht('otherDed'), -s.other_deduct) : '') +
    row(ht('net'), s.net, 'net') + `</table>${s.note ? `<div class="m">${escapeHtml(s.note)}</div>` : ''}</div>`;
}
async function hrPay() {
  if (!state.isBoss) {
    const r = await hrCall('/hr/payslips');
    if (r.status === 401) return null;
    return r.data.length ? r.data.map(slipHtml).join('') : `<div class="empty">${ht('noSlip')}</div>`;
  }
  const month = monthOf(hrState.monthOff);
  const r = await hrCall(`/hr/payroll?month=${month}`);
  if (r.status === 401) return null;
  const d = r.data;
  const [y, m] = month.split('-');
  const bar = `<div class="daybar${hrState.monthOff ? ' past' : ''}"><button data-mo="-1">‹</button><span>${ht('month', { y, m: Number(m) })}</span><button data-mo="1">›</button>` +
    (hrState.monthOff ? `<button class="back" data-mo="0">${t('goToday')}</button>` : '') + `</div>`;
  const rows = d.rows.map(x => {
    const c = x.calc, s = x.saved || {};
    return `<div class="card payrow" data-pr="${x.staff_id}"><h3>${escapeHtml(x.name)} <span class="m">${escapeHtml(x.label || '')}</span> ` +
      `<span class="hst ${x.confirmed ? 'approved' : 'pending'}">${x.confirmed ? ht('confirmed') : ht('draft')}</span></h3>` +
      (c.pay_rate ? '' : `<div class="hint bad">${ht('noRate')}</div>`) +
      `<div class="m">${c.pay_type === 'hour' ? ht('perHour') : ht('perMonth')} ${fmtN(c.pay_rate)}₮ · ${ht('hours', { h: c.hours, d: c.work_days })}${c.unpaid_days ? ' · ' + ht('unpaid', { n: c.unpaid_days }) : ''}</div>
      <div class="grid"><label>${ht('bonus')}<input data-pf="bonus" inputmode="numeric" value="${fmtN(s.bonus || 0)}"></label>
      <label>${ht('otherDed')}<input data-pf="other_deduct" inputmode="numeric" value="${fmtN(s.other_deduct || 0)}"></label>
      <label class="full">${ht('note')}<input data-pf="note" value="${escapeHtml(x.note || '')}"></label></div>
      <label class="ok"><input type="checkbox" data-pf="tax" ${c.tax ? 'checked' : ''}>${ht('tax')}</label>
      <div class="sum"><span>${ht('base')} <b>${fmtN(c.base)}</b></span>${c.unpaid_deduct ? `<span>-${fmtN(c.unpaid_deduct)}</span>` : ''}<span>${ht('gross')} <b>${fmtN(c.gross)}</b></span>` +
      `<span>${ht('si')} -${fmtN(c.si)}</span><span>${ht('pit')} -${fmtN(c.pit)}</span><span>${ht('net')} <b>${fmtN(c.net)}₮</b></span></div>
      <div class="row"><button data-psave="0">${ht('save')}</button><button class="save" data-psave="1">${ht('confirm')}</button></div></div>`;
  }).join('');
  return bar + `<div class="hint">${ht('payHint')}</div><div class="card"><b>${ht('total', { g: fmtN(d.total.gross) + '₮', n: fmtN(d.total.net) + '₮' })}</b></div>` + rows;
}
function bindPay(el) {
  el.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => {
    const v = Number(b.dataset.mo); hrState.monthOff = v === 0 ? 0 : hrState.monthOff + v; renderHR();
  });
  el.querySelectorAll('[data-psave]').forEach(b => b.onclick = async () => {
    const box = b.closest('[data-pr]'), body = { staff_id: Number(box.dataset.pr), month: monthOf(hrState.monthOff), confirm: b.dataset.psave === '1' };
    box.querySelectorAll('[data-pf]').forEach(i => { body[i.dataset.pf] = i.type === 'checkbox' ? i.checked : i.value; });
    const r = await hrCall('/hr/payroll', 'PUT', body);
    if (r.ok) { flashSaved(); renderHR(); }
  });
}
