// 홈 — 2열 카드 피드 (게시판 글·사진첩 사진·공지·대회 성적을 최신순으로 섞어서).
// 카드 = 사진 + 제목 + 작성자. 사진 높이대로 짧은 열에 차곡차곡(메이슨리), 끝까지 내리면 다음 묶음(무한 스크롤).
// 위쪽: 종류 칩(All·Board·Photos·Notices·Results) + 새 글(＋). 운영진은 가입 신청이 있으면 맨 위에 알림 한 줄.
// 일정·캘린더·회비는 각 탭에서 본다 (2026-11-16 사장님 지시 "홈 전체를 피드로").
import { api, esc, origText, avatar } from '../ui.js';
import { t, timeAgo } from '../i18n.js';
import { openPost, postForm } from './board.js';
import { galleryViewer, uploadForm, fmtDur } from './gallery.js';
import { noticeForm } from './notices.js';
import { resultForm, canResults } from './results.js';

const KINDS = [['all', 'filterAll'], ['post', 'tabBoard'], ['photo', 'galleryTitle'], ['notice', 'tabNotices'], ['result', 'feedAwards']];
const BADGE = { notice: '📣', result: '🏆', photo: '📷', video: '🎬' };
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '🎖' };

let observer = null;     // 지난 화면의 무한 스크롤 감시 — 다시 그릴 때 끊는다
let run = 0;             // 다시 그리면 이전 화면이 늦게 받은 묶음을 버린다

export async function renderHome(el, state) {
  observer?.disconnect();
  const my = ++run;
  const kind = state.feedKind || 'all';
  const isAdmin = state.me.role === 'admin' || !!state.me.is_owner;
  const join = isAdmin ? await api('/join').catch(() => ({ count: 0 })) : { count: 0 };
  const again = () => renderHome(el, state);

  el.innerHTML = `
    ${join.count ? `
      <div class="card tap" data-go-members style="border-color:#ecdcb0;background:var(--gold-tint)">
        <div class="card-row">
          <div style="flex:1"><h3 style="font-size:15px">${esc(t('joinPending'))} · ${join.count}</h3>
          <div class="meta">${esc(t('joinApprove'))} →</div></div>
          <span class="pill gold">${join.count}</span>
        </div>
      </div>` : ''}
    <div class="feed-top">
      <div class="seg feed-seg no-tab-swipe">
        ${KINDS.map(([k, label]) => `<button data-kind="${k}" class="${kind === k ? 'on' : ''}">${esc(t(label))}</button>`).join('')}
      </div>
      <button class="btn btn-primary feed-new" data-new aria-label="${esc(t('feedNew'))}">＋</button>
    </div>
    <div class="feed" data-feed><div class="fcol"></div><div class="fcol"></div></div>
    <div class="feed-more" data-sentinel><span class="spin-dot"></span></div>
    <div class="empty" data-empty hidden>${esc(t('feedEmpty'))}</div>`;

  el.querySelector('[data-go-members]')?.addEventListener('click', () => state.go('members'));
  el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { state.feedKind = b.dataset.kind; again(); });
  el.querySelector('[data-new]').onclick = () => newSheet(state, again);

  const feed = el.querySelector('[data-feed]');
  const cols = [...feed.children];
  const sentinel = el.querySelector('[data-sentinel]');
  const items = [];             // 지금까지 받은 카드 (사진 카드는 크게 보기에서 옆으로 넘긴다)
  let next = '', busy = false, done = false;

  const load = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const q = new URLSearchParams({ lang: 'en', limit: '20' });
      if (kind !== 'all') q.set('kind', kind);
      if (next) q.set('before', next);
      const d = await api(`/feed?${q}`);
      if (my !== run) return;
      const ratios = await Promise.all(d.rows.map(r => (r.photo ? ratioOf(r.photo) : null)));
      if (my !== run) return;
      d.rows.forEach((r, i) => {
        items.push(r);
        const html = card(r, ratios[i], items.length - 1);
        // 짧은 열에 붙인다 — 사진 비율을 미리 알아 두었으므로 붙이자마자 높이가 정해진다
        const col = cols[0].offsetHeight <= cols[1].offsetHeight ? cols[0] : cols[1];
        col.insertAdjacentHTML('beforeend', html);
      });
      next = d.next;
      done = !next;
      el.querySelector('[data-empty]').hidden = !!items.length;
      sentinel.hidden = done;
    } catch (e) {
      sentinel.hidden = true;
      if (!items.length) throw e;
    } finally { busy = false; }
    // 화면이 아직 안 찼으면 이어서 받는다
    if (!done && my === run && sentinel.getBoundingClientRect().top < innerHeight + 600) load();
  };

  feed.onclick = (e) => {
    const c = e.target.closest('[data-fi]');
    if (!c || e.target.closest('[data-view-photo]')) return;
    open(items[Number(c.dataset.fi)], items, state, again);
  };

  await load();
  observer = new IntersectionObserver((en) => { if (en.some(x => x.isIntersecting)) load(); }, { rootMargin: '700px 0px' });
  observer.observe(sentinel);
}

