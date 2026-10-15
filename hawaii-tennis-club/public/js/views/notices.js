// 공지 — 관리자가 쓰고(사진 1장·상단 고정) 회원은 읽는다.
import { api, esc, toast, openModal, pickPhoto, trText, origHtml, $$ } from '../ui.js';
import { t } from '../i18n.js';

export async function renderNotices(el, state) {
  const list = await api('/notices?lang=en');
  el.innerHTML = `
    ${state.me.role === 'admin'
      ? `<div class="fab-row"><button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newNotice'))}</button></div>`
      : `<div class="hint">${esc(t('readOnly'))}</div>`}
    ${list.length ? list.map(n => noticeCard(n, state)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`}`;

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
    <div class="card ${n.pinned ? 'pinned' : ''}">
      <div class="card-row">
        <div style="flex:1;min-width:0">
          <h3>${n.pinned ? '📌 ' : ''}${esc(trText(n, 'title').text)}</h3>
          <div class="meta">${esc(n.author || '')} · ${esc(String(n.created_at).slice(0, 10))}</div>
        </div>
        ${state.me.role === 'admin' ? `<button class="btn btn-sm" data-edit-notice="${n.id}">${esc(t('edit'))}</button>` : ''}
      </div>
      <div class="notice-body">${esc(trText(n, 'body').text)}</div>
      ${origHtml(trText(n, 'body').orig)}
      ${n.photo ? `<img class="notice-photo" src="${esc(photoSrc(n.photo))}" alt="" loading="lazy">` : ''}
    </div>`;
}

function noticeForm(n, state, refresh) {
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
