// 뒤로가기 — 폰의 뒤로 버튼(안드로이드)·뒤로 쓸기가 열린 창(모달·☰ 메뉴·사진 크게 보기)을 먼저 닫게 한다.
// 앱으로 설치하면 브라우저 뒤로 버튼이 없어서, 그냥 두면 창이 열린 채 이전 탭으로 가거나 앱이 꺼진다.
//
// 방법: 열린 겹(층) 수만큼 history 에 칸을 쌓고, 닫히면 그만큼 스스로 걷어낸다(history.go(-n)).
// 겹 = #modalRoot 내용 · #menuSheet · body 바로 아래 .photo-view(사진 크게)·.crop-ov(사진 맞추기).
// 가입 신청서 위에 사진을 크게 띄운 것처럼 겹이 쌓이면, 뒤로 한 번에 맨 위 하나만 닫힌다.
// 창을 여닫는 코드가 여러 곳이라 각 코드를 고치지 않고 화면을 지켜본다(MutationObserver).
// 스스로 부른 back 은 popstate 를 앱(탭 이동)까지 보내지 않고 여기서 삼킨다.
// 이 모듈의 popstate 리스너가 app.js 것보다 먼저 등록돼야 한다 (initBackNav 를 먼저 부른다).
const LAYERS = ':scope > .photo-view, :scope > .crop-ov';
let entries = 0;      // 열린 겹 몫으로 쌓아 둔 history 칸 수
let pending = 0;      // 스스로 부른 back(go) 중 아직 popstate 가 안 온 개수

export function initBackNav() {
  const root = document.getElementById('modalRoot');
  const sheet = document.getElementById('menuSheet');
  const layers = () => [...document.body.querySelectorAll(LAYERS)];
  const depth = () => (root.innerHTML.trim() ? 1 : 0) + (sheet.hidden ? 0 : 1) + layers().length;

  const sync = () => {
    if (pending) return;           // 걷어내는 중 — popstate 가 온 뒤 다시 맞춘다
    const d = depth();
    while (entries < d) {
      history.pushState({ ...(history.state || {}), overlay: 1 }, '');
      entries++;
    }
    if (entries > d) {
      const n = entries - d;
      entries = d;
      pending++;
      history.go(-n);
    }
  };
  const mo = new MutationObserver(sync);
  mo.observe(root, { childList: true });
  mo.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
  mo.observe(document.body, { childList: true });   // 사진 크게·맞추기 겹

  window.addEventListener('popstate', (e) => {
    if (pending) {                 // 창을 닫으며 우리가 부른 back — 탭은 그대로
      pending--;
      e.stopImmediatePropagation();
      sync();                      // 그 사이 새 창이 열렸으면 다시 쌓는다
      return;
    }
    if (entries > 0) {             // 창이 열린 채 폰 뒤로 → 맨 위 겹 하나만 닫는다
      entries--;
      e.stopImmediatePropagation();
      const top = layers().pop();
      if (top) {
        // 사진 맞추기는 '취소'로 닫아야 기다리던 쪽(pickFacePhoto)이 끝난다
        const cancel = top.querySelector('[data-cancel]');
        if (cancel) cancel.click(); else top.remove();
      } else if (!sheet.hidden) sheet.hidden = true;
      else root.innerHTML = '';
    }
  });
}
