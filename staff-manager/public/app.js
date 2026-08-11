// 옛 PWA 서비스워커 잔재 제거 (기존 118KB 앱 캐시가 새 앱을 가리는 것 방지)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
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

// ---- 날짜 헬퍼 (KST 기준) ----
function kst(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function weekStart() {
  const d = new Date(Date.now() + 9 * 3600000);
  const day = (d.getUTCDay() + 6) % 7; // 월요일 시작
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
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
          return `<div class="ov ${i.done ? 'done' : 'undone'}"><span class="mk">${i.done ? '✓' : '○'}</span>` +
                 `<span class="tx">${title}${memo}${orig}</span></div>`;
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
    return `<div class="card"><h3>${escapeHtml(row.name)}${head}</h3>${body}</div>`;
  }).join('');
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

async function renderMonth() {
  if (!state.calMonth) state.calMonth = kst().slice(0, 7);
  const ym = state.calMonth;
  const allMode = isAllMode();
  const sid = allMode ? null : (state.isBoss ? state.targetStaff : null);
  const r = await api(`/calendar?month=${ym}` + (sid ? `&staff_id=${sid}` : ''));
  if (r.status === 401) { location.reload(); return; }
  const cal = await r.json();
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
      } else if (notes) {
        badge = '·' + notes;          // 글에서 찾아낸 일정만 있는 날
        noteCls = ' note';
        cls.push('has');
      }
      if (info.total > 0 && notes) badge += ' ·' + notes;
    }
    grid += `<div class="${cls.join(' ')}" data-d="${date}">` +
            `<span class="dnum">${d}</span><span class="badge${noteCls}">${badge}</span></div>`;
  }

  // 현황판 모드에는 '내 월간 메모'라는 게 없으므로 메모 칸을 띄우지 않는다
  const memoBlock = allMode ? '' :
    `<div class="dayhead">${t('freeHint_month')}</div><div id="monthMemo"></div>`;

  $('#content').innerHTML =
    `<div class="calbar"><button data-mv="-1">‹</button><span>${t('calTitle', { y: yy, m: Number(mm) })}</span><button data-mv="1">›</button></div>` +
    `<div class="cal">${grid}</div><div id="dayView"></div>` + memoBlock;

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
      `<div class="ov ${i.done ? 'done' : 'undone'}"><span class="mk">${i.done ? '✓' : '○'}</span>` +
      `<span class="tx">${escapeHtml(i.title || t('noTitle'))}` +
      (i.memo ? ` <span class="m">· ${escapeHtml(i.memo)}</span>` : '') + `</span></div>`).join('');
    const notes = mentions.map(m =>
      `<div class="mention"><span class="from">${t('fromTab', { tab: t(m.period) })}</span>` +
      escapeHtml([m.title, m.memo].filter(Boolean).join(' · ')) + `</div>`).join('');
    return `<div class="card"><h3>${escapeHtml(row.name)}${head}</h3>${list}${notes}</div>`;
  }).join('');
  box.innerHTML = label + (html || `<div class="empty">${t('noEntry')}</div>`);
}

function renderCheckItem(it) {
  return `<div class="item ${it.done ? 'done' : ''}" data-id="${it.id}">
    <input type="checkbox" ${it.done ? 'checked' : ''}>
    <input class="ti" value="${escapeHtml(it.title || '')}" placeholder="${t('todo')}">
    <input class="memo" value="${escapeHtml(it.memo || '')}" placeholder="${t('memo')}">
    <button class="del">×</button>
  </div>`;
}
function bindCheckItem(node) {
  const id = node.dataset.id;
  node.querySelector('input[type=checkbox]').onchange = (e) => patch(id, { done: e.target.checked }).then(render);
  node.querySelector('.ti').onblur = (e) => patch(id, { title: e.target.value });
  node.querySelector('.memo').onblur = (e) => patch(id, { memo: e.target.value });
  node.querySelector('.del').onclick = () => api(`/items/${id}`, { method: 'DELETE' }).then(render);
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
