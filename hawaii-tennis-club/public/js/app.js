// 앱 시작 — 로그인 확인, 탭 전환, 상단 메뉴.
import { $, $$, api, esc, toast, openModal, errText, pickFacePhoto, avatar } from './ui.js';
import { t, applyStatic, levelLabel } from './i18n.js';
import { renderHome } from './views/home.js';
import { renderSchedule } from './views/schedule.js';
import { renderBoard } from './views/board.js';
import { openPushPanel } from './views/push.js';
import { initInstall, openInvite } from './views/install.js';
import { initPullRefresh, refresh } from './refresh.js';
import { initBackNav } from './backnav.js';
import { initUpdate, checkUpdate } from './update.js';
import { openJoinForm } from './views/join.js';

// 폰 뒤로가기가 열린 창부터 닫게 — 아래 탭 이동 popstate 보다 먼저 등록해야 한다
initBackNav();
import { openRules, askAgreeIfNeeded } from './views/rules.js';
import { renderDues } from './views/dues.js';
import { renderNotices } from './views/notices.js';
import { renderMembers } from './views/members.js';
import { renderChat } from './views/chat.js';
import { renderTraining, renderMyFees, renderEliteNotices } from './views/elite-me.js';
import { renderElite } from './views/elite.js';

const state = { me: null, settings: { club_name: 'Hawaii Tennis Club', monthly_fee: 0, joining_fee: 0, currency: '₮' }, tab: 'home' };

const VIEWS = {
  home: renderHome,
  schedule: renderSchedule,
  board: renderBoard,
  dues: renderDues,
  notices: renderNotices,
  members: renderMembers,
  chat: renderChat,          // 하단 Free Chat 탭
  elite: renderElite,        // 오너·선수반 코치
  training: renderTraining,  // 선수(부모) 계정
  fees: renderMyFees,
  enotices: renderEliteNotices,
};

// 계정 종류 — 선수반 선수는 선수반 탭만, 동호인은 선수 탭을 빼고 (Elite 탭은 오너·선수반 코치만)
const isElite = () => state.me?.program === 'elite';
const isEliteStaff = () => !!state.me && !isElite() && !!(state.me.is_owner || state.me.elite_coach);
const homeTab = () => (isElite() ? 'training' : 'home');
const ELITE_TABS = ['training', 'fees', 'enotices'];
const allowed = (tab) => (isElite() ? ELITE_TABS.includes(tab) : !ELITE_TABS.includes(tab) && (tab !== 'elite' || isEliteStaff()));
// 선수반 알림 주소(#training·#fees·#enotices)를 관리자가 누르면 Elite 탭의 그 칸으로
const STAFF_SEC = { training: 'schedule', fees: 'fees', enotices: 'notices' };
function pickTab(tab) {
  if (!isElite() && isEliteStaff() && STAFF_SEC[tab]) { state.eliteSec = STAFF_SEC[tab]; return 'elite'; }
  return VIEWS[tab] && allowed(tab) ? tab : homeTab();
}

