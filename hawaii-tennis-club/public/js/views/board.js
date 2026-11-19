// 자유게시판 — 회원끼리 글·사진·댓글·좋아요.
import { api, esc, toast, openModal, pickPhotos, errText, origText, origHtml, avatar, $$, officerPill } from '../ui.js';
import { t, timeAgo } from '../i18n.js';

export async function renderBoard(el, state) {
  const d = await api('/posts?lang=en');
  state.boardMore = d.has_more ? d.rows[d.rows.length - 1].id : null;

  el.innerHTML = `
    <button class="btn btn-primary" style="width:100%" data-new>+ ${esc(t('newPost'))}</button>
    <div data-list>${d.rows.length ? d.rows.map(p => postCard(p, state)).join('') : `<div class="empty">${esc(t('noPosts'))}</div>`}</div>
    ${state.boardMore ? `<button class="btn" style="width:100%;margin-top:6px" data-more>${esc(t('more'))}</button>` : ''}`;

  el.querySelector('[data-new]').onclick = () => postForm(null, state, () => renderBoard(el, state));
  bindPosts(el, state, () => renderBoard(el, state));

  const more = el.querySelector('[data-more]');
  if (more) more.onclick = async () => {
    more.disabled = true;
    const next = await api(`/posts?lang=en&before=${state.boardMore}`);
    el.querySelector('[data-list]').insertAdjacentHTML('beforeend', next.rows.map(p => postCard(p, state)).join(''));
    state.boardMore = next.has_more && next.rows.length ? next.rows[next.rows.length - 1].id : null;
    if (!state.boardMore) more.remove(); else more.disabled = false;
    bindPosts(el, state, () => renderBoard(el, state));
  };
}

const MAX_PHOTOS = 10;   // 서버(routes/posts.js MAX_PHOTOS)와 같게
const SHOW_PHOTOS = 4;   // 목록 카드에 보이는 사진 수

export function postCard(p, state) {
  const mine = p.member_id === state.me.id;
  const canDelete = mine || state.me.role === 'admin';
  // 목록에서는 4장까지만, 넘는 건 4번째 위에 +N (누르면 전부 넘겨 볼 수 있다)
  const all = p.photos || [];
  const shown = all.slice(0, SHOW_PHOTOS);
  const photos = shown.map((src, i) => {
    const img = `<img class="post-photo" src="${esc(src)}" data-view-photo="${esc(src)}" alt="" loading="lazy">`;
    return i === SHOW_PHOTOS - 1 && all.length > SHOW_PHOTOS ? `<div class="post-more" data-more="+${all.length - SHOW_PHOTOS}">${img}</div>` : img;
  }).join('');

  return `
    <div class="card post" data-post="${p.id}">
      <div class="post-head">
        ${avatar(p.author, p.author_photo)}
        <div class="who">
          <b>${esc(p.author)}${officerPill(p.officer_role)}</b>
          <small>${esc(timeAgo(p.created_at))}${p.updated_at ? ` · ${esc(t('edited'))}` : ''}</small>
        </div>
        ${mine ? `<button class="btn btn-sm" data-edit="${p.id}">${esc(t('edit'))}</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-del="${p.id}">${esc(t('del'))}</button>` : ''}
      </div>
      ${p.body ? `<div class="post-body">${esc(origText(p, 'body').text)}</div>${origHtml(origText(p, 'body').orig)}` : ''}
      ${photos ? `<div class="post-photos ${(all.length > 1) ? 'multi' : ''}" data-photo-set="${esc(JSON.stringify(all))}">${photos}</div>` : ''}
      <div class="post-foot">
        <button class="react ${p.liked ? 'on' : ''}" data-like="${p.id}" data-on="${p.liked ? 1 : 0}">
          ${p.liked ? '♥' : '♡'} <span>${p.likes || ''}</span>
        </button>
        <button class="react" data-open="${p.id}">💬 <span>${p.comments || ''}</span></button>
      </div>
    </div>`;
}

