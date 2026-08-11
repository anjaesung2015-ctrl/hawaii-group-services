// 옛 PWA 서비스워커 잔재 제거 (기존 118KB 앱 캐시가 새 앱을 가리는 것 방지)
// 옛 PWA 서비스워커만 제거한다 (알림용 sw.js 는 남긴다)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => {
    const u = (r.active || r.installing || r.waiting || {}).scriptURL || '';
    if (!u.endsWith('/staff-manager/sw.js')) r.unregister();
  })).catch(() => {});
}

// 상대 경로 API (nginx가 /staff-manager/ 프리픽스를 벗김)
const API = 'api/report';
const CHECK_PERIODS = ['today', 'tomorrow'];
const state = { isBoss: false, staffId: null, myId: null, name: '', targetStaff: null, period: 'today', calMonth: null, calDay: null };

const $ = (s) => document.querySelector(s);
async function api(pathAndQuery, opts) {
  const r = await fetch(`${API}${pathAndQuery}`, opts);
  return r;
}

// ---- 날짜 헬퍼 (몽골 시간 Asia/Ulaanbaatar 기준) ----
// 폰이 한국·다른 나라 시간으로 맞춰져 있어도 항상 몽골 날짜를 쓴다.
// 서버 시간대와 텔레그램 알람도 같은 기준이라 자정 전후에 날짜가 어긋나지 않는다.
const BIZ_TZ = 'Asia/Ulaanbaatar';
const BIZ_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function kst(offsetDays = 0) {   // 이름은 유지 — 호출부가 여러 곳
  return BIZ_FMT.format(new Date(Date.now() + offsetDays * 86400000));
}
function weekStart() {
  const [y, m, d] = kst().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));   // 월요일 시작
  return dt.toISOString().slice(0, 10);
}
function monthStart() { return kst().slice(0, 7) + '-01'; }
function yearStart() { return kst().slice(0, 4) + '-01-01'; }
function itemDateFor(period) {
  return { today: kst(0), tomorrow: kst(1), week: weekStart(), month: monthStart(), year: yearStart() }[period];
}

// ---- 로그인 ----
async function loadStaffList() {
  const r = await api('/staff-list');
  const list = await r.json();
  const sel = $('#nameSel');
  const bsel = $('#bossStaffSel');
  for (const s of list) {
    sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`);
    bsel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${escapeHtml(s.name)}</option>`);
  }
}
async function doLogin(body) {
  const r = await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { $('#loginErr').textContent = t('loginFail'); return; }
  applySession(await r.json());
}

function enterApp() {
  $('#loginView').style.display = 'none';
  $('#appView').style.display = 'block';
  if (state.isBoss) {
    $('#whoami').textContent = t('boss');
    const bsel = $('#bossStaffSel');
    // 사장님 본인 업무공간을 드롭다운 맨 위에 두고 기본 선택
    if (state.myId && !bsel.querySelector('option[data-me]')) {
      bsel.insertAdjacentHTML('afterbegin', `<option data-me="1" data-i18n="myWork" value="${state.myId}">${t('myWork')}</option>`);
    }
    if (!bsel.querySelector('option[data-all]')) {
      bsel.insertAdjacentHTML('afterbegin', `<option data-all="1" data-i18n="allStaff" value="${ALL}">${t('allStaff')}</option>`);
    }
    bsel.value = ALL;  // 로그인하면 직원 현황판이 먼저
    bsel.style.display = 'inline-block';
    state.targetStaff = selVal(bsel.value);
  } else {
    $('#whoami').textContent = state.name;
    state.targetStaff = state.staffId;
  }
  render();
}

// ---- 렌더 ----
const ALL = 'all';  // 직원 현황판 모드
function selVal(v) { return v === ALL ? ALL : Number(v); }
function currentStaffId() { return state.isBoss ? state.targetStaff : state.staffId; }
function qs(period) {
  const p = new URLSearchParams({ period, date: itemDateFor(period) });
  if (state.isBoss && state.targetStaff) p.set('staff_id', state.targetStaff);
  return '?' + p.toString();
}

async function render() {
  const period = state.period;
  if (period === 'score') return renderScore();
  if (period === 'att') return renderAttendance();
  if (period === 'month') return renderMonth();
  if (state.isBoss && state.targetStaff === ALL) return renderOverview();
  const r = await api('/items' + qs(period));
  if (r.status === 401) { location.reload(); return; }
  const items = await r.json();
  const el = $('#content');
  if (CHECK_PERIODS.includes(period)) {
    el.innerHTML = items.map(renderCheckItem).join('') +
      `<button class="add" id="addBtn">${t('addItem')}</button>`;
    $('#addBtn').onclick = addCheckItem;
    el.querySelectorAll('.item').forEach(bindCheckItem);
  } else {
    const memo = items[0]?.memo || '';
    const id = items[0]?.id || '';
    el.innerHTML = `<div class="hint">${t('freeHint_' + period)}</div>
      <textarea class="free" id="freeMemo" data-id="${id}" placeholder="${t('freeWrite')}">${escapeHtml(memo)}</textarea>`;
    $('#freeMemo').onblur = saveFree;
  }
}

