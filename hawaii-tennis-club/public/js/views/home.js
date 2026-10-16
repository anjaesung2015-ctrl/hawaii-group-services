// 홈 — 공지(옆으로 넘겨보기), 다가오는 일정 3개, 내 회비(관리자는 이번 달 미납자).
import { api, esc, thisMonth, trText, origHtml } from '../ui.js';
import { t, fmtMonth, fmtMoney } from '../i18n.js';
import { eventCard, bindEventCards } from './schedule.js';

export async function renderHome(el, state) {
  const isAdmin = state.me.role === 'admin';
  const [events, notices, money, join] = await Promise.all([
    api('/events/upcoming?limit=3&lang=en'),
    api('/notices?lang=en'),
    isAdmin ? api(`/dues/unpaid?month=${thisMonth()}`) : api('/dues/me'),
    isAdmin ? api('/join').catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
  ]);
  const recent = notices.slice(0, 6);       // 서버가 고정 공지 먼저, 그다음 최신순으로 준다
  const cur = state.settings.currency;

  el.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,#1b7a4b,#0f5132);color:#fff;border:0">
      <div style="font-size:12px;opacity:.8;letter-spacing:.08em;text-transform:uppercase">${esc(t('greetMorning'))}</div>
      <h3 style="font-size:19px;margin:2px 0 0">${esc(state.settings.club_name)}</h3>
    </div>

    ${join.count ? `
      <div class="card tap" data-go-members style="border-color:#ecdcb0;background:var(--gold-tint)">
        <div class="card-row">
          <div style="flex:1"><h3 style="font-size:15px">${esc(t('joinPending'))} · ${join.count}</h3>
          <div class="meta">${esc(t('joinApprove'))} →</div></div>
          <span class="pill gold">${join.count}</span>
        </div>
      </div>` : ''}

    ${recent.length ? `
      <div class="section-head"><h2>${esc(t('tabNotices'))}</h2><span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" data-go-notices>${esc(t('seeAll'))} →</button></div>
      <div class="nslider" data-nslider>
        ${recent.map(n => `
          <div class="card tap nslide${n.pinned ? ' pinned' : ''}">
            <h3>${n.pinned ? '📌 ' : ''}${esc(trText(n, 'title').text)}</h3>
            <div class="notice-body">${esc(trText(n, 'body').text)}</div>
            <div class="meta">${esc(String(n.created_at).slice(0, 10))}</div>
          </div>`).join('')}
      </div>
      ${recent.length > 1 ? `<div class="ndots" data-ndots>${recent.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}` : ''}

    <div class="section-head"><h2>${esc(t('upcoming'))}</h2></div>
    <div data-events>
      ${events.length ? events.map(e => eventCard(e, { rsvp: true })).join('') : `<div class="empty">${esc(t('noUpcoming'))}</div>`}
    </div>

    ${isAdmin ? adminMoney(money, cur) : myMoney(money, state, cur)}`;

  bindEventCards(el, state, () => renderHome(el, state));

  // 가입 신청 카드를 누르면 회원 탭으로 (승인은 거기서 한다)
  const go = el.querySelector('[data-go-members]');
  if (go) go.onclick = () => document.querySelector('#tabbar [data-tab="members"]')?.click();

  bindSlider(el);
}

// 공지 카드 — 손가락으로 옆으로 넘긴다(스크롤 스냅). 컴퓨터에선 마우스로 끌어도 넘어간다.
// 누르면 공지 탭으로. 끌다가 놓은 건 누른 걸로 치지 않는다.
function bindSlider(el) {
  const toNotices = () => document.querySelector('#tabbar [data-tab="notices"]')?.click();
  el.querySelector('[data-go-notices]')?.addEventListener('click', toNotices);
  const s = el.querySelector('[data-nslider]');
  if (!s) return;
  const dots = [...el.querySelectorAll('[data-ndots] i')];
  const slides = [...s.children];
  const dist = (c) => Math.abs(c.offsetLeft - s.offsetLeft - s.scrollLeft);
  const nearest = () => slides.reduce((b, c) => (dist(c) < dist(b) ? c : b));

  s.addEventListener('scroll', () => {
    const i = slides.indexOf(nearest());
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });

  let down = null, moved = false;
  s.addEventListener('pointerdown', (e) => {
    moved = false;
    if (e.pointerType !== 'mouse') return;     // 터치는 브라우저가 알아서 넘긴다
    down = { x: e.clientX, left: s.scrollLeft };
  });
  s.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 5) { moved = true; s.classList.add('drag'); }
    if (moved) s.scrollLeft = down.left - dx;
  });
  const up = () => {
    if (!down) return;
    down = null;
    if (!s.classList.contains('drag')) return;
    s.classList.remove('drag');
    s.scrollTo({ left: nearest().offsetLeft - s.offsetLeft, behavior: 'smooth' });   // 가장 가까운 카드에 맞춰 멈춘다
  };
  s.addEventListener('pointerup', up);
  s.addEventListener('pointerleave', up);
  slides.forEach(c => c.addEventListener('click', () => { if (!moved) toNotices(); }));
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