// 주소 → 탭. '#chat-12' 는 채팅 탭의 12번 방 (알림을 누르면 이 주소로 열린다)
function fromHash(h) {
  const m = /^#?chat-(\d+)$/.exec(h || '');
  if (m && !isElite()) { state.chatRoom = Number(m[1]); return 'chat'; }
  const tab = String(h || '').replace(/^#/, '') || homeTab();
  if (tab === 'chat') state.chatRoom = null;
  return pickTab(tab);
}
const hashOf = () => (state.tab === 'chat' && state.chatRoom ? `#chat-${state.chatRoom}` : `#${state.tab}`);

// ---------- 렌더 ----------
async function render({ keepScroll = false } = {}) {
  const el = $('#content');
  const view = VIEWS[state.tab] || renderHome;
  try {
    await view(el, state);
  } catch (e) {
    if (e.status === 401) return showLogin();        // 세션이 끊기면 로그인 화면으로
    el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`;
  }
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#backBtn').hidden = state.tab === homeTab();
  // 방 안에서는 하단 탭을 숨기고 그 자리에 입력칸을 둔다
  document.body.classList.toggle('in-room', state.tab === 'chat' && !!state.chatRoom);
  updateChatBadge();
  // 채팅방은 화면이 스스로 맨 아래(최신 메시지)로 내려가 있으므로 건드리지 않는다
  if (!keepScroll && !(state.tab === 'chat' && state.chatRoom)) window.scrollTo({ top: 0 });
}

// 앱 안에서 탭을 몇 번 옮겼는지 — 0 이면 뒤로 갈 곳이 앱 밖(알림으로 바로 열었을 때 등)이다
let navDepth = 0;

function goTab(tab, { room, replace = false } = {}) {
  state.tab = pickTab(tab);
  if (state.tab === 'chat') state.chatRoom = room || null;
  // 뒤로가기로 탭을 되짚을 수 있게 주소에 남긴다
  const h = hashOf();
  if (replace) history.replaceState({ tab: state.tab, room: state.chatRoom }, '', h);
  else if (location.hash !== h) { history.pushState({ tab: state.tab, room: state.chatRoom }, '', h); navDepth++; }
  render();
}
state.go = goTab;   // 화면 쪽(채팅·회원)에서 탭을 옮길 때

// Free Chat 탭의 안 읽은 수 — 화면을 그릴 때마다, 그리고 30초마다
let badgeBusy = false;
async function updateChatBadge() {
  if (!state.me || isElite() || badgeBusy) return;   // 선수 계정에는 채팅이 없다 (서버가 403)
  badgeBusy = true;
  try {
    const { count } = await api('/chat/unread');
    const b = $('#chatBadge');
    b.hidden = !count;
    b.textContent = count > 99 ? '99+' : String(count);
  } catch (e) { /* 다음 차례에 */ }
  finally { badgeBusy = false; }
}
setInterval(() => { if (!document.hidden) updateChatBadge(); }, 30000);

// ---------- 로그인 ----------
function showLogin() {
  state.me = null;
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginPin').value = '';
}

function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#topClub').textContent = state.settings.club_name;
  $$('.admin-only').forEach(el => { el.hidden = !(state.me.role === 'admin' || state.me.is_owner); });
  $$('.owner-only').forEach(el => { el.hidden = !state.me.is_owner; });
  // 선수반 선수는 동호인 탭·메뉴를 보지 않는다 (settingsBtn 은 owner-only 라 선수에게는 이미 숨겨진다)
  $$('.club-only').forEach(el => { el.hidden = isElite() || (el.classList.contains('owner-only') && !state.me.is_owner); });
  $$('.elite-only').forEach(el => { el.hidden = !isElite(); });
  $$('.elite-staff-only').forEach(el => { el.hidden = !isEliteStaff(); });
  document.body.classList.toggle('tabs-8', isEliteStaff());
  state.tab = fromHash(location.hash);
  render();
}

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  const err = $('#loginErr');
  btn.disabled = true;
  btn.textContent = t('loggingIn');
  err.textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { phone: $('#loginPhone').value, pin: $('#loginPin').value } });
    state.me = r.me;
    state.settings = await api('/settings');
    const me = await api('/auth/me').catch(() => ({}));
    state.rules_agreed = me.rules_agreed;
    showApp();
    if (!isElite()) askAgreeIfNeeded(state);   // 동호회 회칙 — 선수반 선수에게는 묻지 않는다
  } catch (e2) {
    err.textContent = e2.message === 'too_many_tries' ? t('loginLocked', { s: e2.data?.retry_after || 60 })
      : e2.message === 'dormant' ? t('loginDormant')
      : t('loginFail');
  } finally {
    btn.disabled = false;
    btn.textContent = t('login');
  }
};

// ---------- 가입 신청 (로그인 화면) ----------
// 신청서(회칙·개인정보 동의 포함)는 views/join.js. 관리자가 승인해야 회원이 되고 그때부터 로그인된다.
$('#joinBtn').onclick = () => openJoinForm();

// ---------- 상단 메뉴 ----------
const sheet = $('#menuSheet');
$('#menuBtn').onclick = () => { sheet.hidden = false; };
$('#menuClose').onclick = () => { sheet.hidden = true; };
sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };

$('#logoutBtn').onclick = async () => {
  sheet.hidden = true;
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
};

$('#rulesBtn').onclick = () => { sheet.hidden = true; openRules({ canEdit: !!state.me?.is_owner }); };

$('#pushBtn').onclick = () => { sheet.hidden = true; openPushPanel(); };
initInstall(() => { sheet.hidden = true; });
$('#inviteBtn').onclick = () => { sheet.hidden = true; openInvite(state.settings.club_name); };

// ---------- 새로고침 ----------
// 상단 ↻ 버튼, 또는 맨 위에서 아래로 당기기. 창(모달)이 열려 있을 땐 당기기를 막는다(쓰던 내용이 날아가니까)
$('#refreshBtn').onclick = async () => {
  const b = $('#refreshBtn');
  if (b.classList.contains('spin')) return;
  b.classList.add('spin');
  try { await refresh(() => render({ keepScroll: true })); } finally { b.classList.remove('spin'); }
  checkUpdate();   // 새 버전이 올라와 있으면 화면째 새로 받는다
};
initUpdate();
initPullRefresh(() => render({ keepScroll: true }), {
  enabled: () => !!state.me && !$('#modalRoot').innerHTML && $('#menuSheet').hidden,
});

// 내 레벨·코치 — 회원이 직접 고른다
// 내 사진 — 고르면 바로 올라간다. 회원 명단·게시판·채팅에 이름 옆으로 보인다
$('#photoBtn').onclick = () => {
  sheet.hidden = true;
  const m = openModal({
    title: t('myPhoto'),
    fields: [],
    extra: `<div class="photo-edit">${avatar(state.me.name, state.me.photo, 'photo-preview')}
        <button type="button" class="btn btn-sm btn-primary" data-photo>📷 ${esc(t('photoChoose'))}</button>
        ${state.me.photo ? `<button type="button" class="btn btn-sm btn-danger" data-photo-del>${esc(t('photoRemove'))}</button>` : ''}</div>
      <div class="hint">${esc(t('photoHint'))}</div>`,
    saveLabel: t('photoDone'),
    onSave: () => {},
  });
  const done = (photo) => { state.me = { ...state.me, photo }; m.close(); toast(t('saved')); render({ keepScroll: true }); };
  m.form.querySelector('[data-photo]').onclick = async () => {
    const data = await pickFacePhoto();
    if (!data) return;
    try { done((await api('/auth/photo', { method: 'PUT', body: { photo_data: data } })).photo); }
    catch (e) { m.err.textContent = errText(e); }
  };
  const del = m.form.querySelector('[data-photo-del]');
  if (del) del.onclick = async () => { await api('/auth/photo', { method: 'DELETE' }).catch(() => {}); done(null); };
};

$('#levelBtn').onclick = () => {
  sheet.hidden = true;
  const LV = ['newbie', 'beginner', 'intermediate', 'advanced'];
  openModal({
    title: t('myLevel'),
    fields: [
      { name: 'level', label: t('level'), type: 'select', value: state.me.level,
        options: LV.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'is_coach', label: t('coach'), type: 'select', value: state.me.is_coach ? '1' : '0',
        options: [{ value: '0', label: t('coachNo') }, { value: '1', label: t('coachYes') }] },
    ],
    extra: `<div class="hint">${esc(t('myLevelHint'))}</div>`,
    onSave: async (v) => {
      const r = await api('/auth/profile', { method: 'PATCH', body: v });
      state.me = r.me;
      toast(t('saved'));
      render({ keepScroll: true });
    },
  });
};

$('#pinBtn').onclick = () => {
  sheet.hidden = true;
  openModal({
    title: t('changePin'),
    fields: [
      { name: 'current', label: t('currentPin'), type: 'password', inputmode: 'numeric', maxlength: 4 },
      { name: 'new_pin', label: t('newPin'), type: 'password', inputmode: 'numeric', maxlength: 4 },
    ],
    onSave: async (v) => {
      if (!/^\d{4}$/.test(v.new_pin)) return t('pin4');
      await api('/auth/pin', { method: 'POST', body: v });
      toast(t('pinChanged'));
    },
  });
};

$('#settingsBtn').onclick = () => {
  sheet.hidden = true;
  openModal({
    title: t('settings'),
    fields: [
      { name: 'club_name', label: t('clubName'), value: state.settings.club_name },
      { name: 'monthly_fee', label: `${t('monthlyFee')} (${state.settings.currency})`, type: 'number', value: state.settings.monthly_fee, min: 0 },
      { name: 'joining_fee', label: `${t('joiningFee')} (${state.settings.currency})`, type: 'number', value: state.settings.joining_fee, min: 0 },
      { name: 'bank_name', label: t('bankName'), value: state.settings.bank_name || '', maxlength: 60 },
      { name: 'bank_account', label: t('bankAccountNo'), value: state.settings.bank_account || '', maxlength: 40, inputmode: 'numeric' },
      { name: 'bank_holder', label: t('bankHolder'), value: state.settings.bank_holder || '', maxlength: 60 },
      { name: 'elite_fee', label: `${t('eliteDefaultFee')} (${state.settings.currency})`, type: 'number', value: state.settings.elite_fee, min: 0 },
    ],
    onSave: async (v) => {
      state.settings = await api('/settings', { method: 'PUT', body: v });
      $('#topClub').textContent = state.settings.club_name;
      toast(t('saved'));
      render();
    },
  });
};

// ---------- 탭 · 언어 · 뒤로가기 ----------
$$('#tabbar button').forEach(b => b.onclick = () => goTab(b.dataset.tab));

// ← 버튼: 앞서 본 탭으로. 앱 안에서 옮긴 적이 없으면(바로 열었으면) 홈으로 — 앱 밖으로 나가지 않게
$('#backBtn').onclick = () => {
  if (navDepth > 0) return history.back();
  const h = homeTab();
  history.replaceState({ tab: h }, '', `#${h}`);
  state.tab = h;
  render();
};

window.addEventListener('popstate', () => {
  navDepth = Math.max(0, navDepth - 1);
  state.tab = fromHash(location.hash);
  if (state.me) render();
});

// 앱으로 돌아오면 지금 화면을 다시 불러온다 (다른 사람이 바꾼 내용 반영)
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.me || $('#modalRoot').innerHTML) return;
  if (state.tab === 'chat' && state.chatRoom) return updateChatBadge();
  render();
});

// ---------- 부팅 ----------
async function boot() {
  applyStatic();
  try {
    state.settings = await api('/settings');
    $('#brandName').textContent = state.settings.club_name;
  } catch (e) { /* 서버가 아직 안 떴을 때 — 기본값 그대로 */ }

  try {
    const r = await api('/auth/me');          // 쿠키가 살아있으면 로그인 화면을 건너뛴다
    state.me = r.me;
    state.rules_agreed = r.rules_agreed;
    showApp();
    if (!isElite()) askAgreeIfNeeded(state);  // 아직 회칙에 동의하지 않았으면 한 번 받는다 (선수반 선수는 제외)
  } catch (e) {
    showLogin();
    if (location.hash === '#join') openJoinForm();   // 초대 링크로 들어온 사람 — 가입 신청서부터
    else if (location.hash === '#join-elite') openJoinForm('elite');   // 선수반 초대 링크 — 선수반 신청서부터
  }

  if ('serviceWorker' in navigator) {
    // 상대 경로로 등록해야 /club/ 같은 하위 경로에서도 그 폴더만 범위로 잡는다
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
}

boot();
