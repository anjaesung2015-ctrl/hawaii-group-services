// 채팅 — 방 목록(클럽 전체방 + 1:1) 과 방 안 화면.
// 방을 연 동안 3초마다 새 메시지만 받아 온다. 다른 화면으로 가거나 앱을 내리면 멈춘다.
// 한글·몽골어 메시지는 영어 번역을 크게, 원문을 작게 (내 메시지는 반대로 — 남에게 어떻게 보이는지 확인용).
import { api, esc, toast, openModal, errText, pickPhotos, origText, origHtml, avatar, $, $$, officerPill } from '../ui.js';
import { t, levelLabel, timeAgo } from '../i18n.js';

const POLL_MS = 3000;
const TR_TRIES = 3;   // 번역이 안 붙은 메시지를 몇 번까지 다시 물어볼지
const DOUBLE_MS = 280;   // 이 안에 두 번 누르면 '두 번 톡톡'
const HEART = '❤️';
const MAX_PHOTOS = 10;   // 한 번에 묶어 보내는 사진 — 서버(routes/chat.js MAX_PHOTOS)와 같게
const MAX_FACES = 6;     // 한 메시지 아래 얼굴은 이만큼만, 나머지는 +N
// 달 수 있는 이모지 — 서버(routes/chat.js REACTIONS)와 같아야 한다
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🎾', '🔥', '👏'];
let poller = 0;

// 서버가 번역할 대상과 같은 기준 (lib/translate.js srcLang, MAX_CHARS)
const needsTr = (s) => !!s && s.length <= 1200 && /[가-힣Ѐ-ӿ]/.test(s);

