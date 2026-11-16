// 사진첩 — 사진·동영상, 전체 사진첩(renderGallery). 홈 피드의 사진 카드도 여기 크게 보기(galleryViewer)를 쓴다.
// 회원 누구나 한 번에 여러 장 올리고, 지우기는 올린 사람·운영진.
import { api, esc, toast, openModal, errText } from '../ui.js';
import { t, timeAgo } from '../i18n.js';

const MAX_PICK = 10;
const SEND_EACH = 3;     // 한 번에 보내는 장수 — 요청 하나가 너무 커지지 않게 나눠 보낸다

const canDelete = (p, me) => p.member_id === me.id || me.role === 'admin' || !!me.is_owner;

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
    if (c) galleryViewer(rows, Number(c.dataset.gi), state, again);
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

const cell = (p, i) => `<button class="gcell" data-gi="${i}"><img src="${esc(p.photo)}" alt="" loading="lazy">${p.video ? `<span class="vbadge">▶ ${fmtDur(p.duration)}</span>` : ''}</button>`;

// ---------- 크게 보기 — 옆으로 넘기기·설명·지우기 ----------
// body 바로 아래 .photo-view 라서 폰 뒤로가기가 이 창부터 닫는다(backnav).
export function galleryViewer(rows, start, state, refresh) {
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
      ${p.video
        ? `<video src="${esc(p.video)}" poster="${esc(p.photo)}" controls playsinline preload="metadata"></video>`
        : `<img src="${esc(p.photo)}" alt="">`}
      <div class="gv-info">
        ${p.caption ? `<div class="gv-cap">${esc(p.caption)}</div>` : ''}
        <div class="gv-meta">${esc(p.author || '')} · ${esc(timeAgo(p.created_at))} · ${i + 1}/${rows.length}</div>
        <div class="gv-acts">
          <button class="btn btn-sm btn-primary" data-save>⬇ ${esc(t('gallerySave'))}</button>
          ${canDelete(p, state.me) ? `
          <button class="btn btn-sm" data-cap>${esc(t('galleryCaption'))}</button>
          <button class="btn btn-sm btn-danger" data-del>${esc(t('del'))}</button>` : ''}
        </div>
      </div>`;
  };
  draw();

  const go = (d) => { const n = i + d; if (n >= 0 && n < rows.length) { i = n; draw(); } };
  v.onclick = async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const sv = e.target.closest('[data-save]');
    if (sv) { sv.disabled = true; await savePhoto(rows[i]); sv.disabled = false; return; }
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
  // 영상 위에서 민 건 재생 막대 조작일 수 있어 넘기지 않는다
  v.addEventListener('touchstart', (e) => { x0 = e.target.closest('video') ? null : e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
}

// ---------- 폰에 저장 ----------
// 아이폰: 공유 창(navigator.share)을 띄운다 → "이미지 저장"으로 사진 앱에 들어간다
//   (홈 화면 앱에서는 <a download> 가 사진 앱에 저장되지 않는다)
// 안드로이드·PC: 파일로 내려받는다(다운로드 폴더 → 갤러리에도 보인다)
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function savePhoto(p) {
  try {
    const res = await fetch(p.video || p.photo, { credentials: 'same-origin' });   // 동영상이면 영상 파일을
    if (!res.ok) throw new Error('fetch');
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('quicktime', 'mov');
    const name = `hawaii-tennis-${p.id}.${ext}`;
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });

    if (isIOS() && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { /* 공유 창을 닫은 것 */ }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t('gallerySaved'));
  } catch (e) { toast(t('failed'), true); }
}

// ---------- 올리기 ----------
// ---------- 고르기 — 사진 여러 장 + 동영상 ----------
// 사진: 폰 사진은 수 MB라 긴 변 1600px JPEG 로 줄여서 보낸다.
// 동영상: 1분·50MB 까지. 서버에 변환 도구가 없어 그대로 올리고, 첫 장면(poster)은 폰에서 만든다.
const VIDEO_MAX_MB = 50;
const VIDEO_MAX_SEC = 60;
const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|3gp)$/i.test(f.name || '');

function pickMedia(max = 1600) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])].slice(0, MAX_PICK);
      const out = [];
      for (const f of files) {
        if (isVideo(f)) {
          const v = await readVideo(f);
          if (v.error) toast(t(v.error), true);
          else out.push(v);
        } else {
          const d = await shrink(f, max);
          if (d) out.push({ kind: 'photo', data: d });
        }
      }
      resolve(out);
    };
    input.click();
  });
}

// 길이 재기 + 첫 장면 뽑기. 이 폰이 못 여는 영상(코덱)이면 거절한다.
function readVideo(file) {
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) return Promise.resolve({ error: 'videoTooBig' });
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const end = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => end({ error: 'videoBad' }), 15000);
    v.onerror = () => { clearTimeout(timer); end({ error: 'videoBad' }); };
    v.onloadedmetadata = () => {
      const duration = v.duration;
      if (!isFinite(duration) || !duration) { clearTimeout(timer); return end({ error: 'videoBad' }); }
      if (duration > VIDEO_MAX_SEC + 0.9) { clearTimeout(timer); return end({ error: 'videoTooLong' }); }
      v.onseeked = () => {
        clearTimeout(timer);
        end({ kind: 'video', file, duration, poster: frame(v) });
      };
      v.currentTime = Math.min(0.5, duration / 2);
    };
    v.src = url;
  });
}

// 지금 장면을 JPEG 로 — 못 그리면(일부 폰) 어두운 바탕에 ▶ 를 그린다
function frame(v) {
  const w = v.videoWidth || 640, h = v.videoHeight || 360;
  const scale = Math.min(1, 1280 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#16231c';
  g.fillRect(0, 0, c.width, c.height);
  try { g.drawImage(v, 0, 0, c.width, c.height); } catch (e) { return playCard(); }
  try { return c.toDataURL('image/jpeg', 0.8); } catch (e) { return playCard(); }
}
function playCard() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const g = c.getContext('2d');
  g.fillStyle = '#16231c'; g.fillRect(0, 0, 640, 360);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(290, 140); g.lineTo(290, 220); g.lineTo(360, 180); g.fill();
  return c.toDataURL('image/jpeg', 0.8);
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

// 동영상 한 개 올리기 — 진행률을 보려고 fetch 대신 XHR
function sendVideo(item, caption, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    if (caption) fd.append('caption', caption);
    fd.append('duration', String(item.duration));
    fd.append('poster', item.poster);
    fd.append('video', item.file, item.file.name || 'video');
    const x = new XMLHttpRequest();
    x.open('POST', 'api/gallery/video');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => {
      let d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { /* nginx 가 막으면 HTML */ }
      if (x.status >= 200 && x.status < 300) return resolve(d);
      const err = new Error(d?.error || (x.status === 413 ? 'video_too_big' : `http_${x.status}`));
      err.status = x.status;
      reject(err);
    };
    x.onerror = () => reject(new Error('network'));
    x.send(fd);
  });
}

export function uploadForm(refresh) {
  let picked = [];      // { kind:'photo', data } | { kind:'video', file, duration, poster }
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
      const photos = picked.filter(p => p.kind === 'photo').map(p => p.data);
      const videos = picked.filter(p => p.kind === 'video');
      for (let k = 0; k < photos.length; k += SEND_EACH) {
        btn.textContent = `${Math.min(k + SEND_EACH, photos.length)}/${photos.length}…`;
        await api('/gallery', { method: 'POST', body: { photos: photos.slice(k, k + SEND_EACH), caption: v.caption } });
      }
      for (let k = 0; k < videos.length; k++) {
        const label = videos.length > 1 ? ` ${k + 1}/${videos.length}` : '';
        await sendVideo(videos[k], v.caption, (p) => { btn.textContent = t('videoUploading', { p }) + label; });
      }
      toast(t('saved'));
      refresh();
    },
  });

  const prev = m.form.querySelector('[data-preview]');
  const show = () => {
    prev.innerHTML = picked.map((p, k) =>
      `<div class="gp"><img src="${p.kind === 'video' ? p.poster : p.data}" alt="">
        ${p.kind === 'video' ? `<span class="vbadge">▶ ${fmtDur(p.duration)}</span>` : ''}
        <button type="button" data-rm="${k}" aria-label="remove">✕</button></div>`).join('');
  };
  prev.onclick = (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { picked.splice(Number(b.dataset.rm), 1); show(); }
  };
  const pick = m.form.querySelector('[data-pick]');
  pick.onclick = async () => {
    pick.disabled = true;
    try {
      const more = await pickMedia();
      picked = [...picked, ...more].slice(0, MAX_PICK);
      show();
    } finally { pick.disabled = false; }
  };
}

// 0:42 처럼
export function fmtDur(s) {
  const n = Math.round(Number(s) || 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
