// Elite 탭 — 오너·선수반 코치(둘 다 동호인 계정). 위쪽 칸: 선수 · 일정 · 출석 · 수강료 · 공지
import { api, esc, toast, openModal, errText, pickFacePhoto, pickPhoto, avatar, today, thisMonth, shiftMonth, $$ } from '../ui.js';
import { t, levelLabel, fmtDate, fmtMoney, fmtMonth, methodLabel } from '../i18n.js';
import { sessionCard, noticeCard, photoSrc } from './elite-me.js';

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
const SECTIONS = ['players', 'schedule', 'attendance', 'fees', 'notices'];

export async function renderElite(el, state) {
  const sec = SECTIONS.includes(state.eliteSec) ? state.eliteSec : 'players';
  el.innerHTML = `
    <div class="seg elite-seg">${SECTIONS.map(s => `<button type="button" data-sec="${s}" class="${s === sec ? 'on' : ''}">${esc(t('elite_' + s))}</button>`).join('')}</div>
    <div data-body><div class="empty">${esc(t('loading'))}</div></div>`;
  $$('[data-sec]', el).forEach(b => b.onclick = () => { state.eliteSec = b.dataset.sec; renderElite(el, state); });
  const body = el.querySelector('[data-body]');
  const again = () => renderElite(el, state);
  const staff = await api('/elite/staff');
  await ({ players, schedule, attendance, fees, notices })[sec](body, state, staff, again);
}

