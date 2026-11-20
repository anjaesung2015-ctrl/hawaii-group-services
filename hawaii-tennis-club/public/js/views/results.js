// 대회 성적 (Hall of Fame) — 월례대회·외부대회 입상 기록.
// 홈 피드의 성적 카드를 누르면 전체 목록(renderResults)의 그 대회로.
// 올리기·고치기 = 운영진 + 오너가 지정한 성적 담당 (서버가 다시 확인한다).
import { api, esc, toast, openModal, pickPhotos, today, errText } from '../ui.js';
import { t, fmtDate } from '../i18n.js';

const MAX_PHOTOS = 10;   // 서버(routes/results.js)와 같게
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '🎖' };
const placeName = (n) => t(`place${n}`);
const kindName = (k) => t(k === 'external' ? 'kindExternal' : 'kindMonthly');

// 사진 — 1장은 크게, 여러 장은 작은 정사각 격자(2·4장 2칸, 그 외 3칸). 누르면 크게 + 넘기기(data-photo-set)
function photoGrid(list) {
  if (!list.length) return '';
  const set = `data-photo-set="${esc(JSON.stringify(list))}"`;
  if (list.length === 1) {
    return `<div ${set}><img class="notice-photo" src="${esc(list[0])}" data-view-photo="${esc(list[0])}" alt="" loading="lazy"></div>`;
  }
  const cols = (list.length === 2 || list.length === 4) ? 'c2' : 'c3';
  return `<div class="post-grid ${cols}" ${set}>${list.map(src =>
    `<img src="${esc(src)}" data-view-photo="${esc(src)}" alt="" loading="lazy">`).join('')}</div>`;
}

export const canResults = (me) => !!me && (me.role === 'admin' || !!me.is_owner || !!me.results_manager);

// 같은 순위끼리 묶어 이름을 잇는다 — 복식은 '🥇 A · B'
function byPlace(entries) {
  const g = new Map();
  for (const e of entries) { if (!g.has(e.place)) g.set(e.place, []); g.get(e.place).push(e); }
  return [...g.entries()].sort((a, b) => a[0] - b[0]);
}

// ---------- 전체 목록 ----------
export async function renderResults(el, state) {
  const kind = state.resultsKind || 'all';
  const year = state.resultsYear || '';
  const q = new URLSearchParams();
  if (kind !== 'all') q.set('kind', kind);
  if (year) q.set('year', year);
  const { rows, years } = await api(`/results?${q}`);
  const can = canResults(state.me);
  const again = () => renderResults(el, state);

  el.innerHTML = `
    <div class="section-head" style="margin-top:2px"><h2>🏆 ${esc(t('resultsTitle'))}</h2></div>
    <div class="seg">
      ${['all', 'monthly', 'external'].map(k => `<button data-kind="${k}" class="${kind === k ? 'on' : ''}">${esc(k === 'all' ? t('filterAll') : kindName(k))}</button>`).join('')}
    </div>
    ${years.length > 1 ? `<label class="field" style="margin-top:-4px"><select data-year>
      <option value="">${esc(t('allYears'))}</option>
      ${years.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}
    </select></label>` : ''}
    ${can ? `<button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-add>+ ${esc(t('resultAdd'))}</button>` : ''}
    ${rows.length ? rows.map(r => card(r, can)).join('') : `<div class="empty">${esc(t('resultsEmpty'))}</div>`}`;

  el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { state.resultsKind = b.dataset.kind; again(); });
  const ys = el.querySelector('[data-year]');
  if (ys) ys.onchange = () => { state.resultsYear = ys.value; again(); };
  el.querySelector('[data-add]')?.addEventListener('click', () => resultForm(null, again));
  el.querySelectorAll('[data-edit-result]').forEach(b => b.onclick = () =>
    resultForm(rows.find(r => String(r.id) === b.dataset.editResult), again));

  // 홈 카드에서 눌러 들어왔으면 그 대회로 내려간다
  if (state.focusResult) {
    const c = el.querySelector(`[data-result="${state.focusResult}"]`);
    state.focusResult = null;
    if (c) setTimeout(() => { c.scrollIntoView({ block: 'start', behavior: 'smooth' }); c.classList.add('flash'); }, 60);
  }
}

