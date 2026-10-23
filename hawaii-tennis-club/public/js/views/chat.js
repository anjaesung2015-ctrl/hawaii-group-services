// 채팅 — 방 목록(클럽 전체방 + 1:1) 과 방 안 화면.
// 방을 연 동안 3초마다 새 메시지만 받아 온다. 다른 화면으로 가거나 앱을 내리면 멈춘다.
// 한글·몽골어 메시지는 영어 번역을 크게, 원문을 작게 (내 메시지는 반대로 — 남에게 어떻게 보이는지 확인용).
import { api, esc, toast, openModal, errText, pickPhoto, origHtml, $, $$ } from '../ui.js';
import { t, levelLabel, timeAgo } from '../i18n.js';

const POLL_MS = 3000;
const TR_TRIES = 3;   // 번역이 안 붙은 메시지를 몇 번까지 다시 물어볼지
let poller = 0;

// 서버가 번역할 대상과 같은 기준 (lib/translate.js srcLang, MAX_CHARS)
const needsTr = (s) => !!s && s.length <= 1200 && /[가-힣Ѐ-ӿ]/.test(s);

export async function renderChat(el, state) {
  clearInterval(poller);
  if (state.chatRoom) return renderRoom(el, state, state.chatRoom);
  return renderRooms(el, state);
}

// ---------- 방 목록 ----------
async function renderRooms(el, state) {
  const rooms = await api('/chat/rooms?lang=en');
  el.innerHTML = `
    <button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newChat'))}</button>
    <div class="section-head"><h2>${esc(t('chats'))}</h2></div>
    <div class="card">${rooms.map(roomRow).join('')}</div>
    ${rooms.length < 2 ? `<div class="hint">${esc(t('chatHint'))}</div>` : ''}`;

  $$('[data-room]', el).forEach(r => r.onclick = () => state.go('chat', { room: Number(r.dataset.room) }));
  el.querySelector('[data-new]').onclick = () => pickMember(state);
}

