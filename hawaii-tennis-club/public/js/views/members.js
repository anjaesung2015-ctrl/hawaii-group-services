// 회원 명단 — 관리자는 추가·수정·삭제·PIN 재설정, 회원은 이름과 레벨만 본다.
import { api, esc, toast, openModal, today, errText, $$ } from '../ui.js';
import { t, levelLabel } from '../i18n.js';
import { orgBlock, bindOrg } from './org.js';

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];

export async function renderMembers(el, state) {
  const isAdmin = state.me.role === 'admin' || state.me.is_owner;   // 운영진
  const isOwner = !!state.me.is_owner;                               // 사장님
  const [list, join, org] = await Promise.all([
    api('/members'),
    isAdmin ? api('/join').catch(() => ({ count: 0, rows: [] })) : Promise.resolve({ count: 0, rows: [] }),
    orgBlock(state),
  ]);
  const active = list.filter(m => m.status !== 'dormant');

  el.innerHTML = `
    <div class="stat-row">
      <div class="stat"><b>${list.length}</b><span>${esc(t('members'))}</span></div>
      <div class="stat"><b>${active.length}</b><span>${esc(t('stActive'))}</span></div>
      ${isAdmin ? `<div class="stat ${join.count ? 'warn' : ''}"><b>${join.count}</b><span>${esc(t('joinPending'))}</span></div>` : ''}
    </div>
    ${isAdmin ? joinBlock(join) : ''}
    ${org}
    ${isAdmin ? `<div class="fab-row" style="margin-top:12px"><button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newMember'))}</button></div>` : ''}
    <div class="section-head"><h2>${esc(t('memberList'))}</h2></div>
    <div class="card">
      ${list.length ? list.map(m => row(m, isAdmin, isOwner)).join('') : `<div class="empty">${esc(t('membersN', { n: 0 }))}</div>`}
    </div>
    ${isOwner ? `<div class="hint">${esc(t('ownerNote'))}</div>` : (isAdmin ? `<div class="hint">${esc(t('adminNote'))}</div>` : '')}`;

  const add = el.querySelector('[data-new]');
  if (add) add.onclick = () => memberForm(null, state, () => renderMembers(el, state));
  bindOrg(el, state, () => renderMembers(el, state));

  // 가입 신청 승인 · 거절
  $$('[data-approve]', el).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api(`/join/${b.dataset.approve}/approve`, { method: 'POST' });
      toast(t('joinApproved', { name: r.name }));
    } catch (e) { toast(errText(e), true); }
    renderMembers(el, state);
  });
  $$('[data-reject]', el).forEach(b => b.onclick = async () => {
    // 읽기 쉬운 화면에서 실수로 눌리지 않게 두 번 눌러야 거절된다
    if (!b.classList.contains('ask')) {
      b.classList.add('ask');
      b.textContent = t('confirmDelete');
      setTimeout(() => { if (b.isConnected) { b.classList.remove('ask'); b.textContent = t('joinReject'); } }, 3000);
      return;
    }
    await api(`/join/${b.dataset.reject}/reject`, { method: 'POST' }).catch(() => {});
    toast(t('joinRejected'));
    renderMembers(el, state);
  });
  $$('[data-member]', el).forEach(r => r.onclick = () => {
    if (!isAdmin) return;
    const m = list.find(x => String(x.id) === r.dataset.member);
    memberForm(m, state, () => renderMembers(el, state));
  });
}

// 기다리는 가입 신청 — 승인하면 그 자리에서 회원이 된다 (신청할 때 정한 PIN 그대로)
function joinBlock(join) {
  if (!join.count) return '';
  return `
    <div class="section-head"><h2>${esc(t('joinPending'))} · ${join.count}</h2></div>
    <div class="card">
      ${join.rows.map(r => `
        <div class="member-row">
          <div class="avatar">${esc(String(r.name || '?').slice(0, 1))}</div>
          <div class="who">
            <b>${esc(r.name)}</b>
            <small>${esc(r.phone)} · ${esc(levelLabel(r.level))} · ${esc(String(r.created_at).slice(5, 10))}</small>
            ${r.name_en || r.shirt_size || r.recommenders ? `<small>${esc([r.name_en, r.shirt_size && `T-shirt ${r.shirt_size}`, r.recommenders && `${t('joinRecommenders')}: ${r.recommenders}`].filter(Boolean).join(' · '))}</small>` : ''}
            <small style="color:var(--court)">✓ ${esc(t('joinAgreedRules'))}${r.privacy_agreed_at ? ` · ✓ ${esc(t('joinAgreedPrivacy'))}` : ''}</small>
          </div>
          <button class="btn btn-sm btn-primary" data-approve="${r.id}">${esc(t('joinApprove'))}</button>
          <button class="btn btn-sm btn-danger" data-reject="${r.id}">${esc(t('joinReject'))}</button>
        </div>`).join('')}
    </div>`;
}

function row(m, isAdmin, isOwner) {
  const dormant = m.status === 'dormant';
  return `
    <div class="member-row" ${isAdmin ? `data-member="${m.id}" style="cursor:pointer"` : ''}>
      <div class="avatar ${dormant ? 'dormant' : ''}">${esc(String(m.name || '?').slice(0, 1))}</div>
      <div class="who">
        <b>${esc(m.name)}${m.is_owner ? ` <span class="pill solid">👑 ${esc(t('roleOwner'))}</span>` : (m.role === 'admin' ? ` <span class="pill gold">${esc(m.title || t('admin'))}</span>` : '')}</b>
        <small>${esc(levelLabel(m.level))}${isAdmin && m.phone ? ` · ${esc(m.phone)}` : ''}${isAdmin && m.joined_at ? ` · ${esc(m.joined_at)}` : ''}</small>
      </div>
      ${dormant ? `<span class="pill grey">${esc(t('stDormant'))}</span>` : ''}
    </div>`;
}

function memberForm(m, state, refresh) {
  const isNew = !m;
  const modal = openModal({
    title: isNew ? t('newMember') : t('editMember'),
    fields: [
      { name: 'name', label: t('name'), value: m?.name || '' },
      { name: 'phone', label: t('phone'), type: 'tel', inputmode: 'numeric', maxlength: 15, value: m?.phone || '', placeholder: '99112233' },
      ...(isNew ? [{ name: 'pin', label: t('pin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '', placeholder: '1234' }] : []),
      { name: 'level', label: t('level'), type: 'select', value: m?.level || 'beginner',
        options: LEVELS.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'joined_at', label: t('joinedAt'), type: 'date', value: m?.joined_at || today() },
      { name: 'status', label: t('status'), type: 'select', value: m?.status || 'active',
        options: [{ value: 'active', label: t('stActive') }, { value: 'dormant', label: t('stDormant') }] },
      // 운영진 권한을 주고 거두는 것은 오너만 — 다른 사람 화면에는 이 칸이 아예 없다
      ...(state.me.is_owner ? [{ name: 'role', label: t('role'), type: 'select', value: m?.role || 'member',
        options: [{ value: 'member', label: t('member') }, { value: 'admin', label: t('adminGive') }] }] : []),
      { name: 'title', label: t('titleRole'), value: m?.title || '', placeholder: '대표 / 코치' },
      { name: 'memo', label: t('memo'), value: m?.memo || '' },
    ],
    extra: isNew ? `<div class="hint">${esc(t('pin4'))}</div>`
      : `<button type="button" class="btn btn-sm" style="width:100%;margin-top:4px" data-pin>${esc(t('resetPin'))}</button>`,
    // 삭제는 오너만 (회칙 제31조 — 제명은 클럽 오너 최종 결정)
    onDelete: (isNew || !state.me.is_owner || m.is_owner) ? null : async () => {
      await api(`/members/${m.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v) => {
      if (!v.name) return t('required');
      if (isNew) {
        const r = await api('/members', { method: 'POST', body: v });
        toast(t('firstPin', { pin: r.first_pin }));
      } else {
        await api(`/members/${m.id}`, { method: 'PATCH', body: v });
        toast(t('saved'));
      }
      refresh();
    },
  });

  const pinBtn = modal.form.querySelector('[data-pin]');
  if (pinBtn) pinBtn.onclick = () => {
    modal.close();
    openModal({
      title: `${m.name} · ${t('resetPin')}`,
      fields: [{ name: 'pin', label: t('newPin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '' }],
      onSave: async (v) => {
        if (!/^\d{4}$/.test(v.pin)) return t('pin4');
        await api(`/members/${m.id}/pin`, { method: 'POST', body: { pin: v.pin } });
        toast(t('pinChanged'));
        refresh();
      },
    });
  };
}
