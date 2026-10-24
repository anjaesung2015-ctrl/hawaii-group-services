// 선수반 선수(또는 부모) 화면 — 훈련 일정 · 내 수강료 · 선수반 공지. 동호인 화면은 서버가 막는다(403).
// 카드 모양(sessionCard·noticeCard)은 관리자 Elite 탭(elite.js)도 같이 쓴다.
import { api, esc } from '../ui.js';
import { t, fmtDate, fmtMoney, fmtMonth, methodLabel } from '../i18n.js';
import { bankCard, bindBankCopy } from './dues.js';

// 훈련 한 번 — 날짜·시간 / 제목 / 코트·코치 / 메모. extra 는 오른쪽 끝(출석 표시·수정 버튼)
export function sessionCard(s, extra = '') {
  const meta = [s.court && `${t('court')} ${s.court}`, s.coach_name && `${t('coach')} ${s.coach_name}`].filter(Boolean);
  return `
    <div class="card session-card" data-session="${s.id}">
      <div class="card-row">
        <div class="session-date"><b>${esc(fmtDate(s.session_date))}</b><span>${esc(s.start_time)}–${esc(s.end_time)}</span></div>
        <div style="flex:1;min-width:0">
          <h3>${esc(s.title)}</h3>
          ${meta.length ? `<div class="meta">${meta.map(esc).join(' · ')}</div>` : ''}
          ${s.memo ? `<div class="memo">${esc(s.memo)}</div>` : ''}
        </div>
        ${extra}
      </div>
    </div>`;
}

const statusPill = (st) => (st === 'present' ? `<span class="pill">✓ ${esc(t('present'))}</span>`
  : st === 'absent' ? `<span class="pill danger">✗ ${esc(t('absent'))}</span>` : '');

export async function renderTraining(el, state) {
  const past = state.trainingPast === true;
  const rows = await api(`/elite/sessions${past ? '?past=1' : ''}`);
  el.innerHTML = `
    <div class="seg">
      <button type="button" data-past="0" class="${past ? '' : 'on'}">${esc(t('upcomingTab'))}</button>
      <button type="button" data-past="1" class="${past ? 'on' : ''}">${esc(t('pastTab'))}</button>
    </div>
    ${rows.length ? rows.map(s => sessionCard(s, past ? statusPill(s.my_status) : '')).join('')
      : `<div class="empty">${esc(t('noTraining'))}</div>`}`;
  el.querySelectorAll('[data-past]').forEach(b => b.onclick = () => {
    state.trainingPast = b.dataset.past === '1';
    renderTraining(el, state);
  });
}

export async function renderMyFees(el, state) {
  const d = await api('/elite/fees/me');
  const cur = d.currency;
  const unpaid = d.rows.filter(r => !r.paid_at).length;
  el.innerHTML = `
    ${bankCard(state.settings, t('eliteFeeHead', { day: d.due_day }))}
    <div class="stat-row">
      <div class="stat"><b>${fmtMoney(d.fee)}</b><span>${esc(t('eliteMonthly'))} ${cur}</span></div>
      <div class="stat ${unpaid ? 'warn' : ''}"><b>${unpaid}</b><span>${esc(t('unpaid'))}</span></div>
    </div>
    <div class="section-head"><h2>${esc(t('myFees'))}</h2></div>
    ${d.rows.length ? `<div class="card">${d.rows.map(r => `
      <div class="member-row">
        <div class="who"><b>${esc(fmtMonth(r.period))}</b>
          <small>${r.paid_at ? `${esc(r.paid_at)} · ${esc(methodLabel(r.method))}` : esc(t('unpaid'))}</small></div>
        <span class="pill ${r.paid_at ? '' : 'danger'}">${fmtMoney(r.amount)}${cur}</span>
      </div>`).join('')}</div>` : `<div class="empty">${esc(t('myDuesEmpty'))}</div>`}`;
  bindBankCopy(el);
}

// 옛 데이터에 '/uploads/…' 가 있어도 하위 경로(/club/)에서 열리게 앞의 / 를 뗀다 (notices.js 와 같은 규칙)
export const photoSrc = (p) => String(p || '').replace(/^\/+/, '');

export function noticeCard(n, canEdit) {
  return `
    <div class="card ${n.pinned ? 'pinned' : ''}">
      <div class="card-row">
        <div style="flex:1;min-width:0">
          <h3>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3>
          <div class="meta">${esc(n.author || '')} · ${esc(String(n.created_at).slice(0, 10))}</div>
        </div>
        ${canEdit ? `<button class="btn btn-sm" data-edit-enotice="${n.id}">✏️ ${esc(t('edit'))}</button>` : ''}
      </div>
      <div class="notice-body">${esc(n.body)}</div>
      ${n.photo ? `<img class="notice-photo" src="${esc(photoSrc(n.photo))}" data-view-photo="${esc(photoSrc(n.photo))}" alt="" loading="lazy">` : ''}
    </div>`;
}

export async function renderEliteNotices(el) {
  const rows = await api('/elite/notices');
  el.innerHTML = rows.length ? rows.map(n => noticeCard(n, false)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`;
}
