// 홈 — 다가오는 일정 3개, 고정 공지, 내 회비(관리자는 이번 달 미납자).
import { api, esc, thisMonth } from '../ui.js';
import { t, fmtMonth, fmtMoney } from '../i18n.js';
import { eventCard, bindEventCards } from './schedule.js';

export async function renderHome(el, state) {
  const isAdmin = state.me.role === 'admin';
  const [events, notices, money, join] = await Promise.all([
    api('/events/upcoming?limit=3'),
    api('/notices'),
    isAdmin ? api(`/dues/unpaid?month=${thisMonth()}`) : api('/dues/me'),
    isAdmin ? api('/join').catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
  ]);
  const pinned = notices.filter(n => n.pinned).slice(0, 2);
  const cur = state.settings.currency;

  el.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,#1b7a4b,#0f5132);color:#fff;border:0">
      <div style="font-size:12px;opacity:.8;letter-spacing:.08em;text-transform:uppercase">${esc(t('greetMorning'))}</div>
      <h3 style="font-size:19px;margin:2px 0 0">${esc(state.me.name)}${state.me.title ? ` · ${esc(state.me.title)}` : ''}</h3>
      <div style="font-size:12.5px;opacity:.85;margin-top:2px">${esc(state.settings.club_name)}</div>
    </div>

    ${join.count ? `
      <div class="card tap" data-go-members style="border-color:#ecdcb0;background:var(--gold-tint)">
        <div class="card-row">
          <div style="flex:1"><h3 style="font-size:15px">${esc(t('joinPending'))} · ${join.count}</h3>
          <div class="meta">${esc(t('joinApprove'))} →</div></div>
          <span class="pill gold">${join.count}</span>
        </div>
      </div>` : ''}

    ${pinned.length ? `
      <div class="section-head"><h2>${esc(t('pinnedNotice'))}</h2></div>
      ${pinned.map(n => `
        <div class="card pinned">
          <h3>📌 ${esc(n.title)}</h3>
          <div class="notice-body">${esc(n.body.length > 140 ? n.body.slice(0, 140) + '…' : n.body)}</div>
        </div>`).join('')}` : ''}

    <div class="section-head"><h2>${esc(t('upcoming'))}</h2></div>
    <div data-events>
      ${events.length ? events.map(e => eventCard(e, { rsvp: true })).join('') : `<div class="empty">${esc(t('noUpcoming'))}</div>`}
    </div>

    ${isAdmin ? adminMoney(money, cur) : myMoney(money, state, cur)}`;

  bindEventCards(el, state, () => renderHome(el, state));

  // 가입 신청 카드를 누르면 회원 탭으로 (승인은 거기서 한다)
  const go = el.querySelector('[data-go-members]');
  if (go) go.onclick = () => document.querySelector('#tabbar [data-tab="members"]')?.click();
}

function adminMoney(u, cur) {
  return `
    <div class="section-head"><h2>${esc(t('quickUnpaid'))} · ${esc(fmtMonth(u.month))}</h2></div>
    ${u.count ? `<div class="card">
      ${u.rows.map(r => `<div class="member-row">
        <div class="avatar">${esc(String(r.name).slice(0, 1))}</div>
        <div class="who"><b>${esc(r.name)}</b><small>${esc(r.phone || '')}</small></div>
        <span class="pill danger">${fmtMoney(u.monthly_fee)}${cur}</span>
      </div>`).join('')}
    </div>` : `<div class="card" style="text-align:center;color:var(--court)">${esc(t('allPaid'))}</div>`}`;
}

function myMoney(rows, state, cur) {
  const unpaid = (rows || []).filter(r => !r.paid_at);
  return `
    <div class="section-head"><h2>${esc(t('myDues'))}</h2></div>
    <div class="card">
      ${unpaid.length
        ? unpaid.map(r => `<div class="member-row">
            <div class="who"><b>${esc(r.kind === 'joining' ? t('joiningLabel') : fmtMonth(r.period))}</b>
            <small>${esc(t('unpaid'))}</small></div>
            <span class="pill danger">${fmtMoney(r.amount)}${cur}</span></div>`).join('')
        : `<div style="text-align:center;color:var(--court)">${esc(t('allPaid'))}</div>`}
    </div>`;
}
