// 회원 명단 — 관리자는 추가·수정·삭제·PIN 재설정, 회원은 이름과 레벨만 본다.
import { api, esc, toast, openModal, today, errText, pickPhoto, avatar, $$ } from '../ui.js';
import { t, levelLabel } from '../i18n.js';
import { orgBlock, bindOrg } from './org.js';
import { openDm } from './chat.js';
import { shareInvite, openInvite } from './install.js';

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
    <div class="invite-row">
      <button class="btn btn-primary" type="button" data-invite>📨 ${esc(t('inviteFriends'))}</button>
      <button class="btn" type="button" data-invite-qr aria-label="QR">▦ QR</button>
    </div>
    ${isAdmin ? joinBlock(join) : ''}
    ${org}
    ${isAdmin ? `<div class="fab-row" style="margin-top:12px"><button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newMember'))}</button></div>` : ''}
    <div class="section-head"><h2>${esc(t('memberList'))}</h2></div>
    <label class="field member-search"><input type="search" data-search placeholder="🔍 ${esc(t('searchName'))}" autocomplete="off" enterkeyhint="search"></label>
    <div class="seg" data-filters>
      <button type="button" data-filter="all">${esc(t('filterAll'))} · ${list.length}</button>
      <button type="button" data-filter="coach">🎾 ${esc(t('filterCoaches'))} · ${list.filter(m => m.is_coach).length}</button>
    </div>
    <div class="seg levels" data-levels>
      <button type="button" data-level="all">${esc(t('allLevels'))}</button>
      ${LEVELS.map(l => `<button type="button" data-level="${l}">${esc(levelLabel(l))} · ${list.filter(m => m.level === l).length}</button>`).join('')}
    </div>
    <div class="card" data-list></div>
    ${isOwner ? `<div class="hint">${esc(t('ownerNote'))}</div>` : (isAdmin ? `<div class="hint">${esc(t('adminNote'))}</div>` : '')}`;

  // 이름 검색 × 전체/코치만 × 레벨 — 셋을 함께 건다. 고른 칸은 탭을 옮겨 다녀도 기억한다 (다시 불러오지 않고 목록만 다시 그림)
  const listEl = el.querySelector('[data-list]');
  const drawList = () => {
    const f = state.memberFilter === 'coach' ? 'coach' : 'all';
    const lv = LEVELS.includes(state.memberLevel) ? state.memberLevel : 'all';
    $$('[data-filter]', el).forEach(b => b.classList.toggle('on', b.dataset.filter === f));
    $$('[data-level]', el).forEach(b => b.classList.toggle('on', b.dataset.level === lv));
    const q = norm(state.memberQuery);
    const shown = list.filter(m => (f !== 'coach' || m.is_coach) && (lv === 'all' || m.level === lv)
      && (!q || norm(m.name).includes(q)));
    const none = q || lv !== 'all' ? t('noMatch') : (f === 'coach' ? t('noCoaches') : t('membersN', { n: 0 }));
    listEl.innerHTML = shown.length ? shown.map(m => row(m, isAdmin, isOwner, state.me.id)).join('')
      : `<div class="empty">${esc(none)}</div>`;
    // 💬 — 그 사람과 1:1 채팅 (줄을 누른 것으로 치지 않게 막는다)
    $$('[data-dm]', listEl).forEach(b => b.onclick = (e) => { e.stopPropagation(); openDm(state, Number(b.dataset.dm)); });
    $$('[data-member]', listEl).forEach(r => r.onclick = () => {
      if (!isAdmin) return;
      const m = list.find(x => String(x.id) === r.dataset.member);
      memberForm(m, state, () => renderMembers(el, state));
    });
  };
  $$('[data-filter]', el).forEach(b => b.onclick = () => { state.memberFilter = b.dataset.filter; drawList(); });
  $$('[data-level]', el).forEach(b => b.onclick = () => { state.memberLevel = b.dataset.level; drawList(); });
  // 글자를 칠 때마다 목록만 다시 그린다 (입력칸은 그대로라 키보드가 안 닫힌다)
  const search = el.querySelector('[data-search]');
  search.value = state.memberQuery || '';
  search.oninput = () => { state.memberQuery = search.value; drawList(); };
  drawList();

  el.querySelector('[data-invite]').onclick = () => shareInvite(state.settings.club_name);
  el.querySelector('[data-invite-qr]').onclick = () => openInvite(state.settings.club_name);

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
            <small>${r.is_coach ? `🎾 ${esc(t('coach'))} · ` : ''}${esc(r.phone)} · ${esc(levelLabel(r.level))} · ${esc(String(r.created_at).slice(5, 10))}</small>
            ${r.name_en || r.shirt_size || r.recommenders ? `<small>${esc([r.name_en, r.shirt_size && `T-shirt ${r.shirt_size}`, r.recommenders && `${t('joinRecommenders')}: ${r.recommenders}`].filter(Boolean).join(' · '))}</small>` : ''}
            <small style="color:var(--court)">✓ ${esc(t('joinAgreedRules'))}${r.privacy_agreed_at ? ` · ✓ ${esc(t('joinAgreedPrivacy'))}` : ''}</small>
          </div>
          <button class="btn btn-sm btn-primary" data-approve="${r.id}">${esc(t('joinApprove'))}</button>
          <button class="btn btn-sm btn-danger" data-reject="${r.id}">${esc(t('joinReject'))}</button>
        </div>`).join('')}
    </div>`;
}

function row(m, isAdmin, isOwner, meId) {
  const dormant = m.status === 'dormant';
  return `
    <div class="member-row" ${isAdmin ? `data-member="${m.id}" style="cursor:pointer"` : ''}>
      ${avatar(m.name, m.photo, dormant ? 'dormant' : '')}
      <div class="who">
        <b>${esc(m.name)}${m.is_owner ? ` <span class="pill solid">👑 ${esc(t('roleOwner'))}</span>` : (m.role === 'admin' ? ` <span class="pill gold">${esc(m.title || t('admin'))}</span>` : '')}${m.is_coach ? ` <span class="pill coach">🎾 ${esc(t('coach'))}</span>` : ''}</b>
        <small>${esc(levelLabel(m.level))}${isAdmin && m.phone ? ` · ${esc(m.phone)}` : ''}${isAdmin && m.joined_at ? ` · ${esc(m.joined_at)}` : ''}</small>
      </div>
      ${dormant ? `<span class="pill grey">${esc(t('stDormant'))}</span>` : ''}
      ${!dormant && m.id !== meId ? `<button type="button" class="btn btn-sm dm-btn" data-dm="${m.id}" aria-label="${esc(t('message'))}">💬</button>` : ''}
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
      { name: 'is_coach', label: t('coach'), type: 'select', value: m?.is_coach ? '1' : '0',
        options: [{ value: '0', label: t('coachNo') }, { value: '1', label: t('coachYes') }] },
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
      : `<div class="photo-edit">${avatar(m.name, m.photo, 'photo-preview')}
          <button type="button" class="btn btn-sm" data-photo>📷 ${esc(t('photoChoose'))}</button>
          ${m.photo ? `<button type="button" class="btn btn-sm btn-danger" data-photo-del>${esc(t('photoRemove'))}</button>` : ''}</div>
         <button type="button" class="btn btn-sm" style="width:100%;margin-top:4px" data-pin>${esc(t('resetPin'))}</button>`,
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

  // 사진은 저장 버튼과 따로 바로 반영한다
  const photoBtn = modal.form.querySelector('[data-photo]');
  if (photoBtn) photoBtn.onclick = async () => {
    const data = await pickPhoto(640);
    if (!data) return;
    try { await api(`/members/${m.id}/photo`, { method: 'PUT', body: { photo_data: data } }); }
    catch (e) { return toast(errText(e), true); }
    modal.close(); toast(t('saved')); refresh();
  };
  const photoDel = modal.form.querySelector('[data-photo-del]');
  if (photoDel) photoDel.onclick = async () => {
    await api(`/members/${m.id}/photo`, { method: 'DELETE' }).catch(() => {});
    modal.close(); toast(t('saved')); refresh();
  };

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

// 검색용 — 대소문자·앞뒤 공백·몽골어/라틴 악센트 차이를 무시한다
function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); }
