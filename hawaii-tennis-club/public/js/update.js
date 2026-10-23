// 새 버전 자동 새로고침 — 서버의 화면 파일이 바뀌면(배포) 앱을 다시 불러온다.
// 홈 화면 앱은 며칠씩 켜져 있어서, 그냥 두면 고친 화면이 회원 폰에 안 보인다(상단 ↻ 는 데이터만 다시 불러옴).
// 확인 시점: 앱을 처음 열 때(기준값), 다시 화면으로 돌아올 때, 5분마다, ↻ 를 누를 때.
// 쓰던 글이 날아가지 않게 창(모달)·메뉴가 열려 있거나 입력칸에 글이 있으면 끝날 때까지 미룬다.
const CHECK_MS = 5 * 60 * 1000;
const RETRY_MS = 5 * 1000;

let loaded = null;     // 이 화면을 불러올 때의 버전
let pending = false;   // 새 버전이 나왔는데 아직 새로고침 못 함
let retry = 0;

async function fetchVersion() {
  const r = await fetch('api/version', { cache: 'no-store' });
  if (!r.ok) throw new Error('version ' + r.status);
  return (await r.json()).v;
}

// 지금 새로고침하면 뭔가 잃어버리는 상태인가
function busy() {
  if (document.querySelector('#modalRoot')?.innerHTML.trim()) return true;
  if (document.querySelector('#menuSheet')?.hidden === false) return true;
  // 로그인 화면(전화번호만 친 상태)은 잃을 게 없으니 앱 화면 안의 입력칸만 본다
  return [...document.querySelectorAll('#appView textarea, #appView input:not([type=hidden]):not([type=search]):not([readonly])')]
    .some(el => el.value && el.offsetParent !== null);
}

function tryReload() {
  clearTimeout(retry);
  if (!pending) return;
  if (busy()) { retry = setTimeout(tryReload, RETRY_MS); return; }
  location.reload();
}

export async function checkUpdate() {
  try {
    const v = await fetchVersion();
    if (!loaded) loaded = v;
    else if (v !== loaded) pending = true;
  } catch (e) { return; }   // 잠깐 끊겨도 다음 차례에 다시
  tryReload();
}

export function initUpdate() {
  checkUpdate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setInterval(() => { if (!document.hidden) checkUpdate(); }, CHECK_MS);
}
