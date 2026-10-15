// 일정 — 관리자가 등록하고 회원은 참석/불참/미정을 고른다.
import { api, esc, toast, openModal, today, trText, origHtml, $$ } from '../ui.js';
import { t, fmtDate, kindLabel } from '../i18n.js';
import { weekdaysFromText, nextDateFor } from '../weekdays.js';

const KINDS = ['regular', 'event', 'tournament'];

export async function renderSchedule(el, state) {
  const past = state.schedulePast === true;
  const list = await api(`/events?lang=en${past ? '&past=1' : ''}`);

  el.innerHTML = `
    <div class="seg">
      <button data-seg="up" class="${past ? '' : 'on'}">${esc(t('upcomingTab'))}</button>
      <button data-seg="past" class="${past ? 'on' : ''}">${esc(t('pastTab'))}</button>
    </div>
    ${state.me.role === 'admin' ? `<div class="fab-row"><button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newEvent'))}</button></div>` : ''}
    <div data-list>${list.length ? list.map(e => eventCard(e, { rsvp: !past })).join('') : `<div class="empty">${esc(t('noEvents'))}</div>`}</div>`;

  $$('[data-seg]', el).forEach(b => b.onclick = () => {
    state.schedulePast = b.dataset.seg === 'past';
    renderSchedule(el, state);
  });
  const addBtn = el.querySelector('[data-new]');
  if (addBtn) addBtn.onclick = () => eventForm(null, state, () => renderSchedule(el, state));
  bindEventCards(el, state, () => renderSchedule(el, state));
}

// 일정 카드 한 장 — 홈 화면도 이걸 쓴다
export function eventCard(e, { rsvp = true } = {}) {
  const [Y, M, D] = e.event_date.split('-').map(Number);
  const d = D;
  const dowIdx = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  const isToday = e.event_date === today();
  const kindPill = e.kind === 'tournament' ? 'gold' : (e.kind === 'event' ? 'solid' : '');
  return `
    <div class="card tap" data-event="${e.id}">
      <div class="card-row">
        <div class="date-chip${isToday ? ' today' : ''}">
          <b>${d}</b><span>${esc(t('dow')[dowIdx])}</span>
        </div>
        <div style="flex:1;min-width:0">
          <h3>${esc(trText(e, 'title').text)}</h3>
          <div class="meta">${e.start_time}–${e.end_time} · ${esc(t('courtsN', { n: e.courts }))}</div>
        </div>
        <span class="pill ${kindPill}">${esc(kindLabel(e.kind))}</span>
      </div>
      ${e.memo ? `<div class="memo">${esc(trText(e, 'memo').text)}</div>${origHtml(trText(e, 'memo').orig)}` : ''}
      <div class="counts">
        <span>${esc(t('yes'))} <b>${e.counts.yes}</b></span>
        <span>${esc(t('maybe'))} <b>${e.counts.maybe}</b></span>
        <span>${esc(t('no'))} <b>${e.counts.no}</b></span>
      </div>
      ${rsvp ? rsvpRow(e) : ''}
    </div>`;
}

const rsvpRow = (e) => `
  <div class="rsvp" data-rsvp="${e.id}">
    ${['yes', 'maybe', 'no'].map(a =>
      `<button class="${a}${e.my_answer === a ? ' on' : ''}" data-answer="${a}">${esc(t(a))}</button>`).join('')}
  </div>`;

// 카드 탭 → 상세, 참석 버튼 탭 → 바로 저장
export function bindEventCards(el, state, refresh) {
  $$('[data-rsvp] button', el).forEach(b => b.onclick = async (ev) => {
    ev.stopPropagation();
    const id = b.closest('[data-rsvp]').dataset.rsvp;
    try {
      await api(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: b.dataset.answer } });
      toast(t('saved'));
      refresh();
    } catch (e) { toast(t('failed'), true); }
  });
  $$('[data-event]', el).forEach(c => c.onclick = () => openEvent(c.dataset.event, state, refresh));
}

// 상세 — 참석 명단까지
export async function openEvent(id, state, refresh) {
  const e = await api(`/events/${id}?lang=en`);
  const group = (key) => {
    const people = e.roster[key];
    if (!people.length) return '';
    return `<div class="roster-group"><div>${esc(t(key))} · ${people.length}</div>
      <div class="names">${people.map(p => `<span class="name-chip">${esc(p.name)}</span>`).join('')}</div></div>`;
  };
  const any = e.roster.yes.length + e.roster.maybe.length + e.roster.no.length;

  const m = openModal({
    title: trText(e, 'title').text,
    fields: [],
    extra: `
      <div class="meta" style="margin:-6px 2px 10px">
        ${esc(fmtDate(e.event_date))} · ${e.start_time}–${e.end_time} · ${esc(t('courtsN', { n: e.courts }))}
        · <span class="pill ${e.kind === 'tournament' ? 'gold' : ''}">${esc(kindLabel(e.kind))}</span>
      </div>
      ${e.memo ? `<div class="memo" style="margin-bottom:8px">${esc(trText(e, 'memo').text)}</div>${origHtml(trText(e, 'memo').orig)}` : ''}
      ${rsvpRow(e)}
      <div class="roster">${any ? ['yes', 'maybe', 'no'].map(group).join('') : `<div class="empty">${esc(t('noAnswerYet'))}</div>`}</div>
      ${state.me.role === 'admin' ? `<button type="button" class="btn btn-sm" style="margin-top:14px" data-edit>${esc(t('editEvent'))}</button>` : ''}`,
    saveLabel: t('close'),
    onSave: () => { m.close(); refresh(); },
  });

  $$('[data-rsvp] button', m.form).forEach(b => b.onclick = async () => {
    try {
      await api(`/events/${id}/rsvp`, { method: 'PUT', body: { answer: b.dataset.answer } });
      m.close();
      toast(t('saved'));
      refresh();
    } catch (err) { toast(t('failed'), true); }
  });
  const edit = m.form.querySelector('[data-edit]');
  if (edit) edit.onclick = () => { m.close(); eventForm(e, state, refresh); };
}

// 반복 등록 칸 — 새로 만들 때만 보인다 (요일 고르기 + 기간 + 몇 개 만들어질지 미리보기)
function repeatBlock() {
  const days = t('dow').map((d, i) =>
    `<button type="button" class="rep-day" data-day="${i}">${esc(d)}</button>`).join('');
  return `
    <div class="rep">
      <label class="rep-head">
        <input type="checkbox" data-rep-on>
        <span>${esc(t('repeat'))}</span>
      </label>
      <div data-rep-body hidden>
        <div class="rep-days">${days}</div>
        <div class="field-row" style="margin-top:8px">
          <label class="field"><span>${esc(t('repeatFrom'))}</span><input type="date" data-rep-from></label>
          <label class="field"><span>${esc(t('repeatTo'))}</span><input type="date" data-rep-to></label>
        </div>
        <div class="hint" data-rep-info></div>
      </div>
      <div class="hint auto-note" data-rep-auto></div>
    </div>`;
}

// 고른 요일·기간으로 만들어질 날짜를 화면에서 미리 센다 (서버와 같은 규칙)
function repeatDates(from, to, days) {
  if (!from || !to || to < from || !days.length) return [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  const out = [];
  for (let s = Date.UTC(fy, fm - 1, fd); s <= end && out.length <= 400; s += 86400000) {
    const d = new Date(s);
    if (days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// 등록 · 수정 (관리자)
export function eventForm(e, state, refresh) {
  const isNew = !e;
  const picked = new Set();
  const m = openModal({
    title: isNew ? t('newEvent') : t('editEvent'),
    fields: [
      { name: 'title', label: t('title'), value: e?.title || '', placeholder: t('title') },
      { name: 'kind', label: t('kind'), type: 'select', value: e?.kind || 'regular',
        options: KINDS.map(k => ({ value: k, label: kindLabel(k) })) },
      { name: 'event_date', label: t('date'), type: 'date', value: e?.event_date || today() },
      { name: 'start_time', label: t('startTime'), type: 'time', value: e?.start_time || '19:00' },
      { name: 'end_time', label: t('endTime'), type: 'time', value: e?.end_time || '21:00' },
      { name: 'courts', label: t('courts'), type: 'number', value: e?.courts ?? 2, min: 1, max: 20 },
      { name: 'memo', label: t('memo'), type: 'textarea', value: e?.memo || '' },
    ],
    extra: isNew ? repeatBlock() : '',
    onDelete: isNew ? null : async () => {
      await api(`/events/${e.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      refresh();
    },
    onSave: async (v) => {
      if (!v.title) return t('required');
      const body = { ...v, courts: Number(v.courts) || 1 };

      // 반복을 켰으면 그 기간의 날짜를 한 번에 만든다 (날짜 칸은 쓰지 않는다)
      const on = m.form.querySelector('[data-rep-on]')?.checked;
      if (isNew && on) {
        const days = [...picked];
        if (!days.length) return t('repeatNoDays');
        const from = m.form.querySelector('[data-rep-from]').value;
        const to = m.form.querySelector('[data-rep-to]').value;
        if (!from || !to || to < from) return t('repeatBadRange');
        const r = await api('/events/bulk', { method: 'POST', body: { ...body, from, to, weekdays: days } });
        toast(r.skipped ? t('bulkDoneSkip', { n: r.count, s: r.skipped }) : t('bulkDone', { n: r.count }));
        refresh();
        return;
      }

      if (isNew) await api('/events', { method: 'POST', body });
      else await api(`/events/${e.id}`, { method: 'PATCH', body });
      toast(t('saved'));
      refresh();
    },
  });

  if (!isNew) return;

  // ---- 반복 칸 동작 ----
  const form = m.form;
  const onBox = form.querySelector('[data-rep-on]');
  const body = form.querySelector('[data-rep-body]');
  const fromEl = form.querySelector('[data-rep-from]');
  const toEl = form.querySelector('[data-rep-to]');
  const info = form.querySelector('[data-rep-info]');
  const dateField = form.querySelector('[name="event_date"]');

  const titleEl = form.querySelector('[name="title"]');
  const autoNote = form.querySelector('[data-rep-auto]');
  let touched = false;                 // 사람이 직접 요일을 건드렸으면 더 이상 자동으로 바꾸지 않는다

  const update = () => {
    const days = [...picked];
    const list = repeatDates(fromEl.value, toEl.value, days);
    info.textContent = days.length
      ? (list.length ? t('repeatPreview', { n: list.length }) : t('repeatNone'))
      : t('repeatNoDays');
    // 반복을 켜면 날짜 한 칸은 쓰지 않으므로 흐리게 둔다
    if (dateField) dateField.disabled = onBox.checked;
  };

  const paint = () => {
    form.querySelectorAll('[data-day]').forEach(b => {
      b.classList.toggle('on', picked.has(Number(b.dataset.day)));
    });
  };

  // 제목에 '수요일'·'화목'·'лхагва' 같은 말이 있으면 반복 요일을 알아서 집어준다
  const autoFromTitle = () => {
    if (touched) return;
    const days = weekdaysFromText(titleEl.value);
    if (!days.length) {
      if (autoNote) autoNote.textContent = '';
      return;
    }
    picked.clear();
    for (const d of days) picked.add(d);
    paint();

    if (!onBox.checked) {            // 반복을 자동으로 켜 준다
      onBox.checked = true;
      body.hidden = false;
    }
    if (!fromEl.value || !toEl.value) {
      const start = nextDateFor(days[0], dateField?.value || today());
      fromEl.value = start;
      const [y, mo, d] = start.split('-').map(Number);
      toEl.value = new Date(Date.UTC(y, mo - 1, d + 42)).toISOString().slice(0, 10);   // 6주
    }
    // 반복을 끄더라도 날짜가 맞게 바뀌어 있도록
    if (dateField && days.length === 1) dateField.value = nextDateFor(days[0], today());
    if (autoNote) autoNote.textContent = t('repeatAuto', { days: days.map(d => t('dow')[d]).join('·') });
    update();
  };

  titleEl.oninput = autoFromTitle;
  autoFromTitle();                    // 제목이 이미 적혀 있는 경우(복사해 넣었을 때)

  onBox.onchange = () => {
    body.hidden = !onBox.checked;
    if (onBox.checked && !fromEl.value) {
      fromEl.value = dateField?.value || today();
      const [y, mo, d] = fromEl.value.split('-').map(Number);
      toEl.value = new Date(Date.UTC(y, mo - 1, d + 42)).toISOString().slice(0, 10);   // 기본 6주
      // 처음 켤 때는 고른 날짜의 요일을 기본으로 집어준다
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      picked.add(dow);
      form.querySelector(`[data-day="${dow}"]`)?.classList.add('on');
    }
    update();
  };

  form.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    touched = true;                   // 직접 고르기 시작했으면 제목을 더 이상 따라가지 않는다
    if (autoNote) autoNote.textContent = '';
    const d = Number(b.dataset.day);
    if (picked.has(d)) { picked.delete(d); b.classList.remove('on'); }
    else { picked.add(d); b.classList.add('on'); }
    update();
  });
  fromEl.oninput = update;
  toEl.oninput = update;
}