// ---------- 선수 ----------
async function players(body, state, staff, again) {
  const [list, join] = await Promise.all([
    api('/elite/players'),
    // 선수반 가입 신청은 오너만 보고 승인한다
    state.me.is_owner ? api('/join?program=elite').catch(() => ({ count: 0, rows: [] })) : Promise.resolve({ count: 0, rows: [] }),
  ]);
  const cur = state.settings.currency;
  const coachName = (id) => staff.find(s => s.id === id)?.name || '';
  body.innerHTML = `
    ${joinBlock(join)}
    <div class="fab-row"><button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('elitePlayerNew'))}</button></div>
    <div class="card">${list.length ? list.map(p => `
      <div class="member-row" data-player="${p.id}" style="cursor:pointer">
        ${avatar(p.name, p.photo, p.status === 'dormant' ? 'dormant' : '')}
        <div class="who"><b>${esc(p.name)}${p.status === 'dormant' ? ` <span class="pill grey">${esc(t('stDormant'))}</span>` : ''}</b>
          <small>${esc([p.birth_year, levelLabel(p.level), coachName(p.assigned_coach_id), p.parent_phone && `☎ ${p.parent_phone}`].filter(Boolean).join(' · '))}</small></div>
        <span class="pill grey">${fmtMoney(p.elite_fee || state.settings.elite_fee)}${cur}</span>
      </div>`).join('') : `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}</div>
    ${state.me.is_owner ? `
      <div class="section-head"><h2>${esc(t('eliteCoaches'))}</h2></div>
      <div class="card">${staff.map(s => `
        <div class="member-row">${avatar(s.name, s.photo)}
          <div class="who"><b>${esc(s.name)}</b><small>${esc(s.is_owner ? t('roleOwner') : t('eliteCoach'))}</small></div>
          ${s.is_owner ? '' : `<button class="btn btn-sm btn-danger" data-uncoach="${s.id}">${esc(t('eliteCoachRemove'))}</button>`}
        </div>`).join('')}</div>
      <button class="btn" style="width:100%;margin-top:8px" data-addcoach>+ ${esc(t('eliteCoachAdd'))}</button>` : ''}`;

  body.querySelector('[data-new]').onclick = () => playerForm(null, state, staff, again);
  $$('[data-approve]', body).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api(`/join/${b.dataset.approve}/approve`, { method: 'POST' });
      toast(t('joinApproved', { name: r.name }));
    } catch (e) { toast(errText(e), true); }
    again();
  });
  $$('[data-reject]', body).forEach(b => b.onclick = async () => {
    // 실수로 눌리지 않게 두 번 눌러야 거절된다 (Members 탭과 같게)
    if (!b.classList.contains('ask')) {
      b.classList.add('ask');
      b.textContent = t('confirmDelete');
      setTimeout(() => { if (b.isConnected) { b.classList.remove('ask'); b.textContent = t('joinReject'); } }, 3000);
      return;
    }
    await api(`/join/${b.dataset.reject}/reject`, { method: 'POST' }).catch(() => {});
    toast(t('joinRejected'));
    again();
  });
  $$('[data-player]', body).forEach(r => r.onclick = () => playerForm(list.find(p => String(p.id) === r.dataset.player), state, staff, again));
  $$('[data-uncoach]', body).forEach(b => b.onclick = async () => {
    if (!confirm(t('eliteCoachRemoveAsk'))) return;
    try { await api(`/elite/coaches/${b.dataset.uncoach}`, { method: 'PUT', body: { on: false } }); }
    catch (e) { return toast(errText(e), true); }
    toast(t('saved')); again();
  });
  const add = body.querySelector('[data-addcoach]');
  if (add) add.onclick = async () => {
    const members = (await api('/members')).filter(m => m.status !== 'dormant' && !m.is_owner && !staff.some(s => s.id === m.id));
    if (!members.length) return toast(t('chatNoMembers'));
    openModal({
      title: t('eliteCoachAdd'),
      fields: [{ name: 'id', label: t('name'), type: 'select', value: members[0].id,
                 options: members.map(m => ({ value: m.id, label: m.name })) }],
      extra: `<div class="hint">${esc(t('eliteCoachHint'))}</div>`,
      onSave: async (v) => {
        if (!v.id) return t('required');
        await api(`/elite/coaches/${v.id}`, { method: 'PUT', body: { on: true } });
        toast(t('saved')); again();
      },
    });
  };
}

function playerForm(p, state, staff, again) {
  const isNew = !p;
  const m = openModal({
    title: isNew ? t('elitePlayerNew') : t('elitePlayerEdit'),
    fields: [
      { name: 'name', label: t('name'), value: p?.name || '' },
      { name: 'phone', label: t('elitePhone'), type: 'tel', inputmode: 'numeric', maxlength: 15, value: p?.phone || '', placeholder: '99112233' },
      ...(isNew ? [{ name: 'pin', label: t('pin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '', placeholder: '1234' }] : []),
      { name: 'birth_year', label: t('eliteBirthYear'), type: 'number', value: p?.birth_year ?? '', min: 1940, max: 2030 },
      { name: 'level', label: t('level'), type: 'select', value: p?.level || 'intermediate', options: LEVELS.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'assigned_coach_id', label: t('eliteAssignedCoach'), type: 'select', value: p?.assigned_coach_id ?? '',
        options: [{ value: '', label: '—' }, ...staff.map(s => ({ value: s.id, label: s.name }))] },
      { name: 'parent_name', label: t('eliteParentName'), value: p?.parent_name || '' },
      { name: 'parent_phone', label: t('eliteParentPhone'), type: 'tel', inputmode: 'numeric', maxlength: 15, value: p?.parent_phone || '' },
      { name: 'elite_fee', label: `${t('eliteMonthly')} (${state.settings.currency}) — ${t('eliteFeeBlank', { fee: fmtMoney(state.settings.elite_fee) })}`,
        type: 'number', value: p?.elite_fee ?? '', min: 0 },
      ...(isNew ? [] : [{ name: 'status', label: t('status'), type: 'select', value: p.status,
        options: [{ value: 'active', label: t('stActive') }, { value: 'dormant', label: t('stDormant') }] }]),
      { name: 'memo', label: t('memo'), value: p?.memo || '' },
    ],
    extra: isNew ? `<div class="hint">${esc(t('elitePinHint'))}</div>`
      : `<div class="photo-edit">${avatar(p.name, p.photo, 'photo-preview')}<button type="button" class="btn btn-sm" data-photo>📷 ${esc(t('photoChoose'))}</button></div>
         <button type="button" class="btn btn-sm" style="width:100%;margin:4px 0 8px" data-pin>${esc(t('resetPin'))}</button>`,
    onDelete: isNew ? null : async () => { await api(`/elite/players/${p.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); },
    onSave: async (v) => {
      if (!v.name) return t('required');
      if (isNew) {
        const r = await api('/elite/players', { method: 'POST', body: v });
        toast(t('firstPin', { pin: r.first_pin }));
      } else {
        await api(`/elite/players/${p.id}`, { method: 'PATCH', body: v });
        toast(t('saved'));
      }
      again();
    },
  });
  const photo = m.form.querySelector('[data-photo]');
  if (photo) photo.onclick = async () => {
    const data = await pickFacePhoto();
    if (!data) return;
    try { await api(`/elite/players/${p.id}/photo`, { method: 'PUT', body: { photo_data: data } }); }
    catch (e) { m.err.textContent = errText(e); return; }
    m.close(); toast(t('saved')); again();
  };
  const pin = m.form.querySelector('[data-pin]');
  if (pin) pin.onclick = () => {
    m.close();
    openModal({
      title: `${p.name} · ${t('resetPin')}`,
      fields: [{ name: 'pin', label: t('newPin'), type: 'tel', inputmode: 'numeric', maxlength: 4, value: '' }],
      onSave: async (v) => {
        if (!/^\d{4}$/.test(v.pin)) return t('pin4');
        await api(`/elite/players/${p.id}/pin`, { method: 'POST', body: { pin: v.pin } });
        toast(t('pinChanged'));
      },
    });
  };
}

