// 홈 팝업 — 앱을 열면 지금 게시 중인 팝업을 띄운다 (여러 개면 1/2 로 넘긴다).
// '오늘 하루 안 보기'·'다시 안 보기'는 이 폰에만 남긴다(localStorage). 폰을 바꾸면 다시 뜬다.
// 관리(운영진): ☰ 메뉴 → Popups 화면(renderPopupAdmin).
// 팝업은 #modalRoot 에 띄운다 — 폰 뒤로가기가 팝업부터 닫는다(backnav).
import { api, esc, toast, openModal, pickPhoto, today, trText, origHtml } from '../ui.js';
import { t } from '../i18n.js';

const NEVER = 'htc_popup_never';     // [id, …]
const SKIP = 'htc_popup_today';      // { id: 'YYYY-MM-DD' }

const LINK_LABEL = {
  schedule: 'tabSchedule', notices: 'tabNotices', board: 'tabBoard', dues: 'tabDues', members: 'tabMembers',
  chat: 'tabChat', gallery: 'galleryTitle', results: 'resultsTitle',
};
const linkName = (tab) => t(LINK_LABEL[tab] || 'tabHome');

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 개인 브라우저 등 — 그냥 다음에 또 뜬다 */ }
}
const hidden = (p) => load(NEVER, []).includes(p.id) || load(SKIP, {})[p.id] === today();

// ---------- 앱을 열 때 ----------
// 한 번 열 때 한 번만. 회칙 동의 창 같은 다른 창이 떠 있거나 홈이 아니면 잠깐 기다린다.
let started = false;
export function maybeShowPopups(state) {
  if (started) return;
  started = true;
  let list = null, tries = 0;
  const tick = async () => {
    if (!state.me) return;                      // 로그아웃
    if (list === null) {
      try { list = (await api('/popups/active?lang=en')).filter(p => !hidden(p)); }
      catch (e) { return; }                      // 팝업이 안 떠도 앱은 쓴다
      if (!list.length) return;
    }
    const busy = document.getElementById('modalRoot').innerHTML.trim() || !document.getElementById('menuSheet').hidden
      || !state.rules_agreed || state.tab !== 'home';
    if (busy) { if (tries++ < 600) setTimeout(tick, 1000); return; }
    showPopups(list, state);
  };
  setTimeout(tick, 600);
}

// list 를 차례로 보여준다. preview=true 면 '안 보기' 버튼 없이 (관리 화면 미리보기)
export function showPopups(list, state, { preview = false } = {}) {
  const root = document.getElementById('modalRoot');
  let i = 0;
  const close = () => { root.innerHTML = ''; };
  const next = () => { i += 1; if (i < list.length) draw(); else close(); };

  const draw = () => {
    const p = list[i];
    const title = trText(p, 'title'), body = trText(p, 'body');
    root.innerHTML = `
      <div class="popup-wrap" data-modal>
        <div class="popup-card${list.length > 1 && !p.photo ? ' counted' : ''}" role="dialog" aria-modal="true">
          ${list.length > 1 ? `<div class="popup-count">${i + 1} / ${list.length}</div>` : ''}
          ${p.photo ? `<img class="popup-photo" src="${esc(p.photo)}" data-view-photo="${esc(p.photo)}" alt="">` : ''}
          <div class="popup-in">
            <h3>${esc(title.text)}</h3>
            ${origHtml(title.orig)}
            ${body.text ? `<div class="popup-body">${esc(body.text)}</div>${origHtml(body.orig)}` : ''}
            ${p.link_tab ? `<button type="button" class="btn btn-primary popup-go" data-go>${esc(t('popupOpen', { tab: linkName(p.link_tab) }))}</button>` : ''}
          </div>
          <div class="popup-foot">
            ${preview ? '' : `<button type="button" data-today>${esc(t('popupHideToday'))}</button>
            <button type="button" data-never>${esc(t('popupNever'))}</button>`}
            <button type="button" class="strong" data-close>${esc(list.length > 1 && i < list.length - 1 ? t('popupNext') : t('close'))}</button>
          </div>
        </div>
      </div>`;
    const wrap = root.firstElementChild;
    wrap.onclick = (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) return next();
      if (e.target.closest('[data-today]')) { save(SKIP, { ...load(SKIP, {}), [p.id]: today() }); return next(); }
      if (e.target.closest('[data-never]')) { save(NEVER, [...new Set([...load(NEVER, []), p.id])].slice(-200)); return next(); }
      if (e.target.closest('[data-go]')) { close(); goAfterClose(state, p.link_tab); }
    };
  };
  draw();
}

// 창을 닫으면 backnav 가 창 몫 history 칸을 걷어낸다(비동기) — 그게 끝난 뒤 이동해야 새 칸이 안 지워진다
function goAfterClose(state, tab) {
  let tries = 0;
  const go = () => (history.state?.overlay && tries++ < 20 ? setTimeout(go, 30) : state.go(tab));
  setTimeout(go, 30);
}

