// 사진첩 — 홈 화면에 최근 사진 줄(galleryStrip), 누르면 전체 사진첩(renderGallery).
// 회원 누구나 한 번에 여러 장 올리고, 지우기는 올린 사람·운영진.
import { api, esc, toast, openModal, errText, $$ } from '../ui.js';
import { t, timeAgo } from '../i18n.js';

const MAX_PICK = 10;
const SEND_EACH = 3;     // 한 번에 보내는 장수 — 요청 하나가 너무 커지지 않게 나눠 보낸다

const canDelete = (p, me) => p.member_id === me.id || me.role === 'admin' || !!me.is_owner;

// ---------- 홈 화면 줄 ----------
export async function galleryStrip() {
  let d = { rows: [], total: 0 };
  try { d = await api('/gallery?limit=12'); } catch (e) { /* 사진첩이 안 떠도 홈은 뜬다 */ }
  return `
    <div class="section-head"><h2>📷 ${esc(t('galleryTitle'))}${d.total ? ` · ${d.total}` : ''}</h2><span class="spacer"></span>
      ${d.total ? `<button class="btn btn-sm btn-ghost" data-go-gallery>${esc(t('seeAll'))} →</button>` : ''}</div>
    <div class="gstrip">
      <button class="gadd" data-gallery-add aria-label="${esc(t('galleryAdd'))}"><b>+</b><span>${esc(t('galleryAdd'))}</span></button>
      ${d.rows.map((p, i) => `<img src="${esc(p.photo)}" alt="" loading="lazy" data-gstrip="${i}">`).join('')}
      ${d.rows.length ? '' : `<div class="gstrip-empty">${esc(t('galleryEmpty'))}</div>`}
    </div>
    <script type="application/json" data-gstrip-rows>${JSON.stringify(d.rows).replace(/</g, '\\u003c')}</script>`;
}

export function bindGalleryStrip(el, state, refresh) {
  const json = el.querySelector('[data-gstrip-rows]');
  const rows = json ? JSON.parse(json.textContent) : [];
  el.querySelector('[data-go-gallery]')?.addEventListener('click', () => state.go('gallery'));
  el.querySelector('[data-gallery-add]')?.addEventListener('click', () => uploadForm(refresh));
  $$('[data-gstrip]', el).forEach(img => img.onclick = () => viewer(rows, Number(img.dataset.gstrip), state, refresh));
}

// ---------- 전체 사진첩 ----------
export async function renderGallery(el, state) {
  const d = await api('/gallery');
  const rows = d.rows;
  let more = d.has_more ? rows[rows.length - 1].id : null;
  const again = () => renderGallery(el, state);

  el.innerHTML = `
    <div class="section-head" style="margin-top:2px"><h2>📷 ${esc(t('galleryTitle'))}${d.total ? ` · ${d.total}` : ''}</h2></div>
    <button class="btn btn-primary" style="width:100%" data-add>+ ${esc(t('galleryAdd'))}</button>
    <div class="ggrid" data-grid>${rows.map((p, i) => cell(p, i)).join('')}</div>
    ${rows.length ? '' : `<div class="empty">${esc(t('galleryEmpty'))}</div>`}
    ${more ? `<button class="btn" style="width:100%;margin-top:10px" data-more>${esc(t('more'))}</button>` : ''}`;

  el.querySelector('[data-add]').onclick = () => uploadForm(again);
  const grid = el.querySelector('[data-grid]');
  grid.onclick = (e) => {
    const c = e.target.closest('[data-gi]');
    if (c) viewer(rows, Number(c.dataset.gi), state, again);
  };
  const mb = el.querySelector('[data-more]');
  if (mb) mb.onclick = async () => {
    mb.disabled = true;
    const n = await api(`/gallery?before=${more}`);
    const start = rows.length;
    rows.push(...n.rows);
    grid.insertAdjacentHTML('beforeend', n.rows.map((p, i) => cell(p, start + i)).join(''));
    more = n.has_more && n.rows.length ? n.rows[n.rows.length - 1].id : null;
    if (!more) mb.remove(); else mb.disabled = false;
  };
}

const cell = (p, i) => `<button class="gcell" data-gi="${i}"><img src="${esc(p.photo)}" alt="" loading="lazy"></button>`;