function roomRow(r) {
  const club = r.kind === 'club';
  const name = club ? t('clubChat') : (r.other?.name || t('formerMember'));
  const last = r.last
    ? `${r.last.mine ? `${t('you')}: ` : (club && r.last.name ? `${r.last.name}: ` : '')}${(!r.last.mine && r.last.body_tr) || r.last.body || `📷 ${t('photo')}`}`
    : t('clubChatSub');
  return `
    <div class="member-row room-row" data-room="${r.id}" style="cursor:pointer">
      <div class="avatar ${club ? 'club' : ''}">${club ? '🎾' : esc(String(name).slice(0, 1))}</div>
      <div class="who">
        <b>${esc(name)}${!club && r.other?.is_coach ? ` <span class="pill coach">🎾 ${esc(t('coach'))}</span>` : ''}</b>
        <small class="room-last">${esc(last)}</small>
      </div>
      <div class="room-side">
        ${r.last ? `<small>${esc(timeAgo(r.last.created_at))}</small>` : ''}
        ${r.unread ? `<span class="unread">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}
      </div>
    </div>`;
}

// 새 1:1 — 회원 고르기
async function pickMember(state) {
  const list = (await api('/members')).filter(m => m.id !== state.me.id && m.status !== 'dormant');
  if (!list.length) return toast(t('chatNoMembers'));
  openModal({
    title: t('newChat'),
    fields: [{ name: 'member_id', label: t('chatPick'), type: 'select', value: String(list[0].id),
      options: list.map(m => ({ value: String(m.id), label: `${m.name}${m.is_coach ? ' · 🎾' : ''} · ${levelLabel(m.level)}` })) }],
    saveLabel: t('chatOpen'),
    onSave: async (v) => {
      const r = await api('/chat/dm', { method: 'POST', body: { member_id: Number(v.member_id) } });
      state.go('chat', { room: r.id });
    },
  });
}

// 회원 탭 등 다른 화면에서 바로 1:1 열기
export async function openDm(state, memberId) {
  try {
    const r = await api('/chat/dm', { method: 'POST', body: { member_id: memberId } });
    state.go('chat', { room: r.id });
  } catch (e) { toast(errText(e), true); }
}

// ---------- 방 안 ----------
async function renderRoom(el, state, roomId) {
  let d;
  try { d = await api(`/chat/rooms/${roomId}/messages?lang=en`); }
  catch (e) {
    if (e.status !== 404) throw e;
    toast(t('chatGone'), true);
    return state.go('chat', { room: null, replace: true });
  }
  const club = d.room.kind === 'club';
  const officer = state.me.role === 'admin' || !!state.me.is_owner;   // 전체방 글은 임원도 지운다
  const title = club ? t('clubChat') : (d.room.other?.name || t('formerMember'));

  el.innerHTML = `
    <div class="chat-head">
      <button class="btn btn-sm" type="button" data-rooms>‹ ${esc(t('chats'))}</button>
      <b>${club ? '🎾 ' : ''}${esc(title)}</b>
    </div>
    ${d.has_more ? `<button class="btn btn-sm" style="width:100%;margin-bottom:8px" data-older>${esc(t('chatEarlier'))}</button>` : ''}
    <div class="chat-msgs" data-msgs></div>
    <form class="composer" data-composer>
      <div class="composer-inner">
        <button class="btn photo-btn" type="button" data-photo aria-label="${esc(t('photo'))}">📷</button>
        <textarea name="body" rows="1" maxlength="1000" placeholder="${esc(t('chatPlaceholder'))}" enterkeyhint="send"></textarea>
        <button class="btn btn-primary" type="submit">${esc(t('send'))}</button>
      </div>
    </form>`;

  const box = el.querySelector('[data-msgs]');
  const form = el.querySelector('[data-composer]');
  const input = form.querySelector('textarea');
  let msgs = d.messages;
  let lastId = msgs.length ? msgs.at(-1).id : 0;

  const draw = () => {
    const stick = nearBottom();
    box.innerHTML = msgs.length ? msgHtml(msgs, club, officer) : `<div class="empty">${esc(t('chatEmpty'))}</div>`;
    bindMsgs();
    // 사진은 늦게 뜬다 — 맨 아래를 보고 있었으면 뜬 뒤에도 맨 아래로
    $$('.chat-photo', box).forEach(img => { if (!img.complete) img.onload = () => { if (stick) toBottom(); }; });
  };
  const nearBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  const toBottom = () => window.scrollTo({ top: document.body.scrollHeight });

  // 내 말(임원은 전체방 아무 말)을 누르면 '지우기'가 나온다 (두 번 눌러야 지워짐)
  function bindMsgs() {
    $$('[data-del]', box).forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!b.classList.contains('ask')) { b.classList.add('ask'); b.textContent = t('confirmDelete'); return; }
      try {
        await api(`/chat/messages/${b.dataset.del}`, { method: 'DELETE' });
        msgs = msgs.filter(m => String(m.id) !== b.dataset.del);
        draw();
      } catch (err) { toast(errText(err), true); }
    });
    // 사진을 누르면 크게 (창 바깥 아무 데나 누르거나 폰 뒤로가기로 닫힌다)
    $$('[data-full]', box).forEach(img => img.onclick = (e) => {
      e.stopPropagation();
      $('#modalRoot').innerHTML = `<div class="photo-view" data-close><img src="${esc(img.dataset.full)}" alt=""></div>`;
      $('#modalRoot [data-close]').onclick = () => { $('#modalRoot').innerHTML = ''; };
    });
    $$('.msg', box).forEach(m => m.onclick = () => {
      const del = m.querySelector('[data-del]');
      if (del) del.hidden = !del.hidden;
    });
  }

  // 아직 번역이 안 붙은 메시지 — 서버가 몇 초 기다려 주는 /tr 로 따로 물어 와서 그 자리만 바꿔 그린다
  const trTries = new Map();
  let trBusy = false;
  async function fillTr() {
    if (trBusy) return;
    const ids = msgs.filter(m => !m.body_tr && needsTr(m.body) && (trTries.get(m.id) || 0) < TR_TRIES).map(m => m.id).slice(-50);
    if (!ids.length) return;
    trBusy = true;
    ids.forEach(id => trTries.set(id, (trTries.get(id) || 0) + 1));
    try {
      const got = await api(`/chat/rooms/${roomId}/tr?lang=en&ids=${ids.join(',')}`);
      let changed = false;
      for (const m of msgs) if (got[m.id] && !m.body_tr) { m.body_tr = got[m.id]; changed = true; }
      if (changed && box.isConnected) {
        const stick = nearBottom();
        draw();
        if (stick) toBottom();
      }
    } catch (e) { /* 번역이 안 돼도 원문은 이미 보인다 */ }
    finally { trBusy = false; }
  }

  draw();
  toBottom();
  fillTr();

  el.querySelector('[data-rooms]').onclick = () => state.go('chat', { room: null });

  const older = el.querySelector('[data-older]');
  if (older) older.onclick = async () => {
    older.disabled = true;
    const h = document.body.scrollHeight;
    const o = await api(`/chat/rooms/${roomId}/messages?lang=en&before=${msgs[0].id}`);
    msgs = [...o.messages, ...msgs];
    draw();
    window.scrollTo({ top: document.body.scrollHeight - h });   // 보던 자리 그대로
    if (!o.has_more) older.remove(); else older.disabled = false;
    fillTr();
  };

  // 글자 수에 맞춰 입력칸 높이를 늘린다. 엔터 = 보내기, Shift+엔터 = 줄바꿈 (폰 키보드는 줄바꿈 그대로)
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  };

  let sending = false;
  const photoBtn = form.querySelector('[data-photo]');
  // 📷 — 고르면 바로 보낸다. 입력칸에 써 둔 글이 있으면 사진 설명으로 같이 간다
  photoBtn.onclick = async () => {
    if (sending) return;
    const photo = await pickPhoto();
    if (!photo) return;
    photoBtn.disabled = true;
    photoBtn.textContent = '⏳';
    await post({ body: input.value.trim(), photo });
    photoBtn.disabled = false;
    photoBtn.textContent = '📷';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || sending) return;
    await post({ body });
  };

  async function post(payload) {
    sending = true;
    try {
      const m = await api(`/chat/rooms/${roomId}/messages`, { method: 'POST', body: payload });
      input.value = '';
      input.style.height = 'auto';
      if (!msgs.some(x => x.id === m.id)) msgs.push(m);
      lastId = Math.max(lastId, m.id);
      draw();
      toBottom();
      fillTr();
    } catch (err) { toast(errText(err), true); }
    finally { sending = false; if (!payload.photo) input.focus(); }
  }

  // 3초마다 새 메시지 — 화면을 떠났으면 멈춘다
  poller = setInterval(async () => {
    if (!box.isConnected || state.tab !== 'chat' || state.chatRoom !== roomId) return clearInterval(poller);
    if (document.hidden || sending) return;
    fillTr();
    try {
      const n = await api(`/chat/rooms/${roomId}/messages?lang=en&after=${lastId}`);
      const fresh = n.messages.filter(m => !msgs.some(x => x.id === m.id));
      if (!fresh.length) return;
      const stick = nearBottom();
      msgs.push(...fresh);
      lastId = Math.max(lastId, ...fresh.map(m => m.id));
      draw();
      if (stick) toBottom();
    } catch (e) { /* 잠깐 끊겨도 다음 차례에 다시 */ }
  }, POLL_MS);
}

// 남의 말: 번역문 크게 + 🌐 원문 작게. 내 말: 내가 쓴 그대로 크게 + 🌐 영어 번역 작게
function bubble(m) {
  const [big, small] = m.mine ? [m.body, m.body_tr] : [m.body_tr || m.body, m.body_tr ? m.body : null];
  return `<div class="bubble">${esc(big)}${origHtml(small)}</div>`;
}

// 날짜가 바뀌면 가운데 날짜 줄. 같은 사람이 연달아 쓰면 이름은 처음 한 번만.
function msgHtml(msgs, club, officer) {
  let day = '', prev = null;
  return msgs.map(m => {
    const d = String(m.created_at).slice(0, 10);
    const sep = d !== day ? `<div class="chat-day">${esc(d)}</div>` : '';
    const showName = club && !m.mine && (sep || prev?.member_id !== m.member_id);
    day = d; prev = m;
    return `${sep}
      <div class="msg ${m.mine ? 'mine' : ''}">
        ${showName ? `<div class="msg-who">${esc(m.name || t('formerMember'))}${m.is_coach ? ' 🎾' : ''}</div>` : ''}
        ${m.photo ? `<img class="chat-photo" src="${esc(m.photo)}" data-full="${esc(m.photo)}" alt="" loading="lazy">` : ''}
        ${m.body ? bubble(m) : ''}
        <time>${esc(String(m.created_at).slice(11, 16))}</time>
        ${m.mine || (club && officer) ? `<button type="button" class="btn btn-sm btn-danger msg-del" data-del="${m.id}" hidden>${esc(t('del'))}</button>` : ''}
      </div>`;
  }).join('');
}