export async function renderChat(el, state) {
  clearInterval(poller);
  document.body.classList.remove('tray-open');
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
    ? `${r.last.mine ? `${t('you')}: ` : (club && r.last.name ? `${r.last.name}: ` : '')}${r.last.body || (r.last.photos?.length > 1 ? `📷 ${t('photosN', { n: r.last.photos.length })}` : `📷 ${t('photo')}`)}`
    : t('clubChatSub');
  return `
    <div class="member-row room-row" data-room="${r.id}" style="cursor:pointer">
      ${club ? '<div class="avatar club">🎾</div>' : avatar(name, r.other?.photo)}
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
      <div class="chat-tray" data-tray hidden></div>
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
  let reacts = d.reacts || {};   // { 메시지 id: [{ e, n, mine }] } — 폴링 때마다 서버 것으로 갈아 끼운다
  let seen = d.seen || [];       // [{ id, name, photo, last_id }] 나 말고 읽은 사람들 — 폴링 때마다 통째로
  let openId = null;             // 한 번 눌러 이모지 줄을 펼친 메시지
  let reacting = 0;              // 보내는 중인 반응 수 — 그동안은 폴링 결과로 덮지 않는다(눌렀다 깜빡 돌아가지 않게)

  const draw = () => {
    const stick = nearBottom();
    box.innerHTML = msgs.length ? msgHtml(msgs, club, officer, reacts, openId, seen) : `<div class="empty">${esc(t('chatEmpty'))}</div>`;
    bindMsgs();
    // 사진은 늦게 뜬다 — 맨 아래를 보고 있었으면 뜬 뒤에도 맨 아래로
    $$('.chat-photo, .chat-cell', box).forEach(img => { if (!img.complete) img.onload = () => { if (stick) toBottom(); }; });
  };
  const nearBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  const toBottom = () => window.scrollTo({ top: document.body.scrollHeight });

  // 사진을 크게 (아무 데나 누르거나 폰 뒤로가기로 닫힌다). 묶음이면 ‹ › 나 옆으로 밀어 넘긴다
  const openPhoto = (srcs, start = 0) => {
    const root = $('#modalRoot');
    let i = start, x0 = null, swiped = false;
    const show = () => {
      const n = srcs.length;
      root.innerHTML = `<div class="photo-view" data-close><img src="${esc(srcs[i])}" alt="">
        ${n > 1 ? `<button type="button" class="pv-nav prev" data-step="-1" aria-label="Previous">‹</button>
        <button type="button" class="pv-nav next" data-step="1" aria-label="Next">›</button>
        <div class="pv-count">${i + 1} / ${n}</div>` : ''}</div>`;
      const v = root.querySelector('[data-close]');
      const go = (s) => { i = (i + s + n) % n; show(); };
      v.onclick = () => { if (swiped) { swiped = false; return; } root.innerHTML = ''; };
      v.querySelectorAll('[data-step]').forEach(b => b.onclick = (e) => { e.stopPropagation(); go(Number(b.dataset.step)); });
      if (n > 1) {
        v.ontouchstart = (e) => { x0 = e.touches[0].clientX; };
        v.ontouchend = (e) => {
          const dx = e.changedTouches[0].clientX - (x0 ?? e.changedTouches[0].clientX);
          x0 = null;
          if (Math.abs(dx) > 50) { swiped = true; setTimeout(() => { swiped = false; }, 400); go(dx < 0 ? 1 : -1); }
        };
      }
    };
    show();
  };

  // 반응 달기/떼기 — 화면부터 바로 바꾸고(기다리지 않게) 서버 답으로 맞춘다
  async function setReact(id, emoji, on, burst) {
    const before = reacts[id] || [];
    const list = before.map(r => ({ ...r }));
    const r = list.find(x => x.e === emoji);
    if (on && !r?.mine) r ? Object.assign(r, { n: r.n + 1, mine: true }) : list.push({ e: emoji, n: 1, mine: true });
    if (!on && r?.mine) Object.assign(r, { n: r.n - 1, mine: false });
    const put = (l) => { const k = l.filter(x => x.n > 0); if (k.length) reacts[id] = k; else delete reacts[id]; };
    put(list);
    draw();
    if (burst && on) box.querySelector(`.msg[data-id="${id}"]`)?.classList.add('burst');
    reacting++;
    try {
      const res = await api(`/chat/messages/${id}/react`, { method: 'POST', body: { emoji, on } });
      const was = JSON.stringify(reacts[id] || []);
      put(res.reacts);
      if (JSON.stringify(reacts[id] || []) !== was) draw();   // 같으면 다시 안 그린다(하트 튀는 효과가 끊기지 않게)
    } catch (err) { put(before); draw(); toast(errText(err), true); }
    finally { reacting--; }
  }
  const mineOn = (id, emoji) => !!(reacts[id] || []).find(x => x.e === emoji && x.mine);

  // 한 번 누르기 = 이모지 줄 펼치기/접기(사진은 크게 보기), 두 번 톡톡 = ❤️ 달기/떼기.
  // 두 번인지 알아야 해서 한 번 누르기는 잠깐(DOUBLE_MS) 기다렸다가 한다
  function bindMsgs() {
    $$('[data-del]', box).forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!b.classList.contains('ask')) { b.classList.add('ask'); b.textContent = t('confirmDelete'); return; }
      try {
        await api(`/chat/messages/${b.dataset.del}`, { method: 'DELETE' });
        msgs = msgs.filter(m => String(m.id) !== b.dataset.del);
        openId = null;
        draw();
      } catch (err) { toast(errText(err), true); }
    });
    // 읽은 사람 얼굴 — 누르면 누가 읽었는지
    $$('[data-readers]', box).forEach(b => b.onclick = (e) => { e.stopPropagation(); showReaders(Number(b.dataset.readers)); });
    // 말풍선 아래 달린 이모지 — 누르면 내 것 켜기/끄기
    $$('[data-react]', box).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.react);
      setReact(id, b.dataset.emoji, !mineOn(id, b.dataset.emoji));
    });
    // 펼친 이모지 줄에서 고르기
    $$('[data-pick]', box).forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.pick);
      openId = null;
      setReact(id, b.dataset.emoji, !mineOn(id, b.dataset.emoji), true);
    });
    $$('.msg', box).forEach(el => {
      let timer = 0, last = 0;
      el.onclick = (e) => {
        if (e.target.closest('.msg-actions')) return;
        const id = Number(el.dataset.id);
        const now = Date.now();
        if (now - last < DOUBLE_MS) {
          clearTimeout(timer);
          last = 0;
          window.getSelection()?.removeAllRanges();   // PC 에서 두 번 누르면 글자가 잡히는 것 풀기
          return setReact(id, HEART, !mineOn(id, HEART), true);
        }
        last = now;
        const img = e.target.closest('[data-full]');
        timer = setTimeout(() => {
          if (img) {
            const m = msgs.find(x => x.id === id);
            const srcs = m?.photos?.length ? m.photos : [img.dataset.full];
            return openPhoto(srcs, Math.max(0, srcs.indexOf(img.dataset.full)));
          }
          openId = openId === id ? null : id;
          draw();
        }, DOUBLE_MS);
      };
    });
  }

  async function showReaders(id) {
    let list;
    try { list = await api(`/chat/messages/${id}/readers`); }
    catch (err) { return toast(errText(err), true); }
    const md = openModal({
      title: `${t('seenBy')} · ${list.length}`,
      fields: [],
      extra: list.length
        ? list.map(p => `<div class="member-row">${avatar(p.name, p.photo)}<div class="who"><b>${esc(p.name)}</b></div></div>`).join('')
        : `<div class="empty">${esc(t('readNobody'))}</div>`,
      saveLabel: t('close'),
      onSave: () => {},
    });
    md.form.querySelector('[data-cancel]')?.remove();   // 볼 것만 있는 창 — 닫기 하나면 된다
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
    reacts = o.reacts || reacts;   // 새로 받은 가장 옛 메시지부터 끝까지 다 들어 있다
    seen = o.seen || seen;
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
  let pending = [];   // 보내기 전 고른 사진들(data:URL) — 보내기를 누르면 글과 함께 한 메시지로
  const photoBtn = form.querySelector('[data-photo]');
  const sendBtn = form.querySelector('[type="submit"]');
  const tray = form.querySelector('[data-tray]');
  const drawTray = () => {
    tray.hidden = !pending.length;
    document.body.classList.toggle('tray-open', pending.length > 0);
    tray.innerHTML = pending.map((p, i) =>
      `<div class="tray-thumb"><img src="${p}" alt=""><button type="button" data-unpick="${i}" aria-label="Remove">✕</button></div>`).join('')
      + (pending.length < MAX_PHOTOS ? '<button type="button" class="tray-add" data-more aria-label="Add">＋</button>' : '');
    tray.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => { pending.splice(Number(b.dataset.unpick), 1); drawTray(); });
    const more = tray.querySelector('[data-more]');
    if (more) more.onclick = () => photoBtn.click();
  };
  // 📷 — 여러 장 골라 아래 줄에 모아 둔다. 보내기를 누르면 입력칸 글과 함께 한 번에
  photoBtn.onclick = async () => {
    if (sending) return;
    const room = MAX_PHOTOS - pending.length;
    if (room <= 0) return toast(t('chatMaxPhotos', { n: MAX_PHOTOS }), true);
    photoBtn.disabled = true;
    photoBtn.textContent = '⏳';
    const { photos, cut } = await pickPhotos(room);
    photoBtn.disabled = false;
    photoBtn.textContent = '📷';
    if (cut) toast(t('chatMaxPhotos', { n: MAX_PHOTOS }), true);
    if (!photos.length) return;
    pending.push(...photos);
    drawTray();
    toBottom();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if ((!body && !pending.length) || sending) return;
    if (!pending.length) return post({ body });
    sendBtn.disabled = true;
    photoBtn.disabled = true;
    const ok = await post({ body, photos: pending });
    sendBtn.disabled = false;
    photoBtn.disabled = false;
    if (ok) { pending = []; drawTray(); }
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
      return true;
    } catch (err) { toast(errText(err), true); return false; }
    finally { sending = false; if (!payload.photos) input.focus(); }
  }

  // 3초마다 새 메시지 — 화면을 떠났으면 멈춘다
  poller = setInterval(async () => {
    if (!box.isConnected || state.tab !== 'chat' || state.chatRoom !== roomId) return clearInterval(poller);
    if (document.hidden || sending) return;
    fillTr();
    try {
      const n = await api(`/chat/rooms/${roomId}/messages?lang=en&after=${lastId}&from=${msgs[0]?.id || 0}`);
      const fresh = n.messages.filter(m => !msgs.some(x => x.id === m.id));
      // 남이 단 반응 — 내가 보내는 중이면 이번엔 건너뛴다
      const reactsChanged = !reacting && n.reacts && JSON.stringify(n.reacts) !== JSON.stringify(reacts);
      if (reactsChanged) reacts = n.reacts;
      const readsChanged = n.seen && JSON.stringify(n.seen) !== JSON.stringify(seen);
      if (readsChanged) seen = n.seen;
      if (!fresh.length && !reactsChanged && !readsChanged) return;
      const stick = nearBottom();
      msgs.push(...fresh);
      if (fresh.length) lastId = Math.max(lastId, ...fresh.map(m => m.id));
      draw();
      if (stick) toBottom();
    } catch (e) { /* 잠깐 끊겨도 다음 차례에 다시 */ }
  }, POLL_MS);
}

// 누구 말이든 쓴 그대로(원문) 크게 + 🌐 영어 번역 작게 (2026-11-16 사장님 지시 — 공지·게시판·일정과 같게)
function bubble(m) {
  const { text, orig } = origText(m, 'body');
  return `<div class="bubble">${esc(text)}${origHtml(orig)}</div>`;
}

// 날짜가 바뀌면 가운데 날짜 줄. 같은 사람이 연달아 쓰면 이름은 처음 한 번만.
// 말풍선 아래 달린 이모지들 — 내가 단 건 색이 들어간다
function reactsHtml(id, list) {
  if (!list?.length) return '';
  return `<div class="reacts">${list.map(r =>
    `<button type="button" class="react ${r.mine ? 'on' : ''}" data-react="${id}" data-emoji="${esc(r.e)}">${esc(r.e)} ${r.n}</button>`).join('')}</div>`;
}

// 한 번 누르면 펼쳐지는 줄 — 이모지 고르기 + (지울 수 있으면) 지우기
function actionsHtml(m, canDel) {
  return `<div class="msg-actions">
      <div class="react-pick">${REACTIONS.map(e => `<button type="button" data-pick="${m.id}" data-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      ${canDel ? `<button type="button" class="btn btn-sm btn-danger msg-del" data-del="${m.id}">${esc(t('del'))}</button>` : ''}
    </div>`;
}

// 읽음 — 페이스북처럼 각자 마지막으로 읽은 메시지 아래 작은 얼굴. 누르면 그 메시지를 읽은 사람 이름 전부
// 자기 메시지는 당연히 봤으니, 그 사람이 쓴 게 아닌 메시지 중 마지막으로 읽은 것에 붙인다
function seenMap(msgs, seen) {
  const at = {};
  for (const p of seen) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.id <= p.last_id && m.member_id !== p.id) { (at[m.id] ||= []).push(p); break; }
    }
  }
  return at;
}
function face(p) {
  return p.photo
    ? `<span class="face"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></span>`
    : `<span class="face">${esc(String(p.name || '?').slice(0, 1))}</span>`;
}
function seenHtml(m, list) {
  if (!list?.length) return '';
  const more = list.length - MAX_FACES;
  return `<button type="button" class="seen" data-readers="${m.id}" aria-label="${esc(t('seenBy'))}">${
    list.slice(0, more > 0 ? MAX_FACES - 1 : MAX_FACES).map(face).join('')}${more > 0 ? `<span class="face more">+${more + 1}</span>` : ''}</button>`;
}
// 사진 — 한 장은 크게, 여러 장은 격자 (2·4장은 2칸, 그 외 3칸)
function photosHtml(m) {
  const ps = m.photos?.length ? m.photos : (m.photo ? [m.photo] : []);
  if (!ps.length) return '';
  const img = (src, cls) => `<img class="${cls}" src="${esc(src)}" data-full="${esc(src)}" alt="" loading="lazy">`;
  if (ps.length === 1) return img(ps[0], 'chat-photo');
  const cols = ps.length === 2 || ps.length === 4 ? 2 : 3;
  return `<div class="chat-grid c${cols}">${ps.map(s => img(s, 'chat-cell')).join('')}</div>`;
}

function msgHtml(msgs, club, officer, reacts, openId, seen = []) {
  let day = '', prev = null;
  const faces = seenMap(msgs, seen);
  return msgs.map(m => {
    const d = String(m.created_at).slice(0, 10);
    const sep = d !== day ? `<div class="chat-day">${esc(d)}</div>` : '';
    const showName = club && !m.mine && (sep || prev?.member_id !== m.member_id);
    day = d; prev = m;
    return `${sep}
      <div class="msg ${m.mine ? 'mine' : ''}" data-id="${m.id}">
        ${showName ? `<div class="msg-who">${esc(m.name || t('formerMember'))}${m.is_coach ? ' 🎾' : ''}${officerPill(m.officer_role)}</div>` : ''}
        ${photosHtml(m)}
        ${m.body ? bubble(m) : ''}
        ${reactsHtml(m.id, reacts[m.id])}
        <time>${esc(String(m.created_at).slice(11, 16))}</time>
        ${openId === m.id ? actionsHtml(m, m.mine || (club && officer)) : ''}
      </div>
      ${seenHtml(m, faces[m.id])}`;
  }).join('');
}