// 직원 현황판 — 읽기 전용. 고치려면 드롭다운에서 그 직원을 선택한다.
async function renderOverview() {
  const period = state.period;
  const r = await api(`/overview?period=${period}&date=${itemDateFor(period)}&lang=${LANG}`);
  if (r.status === 401) { location.reload(); return; }
  const rows = await r.json();
  $('#content').innerHTML = overviewCards(rows, CHECK_PERIODS.includes(period)) || `<div class="empty">${t('noStaff')}</div>`;
  bindAssign($('#content'));
}

function overviewCards(rows, isCheck) {
  return rows.map(row => {
    const items = row.items || [];
    let head = '', body;
    if (isCheck) {
      if (!items.length) {
        body = `<div class="empty">${t('noEntry')}</div>`;
      } else {
        const done = items.filter(i => i.done).length;
        const pct = Math.round(done / items.length * 100);
        head = `<span class="cnt">${t('doneCount', { done, total: items.length })}</span>`;
        body = `<div class="bar"><i style="width:${pct}%"></i></div>` + items.map(i => {
          const title = escapeHtml(i.title_tr || i.title || t('noTitle'));
          const memoTx = i.memo_tr || i.memo;
          const memo = memoTx ? ` <span class="m">· ${escapeHtml(memoTx)}</span>` : '';
          // 번역된 글에는 원문을 작게 함께 보여준다 (기계번역이라 확인이 필요)
          const orig = (i.title_tr || i.memo_tr)
            ? `<div class="src">🌐 ${escapeHtml(i.title || '')}${i.memo ? ' · ' + escapeHtml(i.memo) : ''}</div>` : '';
          const tag = i.from_boss ? `<span class="tag">${t('boss1')}</span>` : '';
          // 사장님이 내린 지시는 여기서 바로 지울 수 있다 (직원이 적은 건 건드리지 않는다)
          const del = (state.isBoss && i.from_boss) ? `<button class="ovdel" data-del="${i.id}">×</button>` : '';
          return `<div class="ov ${i.done ? 'done' : 'undone'}${i.from_boss ? ' boss' : ''}"><span class="mk">${i.done ? '✓' : '○'}</span>` +
                 `<span class="tx">${tag}${title}${memo}${orig}</span>${del}</div>`;
        }).join('');
      }
    } else {
      const memo = items.map(i => i.memo).filter(Boolean).join('\n');
      const memoTr = items.map(i => i.memo_tr || i.memo).filter(Boolean).join('\n');
      body = memo
        ? `<div class="freeview">${escapeHtml(memoTr)}</div>` +
          (memoTr !== memo ? `<div class="src">🌐 ${escapeHtml(memo)}</div>` : '')
        : `<div class="empty">${t('noEntry')}</div>`;
    }
    const asg = (state.isBoss && row.staff_id !== state.myId)
      ? `<button class="asgBtn" data-asg="${row.staff_id}" data-name="${escapeHtml(row.name)}">${t('assign')}</button>` : '';
    return `<div class="card"><h3>${escapeHtml(row.name)}${head}</h3>${body}${asg}</div>`;
  }).join('');
}

