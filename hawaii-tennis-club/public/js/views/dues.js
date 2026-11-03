// 회비 — 관리자·회비 담당은 월별 현황표에서 체크, 회원은 본인 내역만.
import { api, esc, toast, openModal, thisMonth, shiftMonth, $$ } from '../ui.js';
import { t, fmtMonth, fmtMoney, methodLabel } from '../i18n.js';

// 서버 auth.canDues 와 같은 기준 — 운영진(오너 포함) 또는 오너가 정한 회비 담당
// 월회비 면제 이유 → 현황표 글자 (서버 routes/dues.js grid 의 reason)
const EXEMPT_LABEL = { owner: 'ownerNoFee', coach: 'coachNoFee', secretary: 'secretaryNoFee', joining: 'inJoiningFee' };

export const canDues = (me) => !!me && (me.role === 'admin' || !!me.is_owner || !!me.dues_manager);

export async function renderDues(el, state) {
  if (!canDues(state.me)) return renderMyDues(el, state);

  const month = state.duesMonth || thisMonth();
  const [g, donations, expenses] = await Promise.all([api(`/dues/grid?month=${month}`), api(`/dues/donations?month=${month}`), api(`/dues/expenses?month=${month}`)]);
  const st = g.settlement;
  const cur = g.currency;

  el.innerHTML = `
    ${bankCard(state.settings, t('duesPayHead'))}
    <div class="monthbar">
      <button data-mv="-1">‹</button><strong>${esc(fmtMonth(month))}</strong><button data-mv="1">›</button>
    </div>

    <div class="stat-row">
      <div class="stat"><b>${g.summary.paid}/${g.summary.members}</b><span>${esc(t('paid'))}</span></div>
      <div class="stat ${g.summary.unpaid ? 'warn' : ''}"><b>${g.summary.unpaid}</b><span>${esc(t('unpaid'))}</span></div>
      <div class="stat"><b>${fmtMoney(st.total)}</b><span>${esc(t('duesTotal'))} ${cur}</span></div>
    </div>
    <div class="card settle-card">
      <div class="section-head" style="margin:0 0 6px"><h2>${esc(t('settlement'))} · ${esc(fmtMonth(month))}</h2></div>
      <table class="table"><tbody>
        <tr><td>${esc(t('monthlyFee'))} <small style="color:var(--muted)">${st.monthly_n}</small></td><td class="num">${fmtMoney(st.monthly)}${cur}</td></tr>
        <tr><td>${esc(t('joiningFee'))} <small style="color:var(--muted)">${st.joining_n}</small></td><td class="num">${fmtMoney(st.joining)}${cur}</td></tr>
        <tr><td><b>${esc(t('duesTotal'))}</b></td><td class="num"><b>${fmtMoney(st.total)}${cur}</b></td></tr>
        <tr><td colspan="2" style="padding:2px 0"></td></tr>
        <tr><td>🎁 ${esc(t('donations'))} <small style="color:var(--muted)">${st.donation_n}</small></td><td class="num">+${fmtMoney(st.donation)}${cur}</td></tr>
        <tr><td>💸 ${esc(t('expenses'))} <small style="color:var(--muted)">${st.expense_n}</small></td><td class="num" style="color:var(--danger,#c0392b)">−${fmtMoney(st.expense)}${cur}</td></tr>
        <tr><td><b>${esc(t('balance'))}</b></td><td class="num"><b>${fmtMoney(st.balance)}${cur}</b></td></tr>
      </tbody></table>
      <div class="hint" style="margin:6px 0 0">${esc(t('settlementHint'))}</div>
    </div>
    ${g.summary.exempt ? `<div class="hint">${esc(t('duesCountNote', { total: g.summary.total, members: g.summary.members, exempt: g.summary.exempt }))}</div>` : ''}

    <div class="section-head"><h2>${esc(t('duesGrid'))}</h2><span class="spacer"></span>
      <span class="pill grey">${esc(t('monthlyFee'))} ${fmtMoney(g.monthly_fee)}${cur}</span></div>

    <div class="card">
      <table class="table">
        <thead><tr>
          <th>${esc(t('name'))}</th>
          <th class="num">${esc(t('monthlyFee'))}</th>
          <th style="width:40px"></th>
        </tr></thead>
        <tbody>
          ${g.rows.map(r => `
            <tr>
              <td>
                <div style="font-weight:600">${esc(r.name)}</div>
                <small style="color:var(--muted)">
                  ${r.monthly.exempt ? esc(t(EXEMPT_LABEL[r.monthly.reason] || 'inJoiningFee'))
                    : r.monthly.paid
                    ? `${esc(r.monthly.paid_at || '')} · ${esc(methodLabel(r.monthly.method))}`
                    : esc(t('unpaid'))}
                </small>
                ${r.joining && !r.joining.paid ? `<button type="button" class="pill danger" style="border:0;margin-top:4px;cursor:pointer"
                    data-joining="${r.member_id}" data-period="${esc(r.joining.period)}" data-name="${esc(r.name)}"
                  >${esc(t('joiningFee'))} ${fmtMoney(r.joining.amount)}${cur}</button>` : ''}
              </td>
              <td class="num">${r.monthly.exempt ? '—' : fmtMoney(r.monthly.amount)}</td>
              <td>${r.monthly.exempt ? '' : `<button class="check ${r.monthly.paid ? 'paid' : ''}"
                    data-mark="${r.member_id}" data-paid="${r.monthly.paid ? 1 : 0}"
                    data-name="${esc(r.name)}">✓</button>`}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${g.rows.length ? '' : `<div class="empty">${esc(t('membersN', { n: 0 }))}</div>`}
    </div>

    ${unpaidBlock(g, cur)}
    ${donationBlock(donations, cur)}
    ${expenseBlock(expenses, cur)}
    <div class="hint">${esc(t('joiningLabel'))}: ${fmtMoney(g.joining_fee)}${cur} · ${esc(t('joinMonthHint', { full: fmtMoney(g.monthly_fee) + cur, half: fmtMoney(Math.round(g.monthly_fee / 2)) + cur }))} · ${esc(t('settings'))} → ${esc(t('monthlyFee'))}</div>`;

  bindBankCopy(el);
  $$('[data-mv]', el).forEach(b => b.onclick = () => {
    state.duesMonth = shiftMonth(month, Number(b.dataset.mv));
    renderDues(el, state);
  });

  // 체크 한 번 = 완납. 완납된 것을 다시 누르면 방법·날짜를 고치거나 미납으로 되돌린다.
  $$('[data-mark]', el).forEach(b => b.onclick = () => {
    const member_id = Number(b.dataset.mark);
    const already = b.dataset.paid === '1';
    if (!already) return payModal({ member_id, name: b.dataset.name, month, kind: 'monthly' }, () => renderDues(el, state));
    payModal({ member_id, name: b.dataset.name, month, kind: 'monthly', paid: true }, () => renderDues(el, state));
  });

  const refresh = () => renderDues(el, state);
  const rb = el.querySelector('[data-remind]');
  if (rb) rb.onclick = () => remindUnpaid(month, rb);
  const addBtn = el.querySelector('[data-don-add]');
  if (addBtn) addBtn.onclick = () => donationModal({ rows: g.rows, month }, refresh);
  $$('[data-don]', el).forEach(b => b.onclick = () =>
    donationModal({ rows: g.rows, month, d: donations.find(x => x.id === Number(b.dataset.don)) }, refresh));

  const xb = el.querySelector('[data-exp-add]');
  if (xb) xb.onclick = () => expenseModal({ month }, refresh);
  $$('[data-exp]', el).forEach(b => b.onclick = () =>
    expenseModal({ month, x: expenses.find(e => e.id === Number(b.dataset.exp)) }, refresh));

  $$('[data-joining]', el).forEach(b => b.onclick = () => {
    const [member_id, period, name] = [Number(b.dataset.joining), b.dataset.period, b.dataset.name];
    payModal({ member_id, name, month: period, kind: 'joining' }, () => renderDues(el, state));
  });
}

function unpaidBlock(g, cur) {
  const un = g.rows.filter(r => !r.monthly.paid);
  if (!un.length) return `<div class="card" style="text-align:center;color:var(--court)">${esc(t('allPaid'))}</div>`;
  return `
    <div class="section-head"><h2>${esc(t('unpaidList'))} · ${un.length}</h2><span class="spacer"></span>
      <button class="btn btn-sm" data-remind>📣 ${esc(t('remindUnpaid'))}</button></div>
    <div class="card">
      ${un.map(r => `<div class="member-row">
        <div class="avatar">${esc(r.name.slice(0, 1))}</div>
        <div class="who"><b>${esc(r.name)}</b><small>${esc(r.phone || '')}</small></div>
        <span class="pill danger">${fmtMoney(r.monthly.amount)}${cur}</span>
      </div>`).join('')}
    </div>`;
}

// 찬조금 — 그 달(받은 날 기준) 목록과 추가 버튼
function donationBlock(list, cur) {
  return `
    <div class="section-head"><h2>${esc(t('donations'))}${list.length ? ` · ${list.length}` : ''}</h2><span class="spacer"></span>
      <button class="btn btn-sm btn-primary" data-don-add>+ ${esc(t('addDonation'))}</button></div>
    <div class="card">
      ${list.length ? list.map(d => `<div class="member-row" data-don="${d.id}" style="cursor:pointer">
        <div class="avatar">🎁</div>
        <div class="who"><b>${esc(d.donor_name)}</b><small>${esc(d.given_at)} · ${esc(methodLabel(d.method))}${d.note ? ` · ${esc(d.note)}` : ''}</small></div>
        <span class="pill">${fmtMoney(d.amount)}${cur}</span>
      </div>`).join('') : `<div class="empty">${esc(t('noDonations'))}</div>`}
    </div>`;
}

// 미납자 알림 — 1:1 채팅 메시지 + 폰 알림 (서버 /dues/remind). 홈 화면도 같이 쓴다
export async function remindUnpaid(month, btn) {
  if (!confirm(t('remindConfirm'))) return;
  if (btn) btn.disabled = true;
  try {
    const r = await api('/dues/remind', { method: 'POST', body: { month } });
    toast(t('remindSent', { n: r.members }));
  } catch { toast(t('failed')); }
  if (btn) btn.disabled = false;
}

// 찬조금 입력·수정 — 회원을 고르거나, 외부인이면 이름을 직접 쓴다. rows 를 안 주면 회원 명단을 불러온다(홈 화면)
// 지출 — 그 달(쓴 날 기준) 목록과 추가 버튼
function expenseBlock(list, cur) {
  return `
    <div class="section-head"><h2>${esc(t('expenses'))}${list.length ? ` · ${list.length}` : ''}</h2><span class="spacer"></span>
      <button class="btn btn-sm btn-primary" data-exp-add>+ ${esc(t('addExpense'))}</button></div>
    <div class="card">
      ${list.length ? list.map(x => `<div class="member-row" data-exp="${x.id}" style="cursor:pointer">
        <div class="avatar">💸</div>
        <div class="who"><b>${esc(x.title)}</b><small>${esc(x.spent_at)} · ${esc(methodLabel(x.method))}${x.note ? ` · ${esc(x.note)}` : ''}</small></div>
        <span class="pill danger">−${fmtMoney(x.amount)}${cur}</span>
      </div>`).join('') : `<div class="empty">${esc(t('noExpenses'))}</div>`}
    </div>`;
}

// 지출 입력·수정 — 무엇에, 얼마, 언제, 어떻게
export function expenseModal({ month, x = null }, refresh) {
  const now = new Date().toISOString().slice(0, 10);
  const defDate = now.slice(0, 7) === month ? now : `${month}-01`;
  openModal({
    title: x ? t('editExpense') : t('addExpense'),
    fields: [
      { name: 'title', label: t('expenseTitle'), value: x?.title || '', placeholder: t('expenseTitleHint') },
      { name: 'amount', label: t('amount'), type: 'number', value: x ? String(x.amount) : '' },
      { name: 'spent_at', label: t('spentAt'), type: 'date', value: x?.spent_at || defDate },
      { name: 'method', label: t('method'), type: 'select', value: x?.method || 'cash',
        options: [{ value: 'cash', label: t('cash') }, { value: 'transfer', label: t('transfer') }, { value: 'qpay', label: t('qpay') }] },
      { name: 'note', label: t('memo'), value: x?.note || '' },
    ],
    onSave: async (v) => {
      if (!v.title) return t('expenseTitleRequired');
      if (!(Number(v.amount) > 0)) return t('amountRequired');
      await api(x ? `/dues/expenses/${x.id}` : '/dues/expenses', { method: x ? 'PUT' : 'POST', body: { ...v, amount: Number(v.amount) } });
      toast(t('saved'));
      refresh();
    },
    onDelete: x ? async () => {
      await api(`/dues/expenses/${x.id}`, { method: 'DELETE' });
      toast(t('saved'));
      refresh();
    } : undefined,
  });
}

export async function openDonation(month, refresh) {
  const g = await api(`/dues/grid?month=${month}`);
  donationModal({ rows: g.rows, month }, refresh);
}

function donationModal({ rows, month, d = null }, refresh) {
  const now = new Date().toISOString().slice(0, 10);
  const defDate = now.slice(0, 7) === month ? now : `${month}-01`;
  const methods = [{ value: 'cash', label: t('cash') }, { value: 'transfer', label: t('transfer') }, { value: 'qpay', label: t('qpay') }];
  openModal({
    title: d ? t('editDonation') : t('addDonation'),
    fields: [
      { name: 'member_id', label: t('donorMember'), type: 'select', value: d?.member_id ? String(d.member_id) : '',
        options: [{ value: '', label: t('donorOutside') }, ...rows.map(r => ({ value: String(r.member_id), label: r.name }))] },
      { name: 'donor_name', label: t('donorName'), value: d && !d.member_id ? d.donor_name : '' },
      { name: 'amount', label: t('amount'), type: 'number', value: d ? String(d.amount) : '' },
      { name: 'given_at', label: t('paidAt'), type: 'date', value: d?.given_at || defDate },
      { name: 'method', label: t('method'), type: 'select', value: d?.method || 'cash', options: methods },
      { name: 'note', label: t('memo'), value: d?.note || '' },
    ],
    onSave: async (v) => {
      if (!v.member_id && !v.donor_name) return t('donorNameRequired');
      if (!(Number(v.amount) > 0)) return t('amountRequired');
      const body = { ...v, member_id: v.member_id ? Number(v.member_id) : null, amount: Number(v.amount) };
      await api(d ? `/dues/donations/${d.id}` : '/dues/donations', { method: d ? 'PUT' : 'POST', body });
      toast(t('saved'));
      refresh();
    },
    onDelete: d ? async () => {
      await api(`/dues/donations/${d.id}`, { method: 'DELETE' });
      toast(t('saved'));
      refresh();
    } : undefined,
  });
}

// 납부 기록 — 날짜와 방법을 남긴다
function payModal({ member_id, name, month, kind, paid = false }, refresh) {
  openModal({
    title: `${name} · ${fmtMonth(month)}`,
    fields: [
      { name: 'paid_at', label: t('paidAt'), type: 'date', value: new Date().toISOString().slice(0, 10) },
      { name: 'method', label: t('method'), type: 'select', value: 'cash',
        options: [{ value: 'cash', label: t('cash') }, { value: 'transfer', label: t('transfer') }, { value: 'qpay', label: t('qpay') }] },
      { name: 'note', label: t('memo'), value: '' },
    ],
    extra: paid ? `<button type="button" class="btn btn-danger" style="width:100%;margin-top:4px" data-unpay>${esc(t('markUnpaid'))}</button>` : '',
    saveLabel: t('markPaid'),
    onSave: async (v) => {
      await api('/dues/mark', { method: 'PUT', body: { member_id, kind, period: month, paid: true, ...v } });
      toast(t('saved'));
      refresh();
    },
  });

  const btn = document.querySelector('[data-unpay]');
  if (btn) btn.onclick = async () => {
    await api('/dues/mark', { method: 'PUT', body: { member_id, kind, period: month, paid: false } });
    document.querySelector('#modalRoot').innerHTML = '';
    toast(t('saved'));
    refresh();
  };
}

// 회원 화면 — 본인 내역만
export async function renderMyDues(el, state) {
  const rows = await api('/dues/me');
  const cur = state.settings.currency;
  const unpaid = rows.filter(r => !r.paid_at);

  el.innerHTML = `
    ${bankCard(state.settings, t('duesPayHead'))}
    <div class="stat-row">
      <div class="stat"><b>${fmtMoney(state.settings.monthly_fee)}</b><span>${esc(t('monthlyFee'))} ${cur}</span></div>
      <div class="stat ${unpaid.length ? 'warn' : ''}"><b>${unpaid.length}</b><span>${esc(t('unpaid'))}</span></div>
    </div>
    <div class="section-head"><h2>${esc(t('myDues'))}</h2></div>
    ${rows.length ? `<div class="card">${rows.map(r => `
      <div class="member-row">
        <div class="who">
          <b>${esc(r.kind === 'joining' ? t('joiningLabel') : fmtMonth(r.period))}</b>
          <small>${r.paid_at ? `${esc(r.paid_at)} · ${esc(methodLabel(r.method))}` : esc(t('unpaid'))}</small>
        </div>
        <span class="pill ${r.paid_at ? '' : 'danger'}">${fmtMoney(r.amount)}${cur}</span>
      </div>`).join('')}</div>`
      : `<div class="empty">${esc(t('myDuesEmpty'))}</div>`}`;
  bindBankCopy(el);
}

// 회비 받는 계좌 — 오너가 설정에서 바꾼다. 계좌번호를 누르거나 Copy 로 복사해 은행 앱에 붙여넣는다.
// 가입 신청서(join.js)도 같은 카드를 쓴다 — 머리글만 입회비 안내로 바꿔서.
export function bankCard(s, head = t('bankPayTo')) {
  if (!s.bank_account) return '';
  return `
    <div class="card bank-card">
      <div class="bank-head">🏦 ${esc(head)}</div>
      <div class="bank-name">${esc(s.bank_name || '')}</div>
      <div class="bank-row">
        <b class="bank-no" data-bank-copy>${esc(s.bank_account)}</b>
        <button type="button" class="btn btn-sm" data-bank-copy>📋 ${esc(t('copy'))}</button>
      </div>
      ${s.bank_holder ? `<div class="meta">${esc(t('bankHolder'))}: <b>${esc(s.bank_holder)}</b></div>` : ''}
      <div class="hint" style="margin:6px 0 0">${esc(t('bankNoteHint'))}</div>
    </div>`;
}

export function bindBankCopy(el) {
  const no = el.querySelector('.bank-no')?.textContent.replace(/[\s-]/g, '');
  if (!no) return;
  $$('[data-bank-copy]', el).forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(no); toast(t('bankCopied')); }
    catch { prompt(t('copy'), no); }
  });
}
