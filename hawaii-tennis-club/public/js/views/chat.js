// 채팅 — 방 목록(클럽 전체방 + 1:1) 과 방 안 화면.
// 방을 연 동안 3초마다 새 메시지만 받아 온다. 다른 화면으로 가거나 앱을 내리면 멈춘다.
import { api, esc, toast, openModal, errText, $$ } from '../ui.js';
import { t, levelLabel, timeAgo } from '../i18n.js';

const POLL_MS = 3000;
let poller = 0;

export async function renderChat(el, state) {
  clearInterval(poller);
  if (state.chatRoom) return renderRoom(el, state, state.chatRoom);
  return renderRooms(el, state);
}

// ---------- 방 목록 ----------
async function renderRooms(el, state) {
  const rooms = await api('/chat/rooms');
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
    ? `${r.last.mine ? `${t('you')}: ` : (club && r.last.name ? `${r.last.name}: ` : '')}${r.last.body}`
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
  try { d = await api(`/chat/rooms/${roomId}/messages`); }
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
    box.innerHTML = msgs.length ? msgHtml(msgs, club, officer) : `<div class="empty">${esc(t('chatEmpty'))}</div>`;
    bindMsgs();
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
    $$('.msg', box).forEach(m => m.onclick = () => {
      const del = m.querySelector('[data-del]');
      if (del) del.hidden = !del.hidden;
    });
  }

  draw();
  toBottom();

  el.querySelector('[data-rooms]').onclick = () => state.go('chat', { room: null });

  const older = el.querySelector('[data-older]');
  if (older) older.onclick = async () => {
    older.disabled = true;
    const h = document.body.scrollHeight;
    const o = await api(`/chat/rooms/${roomId}/messages?before=${msgs[0].id}`);
    msgs = [...o.messages, ...msgs];
    draw();
    window.scrollTo({ top: document.body.scrollHeight - h });   // 보던 자리 그대로
    if (!o.has_more) older.remove(); else older.disabled = false;
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
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || sending) return;
    sending = true;
    try {
      const m = await api(`/chat/rooms/${roomId}/messages`, { method: 'POST', body: { body } });
      input.value = '';
      input.style.height = 'auto';
      if (!msgs.some(x => x.id === m.id)) msgs.push(m);
      lastId = Math.max(lastId, m.id);
      draw();
      toBottom();
    } catch (err) { toast(errText(err), true); }
    finally { sending = false; input.focus(); }
  };

  // 3초마다 새 메시지 — 화면을 떠났으면 멈춘다
  poller = setInterval(async () => {
    if (!box.isConnected || state.tab !== 'chat' || state.chatRoom !== roomId) return clearInterval(poller);
    if (document.hidden || sending) return;
    try {
      const n = await api(`/chat/rooms/${roomId}/messages?after=${lastId}`);
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
        <div class="bubble">${esc(m.body)}</div>
        <time>${esc(String(m.created_at).slice(11, 16))}</time>
        ${m.mine || (club && officer) ? `<button type="button" class="btn btn-sm btn-danger msg-del" data-del="${m.id}" hidden>${esc(t('del'))}</button>` : ''}
      </div>`;
  }).join('');
}
