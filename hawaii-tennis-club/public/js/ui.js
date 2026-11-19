// 화면 조각 만들기 — 서버 호출, 토스트, 모달, 사진 줄이기.
import { t } from './i18n.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 울란바토르 기준 오늘 (서버와 같은 기준이라 자정 전후로 날짜가 어긋나지 않는다)
const UB_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => UB_FMT.format(new Date());
export const thisMonth = () => today().slice(0, 7);
export function shiftMonth(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// 'api/...' 상대 경로 — 루트에 띄우면 /api/…, /club/ 아래에 올리면 /club/api/… 로 간다.
// (nginx 가 /club/ 프리픽스를 벗기고 넘겨주므로 서버 쪽 경로는 그대로다)
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer = 0;
export function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// 아래에서 올라오는 모달. fields 로 입력칸을 만들고, 저장을 누르면 onSave(값) 을 부른다.
// onSave 가 문자열을 돌려주면 그걸 오류로 띄우고 모달은 열어둔다.
export function openModal({ title, fields = [], extra = '', saveLabel, onSave, onDelete }) {
  const root = $('#modalRoot');
  const inputs = fields.map(f => fieldHtml(f)).join('');
  root.innerHTML = `
    <div class="modal" data-modal>
      <div class="modal-body">
        <div class="modal-head"><h3>${esc(title)}</h3>
          ${onDelete ? `<button class="btn btn-sm btn-danger" data-del>${esc(t('del'))}</button>` : ''}
        </div>
        <form data-form>${inputs}${extra}
          <p class="err" data-err></p>
          <div class="modal-actions">
            <button type="button" class="btn" data-cancel>${esc(t('cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(saveLabel || t('save'))}</button>
          </div>
        </form>
      </div>
    </div>`;

  const wrap = $('[data-modal]', root);
  const form = $('[data-form]', root);
  const err = $('[data-err]', root);
  const close = () => { root.innerHTML = ''; };

  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  $('[data-cancel]', root).onclick = close;
  if (onDelete) $('[data-del]', root).onclick = async () => {
    if (!confirm(t('confirmDelete'))) return;
    try { await onDelete(); close(); } catch (e) { err.textContent = t('failed'); }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    err.textContent = '';
    const vals = {};
    for (const f of fields) {
      const el = $(`[name="${f.name}"]`, form);
      if (!el) continue;
      vals[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
    }
    try {
      const msg = await onSave(vals, form);
      if (msg) { err.textContent = msg; btn.disabled = false; return; }
      close();
    } catch (e2) {
      err.textContent = errText(e2);
      btn.disabled = false;
    }
  };

  setTimeout(() => { const first = $('input,select,textarea', form); if (first) first.focus(); }, 60);
  return { close, form, err };
}

function fieldHtml(f) {
  const label = `<span>${esc(f.label)}</span>`;
  if (f.type === 'select') {
    const opts = f.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<label class="field">${label}<select name="${f.name}">${opts}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="field">${label}<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></label>`;
  }
  if (f.type === 'checkbox') {
    return `<label class="field" style="display:flex;align-items:center;gap:9px">
      <input type="checkbox" name="${f.name}" style="width:20px;height:20px"${f.value ? ' checked' : ''}>
      <span style="margin:0">${esc(f.label)}</span></label>`;
  }
  const attrs = [
    `type="${f.type || 'text'}"`, `name="${f.name}"`,
    f.value != null ? `value="${esc(f.value)}"` : '',
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
    f.inputmode ? `inputmode="${f.inputmode}"` : '',
    f.maxlength ? `maxlength="${f.maxlength}"` : '',
    f.min != null ? `min="${f.min}"` : '',
    f.max != null ? `max="${f.max}"` : '',
  ].filter(Boolean).join(' ');
  return `<label class="field">${label}<input ${attrs}></label>`;
}

// 회원이 쓴 글은 서버가 영어로 번역해 '칸_tr' 로 함께 보낸다.
// 번역문을 크게, 원문을 작게 아래에 둔다 — 기계 번역이라 원문 확인이 필요하다.
export function trText(row, field) {
  const orig = row?.[field];
  const en = row?.[field + '_tr'];
  return { text: en || orig || '', orig: en ? orig : null };
}
// 반대로 — 원문을 크게, 영어 번역을 작게 (팝업·공지·게시판·홈 피드, 2026-11-16 사장님 지시)
export function origText(row, field) {
  const orig = row?.[field];
  const en = row?.[field + '_tr'];
  return { text: orig || en || '', orig: orig && en && en !== orig ? en : null };
}
export function origHtml(orig) {
  return orig ? `<div class="src">🌐 ${esc(orig)}</div>` : '';
}

// 동그란 얼굴 — 사진이 있으면 사진, 없으면 이름 첫 글자. 사진은 누르면 크게 (data-view-photo)
// 임원 배지 — 조직도 자리 이름 (부회장 1·고문 2 의 번호는 뺀다)
export const officerPill = (role) => (role
  ? ` <span class="pill officer">★ ${esc(t('role_' + role).replace(/\s*\d+$/, ''))}</span>` : '');

export function avatar(name, photo, cls = '') {
  return photo
    ? `<div class="avatar has-photo ${cls}" data-view-photo="${esc(photo)}"><img src="${esc(photo)}" alt="" loading="lazy"></div>`
    : `<div class="avatar ${cls}">${esc(String(name || '?').slice(0, 1))}</div>`;
}

// 사진 크게 보기 — 아무 데나 누르면 닫힌다.
// #modalRoot 가 아니라 body 에 따로 띄운다 (가입 신청서·수정 창 위에서 눌러도 창이 안 날아가게)
// list 를 주면(사진 묶음) ‹ › 나 옆으로 밀어 넘긴다
export function showPhoto(src, list = null) {
  const srcs = list?.length ? list : [src];
  let i = Math.max(0, srcs.indexOf(src)), x0 = null, swiped = false;
  const v = document.createElement('div');
  v.className = 'photo-view';
  const draw = () => {
    const n = srcs.length;
    v.innerHTML = `<img src="${esc(srcs[i])}" alt="">${n > 1 ? `
      <button type="button" class="pv-nav prev" data-step="-1" aria-label="Previous">‹</button>
      <button type="button" class="pv-nav next" data-step="1" aria-label="Next">›</button>
      <div class="pv-count">${i + 1} / ${n}</div>` : ''}`;
    v.querySelectorAll('[data-step]').forEach(b => b.onclick = (e) => { e.stopPropagation(); go(Number(b.dataset.step)); });
  };
  const go = (s) => { i = (i + s + srcs.length) % srcs.length; draw(); };
  v.onclick = () => { if (swiped) { swiped = false; return; } v.remove(); };
  if (srcs.length > 1) {
    v.ontouchstart = (e) => { x0 = e.touches[0].clientX; };
    v.ontouchend = (e) => {
      const dx = e.changedTouches[0].clientX - (x0 ?? e.changedTouches[0].clientX);
      x0 = null;
      if (Math.abs(dx) > 50) { swiped = true; setTimeout(() => { swiped = false; }, 400); go(dx < 0 ? 1 : -1); }
    };
  }
  draw();
  document.body.appendChild(v);
}

// 화면 어디서든 얼굴 사진을 누르면 크게 — 줄을 누른 것(수정 창 열기 등)으로 치지 않는다
// (node 테스트가 이 파일을 불러올 때는 document 가 없다)
if (typeof document !== 'undefined') document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-view-photo]');
  if (!a) return;
  e.stopPropagation();
  e.preventDefault();
  // 묶음(data-photo-set = 사진 주소 JSON 배열) 안의 사진이면 그 묶음을 넘겨 볼 수 있게
  let list = null;
  try { list = JSON.parse(a.closest('[data-photo-set]')?.dataset.photoSet || 'null'); } catch { /* 한 장 */ }
  showPhoto(a.dataset.viewPhoto, Array.isArray(list) ? list : null);
}, true);

// 서버가 돌려준 코드를 사람 말로
const ERRORS = {
  phone_taken: 'phoneTaken', bad_phone: 'badPhone', pin_4_digits: 'pin4',
  bad_current_pin: 'badCurrentPin', last_admin: 'lastAdmin', end_before_start: 'endBeforeStart',
  photo_too_big: 'photoTooBig', too_large: 'photoTooBig', title_required: 'required',
  body_required: 'required', name_required: 'required', admin_only: 'adminOnly',
  already_member: 'alreadyMember', already_requested: 'alreadyRequested', too_many_requests: 'tooManyRequests',
  bad_range: 'repeatBadRange', weekdays_required: 'repeatNoDays', no_dates: 'repeatNone',
  too_many_dates: 'repeatTooMany', no_device: 'pushNoDevice', bad_subscription: 'failed',
  photo_required: 'galleryNone', forbidden: 'adminOnly', owner_only: 'ownerOnly', bad_photo: 'photoBad', cannot_delete_owner: 'cannotDeleteOwner',
  bad_date: 'failed', bad_kind: 'failed', entries_required: 'resultNeedWinner', bad_place: 'failed', bad_member: 'failed',
  too_many_photos: 'failed', results_only: 'adminOnly', bad_birthday: 'birthdayBoth',
  video_too_big: 'videoTooBig', video_too_long: 'videoTooLong', bad_video: 'videoBad', video_required: 'galleryNone', poster_required: 'videoBad',
};
export const errText = (e) => t(ERRORS[e?.message] || 'failed');

// 폰 사진은 그대로 올리면 수 MB다. 캔버스로 긴 변 1280px·JPEG 품질 0.8로 줄여 보낸다.
export function pickPhoto(max = 1280) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

// 사진 여러 장 고르기 — 한 장씩 pickPhoto 와 같게 줄인다. limit 장까지만 (넘으면 앞에서부터)
function shrinkFile(file, max) {
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
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
// onProgress(n, total) — 고른 뒤 줄이는 동안 몇 장째인지 알려 준다 (0 이면 시작).
// 고르기 창을 닫으면(cancel) 빈 결과로 끝낸다 — 안 그러면 📷 버튼이 계속 잠긴다.
export function pickPhotos(limit = 10, max = 1280, onProgress) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    input.addEventListener('cancel', () => finish({ photos: [], cut: false, failed: 0 }));
    input.onchange = async () => {
      const files = [...(input.files || [])];
      const take = files.slice(0, limit);
      const out = [];
      onProgress?.(0, take.length);
      for (let i = 0; i < take.length; i++) {
        const d = await shrinkFile(take[i], max);
        if (d) out.push(d);
        onProgress?.(i + 1, take.length);
      }
      finish({ photos: out, cut: files.length > limit, failed: take.length - out.length });
    };
    input.click();
  });
}

// 얼굴 사진 고르기 + 맞추기 — 동그란 틀 안에서 끌어 옮기고, 두 손가락·막대로 키우고, 90° 돌린다.
// 틀 안 그대로 512×512 JPEG 로 돌려준다 (취소하면 null).
// 열려 있는 창(#modalRoot — 가입 신청서 등)을 덮어쓰지 않게 body 에 따로 띄운다.
export async function pickFacePhoto() {
  const src = await pickPhoto(1600);
  if (!src) return null;
  const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  if (!img) return null;

  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'crop-ov';
    ov.innerHTML = `
      <div class="crop-box">
        <h3>${esc(t('photoAdjust'))}</h3>
        <div class="crop-stage" data-stage><img alt="" draggable="false"><div class="crop-ring"></div></div>
        <div class="crop-tools">
          <span>－</span><input type="range" min="1" max="4" step="0.01" value="1" data-zoom aria-label="zoom"><span>＋</span>
          <button type="button" class="btn btn-sm" data-rot aria-label="${esc(t('photoRotate'))}">⟳</button>
        </div>
        <div class="hint" style="text-align:center">${esc(t('photoAdjustHint'))}</div>
        <div class="modal-actions">
          <button type="button" class="btn" data-cancel>${esc(t('cancel'))}</button>
          <button type="button" class="btn btn-primary" data-use>${esc(t('photoUse'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('[data-stage]');
    const im = stage.querySelector('img');
    const zoomEl = ov.querySelector('[data-zoom]');
    im.src = src;

    const W = img.naturalWidth, H = img.naturalHeight;
    let S = stage.clientWidth;          // 틀 한 변 (화면 px)
    let zoom = 1, rot = 0, x = 0, y = 0; // x,y = 틀 가운데에서 사진 가운데까지
    const turned = () => rot % 2 === 1;
    const k = () => S / Math.min(W, H) * zoom;   // 짧은 변이 틀에 꽉 차는 것이 1배
    const clamp = () => {
      const bw = (turned() ? H : W) * k(), bh = (turned() ? W : H) * k();
      x = Math.max(-(bw - S) / 2, Math.min((bw - S) / 2, x));
      y = Math.max(-(bh - S) / 2, Math.min((bh - S) / 2, y));
    };
    const draw = () => {
      clamp();
      im.style.width = `${W * k()}px`;
      im.style.height = `${H * k()}px`;
      im.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rot * 90}deg)`;
    };
    const setZoom = (z) => { zoom = Math.max(1, Math.min(4, z)); zoomEl.value = zoom; draw(); };
    draw();

    // 한 손가락 = 옮기기, 두 손가락 = 키우기
    const pts = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) { x += dx; y += dy; draw(); }
      else if (pinch) {
        const [a, b] = [...pts.values()];
        setZoom(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1));
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    zoomEl.oninput = () => setZoom(Number(zoomEl.value));
    ov.querySelector('[data-rot]').onclick = () => { rot = (rot + 1) % 4; x = y = 0; draw(); };

    const done = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('[data-cancel]').onclick = () => done(null);
    ov.querySelector('[data-use]').onclick = () => {
      const O = 512, r = O / S;
      const c = document.createElement('canvas');
      c.width = c.height = O;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, O, O);
      g.translate(O / 2 + x * r, O / 2 + y * r);
      g.rotate(rot * Math.PI / 2);
      g.drawImage(img, -W * k() * r / 2, -H * k() * r / 2, W * k() * r, H * k() * r);
      done(c.toDataURL('image/jpeg', 0.85));
    };
    // 화면을 돌리면 틀 크기가 바뀐다
    window.addEventListener('resize', function re() {
      if (!ov.isConnected) return window.removeEventListener('resize', re);
      const ns = stage.clientWidth;
      if (ns && ns !== S) { x *= ns / S; y *= ns / S; S = ns; draw(); }
    });
  });
}

// ---------- 생일 (월·일 두 칸) — 내 프로필과 회원 수정 창이 같이 쓴다 ----------
export function birthdayFields(bd) {
  const two = (n) => String(n).padStart(2, '0');
  return [
    { name: 'bmonth', label: t('birthMonth'), type: 'select', value: (bd || '').slice(0, 2),
      options: [{ value: '', label: '—' }, ...t('months').map((mo, k) => ({ value: two(k + 1), label: mo }))] },
    { name: 'bday', label: t('birthDay'), type: 'select', value: (bd || '').slice(3),
      options: [{ value: '', label: '—' }, ...Array.from({ length: 31 }, (_, k) => ({ value: two(k + 1), label: String(k + 1) }))] },
  ];
}
// 폼 값에서 꺼내 'MM-DD' / '' (지우기) / false (한 칸만 고름)
export function takeBirthday(v) {
  const { bmonth, bday } = v;
  delete v.bmonth; delete v.bday;
  if (!bmonth !== !bday) return false;
  return bmonth ? `${bmonth}-${bday}` : '';
}
// '03-05' → 'Mar 5'
export const fmtBirthday = (bd) => `${t('months')[Number(bd.slice(0, 2)) - 1].slice(0, 3)} ${Number(bd.slice(3))}`;
