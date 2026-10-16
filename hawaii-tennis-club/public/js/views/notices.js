// 공지 — 관리자가 쓰고(사진 1장·상단 고정) 회원은 읽는다.
import { api, esc, toast, openModal, pickPhoto, trText, origHtml, $$ } from '../ui.js';
import { t } from '../i18n.js';
import { openRules, editRulesNow } from './rules.js';

export async function renderNotices(el, state) {
  const [list, rules] = await Promise.all([
    api('/notices?lang=en'),
    api('/docs/rules?lang=ko').catch(() => null),
  ]);
  const owner = !!state.me.is_owner;
  el.innerHTML = `
    ${state.me.role === 'admin'
      ? `<div class="fab-row"><button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newNotice'))}</button></div>`
      : `<div class="hint">${esc(t('readOnly'))}</div>`}
    ${rules ? `
      <div class="card tap pinned" data-rules>
        <div class="card-row">
          <div style="flex:1;min-width:0">
            <h3>📜 ${esc(t('rulesTitle'))}</h3>
            <div class="meta">${esc(t('rulesVersion', { v: rules.version }))} · ${esc(String(rules.updated_at).slice(0, 10))}</div>
          </div>
          ${owner ? `<button class="btn btn-sm" data-edit-rules>${esc(t('edit'))}</button>` : ''}
        </div>
        <div class="meta" style="margin-top:6px">${esc(t('rulesSee'))} →</div>
      </div>` : ''}
    ${list.length ? list.map(n => noticeCard(n, state)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`}`;

  // 회칙 — 누르면 읽기(한국어/몽골어), 오너는 '수정'으로 바로 고친다
  const rc = el.querySelector('[data-rules]');
  if (rc) rc.onclick = (e) => {
    if (e.target.closest('[data-edit-rules]')) return;
    openRules({ canEdit: owner });
  };
  const re = el.querySelector('[data-edit-rules]');
  if (re) re.onclick = () => editRulesNow(() => renderNotices(el, state));

  // 홈 카드에서 눌러 왔으면 그 공지로 내려간다
  if (state.focusNotice) {
    const id = state.focusNotice;
    state.focusNotice = null;
    // 탭을 그린 뒤 맨 위로 올리는 동작(app.js render)이 끝난 다음에 내려간다
    setTimeout(() => document.getElementById(`notice-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  }

  const add = el.querySelector('[data-new]');
  if (add) add.onclick = () => noticeForm(null, state, () => renderNotices(el, state));
  $$('[data-edit-notice]', el).forEach(b => b.onclick = async () => {
    const n = list.find(x => String(x.id) === b.dataset.editNotice);
    noticeForm(n, state, () => renderNotices(el, state));
  });
}

// 옛 공지에 '/uploads/…' 로 저장된 것이 있어도 하위 경로에서 열리게 앞의 / 를 떼어 쓴다
const photoSrc = (p) => String(p || '').replace(/^\/+/, '');

function noticeCard(n, state) {
  return `
    <div class="card ${n.pinned ? 'pinned' : ''}" id="notice-${n.id}">
      <div class="card-row">
        <div style="flex:1;min-width:0">
          <h3>${n.pinned ? '📌 ' : ''}${esc(trText(n, 'title').text)}</h3>
          <div class="meta">${esc(n.author || '')} · ${esc(String(n.created_at).slice(0, 10))}</div>
        </div>
        ${state.me.role === 'admin' ? `<button class="btn btn-sm" data-edit-notice="${n.id}">✏️ ${esc(t('edit'))}</button>` : ''}
      </div>
      <div class="notice-body">${esc(trText(n, 'body').text)}</div>
      ${origHtml(trText(n, 'body').orig)}
      ${n.photo ? `<img class="notice-photo" src="${esc(photoSrc(n.photo))}" alt="" loading="lazy">` : ''}
    </div>`;
}

// 홈 화면 공지 카드에서도 바로 고칠 수 있게 내보낸다
export function noticeForm(n, state, refresh) {
  const isNew = !n;
  let photoData = null;       // 새로 고른 사진 (data:URL)
  let removePhoto = false;

  const m = openModal({
    title: isNew ? t('newNotice') : t('editNotice'),
    fields: [
      { name: 'title', label: t('title'), value: n?.title || '' },
      { name: 'body', label: t('body'), type: 'textarea', value: n?.body || '' },
      { name: 'pinned', label: t('pinTop'), type: 'checkbox', value: !!n?.pinned },
    ],
    extra: `
      <div class="field">
        <span>${esc(t('photo'))}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-sm" data-pick>${esc(t('photoPick'))}</button>
          ${n?.photo ? `<button type="button" class="btn btn-sm btn-danger" data-rm>${esc(t('photoRemove'))}</button>` : ''}
          <span class="hint" data-photo-name style="padding:0">${n?.photo ? '1' : ''}</span>
        </div>
        <img data-preview src="${esc(photoSrc(n?.photo))}" class="notice-photo" ${n?.photo ? '' : 'hidden'} alt="">
      </div>`,
    onDelete: isNew ? null : async () => {
      await api(`/notices/${n.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v) => {
      if (!v.title || !v.body) return t('required');
      const body = { title: v.title, body: v.body, pinned: v.pinned };
      if (photoData) body.photo_data = photoData;
      if (removePhoto) body.remove_photo = true;
      if (isNew) await api('/notices', { method: 'POST', body });
      else await api(`/notices/${n.id}`, { method: 'PATCH', body });
      toast(t('saved'));
      refresh();
    },
  });

  m.form.querySelector('textarea[name="body"]').classList.add('long-edit');   // 긴 공지도 폰에서 고치기 쉽게

  const preview = m.form.querySelector('[data-preview]');
  m.form.querySelector('[data-pick]').onclick = async () => {
    const data = await pickPhoto();
    if (!data) return;
    photoData = data;
    removePhoto = false;
    preview.src = data;
    preview.hidden = false;
  };
  const rm = m.form.querySelector('[data-rm]');
  if (rm) rm.onclick = () => {
    removePhoto = true;
    photoData = null;
    preview.hidden = true;
    m.form.querySelector('[data-photo-name]').textContent = '';
  };
}