// ---------- 관리 화면 (운영진) ----------
export async function renderPopupAdmin(el, state) {
  const { rows, today: d } = await api('/popups');
  const again = () => renderPopupAdmin(el, state);
  const status = (p) => (!p.active ? 'off' : p.starts_on > d ? 'scheduled' : (p.ends_on && p.ends_on < d) ? 'ended' : 'live');
  const PILL = { live: 'solid', scheduled: 'gold', ended: 'grey', off: 'grey' };
  const LABEL = { live: 'popupLive', scheduled: 'popupScheduled', ended: 'popupEnded', off: 'popupOff' };

  el.innerHTML = `
    <div class="section-head" style="margin-top:2px"><h2>📢 ${esc(t('popupsTitle'))}</h2></div>
    <button class="btn btn-primary" style="width:100%" data-add>+ ${esc(t('popupNew'))}</button>
    <div class="hint" style="margin:8px 2px 12px">${esc(t('popupHint'))}</div>
    ${rows.length ? rows.map(p => {
      const s = status(p);
      return `<div class="card">
        <div class="card-row" style="align-items:flex-start">
          ${p.photo ? `<img class="popup-thumb" src="${esc(p.photo)}" alt="">` : ''}
          <div style="flex:1;min-width:0">
            <h3>${esc(p.title)}</h3>
            <div class="meta">${esc(p.starts_on)} → ${esc(p.ends_on || t('popupNoEnd'))}${p.link_tab ? ` · ${esc(linkName(p.link_tab))}` : ''}</div>
          </div>
          <span class="pill ${PILL[s]}">${esc(t(LABEL[s]))}</span>
        </div>
        ${p.body ? `<div class="memo">${esc(p.body)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-sm" data-preview="${p.id}">👁 ${esc(t('popupPreview'))}</button>
          <button class="btn btn-sm" data-edit="${p.id}">✏️ ${esc(t('edit'))}</button>
        </div>
      </div>`;
    }).join('') : `<div class="empty">${esc(t('popupEmpty'))}</div>`}`;

  el.querySelector('[data-add]').onclick = () => popupForm(null, again);
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => popupForm(rows.find(p => String(p.id) === b.dataset.edit), again));
  el.querySelectorAll('[data-preview]').forEach(b => b.onclick = () =>
    showPopups([rows.find(p => String(p.id) === b.dataset.preview)], state, { preview: true }));
}

function popupForm(p, refresh) {
  const isNew = !p;
  let photoData = null, removePhoto = false;
  const m = openModal({
    title: isNew ? t('popupNew') : t('popupEdit'),
    fields: [
      { name: 'title', label: t('title'), value: p?.title || '', maxlength: 100 },
      { name: 'body', label: t('body'), type: 'textarea', value: p?.body || '' },
      { name: 'starts_on', label: t('popupStarts'), type: 'date', value: p?.starts_on || today() },
      { name: 'ends_on', label: t('popupEnds'), type: 'date', value: p?.ends_on || '' },
      { name: 'link_tab', label: t('popupLink'), type: 'select', value: p?.link_tab || '',
        options: [{ value: '', label: t('popupLinkNone') }, ...Object.keys(LINK_LABEL).map(k => ({ value: k, label: linkName(k) }))] },
      { name: 'active', label: t('popupActive'), type: 'checkbox', value: isNew ? true : !!p.active },
    ],
    extra: `
      <div class="field">
        <span>${esc(t('photo'))}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-sm" data-pick>${esc(t('photoPick'))}</button>
          ${p?.photo ? `<button type="button" class="btn btn-sm btn-danger" data-rm>${esc(t('photoRemove'))}</button>` : ''}
        </div>
        <img data-preview src="${esc(p?.photo || '')}" class="notice-photo" ${p?.photo ? '' : 'hidden'} alt="">
      </div>`,
    onDelete: isNew ? null : async () => {
      await api(`/popups/${p.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v) => {
      if (!v.title) return t('required');
      if (v.ends_on && v.ends_on < v.starts_on) return t('endBeforeStart');
      const body = { ...v, ends_on: v.ends_on || null, link_tab: v.link_tab || null };
      if (photoData) body.photo_data = photoData;
      if (removePhoto) body.remove_photo = true;
      if (isNew) await api('/popups', { method: 'POST', body });
      else await api(`/popups/${p.id}`, { method: 'PATCH', body });
      toast(t('saved'));
      refresh();
    },
  });
  const preview = m.form.querySelector('[data-preview]');
  m.form.querySelector('[data-pick]').onclick = async () => {
    const data = await pickPhoto();
    if (!data) return;
    photoData = data; removePhoto = false;
    preview.src = data; preview.hidden = false;
  };
  const rm = m.form.querySelector('[data-rm]');
  if (rm) rm.onclick = () => { removePhoto = true; photoData = null; preview.hidden = true; };
}
