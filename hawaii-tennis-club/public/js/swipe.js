// 옆으로 밀어 넘기기 (2026-11-12 사장님 지시)
//  - onSwipe(el, fn): el 위에서 옆으로 밀면 fn(+1 다음 / -1 이전) — 캘린더 달 넘기기가 쓴다
//  - initTabSwipe: 화면 아무 데서나 옆으로 밀면 하단 탭 순서대로 이동
// 세로 스크롤을 방해하지 않게 옆으로 충분히(70px), 세로보다 훨씬 많이 움직였을 때만 넘긴다.
const MIN_X = 70;
const RATIO = 1.8;      // 가로 이동이 세로의 1.8배 이상
const MAX_MS = 800;
const EDGE = 24;        // 화면 가장자리에서 시작한 밀기는 폰 자체 뒤로가기 몸짓이라 건드리지 않는다

function track(el, test, fn) {
  let s = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { s = null; return; }
    const p = e.touches[0];
    s = test(e, p) ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!s) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y, dt = Date.now() - s.t;
    s = null;
    if (dt > MAX_MS || Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    fn(dx < 0 ? 1 : -1);
  }, { passive: true });
  el.addEventListener('touchcancel', () => { s = null; }, { passive: true });
}

export function onSwipe(el, fn) {
  track(el, () => true, fn);
}

// 자기가 옆으로 움직이는 곳(공지 슬라이드·사진 줄·캘린더·표)이나 입력칸에서 시작하면 탭을 넘기지 않는다
const OWN = '.nslider, .gstrip, .cal, input, textarea, select, [contenteditable], .no-tab-swipe';
function scrollsSideways(node, stop) {
  for (let n = node; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function initTabSwipe(root, { canSwipe, tabs, current, go }) {
  track(root, (e, p) => {
    if (p.clientX < EDGE || p.clientX > window.innerWidth - EDGE) return false;
    if (!canSwipe()) return false;
    const tg = e.target;
    if (tg.closest?.(OWN)) return false;
    return !scrollsSideways(tg, root);
  }, (dir) => {
    const list = tabs();
    const i = list.indexOf(current());
    if (i < 0) return;
    const next = list[i + dir];
    if (next) go(next);
  });
}