// 사진 비율(가로/세로) — 너무 길거나 납작한 사진은 잘라서 보여준다
function ratioOf(src) {
  return new Promise((ok) => {
    const img = new Image();
    let fin = false;
    const end = (v) => { if (!fin) { fin = true; ok(v); } };
    img.onload = () => end(img.naturalWidth && img.naturalHeight ? Math.min(1.5, Math.max(0.66, img.naturalWidth / img.naturalHeight)) : 1);
    img.onerror = () => end(1);
    setTimeout(() => end(1), 4000);
    img.src = src;
  });
}

function card(r, ratio, i) {
  const title = origText(r, 'title').text;
  const meta = `<div class="fmeta">${avatar(r.author || '?', r.author_photo, 'fav')}<span class="fwho">${esc(r.author || t('formerMember'))}</span>
      <span class="fwhen">${esc(timeAgo(r.created_at))}</span></div>`;
  const counts = r.type === 'post' && (r.likes || r.comments)
    ? `<div class="fcount">${r.likes ? `♥ ${r.likes}` : ''}${r.likes && r.comments ? ' · ' : ''}${r.comments ? `💬 ${r.comments}` : ''}</div>` : '';
  let sub = '';
  if (r.type === 'result') {
    sub = `<div class="fsub">${esc(t(r.kind === 'external' ? 'kindExternal' : 'kindMonthly'))}${r.excerpt ? ` · ${esc(origText(r, 'excerpt').text)}` : ''}</div>
      ${r.winners?.length ? `<div class="fwin">${MEDAL[r.place] || ''} ${esc(r.winners.join(' · '))}</div>` : ''}`;
  } else if (r.type === 'notice' && !r.photo && r.excerpt) {
    sub = `<div class="fexcerpt">${esc(origText(r, 'excerpt').text)}</div>`;
  }

  // 사진 없는 게시판 글 — 글을 크게 (카드 자체가 글)
  if (!r.photo && r.type === 'post') {
    return `<article class="fcard ftext-card" data-fi="${i}">
        <div class="ftext">${esc(title)}</div>${counts}${meta}</article>`;
  }
  return `<article class="fcard t-${r.type}" data-fi="${i}">
      ${r.photo ? `<div class="fimg" style="aspect-ratio:${ratio || 1}"><img src="${esc(r.photo)}" alt="" loading="lazy">
        ${r.photos > 1 ? `<span class="fmulti">▣ ${r.photos}</span>` : ''}
        ${r.video ? `<span class="fplay">▶</span>${r.duration ? `<span class="vbadge">${fmtDur(r.duration)}</span>` : ''}` : ''}</div>` : ''}
      <div class="fbody">
        ${BADGE[r.type] ? `<div class="fbadge b-${r.type}">${r.video ? `${BADGE.video} ${esc(t('video'))}` : `${BADGE[r.type]} ${esc(t(r.type === 'notice' ? 'tabNotices' : r.type === 'result' ? 'resultsTitle' : 'galleryTitle'))}`}</div>` : ''}
        ${title ? `<div class="ftitle">${esc(title)}</div>` : ''}
        ${sub}${counts}${meta}
      </div></article>`;
}

// 카드를 누르면 — 글은 글 창, 사진은 크게(옆으로 넘기기), 공지·성적은 그 탭의 그 자리로
function open(r, items, state, again) {
  if (!r) return;
  if (r.type === 'post') return openPost(r.id, state, () => {});
  if (r.type === 'photo') {
    const photos = items.filter(x => x.type === 'photo')
      .map(x => ({ id: x.id, member_id: x.member_id, photo: x.photo, video: x.video, duration: x.duration, caption: x.title, author: x.author, created_at: x.created_at }));
    return galleryViewer(photos, photos.findIndex(x => x.id === r.id), state, again);
  }
  if (r.type === 'notice') { state.focusNotice = String(r.id); return state.go('notices'); }
  if (r.type === 'result') { state.focusResult = String(r.id); return state.go('results'); }
}

// ＋ — 무엇을 올릴지 고른다 (공지는 운영진, 성적은 운영진·성적 담당)
function newSheet(state, again) {
  const root = document.getElementById('modalRoot');
  const isAdmin = state.me.role === 'admin' || !!state.me.is_owner;
  const opts = [
    ['post', '✏️', t('newPost')],
    ['photo', '📷', t('galleryAdd')],
    ...(isAdmin ? [['notice', '📣', t('newNotice')]] : []),
    ...(canResults(state.me) ? [['result', '🏆', t('resultAdd')]] : []),
  ];
  root.innerHTML = `
    <div class="modal" data-modal><div class="modal-body">
      <div class="modal-head"><h3>${esc(t('feedNew'))}</h3></div>
      ${opts.map(([k, icon, label]) => `<button class="sheet-item" data-pick="${k}">${icon}&nbsp; ${esc(label)}</button>`).join('')}
      <button class="sheet-item muted" data-x>${esc(t('cancel'))}</button>
    </div></div>`;
  const wrap = root.firstElementChild;
  wrap.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (e.target === wrap || e.target.closest('[data-x]')) { root.innerHTML = ''; return; }
    if (!b) return;
    root.innerHTML = '';
    const k = b.dataset.pick;
    if (k === 'post') postForm(null, state, again);
    else if (k === 'photo') uploadForm(again);
    else if (k === 'notice') noticeForm(null, state, again);
    else if (k === 'result') resultForm(null, again);
  };
}