// ---------- 크게 보기 — 옆으로 넘기기·설명·지우기 ----------
// body 바로 아래 .photo-view 라서 폰 뒤로가기가 이 창부터 닫는다(backnav).
function viewer(rows, start, state, refresh) {
  let i = start;
  const v = document.createElement('div');
  v.className = 'photo-view gview';
  document.body.appendChild(v);
  const close = () => v.remove();

  const draw = () => {
    const p = rows[i];
    v.innerHTML = `
      <button class="gv-x" data-x aria-label="${esc(t('close'))}">✕</button>
      ${i > 0 ? '<button class="gv-nav prev" data-prev aria-label="prev">‹</button>' : ''}
      ${i < rows.length - 1 ? '<button class="gv-nav next" data-next aria-label="next">›</button>' : ''}
      <img src="${esc(p.photo)}" alt="">
      <div class="gv-info">
        ${p.caption ? `<div class="gv-cap">${esc(p.caption)}</div>` : ''}
        <div class="gv-meta">${esc(p.author || '')} · ${esc(timeAgo(p.created_at))} · ${i + 1}/${rows.length}</div>
        ${canDelete(p, state.me) ? `<div class="gv-acts">
          <button class="btn btn-sm" data-cap>${esc(t('galleryCaption'))}</button>
          <button class="btn btn-sm btn-danger" data-del>${esc(t('del'))}</button></div>` : ''}
      </div>`;
  };
  draw();

  const go = (d) => { const n = i + d; if (n >= 0 && n < rows.length) { i = n; draw(); } };
  v.onclick = async (e) => {
    if (e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-prev]')) return go(-1);
    if (e.target.closest('[data-next]')) return go(1);
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!del.classList.contains('ask')) { del.classList.add('ask'); del.textContent = t('confirmDelete'); return; }
      try {
        await api(`/gallery/${rows[i].id}`, { method: 'DELETE' });
        toast(t('deleted'));
        close();
        refresh();
      } catch (err) { toast(errText(err), true); }
      return;
    }
    if (e.target.closest('[data-cap]')) {
      const cap = prompt(t('galleryCaption'), rows[i].caption || '');
      if (cap === null) return;
      try {
        await api(`/gallery/${rows[i].id}`, { method: 'PATCH', body: { caption: cap } });
        rows[i].caption = cap.trim() || null;
        draw();
        toast(t('saved'));
      } catch (err) { toast(errText(err), true); }
      return;
    }
    if (e.target === v) close();     // 사진 밖 빈 곳을 누르면 닫힌다
  };

  // 손가락으로 옆으로 밀어 넘기기
  let x0 = null;
  v.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
}

// ---------- 올리기 ----------
// 사진 여러 장 고르기 — 폰 사진은 수 MB라 긴 변 1600px JPEG 로 줄여서 보낸다.
function pickPhotos(max = 1600) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])].slice(0, MAX_PICK);
      const out = [];
      for (const f of files) {
        const d = await shrink(f, max);
        if (d) out.push(d);
      }
      resolve(out);
    };
    input.click();
  });
}

function shrink(file, max) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function uploadForm(refresh) {
  let picked = [];
  const m = openModal({
    title: t('galleryAdd'),
    fields: [{ name: 'caption', label: t('galleryCaption'), placeholder: t('galleryCaptionHint') }],
    extra: `
      <button type="button" class="btn" style="width:100%" data-pick>📷 ${esc(t('galleryPick'))}</button>
      <div class="gpreview" data-preview></div>
      <div class="hint">${esc(t('galleryPickHint', { n: MAX_PICK }))}</div>`,
    saveLabel: t('galleryUpload'),
    onSave: async (v, form) => {
      if (!picked.length) return t('galleryNone');
      const btn = form.querySelector('button[type=submit]');
      for (let k = 0; k < picked.length; k += SEND_EACH) {
        btn.textContent = `${Math.min(k + SEND_EACH, picked.length)}/${picked.length}…`;
        await api('/gallery', { method: 'POST', body: { photos: picked.slice(k, k + SEND_EACH), caption: v.caption } });
      }
      toast(t('saved'));
      refresh();
    },
  });

  const prev = m.form.querySelector('[data-preview]');
  const show = () => {
    prev.innerHTML = picked.map((src, k) =>
      `<div class="gp"><img src="${src}" alt=""><button type="button" data-rm="${k}" aria-label="remove">✕</button></div>`).join('');
  };
  prev.onclick = (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { picked.splice(Number(b.dataset.rm), 1); show(); }
  };
  m.form.querySelector('[data-pick]').onclick = async () => {
    const more = await pickPhotos();
    picked = [...picked, ...more].slice(0, MAX_PICK);
    show();
  };
}