// 카드의 '+ 지시' / 지시 삭제 버튼을 살린다 (카드를 다시 그릴 때마다 호출)
function bindAssign(scope) {
  const root = scope || document;
  root.querySelectorAll('[data-asg]').forEach(b => {
    b.onclick = () => openAssign(b, Number(b.dataset.asg), b.dataset.name);
  });
  // 읽기 전용 화면이라 실수로 눌릴 수 있으니 두 번 눌러야 지워진다
  root.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!b.classList.contains('ask')) {
        b.classList.add('ask');
        b.textContent = t('delAsk');
        setTimeout(() => { if (b.isConnected) { b.classList.remove('ask'); b.textContent = '×'; } }, 3000);
        return;
      }
      const r = await api(`/items/${b.dataset.del}`, { method: 'DELETE' });
      if (r.ok) render();
    };
  });
}
function openAssign(btn, staffId, name) {
  if (btn.nextElementSibling && btn.nextElementSibling.classList.contains('asgBox')) {
    btn.nextElementSibling.remove();
    const m = btn.parentElement.querySelector('.asgMsg'); if (m) m.remove();
    return;
  }
  btn.insertAdjacentHTML('afterend',
    `<div class="asgBox"><input type="text" placeholder="${t('assignWhat')}">` +
    `<button data-go="1">${t('assignSend')}</button></div><div class="asgMsg"></div>`);
  const box = btn.nextElementSibling;
  const msg = box.nextElementSibling;
  const input = box.querySelector('input');
  input.focus();
  const go = async () => {
    const title = input.value.trim();
    if (!title) return;
    const date = (state.period === 'month' && state.calDay) ? state.calDay : itemDateFor('today');
    const r = await api('/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, title, date }) });
    if (r.ok) {
      const d = await r.json();
      msg.style.color = d.notified ? '#16a34a' : '#b45309';
      msg.textContent = d.notified ? t('assignOk') : t('assignOkNoTg');
      input.value = '';
      setTimeout(render, 900);
    } else { msg.style.color = '#dc2626'; msg.textContent = t('assignFail'); }
  };
  box.querySelector('[data-go]').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

// ---- 직원 종합 현황 ----
async function renderScore() {
  const el = $('#content');
  if (!state.isBoss) { el.innerHTML = `<div class="empty">${t('noEntry')}</div>`; return; }
  const month = (state.calMonth || kst().slice(0, 7));
  const r = await api(`/scorecard?month=${month}`);
  if (r.status === 401) { location.reload(); return; }
  if (!r.ok) { el.innerHTML = `<div class="empty">${t('scNone')}</div>`; return; }
  const d = await r.json();

  const hh = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const cards = d.rows.map(x => {
    const rate = x.taskRate;
    const color = rate == null ? '#d1d5db' : (rate >= 80 ? '#22c55e' : rate >= 50 ? '#f59e0b' : '#ef4444');
    const empty = !x.tasks && !x.workDays && !x.assigned;
    return `<div class="sc">
      <h4><span class="ev c${colorOf(x.staff_id)}" style="padding:2px 8px">${escapeHtml(x.name)}</span>` +
      (rate == null ? '' : `<span class="rate" style="color:${color}">${rate}%</span>`) + `</h4>` +
      (empty ? `<div class="empty">${t('scNone')}</div>` : `<div class="grid">
        <div><div class="k">${t('scReport')}</div><div class="v">${x.reportDays}<small>일</small></div></div>
        <div><div class="k">${t('scTask')}</div><div class="v">${x.tasksDone}<small>/${x.tasks}</small></div></div>
        <div><div class="k">${t('scAsg')}</div><div class="v">${x.assignedDone}<small>/${x.assigned}</small></div></div>
        <div><div class="k">${t('scWork')}</div><div class="v">${x.workDays}<small>일 ${hh(x.workMinutes)}</small></div></div>
      </div>
      <div class="bar"><i style="width:${rate || 0}%;background:${color}"></i></div>` +
      (x.late ? `<div class="k warn" style="margin-top:6px">${t('scLate')} ${x.late}회</div>` : '')) + `</div>`;
  }).join('');

  const [y, m] = month.split('-');
  el.innerHTML =
    `<div class="calbar"><button data-mv="-1">‹</button><span>${t('scTitle', { m: Number(m) })}</span><button data-mv="1">›</button></div>` +
    (cards || `<div class="empty">${t('noStaff')}</div>`) +
    `<div class="attbar"><a class="go" style="text-decoration:none;padding:8px 10px;border-radius:8px" href="${API}/scorecard/export?month=${month}">${t('scExport')}</a></div>`;

  el.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    state.calMonth = shiftMonth(month, Number(b.dataset.mv));
    render();
  });
}

// ---- 근태 ----
const AT = '/attendance';
function hhmm(mins) { return mins == null ? '' : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`; }

function getPos() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

async function punch(kind) {
  const msg = $('#attMsg');
  msg.textContent = '…';
  const pos = await getPos();
  const r = await api(`${AT}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pos || {}) });
  if (r.ok) { msg.style.color = '#16a34a'; msg.textContent = t('attDone'); render(); return; }
  const d = await r.json().catch(() => ({}));
  msg.style.color = '#dc2626';
  if (d.error === 'out_of_range') msg.textContent = t('attFar', { d: d.distance_m, r: d.radius_m });
  else if (d.error === 'location_required') msg.textContent = t('attGpsFail');
  else msg.textContent = t('alarmFailed');
}

