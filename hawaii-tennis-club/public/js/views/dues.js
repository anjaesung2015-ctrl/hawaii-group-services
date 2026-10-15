// 회비 — 관리자는 월별 현황표에서 체크, 회원은 본인 내역만.
import { api, esc, toast, openModal, thisMonth, shiftMonth, $$ } from '../ui.js';
import { t, fmtMonth, fmtMoney, methodLabel } from '../i18n.js';

export async function renderDues(el, state) {
  if (state.me.role !== 'admin') return renderMyDues(el, state);

  const month = state.duesMonth || thisMonth();
  const g = await api(`/dues/grid?month=${month}`);
  const cur = g.currency;

  el.innerHTML = `
    <div class="monthbar">
      <button data-mv="-1">‹</button><strong>${esc(fmtMonth(month))}</strong><button data-mv="1">›</button>
    </div>

    <div class="stat-row">
      <div class="stat"><b>${g.summary.paid}/${g.summary.members}</b><span>${esc(t('paid'))}</span></div>
      <div class="stat ${g.summary.unpaid ? 'warn' : ''}"><b>${g.summary.unpaid}</b><span>${esc(t('unpaid'))}</span></div>
      <div class="stat"><b>${fmtMoney(g.summary.collected)}</b><span>${esc(t('collected'))} ${cur}</span></div>
    </div>

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
                  ${r.monthly.paid
                    ? `${esc(r.monthly.paid_at || '')} · ${esc(methodLabel(r.monthly.method))}`
                    : esc(t('unpaid'))}
                </small>
                ${r.joining && !r.joining.paid ? `<button type="button" class="pill danger" style="border:0;margin-top:4px;cursor:pointer"
                    data-joining="${r.member_id}" data-period="${esc(r.joining.period)}" data-name="${esc(r.name)}"
                  >${esc(t('joiningFee'))} ${fmtMoney(r.joining.amount)}${cur}</button>` : ''}
              </td>
              <td class="num">${fmtMoney(r.monthly.amount)}</td>
              <td><button class="check ${r.monthly.paid ? 'paid' : ''}"
                    data-mark="${r.member_id}" data-paid="${r.monthly.paid ? 1 : 0}"
                    data-name="${esc(r.name)}">✓</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${g.rows.length ? '' : `<div class="empty">${esc(t('membersN', { n: 0 }))}</div>`}
    </div>

    ${unpaidBlock(g, cur)}
    <div class="hint">${esc(t('joiningLabel'))}: ${fmtMoney(g.joining_fee)}${cur} · ${esc(t('settings'))} → ${esc(t('monthlyFee'))}</div>`;

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

  $$('[data-joining]', el).forEach(b => b.onclick = () => {
    const [member_id, period, name] = [Number(b.dataset.joining), b.dataset.period, b.dataset.name];
    payModal({ member_id, name, month: period, kind: 'joining' }, () => renderDues(el, state));
  });
}

function unpaidBlock(g, cur) {
  const un = g.rows.filter(r => !r.monthly.paid);
  if (!un.length) return `<div class="card" style="text-align:center;color:var(--court)">${esc(t('allPaid'))}</div>`;
  return `
    <div class="section-head"><h2>${esc(t('unpaidList'))} · ${un.length}</h2></div>
    <div class="card">
      ${un.map(r => `<div class="member-row">
        <div class="avatar">${esc(r.name.slice(0, 1))}</div>
        <div class="who"><b>${esc(r.name)}</b><small>${esc(r.phone || '')}</small></div>
        <span class="pill danger">${fmtMoney(r.monthly.amount)}${cur}</span>
      </div>`).join('')}
    </div>`;
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
}