// ---------- 일정 ----------
async function schedule(body, state, staff, again) {
  const rows = await api('/elite/sessions');
  body.innerHTML = `
    <div class="fab-row"><button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('eliteSessionNew'))}</button></div>
    ${rows.length ? rows.map(s => sessionCard(s, `<button class="btn btn-sm" data-edit="${s.id}" aria-label="${esc(t('edit'))}">✏️</button>`)).join('')
      : `<div class="empty">${esc(t('noTraining'))}</div>`}`;
  body.querySelector('[data-new]').onclick = () => sessionForm(null, staff, again);
  $$('[data-edit]', body).forEach(b => b.onclick = () => sessionForm(rows.find(s => String(s.id) === b.dataset.edit), staff, again));
}

// 반복 등록 칸 — 동호인 일정(schedule.js)과 같은 모양(.rep)
function repeatBlock() {
  const days = t('dow').map((d, i) => `<button type="button" class="rep-day" data-day="${i}">${esc(d)}</button>`).join('');
  return `
    <div class="rep">
      <label class="rep-head"><input type="checkbox" data-rep-on><span>${esc(t('repeat'))}</span></label>
      <div data-rep-body hidden>
        <div class="rep-days">${days}</div>
        <div class="field-row" style="margin-top:8px">
          <label class="field"><span>${esc(t('repeatFrom'))}</span><input type="date" data-rep-from></label>
          <label class="field"><span>${esc(t('repeatTo'))}</span><input type="date" data-rep-to></label>
        </div>
      </div>
    </div>`;
}

const plusDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function sessionForm(s, staff, again) {
  const isNew = !s;
  const picked = new Set();
  const m = openModal({
    title: isNew ? t('eliteSessionNew') : t('eliteSessionEdit'),
    fields: [
      { name: 'title', label: t('title'), value: s?.title || 'Elite training' },
      { name: 'session_date', label: t('date'), type: 'date', value: s?.session_date || today() },
      { name: 'start_time', label: t('startTime'), type: 'time', value: s?.start_time || '16:00' },
      { name: 'end_time', label: t('endTime'), type: 'time', value: s?.end_time || '18:00' },
      { name: 'court', label: t('court'), value: s?.court || '' },
      { name: 'coach_id', label: t('coach'), type: 'select', value: s?.coach_id ?? '',
        options: [{ value: '', label: '—' }, ...staff.map(x => ({ value: x.id, label: x.name }))] },
      { name: 'memo', label: t('memo'), type: 'textarea', value: s?.memo || '' },
    ],
    extra: isNew ? repeatBlock() : '',
    onDelete: isNew ? null : async () => { await api(`/elite/sessions/${s.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); },
    onSave: async (v, form) => {
      if (!v.title) return t('required');
      if (v.end_time <= v.start_time) return t('endBeforeStart');
      if (isNew && form.querySelector('[data-rep-on]')?.checked) {
        const weekdays = [...picked];
        if (!weekdays.length) return t('repeatNoDays');
        const from = form.querySelector('[data-rep-from]').value;
        const to = form.querySelector('[data-rep-to]').value;
        if (!from || !to || to < from) return t('repeatBadRange');
        const r = await api('/elite/sessions/bulk', { method: 'POST', body: { ...v, from, to, weekdays } });
        toast(r.skipped ? t('bulkDoneSkip', { n: r.count, s: r.skipped }) : t('bulkDone', { n: r.count }));
      } else if (isNew) {
        await api('/elite/sessions', { method: 'POST', body: v });
        toast(t('saved'));
      } else {
        await api(`/elite/sessions/${s.id}`, { method: 'PATCH', body: v });
        toast(t('saved'));
      }
      again();
    },
  });
  if (!isNew) return;

  const form = m.form;
  const onBox = form.querySelector('[data-rep-on]');
  const repBody = form.querySelector('[data-rep-body]');
  const fromEl = form.querySelector('[data-rep-from]');
  const toEl = form.querySelector('[data-rep-to]');
  const dateField = form.querySelector('[name="session_date"]');
  onBox.onchange = () => {
    repBody.hidden = !onBox.checked;
    dateField.disabled = onBox.checked;   // 반복이면 날짜 한 칸 대신 기간을 쓴다
    if (onBox.checked && !fromEl.value) {
      fromEl.value = dateField.value || today();
      toEl.value = plusDays(fromEl.value, 42);   // 기본 6주
      const [y, mo, d] = fromEl.value.split('-').map(Number);
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      picked.add(dow);
      form.querySelector(`[data-day="${dow}"]`)?.classList.add('on');
    }
  };
  $$('[data-day]', form).forEach(b => b.onclick = () => {
    const d = Number(b.dataset.day);
    if (picked.has(d)) picked.delete(d); else picked.add(d);
    b.classList.toggle('on', picked.has(d));
  });
}

// ---------- 출석 ----------
async function attendance(body, state, staff, again) {
  const [up, past] = await Promise.all([api('/elite/sessions'), api('/elite/sessions?past=1')]);
  const list = [...up.filter(s => s.session_date === today()).reverse(), ...past].slice(0, 30);
  if (!list.length) { body.innerHTML = `<div class="empty">${esc(t('noTraining'))}</div>`; return; }
  const sid = list.some(x => x.id === state.eliteSession) ? state.eliteSession : list[0].id;
  const s = await api(`/elite/sessions/${sid}`);
  const n = (st) => s.roster.filter(r => r.status === st).length;
  body.innerHTML = `
    <label class="field"><span>${esc(t('eliteSessionPick'))}</span>
      <select data-pick>${list.map(x => `<option value="${x.id}"${x.id === sid ? ' selected' : ''}>${esc(fmtDate(x.session_date))} ${esc(x.start_time)} · ${esc(x.title)}</option>`).join('')}</select></label>
    <div class="stat-row" style="margin-bottom:12px">
      <div class="stat"><b>${n('present')}</b><span>${esc(t('present'))}</span></div>
      <div class="stat ${n('absent') ? 'warn' : ''}"><b>${n('absent')}</b><span>${esc(t('absent'))}</span></div>
      <div class="stat"><b>${s.roster.length - n('present') - n('absent')}</b><span>${esc(t('notChecked'))}</span></div>
    </div>
    <div class="card">${s.roster.map(r => `
      <div class="member-row">${avatar(r.name, r.photo)}<div class="who"><b>${esc(r.name)}</b></div>
        <button type="button" class="att-btn ${r.status === 'present' ? 'on' : ''}" data-att="${r.id}" data-st="present" aria-label="${esc(t('present'))}">✓</button>
        <button type="button" class="att-btn absent ${r.status === 'absent' ? 'on' : ''}" data-att="${r.id}" data-st="absent" aria-label="${esc(t('absent'))}">✗</button>
      </div>`).join('') || `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}</div>`;
  body.querySelector('[data-pick]').onchange = (e) => { state.eliteSession = Number(e.target.value); again(); };
  $$('[data-att]', body).forEach(b => b.onclick = async () => {
    const status = b.classList.contains('on') ? null : b.dataset.st;   // 같은 것을 다시 누르면 지운다
    try { await api(`/elite/sessions/${sid}/attendance`, { method: 'PUT', body: { member_id: Number(b.dataset.att), status } }); }
    catch (e) { return toast(errText(e), true); }
    state.eliteSession = sid; again();
  });
}

// ---------- 수강료 ----------
async function fees(body, state, staff, again) {
  const month = state.eliteMonth || thisMonth();
  const g = await api(`/elite/fees/grid?month=${month}`);
  const cur = g.currency;
  body.innerHTML = `
    <div class="monthbar"><button data-mv="-1">‹</button><strong>${esc(fmtMonth(month))}</strong><button data-mv="1">›</button></div>
    <div class="stat-row">
      <div class="stat"><b>${g.summary.paid}/${g.summary.players}</b><span>${esc(t('paid'))}</span></div>
      <div class="stat ${g.summary.unpaid ? 'warn' : ''}"><b>${g.summary.unpaid}</b><span>${esc(t('unpaid'))}</span></div>
      <div class="stat"><b>${fmtMoney(g.summary.collected)}</b><span>${esc(t('collected'))} ${cur}</span></div>
    </div>
    <div class="hint" style="margin-top:8px">${esc(t('eliteDueHint', { day: g.due_day, fee: fmtMoney(g.default_fee) + cur }))}</div>
    <div class="card">
      <table class="table">
        <thead><tr><th>${esc(t('name'))}</th><th class="num">${esc(t('eliteMonthly'))}</th><th style="width:40px"></th></tr></thead>
        <tbody>${g.rows.map((r, i) => `
          <tr><td><div style="font-weight:600">${esc(r.name)}${r.status === 'dormant' ? ` <span class="pill grey">${esc(t('stDormant'))}</span>` : ''}</div>
            <small style="color:var(--muted)">${r.paid ? `${esc(r.paid_at)} · ${esc(methodLabel(r.method))}` : esc(t('unpaid'))}</small></td>
          <td class="num">${fmtMoney(r.amount)}</td>
          <td><button class="check ${r.paid ? 'paid' : ''}" data-mark="${i}">✓</button></td></tr>`).join('')}
        </tbody>
      </table>
      ${g.rows.length ? '' : `<div class="empty">${esc(t('elitePlayersEmpty'))}</div>`}
    </div>`;
  $$('[data-mv]', body).forEach(b => b.onclick = () => { state.eliteMonth = shiftMonth(month, Number(b.dataset.mv)); again(); });
  $$('[data-mark]', body).forEach(b => b.onclick = () => {
    const r = g.rows[Number(b.dataset.mark)];
    const member_id = r.member_id;
    const m = openModal({
      title: `${r.name} · ${fmtMonth(month)}`,
      fields: [
        { name: 'paid_at', label: t('paidAt'), type: 'date', value: r.paid_at || today() },
        { name: 'method', label: t('method'), type: 'select', value: r.method || 'transfer',
          options: [{ value: 'cash', label: t('cash') }, { value: 'transfer', label: t('transfer') }, { value: 'qpay', label: t('qpay') }] },
        { name: 'note', label: t('memo'), value: r.note || '' },
      ],
      extra: r.paid ? `<button type="button" class="btn btn-danger" style="width:100%;margin:4px 0 8px" data-unpay>${esc(t('markUnpaid'))}</button>` : '',
      saveLabel: t('markPaid'),
      onSave: async (v) => {
        await api('/elite/fees/mark', { method: 'PUT', body: { member_id, period: month, paid: true, ...v } });
        toast(t('saved')); again();
      },
    });
    const un = m.form.querySelector('[data-unpay]');
    if (un) un.onclick = async () => {
      try { await api('/elite/fees/mark', { method: 'PUT', body: { member_id, period: month, paid: false } }); }
      catch (e) { m.err.textContent = errText(e); return; }
      m.close(); toast(t('saved')); again();
    };
  });
}

// ---------- 공지 ----------
async function notices(body, state, staff, again) {
  const rows = await api('/elite/notices');
  body.innerHTML = `
    <div class="fab-row"><button class="btn btn-primary" style="width:100%;margin-bottom:12px" data-new>+ ${esc(t('newNotice'))}</button></div>
    ${rows.length ? rows.map(n => noticeCard(n, true)).join('') : `<div class="empty">${esc(t('noNotices'))}</div>`}`;
  body.querySelector('[data-new]').onclick = () => noticeForm(null, again);
  $$('[data-edit-enotice]', body).forEach(b => b.onclick = () => noticeForm(rows.find(n => String(n.id) === b.dataset.editEnotice), again));
}

// 동호인 공지 창(notices.js)과 같은 모양 — 사진 1장, 상단 고정
function noticeForm(n, again) {
  const isNew = !n;
  let photoData = null;
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
        </div>
        <img data-preview src="${esc(photoSrc(n?.photo))}" class="notice-photo" ${n?.photo ? '' : 'hidden'} alt="">
      </div>`,
    onDelete: isNew ? null : async () => { await api(`/elite/notices/${n.id}`, { method: 'DELETE' }); toast(t('deleted')); again(); },
    onSave: async (v) => {
      if (!v.title || !v.body) return t('required');
      const body = { title: v.title, body: v.body, pinned: v.pinned };
      if (photoData) body.photo_data = photoData;
      if (removePhoto) body.remove_photo = true;
      if (isNew) await api('/elite/notices', { method: 'POST', body });
      else await api(`/elite/notices/${n.id}`, { method: 'PATCH', body });
      toast(t('saved')); again();
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
  if (rm) rm.onclick = () => { removePhoto = true; photoData = null; preview.hidden = true; };
}

// 기다리는 선수반 가입 신청 — 승인하면 그 자리에서 선수 계정이 된다 (신청할 때 정한 PIN 그대로)
function joinBlock(join) {
  if (!join.count) return '';
  return `
    <div class="section-head"><h2>${esc(t('eliteApplications'))} · ${join.count}</h2></div>
    <div class="card" style="margin-bottom:12px">
      ${join.rows.map(r => `
        <div class="member-row">
          ${avatar(r.name, r.photo)}
          <div class="who">
            <b>${esc(r.name)}</b>
            <small>${esc([r.phone, r.birth_year, levelLabel(r.level), String(r.created_at).slice(5, 10)].filter(Boolean).join(' · '))}</small>
            ${r.parent_name || r.parent_phone || r.memo ? `<small>${esc([r.parent_name && `${t('eliteParentName')}: ${r.parent_name}`, r.parent_phone && `☎ ${r.parent_phone}`, r.memo].filter(Boolean).join(' · '))}</small>` : ''}
            <small style="color:var(--court)">✓ ${esc(t('joinAgreedPrivacy'))}</small>
          </div>
          <button class="btn btn-sm btn-primary" data-approve="${r.id}">${esc(t('joinApprove'))}</button>
          <button class="btn btn-sm btn-danger" data-reject="${r.id}">${esc(t('joinReject'))}</button>
        </div>`).join('')}
    </div>`;
}
