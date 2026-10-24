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
export function origHtml(orig) {
  return orig ? `<div class="src">🌐 ${esc(orig)}</div>` : '';
}

// 동그란 얼굴 — 사진이 있으면 사진, 없으면 이름 첫 글자. 사진은 누르면 크게 (data-view-photo)
export function avatar(name, photo, cls = '') {
  return photo
    ? `<div class="avatar has-photo ${cls}" data-view-photo="${esc(photo)}"><img src="${esc(photo)}" alt="" loading="lazy"></div>`
    : `<div class="avatar ${cls}">${esc(String(name || '?').slice(0, 1))}</div>`;
}

// 사진 크게 보기 — 아무 데나 누르면 닫힌다
export function showPhoto(src) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `<div class="photo-view"><img src="${esc(src)}" alt=""></div>`;
  root.firstElementChild.onclick = () => { root.innerHTML = ''; };
}

// 화면 어디서든 얼굴 사진을 누르면 크게 — 줄을 누른 것(수정 창 열기 등)으로 치지 않는다
// (node 테스트가 이 파일을 불러올 때는 document 가 없다)
if (typeof document !== 'undefined') document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-view-photo]');
  if (!a) return;
  e.stopPropagation();
  e.preventDefault();
  showPhoto(a.dataset.viewPhoto);
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
  owner_only: 'ownerOnly', bad_photo: 'photoBad', cannot_delete_owner: 'cannotDeleteOwner',
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
