// 캘린더 — 한 달 칸에 일정이 표시되고, 날짜를 누르면 그날 일정이 아래에 나온다.
// 행사·대회는 칸 안에 제목이 보이고, 정기모임은 점으로만 (칸이 좁으니까).
// 운영진은 날짜를 고르고 "+ 이날 행사 추가"로 바로 적는다.
// 홈 화면과 일정 탭(Calendar)이 같이 쓴다.
import { api, esc, today, thisMonth, shiftMonth, trText } from '../ui.js';
import { t, fmtMonth, fmtDate } from '../i18n.js';
import { eventCard, bindEventCards, eventForm } from './schedule.js';

export async function mountCalendar(box, state) {
  const ym = state.calMonth || thisMonth();
  let events = [];
  try { events = await api(`/events?month=${ym}&lang=en`); } catch (e) { events = []; }
  const byDay = new Map();
  for (const e of events) {
    if (!byDay.has(e.event_date)) byDay.set(e.event_date, []);
    byDay.get(e.event_date).push(e);
  }
  // 고른 날이 이 달이 아니면 — 이번 달이면 오늘, 아니면 고르지 않은 상태
  let sel = state.calDay && state.calDay.startsWith(ym) ? state.calDay : (ym === thisMonth() ? today() : null);
  const isAdmin = state.me.role === 'admin';
  const again = () => mountCalendar(box, state);

  const [Y, M] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(Y, M - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const cells = [];
  for (let k = 0; k < first; k++) cells.push('<div class="cal-cell blank"></div>');
  for (let d = 1; d <= days; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const list = byDay.get(iso) || [];
    const big = list.filter(e => e.kind !== 'regular');
    const reg = list.length - big.length;
    const dow = (first + d - 1) % 7;
    cells.push(`<button class="cal-cell${iso === today() ? ' today' : ''}${iso === sel ? ' sel' : ''}${dow === 0 ? ' sun' : ''}${dow === 6 ? ' sat' : ''}" data-day="${iso}">
      <span class="cal-d">${d}</span>
      ${big.slice(0, 2).map(e => `<span class="cal-ev ${e.kind}">${esc(trText(e, 'title').text)}</span>`).join('')}
      ${big.length > 2 ? `<span class="cal-more">+${big.length - 2}</span>` : ''}
      ${reg ? `<span class="cal-dots">${'<i></i>'.repeat(Math.min(reg, 3))}</span>` : ''}
    </button>`);
  }

  const dayList = sel ? (byDay.get(sel) || []) : [];
  box.innerHTML = `
    <div class="card cal">
      <div class="cal-head">
        <button class="btn btn-sm btn-ghost" data-cal="-1" aria-label="prev">‹</button>
        <b>${esc(fmtMonth(ym))}</b>
        <button class="btn btn-sm btn-ghost" data-cal="1" aria-label="next">›</button>
        ${ym !== thisMonth() ? `<button class="btn btn-sm" data-cal="0">${esc(t('calToday'))}</button>` : ''}
      </div>
      <div class="cal-grid cal-dow">${t('dow').map(d => `<span>${esc(d)}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="cal-legend"><span class="cal-ev event">${esc(t('kindEvent'))}</span><span class="cal-ev tournament">${esc(t('kindTournament'))}</span><span class="cal-dots"><i></i></span> ${esc(t('kindRegular'))}</div>
    </div>
    ${sel ? `
      <div class="section-head"><h2>${esc(fmtDate(sel))}</h2><span class="spacer"></span>
        ${isAdmin ? `<button class="btn btn-sm btn-primary" data-cal-add>+ ${esc(t('calAddEvent'))}</button>` : ''}</div>
      ${dayList.length ? dayList.map(e => eventCard(e, { rsvp: e.event_date >= today() })).join('') : `<div class="empty" style="padding:14px">${esc(t('calNothing'))}</div>`}` : ''}`;

  box.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => {
    const step = Number(b.dataset.cal);
    state.calMonth = step ? shiftMonth(ym, step) : thisMonth();
    state.calDay = null;
    again();
  });
  box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { state.calDay = b.dataset.day; again(); });
  const add = box.querySelector('[data-cal-add]');
  if (add) add.onclick = () => eventForm(null, state, again, { event_date: sel, kind: 'event' });
  bindEventCards(box, state, again);
}
