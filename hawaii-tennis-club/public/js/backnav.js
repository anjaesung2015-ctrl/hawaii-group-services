// 뒤로가기 — 폰의 뒤로 버튼(안드로이드)·뒤로 쓸기가 열린 창(모달·☰ 메뉴)을 먼저 닫게 한다.
// 앱으로 설치하면 브라우저 뒤로 버튼이 없어서, 그냥 두면 창이 열린 채 이전 탭으로 가거나 앱이 꺼진다.
//
// 방법: 창이 열리면 history 에 한 칸을 쌓고, 닫히면 그 칸을 스스로 걷어낸다(history.back).
// 창을 여닫는 코드가 여러 곳(openModal, 사진 크게 보기, 미납 되돌리기 …)이라
// 각 코드를 고치지 않고 #modalRoot 내용과 #menuSheet 표시 여부를 지켜본다.
// 스스로 부른 back 은 popstate 를 앱(탭 이동)까지 보내지 않고 여기서 삼킨다.
// 이 모듈의 popstate 리스너가 app.js 것보다 먼저 등록돼야 한다 (initBackNav 를 먼저 부른다).
let owns = false;     // 지금 열린 창 몫의 history 칸이 있는가
let pending = 0;      // 스스로 부른 back 중 아직 popstate 가 안 온 개수

export function initBackNav() {
  const root = document.getElementById('modalRoot');
  const sheet = document.getElementById('menuSheet');
  const isOpen = () => !!root.innerHTML.trim() || !sheet.hidden;

  const sync = () => {
    const open = isOpen();
    if (open && !owns && !pending) {
      history.pushState({ ...(history.state || {}), overlay: 1 }, '');
      owns = true;
    } else if (!open && owns) {
      owns = false;
      pending++;
      history.back();
    }
  };
  const mo = new MutationObserver(sync);
  mo.observe(root, { childList: true });
  mo.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });

  window.addEventListener('popstate', (e) => {
    if (pending) {                 // 창을 닫으며 우리가 부른 back — 탭은 그대로
      pending--;
      e.stopImmediatePropagation();
      sync();                      // 그 사이 새 창이 열렸으면 다시 한 칸 쌓는다
      return;
    }
    if (owns) {                    // 창이 열린 채 폰 뒤로 → 창만 닫는다
      owns = false;
      e.stopImmediatePropagation();
      root.innerHTML = '';
      sheet.hidden = true;
    }
  });
}
