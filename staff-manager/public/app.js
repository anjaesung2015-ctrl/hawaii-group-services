// 옛 PWA 서비스워커 잔재 제거 (기존 118KB 앱 캐시가 새 앱을 가리는 것 방지)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
}

// 상대 경로 API (nginx가 /staff-manager/ 프리픽스를 벗김)
const API = 'api/report';
const CHECK_PERIODS = ['today', 'tomorrow'];
const state = { isBoss: false, staffId: null, name: '', targetStaff: null, period: 'today' };

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
  if (!r.ok) { $('#loginErr').textContent = '로그인 실패'; return; }
  const d = await r.json();
  state.isBoss = d.isBoss;
  state.staffId = d.staff_id || null;
  state.name = d.name || '사장님';
  enterApp();
}

function enterApp() {
  $('#loginView').style.display = 'none';
  $('#appView').style.display = 'block';
  if (state.isBoss) {
    $('#whoami').textContent = '사장님';
    $('#bossStaffSel').style.display = 'inline-block';
    state.targetStaff = Number($('#bossStaffSel').value);
  } else {
    $('#whoami').textContent = state.name;
    state.targetStaff = state.staffId;
  }
  render();
}

// ---- 렌더 ----
function currentStaffId() { return state.isBoss ? state.targetStaff : state.staffId; }
function qs(period) {
  const p = new URLSearchParams({ period, date: itemDateFor(period) });
  if (state.isBoss && state.targetStaff) p.set('staff_id', state.targetStaff);
  return '?' + p.toString();
}

async function render() {
  const period = state.period;
  const r = await api('/items' + qs(period));
  if (r.status === 401) { location.reload(); return; }
  const items = await r.json();
  const el = $('#content');
  if (CHECK_PERIODS.includes(period)) {
    el.innerHTML = items.map(renderCheckItem).join('') +
      `<button class="add" id="addBtn">+ 항목 추가</button>`;
    $('#addBtn').onclick = addCheckItem;
    el.querySelectorAll('.item').forEach(bindCheckItem);
  } else {
    const memo = items[0]?.memo || '';
    const id = items[0]?.id || '';
    el.innerHTML = `<div class="hint">${{week:'이번 주',month:'이번 달',year:'올해'}[period]} 방향/목표를 자유롭게 적어두세요.</div>
      <textarea class="free" id="freeMemo" data-id="${id}" placeholder="자유롭게 작성...">${escapeHtml(memo)}</textarea>`;
    $('#freeMemo').onblur = saveFree;
  }
}

function renderCheckItem(it) {
  return `<div class="item ${it.done ? 'done' : ''}" data-id="${it.id}">
    <input type="checkbox" ${it.done ? 'checked' : ''}>
    <input class="ti" value="${escapeHtml(it.title || '')}" placeholder="할 일">
    <input class="memo" value="${escapeHtml(it.memo || '')}" placeholder="메모">
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
  if (id) { await patch(id, { memo }); }
  else {
    const r = await api('/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithStaff({ period: state.period, item_date: itemDateFor(state.period), memo })) });
    const d = await r.json(); e.target.dataset.id = d.id;
  }
  flashSaved();
}
function patch(id, body) {
  return api(`/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(flashSaved);
}
function bodyWithStaff(body) {
  if (state.isBoss && state.targetStaff) body.staff_id = state.targetStaff;
  return body;
}
function flashSaved() { const m = $('#savedMsg'); m.textContent = '저장됨'; setTimeout(() => m.textContent = '', 1200); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- 이벤트 바인딩 ----
$('#staffLoginBtn').onclick = () => { const n = $('#nameSel').value; if (!n) { $('#loginErr').textContent = '이름을 선택하세요'; return; } doLogin({ name: n }); };
$('#bossLoginBtn').onclick = () => doLogin({ boss_pw: $('#bossPw').value });
$('#logoutBtn').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
$('#bossStaffSel').onchange = (e) => { state.targetStaff = Number(e.target.value); render(); };
$('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('#tabs').querySelector('.active').classList.remove('active');
  b.classList.add('active'); state.period = b.dataset.p; render();
});

loadStaffList();