export function bindPosts(el, state, refresh) {
  $$('[data-like]', el).forEach(b => b.onclick = async () => {
    const on = b.dataset.on !== '1';
    try {
      const r = await api(`/posts/${b.dataset.like}/like`, { method: 'PUT', body: { on } });
      b.dataset.on = r.liked ? '1' : '0';
      b.classList.toggle('on', r.liked);
      b.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.likes || ''}</span>`;
    } catch (e) { toast(errText(e), true); }
  });

  $$('[data-open]', el).forEach(b => b.onclick = () => openPost(b.dataset.open, state, refresh));
  $$('[data-edit]', el).forEach(b => b.onclick = async () => {
    const p = await api(`/posts/${b.dataset.edit}`);
    postForm(p, state, refresh);
  });
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    if (!b.classList.contains('ask')) {
      b.classList.add('ask');
      b.textContent = t('confirmDelete');
      setTimeout(() => { if (b.isConnected) { b.classList.remove('ask'); b.textContent = t('del'); } }, 3000);
      return;
    }
    await api(`/posts/${b.dataset.del}`, { method: 'DELETE' }).catch(() => {});
    toast(t('deleted'));
    refresh();
  });
  // 사진을 누르면 크게 — data-view-photo 는 ui.js 가 화면 전체에서 받는다
}

// 글 하나 + 댓글
export async function openPost(id, state, refresh) {
  const p = await api(`/posts/${id}?lang=en`);
  const canDel = (c) => c.member_id === state.me.id || state.me.role === 'admin';

  const m = openModal({
    title: p.author,
    fields: [],
    extra: `
      <div class="hint" style="margin:-8px 2px 8px">${esc(timeAgo(p.created_at))}</div>
      ${p.body ? `<div class="post-body">${esc(origText(p, 'body').text)}</div>${origHtml(origText(p, 'body').orig)}` : ''}
      <div data-photo-set="${esc(JSON.stringify(p.photos || []))}">${(p.photos || []).map(src => `<img class="post-photo" src="${esc(src)}" data-view-photo="${esc(src)}" style="width:100%;margin-top:8px;border-radius:12px" alt="">`).join('')}</div>
      <div class="section-head" style="margin:16px 2px 8px"><h2>${esc(t('comments'))} · ${p.comments.length}</h2></div>
      <div data-comments>
        ${p.comments.length ? p.comments.map(c => `
          <div class="cmt">
            <div class="cmt-top"><b>${esc(c.author)}</b><small>${esc(timeAgo(c.created_at))}</small>
              ${canDel(c) ? `<button class="cmt-del" data-cdel="${c.id}">×</button>` : ''}</div>
            <div>${esc(origText(c, 'body').text)}</div>${origHtml(origText(c, 'body').orig)}
          </div>`).join('') : `<div class="empty">${esc(t('noComments'))}</div>`}
      </div>
      <div class="cmt-write">
        <input type="text" data-cmt placeholder="${esc(t('commentWrite'))}" maxlength="500">
        <button type="button" class="btn btn-primary btn-sm" data-csend>${esc(t('send'))}</button>
      </div>`,
    saveLabel: t('close'),
    onSave: () => { m.close(); refresh(); },
  });

  const input = m.form.querySelector('[data-cmt]');
  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    try {
      await api(`/posts/${id}/comments`, { method: 'POST', body: { body } });
      m.close();
      refresh();
      openPost(id, state, refresh);     // 방금 쓴 댓글이 보이게 다시 펼친다
    } catch (e) { toast(errText(e), true); }
  };
  m.form.querySelector('[data-csend]').onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };

  m.form.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    await api(`/posts/${id}/comments/${b.dataset.cdel}`, { method: 'DELETE' }).catch(() => {});
    m.close();
    refresh();
    openPost(id, state, refresh);
  });
}

// 글쓰기 · 고치기
export function postForm(p, state, refresh) {
  const isNew = !p;
  const photos = [];        // 새로 고른 사진 (data:URL)
  let ready = null;         // 사진을 줄이는 중이면 끝날 때 풀리는 약속 — 저장은 이걸 기다린다

  const m = openModal({
    title: isNew ? t('newPost') : t('editPost'),
    fields: [
      { name: 'body', label: t('postWhat'), type: 'textarea', value: p?.body || '', placeholder: t('postWhat') },
    ],
    extra: isNew ? `
      <div class="field">
        <span>${esc(t('photo'))} <span class="hint" style="padding:0">(${esc(t('photoMax'))})</span></span>
        <button type="button" class="btn btn-sm" data-pick>📷 ${esc(t('photoPick'))}</button>
        <div class="post-preview" data-preview></div>
      </div>` : `<div class="hint">${esc(t('editBodyOnly'))}</div>`,
    onSave: async (v) => {
      if (ready) await ready;   // 사진 줄이는 중에 올리기를 눌러도 사진이 빠지지 않게
      if (!v.body && !photos.length) return t('postEmpty');
      if (isNew) await api('/posts', { method: 'POST', body: { body: v.body, photos } });
      else await api(`/posts/${p.id}`, { method: 'PATCH', body: { body: v.body } });
      toast(t('saved'));
      refresh();
    },
  });

  // 여러 장 한 번에 고르기 — 미리보기에서 ✕ 로 뺄 수 있다
  const box = m.form.querySelector('[data-preview]');
  const drawPreview = () => {
    box.innerHTML = photos.map((d, i) =>
      `<div class="tray-thumb post-thumb"><img src="${d}" alt=""><button type="button" data-unpick="${i}" aria-label="Remove">✕</button></div>`).join('');
    box.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => { photos.splice(Number(b.dataset.unpick), 1); drawPreview(); });
  };
  const pick = m.form.querySelector('[data-pick]');
  if (pick) pick.onclick = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return toast(t('photoMax'), true);
    pick.disabled = true;
    const label = pick.textContent;
    let release = null;
    const { photos: got, cut, failed } = await pickPhotos(room, 1280, (n, total) => {
      if (n === 0) ready = new Promise(r => { release = r; });
      pick.textContent = `⏳ ${n}/${total}`;
    });
    pick.disabled = false;
    pick.textContent = label;
    if (cut) toast(t('photoMax'), true);
    if (failed) toast(t('photoFailed', { n: failed }), true);
    photos.push(...got);
    drawPreview();
    ready = null;
    release?.();
  };
}