function card(r, can) {
  return `
    <div class="card result-card${r.kind === 'external' ? ' ext' : ''}" data-result="${r.id}">
      <div class="card-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <h3>${esc(r.title)}</h3>
          <div class="meta">${esc(fmtDate(r.held_on))} · <span class="pill ${r.kind === 'external' ? 'coach' : 'gold'}">${esc(kindName(r.kind))}</span>${r.division ? ` · ${esc(r.division)}` : ''}</div>
        </div>
        ${can ? `<button class="btn btn-sm" data-edit-result="${r.id}">✏️</button>` : ''}
      </div>
      <div class="podium">
        ${byPlace(r.entries).map(([place, list]) => `
          <div class="pl pl-${place}"><span class="medal">${MEDAL[place]}</span>
            <span class="pl-name">${esc(placeName(place))}</span>
            <b>${esc(list.map(e => e.name).join(' · '))}</b></div>`).join('')}
      </div>
      ${photoGrid(r.photos.map(p => p.photo))}
      ${r.note ? `<div class="memo">${esc(r.note)}</div>` : ''}
    </div>`;
}

// ---------- 올리기·고치기 ----------
export async function resultForm(r, refresh) {
  let members = [];
  try { members = (await api('/members')).filter(m => m.status !== 'dormant' || (r?.entries || []).some(e => e.member_id === m.id)); }
  catch (e) { return toast(errText(e), true); }
  members.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const isNew = !r;
  const keep = [...(r?.photos || [])];   // 남겨 둘 기존 사진
  const removed = [];
  let added = [];

  const entryRow = (e = {}) => {
    const who = e.member_id ? String(e.member_id) : (e.name ? 'other' : '');
    return `<div class="rentry">
      <select data-place aria-label="${esc(t('resultPlace'))}">
        ${[1, 2, 3, 4].map(n => `<option value="${n}"${(e.place || 1) === n ? ' selected' : ''}>${MEDAL[n]} ${esc(t(`placeShort${n}`))}</option>`).join('')}
      </select>
      <select data-who aria-label="${esc(t('name'))}">
        <option value="">${esc(t('resultPickMember'))}</option>
        ${members.map(m => `<option value="${m.id}"${who === String(m.id) ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
        <option value="other"${who === 'other' ? ' selected' : ''}>${esc(t('resultNotMember'))}</option>
      </select>
      <input data-name placeholder="${esc(t('name'))}" maxlength="60" value="${esc(who === 'other' ? e.name : '')}"${who === 'other' ? '' : ' hidden'}>
      <button type="button" class="btn btn-sm" data-rm-entry aria-label="remove">✕</button>
    </div>`;
  };

  const m = openModal({
    title: isNew ? t('resultNew') : t('resultEdit'),
    fields: [
      { name: 'title', label: t('resultName'), value: r?.title || '', maxlength: 120, placeholder: t('resultNameHint') },
      { name: 'held_on', label: t('date'), type: 'date', value: r?.held_on || today() },
      { name: 'kind', label: t('kind'), type: 'select', value: r?.kind || 'monthly',
        options: [{ value: 'monthly', label: t('kindMonthly') }, { value: 'external', label: t('kindExternal') }] },
      { name: 'division', label: t('resultDivision'), value: r?.division || '', maxlength: 60, placeholder: t('resultDivisionHint') },
    ],
    extra: `
      <div class="field"><span>${esc(t('resultWinners'))}</span>
        <div data-entries>${(r?.entries?.length ? r.entries : [{ place: 1 }, { place: 2 }]).map(entryRow).join('')}</div>
        <button type="button" class="btn btn-sm" style="width:100%;margin-top:6px" data-add-entry>+ ${esc(t('resultAddWinner'))}</button>
        <div class="hint">${esc(t('resultWinnersHint'))}</div>
      </div>
      <label class="field"><span>${esc(t('memo'))}</span><textarea name="note" data-note>${esc(r?.note || '')}</textarea></label>
      <div class="field"><span>${esc(t('resultPhotos', { n: MAX_PHOTOS }))}</span>
        <div class="gpreview" data-photos></div>
        <button type="button" class="btn btn-sm" data-pick>📷 ${esc(t('photoPick'))}</button>
      </div>`,
    onDelete: isNew ? null : async () => {
      await api(`/results/${r.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v, form) => {
      if (!v.title) return t('required');
      const entries = [...form.querySelectorAll('.rentry')].map(row => {
        const place = Number(row.querySelector('[data-place]').value);
        const who = row.querySelector('[data-who]').value;
        if (who === 'other') return { place, name: row.querySelector('[data-name]').value.trim() };
        return who ? { place, member_id: Number(who) } : null;
      }).filter(e => e && (e.member_id || e.name));
      if (!entries.length) return t('resultNeedWinner');
      if (ready) await ready;   // 사진 줄이는 중이면 끝날 때까지 기다린다
      const body = { ...v, note: form.querySelector('[data-note]').value.trim(), entries, photos: added };
      if (isNew) await api('/results', { method: 'POST', body });
      else await api(`/results/${r.id}`, { method: 'PATCH', body: { ...body, remove_photos: removed } });
      toast(t('saved'));
      refresh();
    },
  });

  const box = m.form.querySelector('[data-entries]');
  box.addEventListener('change', (e) => {
    const s = e.target.closest('[data-who]');
    if (!s) return;
    const name = s.parentElement.querySelector('[data-name]');
    name.hidden = s.value !== 'other';
    if (!name.hidden) name.focus();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-entry]');
    if (b) b.parentElement.remove();
  });
  m.form.querySelector('[data-add-entry]').onclick = () => {
    const last = [...box.querySelectorAll('[data-place]')].pop();
    box.insertAdjacentHTML('beforeend', entryRow({ place: last ? Number(last.value) : 1 }));
  };

  let ready = null;   // 사진 줄이는 중이면 저장이 기다린다
  const ph = m.form.querySelector('[data-photos]');
  const pick = m.form.querySelector('[data-pick]');
  const drawPhotos = () => {
    ph.innerHTML = [
      ...keep.map(p => `<div class="gp"><img src="${esc(p.photo)}" alt=""><button type="button" data-rm-old="${p.id}" aria-label="remove">✕</button></div>`),
      ...added.map((src, k) => `<div class="gp"><img src="${src}" alt=""><button type="button" data-rm-new="${k}" aria-label="remove">✕</button></div>`),
    ].join('');
    pick.hidden = keep.length + added.length >= MAX_PHOTOS;
  };
  ph.onclick = (e) => {
    const o = e.target.closest('[data-rm-old]');
    if (o) { const k = keep.findIndex(p => String(p.id) === o.dataset.rmOld); removed.push(keep[k].id); keep.splice(k, 1); }
    const n = e.target.closest('[data-rm-new]');
    if (n) added.splice(Number(n.dataset.rmNew), 1);
    drawPhotos();
  };
  pick.onclick = async () => {
    const room = MAX_PHOTOS - keep.length - added.length;
    if (room <= 0) return;
    pick.disabled = true;
    const label = pick.textContent;
    let release = null;
    const { photos, cut, failed } = await pickPhotos(room, 1600, (n, total) => {
      if (n === 0) ready = new Promise(r => { release = r; });
      pick.textContent = `⏳ ${n}/${total}`;
    });
    pick.disabled = false;
    pick.textContent = label;
    if (cut) toast(t('resultPhotos', { n: MAX_PHOTOS }), true);
    if (failed) toast(t('photoFailed', { n: failed }), true);
    added = [...added, ...photos].slice(0, MAX_PHOTOS - keep.length);
    drawPhotos();
    ready = null;
    release?.();
  };
  drawPhotos();
}
