// 당겨서 새로고침 — 맨 위에서 아래로 끌어 내리면 지금 탭을 다시 불러온다.
// css 의 overscroll-behavior-y: contain 이 브라우저 기본 새로고침을 막으니(앱으로 설치하면 원래 없다) 직접 만든다.
// 옆으로 끄는 동작(홈 공지 넘기기)과 섞이지 않게 세로로 더 많이 움직였을 때만 반응한다.
const PULL = 70;     // 이만큼 당기고 놓으면 새로고침
const MAX = 110;

export function initPullRefresh(onRefresh, { enabled = () => true } = {}) {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(ind);

  let y0 = null, x0 = 0, dy = 0, busy = false, vertical = null;

  const show = (d) => {
    ind.style.transform = `translate(-50%, ${Math.min(d, MAX) - 50}px) rotate(${d * 3}deg)`;
    ind.style.opacity = Math.min(d / PULL, 1);
    ind.classList.toggle('ready', d >= PULL);
  };
  const reset = () => { ind.style.transform = ''; ind.style.opacity = ''; ind.classList.remove('ready', 'spin'); };

  window.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || !enabled()) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; vertical = null;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
    if (vertical == null && (Math.abs(ddy) > 8 || Math.abs(ddx) > 8)) vertical = Math.abs(ddy) > Math.abs(ddx) && ddy > 0;
    if (!vertical || window.scrollY > 0) return;
    dy = ddy * 0.5;          // 손가락보다 덜 따라오게 해서 '당기는' 느낌
    show(dy);
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (!vertical || dy < PULL) { reset(); return; }
    busy = true;
    ind.classList.add('spin');
    ind.style.transform = `translate(-50%, ${PULL - 50}px)`;
    try { await refresh(onRefresh); } finally { busy = false; reset(); }
  });
}

// 상단 새로고침 버튼도 같은 걸 부른다 — 너무 빨리 끝나면 돈 줄도 모르니 최소 0.4초는 돈다
export async function refresh(onRefresh) {
  await Promise.all([onRefresh(), new Promise(r => setTimeout(r, 400))]);
}
