// 앱 시작 — 로그인 확인, 탭 전환, 상단 메뉴.
import { $, $$, api, esc, toast, openModal, errText } from './ui.js';
import { t, applyStatic } from './i18n.js';
import { renderHome } from './views/home.js';
import { renderSchedule } from './views/schedule.js';
import { renderBoard } from './views/board.js';
import { openPushPanel } from './views/push.js';
import { openRules, askAgreeIfNeeded } from './views/rules.js';
import { renderDues } from './views/dues.js';
import { renderNotices } from './views/notices.js';
import { renderMembers } from './views/members.js';

const state = { me: null, settings: { club_name: 'Hawaii Tennis Club', monthly_fee: 0, joining_fee: 0, currency: '₮' }, tab: 'home' };

const VIEWS = {
  home: renderHome,
  schedule: renderSchedule,
  board: renderBoard,
  dues: renderDues,
  notices: renderNotices,
  members: renderMembers,
};

// ---------- 렌더 ----------
async function render() {
  const el = $('#content');
  const view = VIEWS[state.tab] || renderHome;
  try {
    await view(el, state);
  } catch (e) {
    if (e.status === 401) return showLogin();        // 세션이 끊기면 로그인 화면으로
    el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`;
  }
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  window.scrollTo({ top: 0 });
}

function goTab(tab) {
  state.tab = VIEWS[tab] ? tab : 'home';
  // 뒤로가기로 탭을 되짚을 수 있게 주소에 남긴다
  if (location.hash !== `#${state.tab}`) history.pushState({ tab: state.tab }, '', `#${state.tab}`);
  render();
}

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
  $('#topWho').textContent = `${state.me.name}${state.me.title ? ` · ${state.me.title}` : ''}`;
  $$('.admin-only').forEach(el => { el.hidden = !(state.me.role === 'admin' || state.me.is_owner); });
  $$('.owner-only').forEach(el => { el.hidden = !state.me.is_owner; });
  const tab = (location.hash || '#home').slice(1);
  state.tab = VIEWS[tab] ? tab : 'home';
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
    askAgreeIfNeeded(state);
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
// 신청만 넣고 끝. 관리자가 승인해야 회원이 되고 그때부터 로그인된다.
const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
$('#joinBtn').onclick = () => {
  openModal({
    title: t('joinRequest'),
    fields: [
      { name: 'name', label: t('name'), placeholder: t('name') },
      { name: 'phone', label: t('phone'), type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: '99112233' },
      { name: 'pin', label: t('pin'), type: 'tel', inputmode: 'numeric', maxlength: 4, placeholder: '1234' },
      { name: 'level', label: t('level'), type: 'select', value: 'beginner',
        options: LEVELS.map(l => ({ value: l, label: t({ newbie: 'lvNewbie', beginner: 'lvBeginner', intermediate: 'lvIntermediate', advanced: 'lvAdvanced' }[l]) })) },
    ],
    extra: `<div class="hint">${t('joinHint')}</div>
      <label class="rl-agree"><input type="checkbox" name="agree"><span>${t('rulesAgreeCheck')}</span></label>
      <button type="button" class="btn btn-sm" style="width:100%" data-see-rules>${t('rulesSee')}</button>`,
    saveLabel: t('joinSend'),
    onSave: async (v, form) => {
      if (!v.name) return t('required');
      if (!/^\d{4}$/.test(v.pin)) return t('pin4');
      // 회칙에 동의해야 신청된다 (제6조7)
      if (!form.querySelector('[name="agree"]').checked) return t('rulesAgreeCheck');
      await api('/join', { method: 'POST', body: { ...v, agree: true } });
      toast(t('joinDone'));
      $('#loginPhone').value = v.phone;
    },
  });

  // 신청 화면에서 회칙을 열어볼 수 있다 (로그인 전에도 읽힌다)
  const see = document.querySelector('[data-see-rules]');
  if (see) see.onclick = () => openRules();
};

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

window.addEventListener('popstate', (e) => {
  const tab = e.state?.tab || (location.hash || '#home').slice(1);
  state.tab = VIEWS[tab] ? tab : 'home';
  if (state.me) render();
});

// 앱으로 돌아오면 지금 화면을 다시 불러온다 (다른 사람이 바꾼 내용 반영)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !$('#modalRoot').innerHTML) render();
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
    askAgreeIfNeeded(state);                  // 아직 회칙에 동의하지 않았으면 한 번 받는다
  } catch (e) {
    showLogin();
  }

  if ('serviceWorker' in navigator) {
    // 상대 경로로 등록해야 /club/ 같은 하위 경로에서도 그 폴더만 범위로 잡는다
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
}

boot();