async function renderAttendance() {
  const el = $('#content');
  const [tRes, mRes] = await Promise.all([api(`${AT}/today`), api(`${AT}/month`)]);
  if (tRes.status === 401) { location.reload(); return; }
  const today = await tRes.json();
  const month = mRes.ok ? await mRes.json() : { rows: [] };
  const boss = isAllMode();

  let html = '';
  if (!state.isBoss) {
    const me = today.rows[0] || {};
    html += `<div class="punch">
      <button class="in" id="pIn" ${me.check_in ? 'disabled' : ''}>${t('attIn')}</button>
      <button class="out" id="pOut" ${(!me.check_in || me.check_out) ? 'disabled' : ''}>${t('attOut')}</button>
    </div><div id="attMsg" style="font-size:13px;min-height:18px"></div>`;
    html += `<div class="attrow"><span class="nm">${t('attToday')}</span>` +
      `<span class="tm">${me.check_in || '—'} ~ ${me.check_out || '—'}</span>` +
      `<span class="rt">${me.minutes != null ? hhmm(me.minutes) : (me.check_in ? t('attWorking') : t('attNone'))}</span>` +
      (me.late ? `<span class="lt">${t('attLate')}</span>` : '') + `</div>`;
    const mine = month.rows[0];
    if (mine) html += `<div class="hint">${t('attMonth')} · ${t('attSummary', { days: mine.days, hours: hhmm(mine.minutes), late: mine.late })}</div>`;
    el.innerHTML = html;
    $('#pIn').onclick = () => punch('in');
    $('#pOut').onclick = () => punch('out');
    return;
  }

  // 사장님 화면
  const done = today.rows.filter(r => r.check_in).length;
  html += `<div class="dayhead">${t('attToday')} ${today.date.slice(5)} — ${done}/${today.rows.length}</div>`;
  html += today.rows.map(r => {
    if (!r.check_in) return `<div class="attrow none"><span class="nm">${escapeHtml(r.name)}</span>` +
      `<span class="tm">${t('attNone')}</span>` +
      `<span class="rt"><button class="go" data-mark="${r.staff_id}" style="padding:4px 8px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer">${t('attMark')}</button></span></div>`;
    return `<div class="attrow"><span class="nm">${escapeHtml(r.name)}</span>` +
      `<span class="tm">${r.check_in} ~ ${r.check_out || '—'}</span>` +
      (r.late ? `<span class="lt">${t('attLate')}</span>` : '') +
      `<span class="rt">${r.minutes != null ? hhmm(r.minutes) : t('attWorking')}</span></div>`;
  }).join('');

  html += `<div class="dayhead">${t('attMonth')} (${month.month || ''})</div>`;
  html += month.rows.map(r => `<div class="attrow"><span class="nm">${escapeHtml(r.name)}</span>` +
    `<span class="tm">${t('attSummary', { days: r.days, hours: hhmm(r.minutes), late: r.late })}</span></div>`).join('');

  html += `<div class="attbar">
    <a class="go" style="text-decoration:none;padding:8px 10px;border-radius:8px" href="${API}${AT}/export?month=${month.month || ''}">${t('attExport')}</a>
    <span>${t('attStart')}</span><input id="attStart" type="time" value="${today.work_start || '09:00'}" style="width:110px">
    <button class="go" id="attCfg">${t('alarmSave')}</button>
    <span id="attMsg" style="font-size:13px"></span>
  </div>`;
  html += `<div class="attbar"><span>${t('attPlace')}</span><span id="placeInfo" class="hint"></span>
    <span>${t('attRadius')}</span><input id="attRad" type="number" min="5" max="2000" step="5" value="30" style="width:80px">
    <button class="go" id="placeSet">${t('attSetHere')}</button></div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-mark]').forEach(b => b.onclick = async () => {
    await api(`${AT}/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: Number(b.dataset.mark) }) });
    render();
  });
  $('#attCfg').onclick = async () => {
    const r = await api(`${AT}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_start: $('#attStart').value }) });
    $('#attMsg').textContent = r.ok ? t('attSaved') : t('alarmFailed');
    if (r.ok) render();
  };
  const pr = await api(`${AT}/place`);
  const places = pr.ok ? await pr.json() : [];
  $('#placeInfo').textContent = places.length
    ? places.map(p => `${p.name} ${p.radius_m}m`).join(', ') : t('attNoPlace');
  if (places.length) $('#attRad').value = places[0].radius_m;
  $('#placeSet').onclick = async () => {
    const info = $('#placeInfo');
    info.textContent = '…';
    const pos = await getPos();
    if (!pos) { info.textContent = t('attGpsFail'); return; }
    const rad = Math.max(5, Math.min(2000, Number($('#attRad').value) || 30));
    const r = await api(`${AT}/place`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '휘트니스', lat: pos.lat, lng: pos.lng, radius_m: rad }) });
    info.textContent = r.ok ? `휘트니스 ${rad}m (±${Math.round(pos.acc)}m)` : t('alarmFailed');
  };
}

// ---- 월간 달력 ----
const DOW = [0, 1, 2, 3, 4, 5, 6];   // 요일 이름은 사전에서 (dow0..dow6)
function shiftMonth(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + String(m).padStart(2, '0');
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function firstDow(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}
function isAllMode() { return state.isBoss && state.targetStaff === ALL; }

// 사람마다 고정된 색을 준다 (직원 목록 순서 기준 — 매번 같은 색)
let COLOR_MAP = {};
function colorOf(staffId) {
  if (staffId == null) return 4;
  return COLOR_MAP[staffId] != null ? COLOR_MAP[staffId] : 4;
}
function buildColorMap(people) {
  COLOR_MAP = {};
  (people || []).forEach((p, i) => { COLOR_MAP[p.id] = i % 6; });
}

async function renderMonth() {
  if (!state.calMonth) state.calMonth = kst().slice(0, 7);
  const ym = state.calMonth;
  const allMode = isAllMode();
  const sid = allMode ? null : (state.isBoss ? state.targetStaff : null);
  const r = await api(`/calendar?month=${ym}` + (sid ? `&staff_id=${sid}` : ''));
  if (r.status === 401) { location.reload(); return; }
  const cal = await r.json();
  buildColorMap(cal.people);
  const days = cal.days || {};
  const today = kst();
  const [yy, mm] = ym.split('-');

  let grid = DOW.map(d => `<div class="dow">${t('dow' + d)}</div>`).join('');
  const lead = firstDow(ym);
  for (let i = 0; i < lead; i++) grid += `<div class="cell blank"></div>`;
  for (let d = 1; d <= daysInMonth(ym); d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const info = days[date];
    const cls = ['cell'];
    if ((lead + d - 1) % 7 === 0) cls.push('sun');
    if (date === today) cls.push('today');
    if (date === state.calDay) cls.push('sel');
    let badge = '', noteCls = '';
    if (info) {
      const notes = info.notes || 0;
      if (allMode) {
        badge = `${info.staff}/${cal.staffTotal}`;
        cls.push(info.staff >= cal.staffTotal ? 'full' : 'has');
      } else if (info.total > 0) {
        badge = `${info.done}/${info.total}`;
        cls.push(info.done >= info.total ? 'full' : 'has');
      }
      if (notes) {                    // 글에서 찾아낸 일정은 항상 '·N' 으로 함께 보인다
        badge = badge ? badge + ' ·' + notes : '·' + notes;
        if (!badge.includes('/')) noteCls = ' note';
        cls.push('has');
      }
    }
    // 숫자 배지 대신 실제 글을 보여준다 (칸이 좁으니 2줄까지, 나머지는 +N)
    const texts = (info && info.texts) || [];
    const shown = texts.slice(0, 2).map(x => {
      const cls = ['ev', 'c' + colorOf(x.s)];
      if (x.note) cls.push('note');
      if (x.done) cls.push('done');
      return `<span class="${cls.join(' ')}">${escapeHtml(x.t)}</span>`;
    }).join('');
    const rest = (info ? (info.total + info.notes) : 0) - texts.slice(0, 2).length;
    const more = rest > 0 ? `<span class="more">+${rest}</span>` : '';
    grid += `<div class="${cls.join(' ')}" data-d="${date}">` +
            `<span class="dnum">${d}</span>${shown}${more}` +
            (allMode && badge ? `<span class="badge${noteCls}">${badge}</span>` : '') + `</div>`;
  }

  // 현황판 모드에는 '내 월간 메모'라는 게 없으므로 메모 칸을 띄우지 않는다
  const memoBlock = allMode ? '' :
    `<div class="dayhead">${t('freeHint_month')}</div><div id="monthMemo"></div>`;

  const legend = allMode && cal.people?.length
    ? `<div class="legend">` + cal.people.map(p =>
        `<span class="ev c${colorOf(p.id)}">${escapeHtml(p.name)}</span>`).join('') + `</div>`
    : '';

  $('#content').innerHTML =
    `<div class="calbar"><button data-mv="-1">‹</button><span>${t('calTitle', { y: yy, m: Number(mm) })}</span><button data-mv="1">›</button></div>` +
    `<div class="cal">${grid}</div>${legend}<div id="dayView"></div>` + memoBlock;

  $('#content').querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    state.calMonth = shiftMonth(state.calMonth, Number(b.dataset.mv));
    state.calDay = null;
    render();
  });
  $('#content').querySelectorAll('.cell[data-d]').forEach(c => c.onclick = () => {
    state.calDay = (state.calDay === c.dataset.d) ? null : c.dataset.d;
    render();
  });

  if (!allMode) await renderMonthMemo(ym);
  if (state.calDay) await renderDay(state.calDay);
}

// 달력 아래 '이번 달 방향/목표' — 기존 월간 메모를 그대로 이어서 쓴다
async function renderMonthMemo(ym) {
  const box = $('#monthMemo');
  if (!box) return;
  const sid = state.isBoss ? state.targetStaff : null;
  const r = await api(`/items?period=month&date=${ym}-01` + (sid ? `&staff_id=${sid}` : ''));
  if (!r.ok) return;
  const items = await r.json();
  const memo = items[0]?.memo || '';
  const id = items[0]?.id || '';
  box.innerHTML = `<textarea class="free" id="freeMemo" data-id="${id}" data-date="${ym}-01" placeholder="${t('freeWrite')}">${escapeHtml(memo)}</textarea>`;
  $('#freeMemo').onblur = saveFree;
}

// 날짜를 누르면 그날 업무가 달력 아래에 읽기 전용으로 펼쳐진다
async function renderDay(date) {
  const box = $('#dayView');
  if (!box) return;
  const label = `<div class="dayhead">${t('dayLabel', { d: Number(date.slice(8)) })}</div>`;
  const sid = (!isAllMode() && state.isBoss) ? state.targetStaff : null;
  const r = await api(`/day?date=${date}` + (sid ? `&staff_id=${sid}` : ''));
  const rows = r.ok ? await r.json() : [];
  const html = rows.map(row => {
    const items = row.items || [], mentions = row.mentions || [];
    if (!items.length && !mentions.length) return '';
    const done = items.filter(i => i.done).length;
    const head = items.length ? `<span class="cnt">${t('doneCount', { done, total: items.length })}</span>` : '';
    const list = items.map(i =>
      `<div class="ov ${i.done ? 'done' : 'undone'}${i.from_boss ? ' boss' : ''}"><span class="mk">${i.done ? '✓' : '○'}</span>` +
      `<span class="tx">${i.from_boss ? `<span class="tag">${t('boss1')}</span>` : ''}${escapeHtml(i.title || t('noTitle'))}` +
      (i.memo ? ` <span class="m">· ${escapeHtml(i.memo)}</span>` : '') + `</span>` +
      ((state.isBoss && i.from_boss) ? `<button class="ovdel" data-del="${i.id}">×</button>` : '') + `</div>`).join('');
    const notes = mentions.map(m =>
      `<div class="mention"><span class="from">${t('fromTab', { tab: t(m.period) })}</span>` +
      escapeHtml([m.title, m.memo].filter(Boolean).join(' · ')) + `</div>`).join('');
    const asg = (state.isBoss && row.staff_id !== state.myId)
      ? `<button class="asgBtn" data-asg="${row.staff_id}" data-name="${escapeHtml(row.name)}">${t('assign')}</button>` : '';
    return `<div class="card"><h3>${escapeHtml(row.name)}${head}</h3>${list}${notes}${asg}</div>`;
  }).join('');
  box.innerHTML = label + (html || `<div class="empty">${t('noEntry')}</div>`);
  bindAssign(box);
}

function renderCheckItem(it) {
  // 사장님이 내린 지시는 직원이 지울 수 없다 (완료 체크·메모는 가능)
  const locked = it.from_boss && !state.isBoss;
  return `<div class="item ${it.done ? 'done' : ''}${it.from_boss ? ' boss' : ''}" data-id="${it.id}">
    <input type="checkbox" ${it.done ? 'checked' : ''}>
    ${it.from_boss ? `<span class="tag">${t('boss1')}</span>` : ''}
    <input class="ti" value="${escapeHtml(it.title || '')}" placeholder="${t('todo')}" ${locked ? 'readonly' : ''}>
    <input class="memo" value="${escapeHtml(it.memo || '')}" placeholder="${t('memo')}">
    ${locked ? '' : '<button class="del">×</button>'}
  </div>`;
}
function bindCheckItem(node) {
  const id = node.dataset.id;
  node.querySelector('input[type=checkbox]').onchange = (e) => patch(id, { done: e.target.checked }).then(render);
  const ti = node.querySelector('.ti');
  if (!ti.readOnly) ti.onblur = (e) => patch(id, { title: e.target.value });
  node.querySelector('.memo').onblur = (e) => patch(id, { memo: e.target.value });
  const del = node.querySelector('.del');
  if (del) del.onclick = () => api(`/items/${id}`, { method: 'DELETE' }).then(render);
}
async function addCheckItem() {
  await api('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyWithStaff({ period: state.period, item_date: itemDateFor(state.period), title: '', memo: '' })) });
  render();
}
async function saveFree(e) {
  const id = e.target.dataset.id;
  const memo = e.target.value;
  const itemDate = e.target.dataset.date || itemDateFor(state.period);
  if (id) { await patch(id, { memo }); }
  else {
    const r = await api('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithStaff({ period: state.period, item_date: itemDate, memo })) });
    const d = await r.json(); e.target.dataset.id = d.id;
  }
  flashSaved();
}
function patch(id, body) {
  return api(`/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(flashSaved);
}
function bodyWithStaff(body) {
  if (state.isBoss && state.targetStaff && state.targetStaff !== ALL) body.staff_id = state.targetStaff;
  return body;
}
function flashSaved() { const m = $('#savedMsg'); m.textContent = t('saved'); setTimeout(() => m.textContent = '', 1200); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- 이벤트 바인딩 ----
$('#staffLoginBtn').onclick = () => {
  const n = $('#nameSel').value;
  if (!n) { $('#loginErr').textContent = t('selectName'); return; }
  doLogin({ name: n, password: $('#staffPw').value });
};
$('#bossLoginBtn').onclick = () => doLogin({ boss_pw: $('#bossPw').value });
$('#logoutBtn').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
$('#bossStaffSel').onchange = (e) => { state.targetStaff = selVal(e.target.value); $('#pwPanel').style.display = 'none'; render(); };
$('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('#tabs').querySelector('.active').classList.remove('active');
  b.classList.add('active'); state.period = b.dataset.p; state.calDay = null; render();
});

// ---- 비밀번호 변경 ----
function togglePwPanel() {
  const panel = $('#pwPanel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const f = panel.querySelector('#pwFields');
  const inp = 'padding:10px;border:1px solid #d1d5db;border-radius:8px;margin-right:6px';
  const btn = 'padding:10px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer';
  if (state.isBoss) {
    if (state.targetStaff === ALL) {
      f.innerHTML = `<div class="hint">${t('pwPickStaff')}</div>`;
      return;
    }
    if (state.targetStaff === state.myId) {
      f.innerHTML = `<div class="hint">${t('pwBossEnv')}</div>`;
      return;
    }
    const name = $('#bossStaffSel').selectedOptions[0]?.textContent || '';
    f.innerHTML = `<div class="hint">${escapeHtml(t('pwSetFor', { name }))}</div>
      <input id="npw" type="text" placeholder="${t('newPassword')}" style="${inp}">
      <button id="pwSave" style="${btn}">${t('save')}</button>
      <span id="pwMsg" style="font-size:13px;margin-left:8px"></span>`;
    $('#pwSave').onclick = doBossReset;
  } else {
    f.innerHTML = `<input id="cpw" type="password" placeholder="${t('curPassword')}" style="${inp}">
      <input id="npw" type="password" placeholder="${t('newPassword')}" style="${inp}">
      <button id="pwSave" style="${btn}">${t('change')}</button>
      <span id="pwMsg" style="font-size:13px;margin-left:8px"></span>`;
    $('#pwSave').onclick = doChangePw;
  }
}
async function doChangePw() {
  const r = await api('/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: $('#cpw').value, new_password: $('#npw').value }) });
  const msg = $('#pwMsg');
  if (r.ok) { msg.style.color = '#16a34a'; msg.textContent = t('pwChanged'); $('#cpw').value = ''; $('#npw').value = ''; }
  else { msg.style.color = '#dc2626'; msg.textContent = r.status === 401 ? t('pwWrongCurrent') : (r.status === 400 ? t('pwTooShort') : t('pwFailed')); }
}
async function doBossReset() {
  const r = await api('/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staff_id: state.targetStaff, new_password: $('#npw').value }) });
  const msg = $('#pwMsg');
  if (r.ok) { msg.style.color = '#16a34a'; msg.textContent = t('pwReset'); $('#npw').value = ''; }
  else { msg.style.color = '#dc2626'; msg.textContent = r.status === 400 ? t('pwTooShort') : t('pwFailed'); }
}
$('#pwBtn').onclick = togglePwPanel;

// ---- 알람 설정 ----
function alarmTargetId() {
  if (!state.isBoss) return null;                       // 직원은 서버가 본인으로 강제
  return state.targetStaff === ALL ? state.myId : state.targetStaff;
}
async function toggleAlarmPanel() {
  const panel = $('#alarmPanel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const sid = alarmTargetId();
  const r = await api('/alarm' + (sid ? `?staff_id=${sid}` : ''));
  const d = r.ok ? await r.json() : { chat_id: '', enabled: 0, send_at: '09:00' };
  const inp = 'padding:9px;border:1px solid #d1d5db;border-radius:8px;margin-right:6px';
  const btn = 'padding:9px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;margin-right:6px';
  $('#alarmFields').innerHTML =
    `<div style="margin-bottom:6px">
       <label style="font-size:14px"><input type="checkbox" id="alOn" ${d.enabled ? 'checked' : ''}> ${t('alarmOn')}</label>
       <span style="margin-left:10px;font-size:14px">${t('alarmTime')}</span>
       <input id="alAt" type="time" value="${escapeHtml(d.send_at || '09:00')}" style="${inp}">
     </div>
     <div style="margin-bottom:6px">
       <input id="alChat" type="text" inputmode="numeric" placeholder="${t('alarmChat')}" value="${escapeHtml(d.chat_id || '')}" style="${inp};width:190px">
       <button id="alSave" style="${btn}">${t('alarmSave')}</button>
       <button id="alTest" style="${btn};background:#6b7280">${t('alarmTest')}</button>
       <span id="alMsg" style="font-size:13px;margin-left:4px"></span>
     </div>
     <div class="hint">${t('alarmHelp')}</div>`;
  $('#alSave').onclick = saveAlarm;
  $('#alTest').onclick = testAlarm;
  renderPushRow();
}

// ---- 폰 알림(웹 푸시) ----
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

function b64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function renderPushRow() {
  const box = document.createElement('div');
  box.id = 'pushRow';
  box.style.marginTop = '10px';
  box.style.paddingTop = '8px';
  box.style.borderTop = '1px solid #e5e7eb';
  $('#alarmFields').appendChild(box);

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) { box.innerHTML = `<div class="hint">${t('pushNo')}</div>`; return; }
  // 아이폰은 홈 화면에 추가된 상태에서만 알림이 온다 (iOS 제약)
  if (isIos() && !isStandalone()) {
    box.innerHTML = `<div class="hint"><b>${t('pushNeedHome')}</b><br>${t('pushHowIos')}</div>`;
    return;
  }

  const r = await api('/push');
  if (!r.ok) return;
  const d = await r.json();
  if (!d.ready) return;
  const btn = 'padding:9px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;margin-right:6px';

  if (d.subscribed) {
    box.innerHTML = `<span style="color:#16a34a;font-size:14px;margin-right:8px">🔔 ${t('pushOk')}</span>` +
      `<button id="pTest" style="${btn};background:#6b7280">${t('pushTest')}</button>` +
      `<button id="pOff" style="${btn};background:#6b7280">${t('pushOff')}</button>` +
      `<span id="pMsg" style="font-size:13px;margin-left:4px"></span>`;
    $('#pTest').onclick = async () => {
      const rr = await api('/push/test', { method: 'POST' });
      $('#pMsg').textContent = rr.ok ? t('pushSent') : t('alarmFailed');
    };
    $('#pOff').onclick = async () => {
      const reg = await navigator.serviceWorker.getRegistration('/staff-manager/');
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) { await api('/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      else await api('/push', { method: 'DELETE' });
      box.remove(); renderPushRow();
    };
    return;
  }

  box.innerHTML = `<button id="pOn" style="${btn}">🔔 ${t('pushOn')}</button><span id="pMsg" style="font-size:13px"></span>`;
  $('#pOn').onclick = async () => {
    const msg = $('#pMsg');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { msg.style.color = '#dc2626'; msg.textContent = t('pushDenied'); return; }
      const reg = await navigator.serviceWorker.register('sw.js', { scope: '/staff-manager/' });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(d.publicKey) });
      const res = await api('/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error('save failed');
      box.remove(); renderPushRow();
    } catch (e) {
      msg.style.color = '#dc2626';
      msg.textContent = t('alarmFailed');
    }
  };
}

async function saveAlarm() {
  const sid = alarmTargetId();
  const body = { enabled: $('#alOn').checked ? 1 : 0, send_at: $('#alAt').value || '09:00', chat_id: $('#alChat').value.trim() };
  if (sid) body.staff_id = sid;
  const r = await api('/alarm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const m = $('#alMsg');
  if (r.ok) { m.style.color = '#16a34a'; m.textContent = t('alarmSaved'); }
  else { m.style.color = '#dc2626'; m.textContent = t('alarmFailed'); }
}
async function testAlarm() {
  await saveAlarm();
  const sid = alarmTargetId();
  const r = await api('/alarm/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sid ? { staff_id: sid } : {}) });
  const m = $('#alMsg');
  if (r.ok) { m.style.color = '#16a34a'; m.textContent = t('alarmSentOk'); }
  else { m.style.color = '#dc2626'; m.textContent = r.status === 400 ? t('alarmNoChat') : t('alarmFailed'); }
}
$('#alarmBtn').onclick = toggleAlarmPanel;

// ---- 새로고침 ----
// 당겨서 새로고침은 꺼져 있으므로(실수로 앱을 벗어나는 걸 막느라) 대신 이 경로들을 쓴다.
function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
function appOpen() { return $('#appView').style.display === 'block'; }

async function refreshNow() {
  const b = $('#reloadBtn');
  if (isTyping()) document.activeElement.blur();   // 입력 중이던 값을 먼저 저장시킨다
  b.classList.add('spin');
  await new Promise(r => setTimeout(r, 120));      // onblur 저장이 먼저 나가도록 잠깐 기다린다
  try { await render(); } finally { setTimeout(() => b.classList.remove('spin'), 400); }
}
$('#reloadBtn').onclick = refreshNow;

// 앱으로 돌아오면 최신 내용을 다시 불러온다 (입력 중이면 건드리지 않는다)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && appOpen() && !isTyping()) render();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted && appOpen() && !isTyping()) render();
});

// ---- 부팅: 살아있는 세션이 있으면 로그인 화면 건너뛰기 ----
function applySession(d) {
  state.isBoss = d.isBoss;
  state.staffId = d.staff_id || null;
  state.myId = d.my_id || null;
  state.name = d.name || '사장님';
  enterApp();
}
document.querySelectorAll('.langBtn').forEach(b => {
  b.onclick = () => setLang(LANG === 'ko' ? 'mn' : 'ko');
});

async function boot() {
  applyI18n();
  await loadStaffList();
  try {
    const r = await api('/me');
    if (r.ok) applySession(await r.json());
  } catch (e) { /* 오프라인 등 — 로그인 화면 유지 */ }
}
boot();
