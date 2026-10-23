// 조직도 (회칙 제14조) — 회원 탭 맨 위에 보인다. 관리자는 자리를 눌러 사람을 앉힌다.
import { api, esc, toast, openModal, errText, $$ } from '../ui.js';
import { t } from '../i18n.js';

// 화면에 놓이는 순서 — 오너 / 회장 / 부회장·총무 / 이사 / 명예직
const LAYOUT = [
  { group: 'owner', roles: ['owner'] },
  { group: 'exec', roles: ['president'] },
  { group: 'exec', roles: ['vice1', 'vice2'] },
  { group: 'exec', roles: ['manager1'] },
  { group: 'exec', roles: ['match', 'event', 'external'] },
  { group: 'honorary', roles: ['honorary', 'advisor1', 'advisor2', 'advisor3'] },
];

export async function orgBlock(state) {
  let rows = [];
  try { rows = await api('/officers'); } catch (e) { return ''; }
  const by = new Map(rows.map(r => [r.role, r]));
  const isAdmin = !!state.me.is_owner;   // 조직도 편집은 오너만 (회칙 제14조③·제16조)

  const slot = (role) => {
    const o = by.get(role) || {};
    const filled = !!o.name;
    return `<div class="org-slot ${filled ? '' : 'empty'} ${isAdmin ? 'tap' : ''}" ${isAdmin ? `data-role="${role}"` : ''}>
      <div class="org-role">${esc(t('role_' + role))}</div>
      <div class="org-name">${filled ? esc(o.name) : (isAdmin ? esc(t('orgAssign')) : '—')}</div>
      ${o.note ? `<div class="org-note">${esc(o.note)}</div>` : ''}
    </div>`;
  };

  const lines = LAYOUT.map(({ group, roles }, i) => {
    const inner = roles.map(slot).join('');
    const label = group === 'honorary' ? `<div class="org-label">${esc(t('orgHonorary'))}</div>` : '';
    return `${i > 0 && group !== 'honorary' ? '<div class="org-link"></div>' : ''}${label}<div class="org-row">${inner}</div>`;
  }).join('');

  return `
    <div class="section-head"><h2>${esc(t('orgTitle'))}</h2></div>
    <div class="card org">${lines}</div>`;
}

export function bindOrg(el, state, refresh) {
  $$('[data-role]', el).forEach(b => b.onclick = async () => {
    const role = b.dataset.role;
    let members = [];
    try { members = await api('/members'); } catch (e) { members = []; }
    const cur = await api('/officers').then(rs => rs.find(r => r.role === role)).catch(() => ({}));

    openModal({
      title: t('role_' + role),
      fields: [
        { name: 'member_id', label: t('orgPickMember'), type: 'select', value: cur?.member_id || '',
          options: [{ value: '', label: t('orgNotMember') }, ...members.map(m => ({ value: m.id, label: m.name }))] },
        { name: 'person_name', label: t('orgNameOnly'), value: cur?.from_member ? '' : (cur?.name || ''),
          placeholder: t('orgNameOnlyHint') },
        { name: 'note', label: t('memo'), value: cur?.note || '' },
      ],
      extra: `<div class="hint">${esc(t('orgHint'))}</div>`,
      onSave: async (v) => {
        try {
          await api(`/officers/${role}`, { method: 'PUT', body: {
            member_id: v.member_id ? Number(v.member_id) : null,
            person_name: v.member_id ? '' : v.person_name,
            note: v.note,
          } });
          toast(t('saved'));
          refresh();
        } catch (e) { return errText(e); }
      },
    });
  });
}
