// 공지 — 관리자가 쓰고(사진 1장·상단 고정) 회원은 읽는다.
import { api, esc, toast, openModal, pickPhotos, origText, origHtml, $$ } from '../ui.js';
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
const MAX_PHOTOS = 10;   // 서버(routes/notices.js MAX_PHOTOS)와 같게
const photosOf = (n) => (n?.photos?.length ? n.photos : (n?.photo ? [n.photo] : []));

// 사진 묶음 — 1장은 크게, 여러 장은 작은 격자. 누르면 크게 보고 넘길 수 있다(data-photo-set)
function photosHtml(n) {
  const all = photosOf(n).map(photoSrc);
  if (!all.length) return '';
  if (all.length === 1) return `<img class="notice-photo" src="${esc(all[0])}" data-view-photo="${esc(all[0])}" alt="" loading="lazy">`;
  // 여러 장은 전부 작은 정사각 격자 (2·4장 2칸, 그 외 3칸) — 글 상세(board.js)와 같은 모양
  const cols = (all.length === 2 || all.length === 4) ? 'c2' : 'c3';
  return `<div class="post-grid ${cols}" data-photo-set="${esc(JSON.stringify(all))}">${all.map(src =>
    `<img src="${esc(src)}" data-view-photo="${esc(src)}" alt="" loading="lazy">`).join('')}</div>`;
}

function noticeCard(n, state) {
  return `
    <div class="card ${n.pinned ? 'pinned' : ''}" id="notice-${n.id}">
      <div class="card-row">
        <div style="flex:1;min-width:0">
          <h3>${n.pinned ? '📌 ' : ''}${esc(origText(n, 'title').text)}</h3>
          <div class="meta">${esc(n.author || '')} · ${esc(String(n.created_at).slice(0, 10))}</div>
        </div>
        ${state.me.role === 'admin' ? `<button class="btn btn-sm" data-edit-notice="${n.id}">✏️ ${esc(t('edit'))}</button>` : ''}
      </div>
      <div class="notice-body">${esc(origText(n, 'body').text)}</div>
      ${origHtml(origText(n, 'body').orig)}
      ${photosHtml(n)}
    </div>`;
}

// 홈 화면 공지 카드에서도 바로 고칠 수 있게 내보낸다
export function noticeForm(n, state, refresh) {
  const isNew = !n;
  // 사진 목록 — 이미 있던 것은 { path }, 새로 고른 것은 { data }. 보낼 때 남길 것·새 것으로 나눈다
  let items = photosOf(n).map(path => ({ path }));

  const m = openModal({
    title: isNew ? t('newNotice') : t('editNotice'),
    fields: [
      { name: 'title', label: t('title'), value: n?.title || '' },
      { name: 'body', label: t('body'), type: 'textarea', value: n?.body || '' },
      { name: 'pinned', label: t('pinTop'), type: 'checkbox', value: !!n?.pinned },
    ],
    extra: `
      <div class="field">
        <span>${esc(t('photo'))} <span class="hint" style="padding:0">(${esc(t('photoMax'))})</span></span>
        <button type="button" class="btn btn-sm" data-pick>📷 ${esc(t('photoPick'))}</button>
        <div class="post-preview" data-preview></div>
      </div>`,
    onDelete: isNew ? null : async () => {
      await api(`/notices/${n.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v) => {
      if (!v.title || !v.body) return t('required');
      const body = { title: v.title, body: v.body, pinned: v.pinned };
      const add = items.filter(x => x.data).map(x => x.data);
      if (isNew) body.photos_data = add;
      else { body.photos_keep = items.filter(x => x.path).map(x => x.path); body.photos_data = add; }
      if (isNew) await api('/notices', { method: 'POST', body });
      else await api(`/notices/${n.id}`, { method: 'PATCH', body });
      toast(t('saved'));
      refresh();
    },
  });

  m.form.querySelector('textarea[name="body"]').classList.add('long-edit');   // 긴 공지도 폰에서 고치기 쉽게

  // 여러 장 한 번에 고르기 — 미리보기 ✕ 로 뺀다(있던 사진도)
  const preview = m.form.querySelector('[data-preview]');
  const draw = () => {
    preview.innerHTML = items.map((x, i) =>
      `<div class="tray-thumb post-thumb"><img src="${esc(x.data || photoSrc(x.path))}" alt=""><button type="button" data-unpick="${i}" aria-label="Remove">✕</button></div>`).join('');
    preview.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => { items.splice(Number(b.dataset.unpick), 1); draw(); });
  };
  draw();
  const pick = m.form.querySelector('[data-pick]');
  let ready = null;   // 사진 줄이는 중이면 저장이 기다린다
  pick.onclick = async () => {
    const room = MAX_PHOTOS - items.length;
    if (room <= 0) return toast(t('photoMax'), true);
    pick.disabled = true;
    const label = pick.textContent;
    let release = null;
    const { photos, cut, failed } = await pickPhotos(room, 1280, (n, total) => {
      if (n === 0) ready = new Promise(r => { release = r; });
      pick.textContent = `⏳ ${n}/${total}`;
    });
    pick.disabled = false;
    pick.textContent = label;
    if (cut) toast(t('photoMax'), true);
    if (failed) toast(t('photoFailed', { n: failed }), true);
    items.push(...photos.map(data => ({ data })));
    draw();
    ready = null;
    release?.();
  };
}
