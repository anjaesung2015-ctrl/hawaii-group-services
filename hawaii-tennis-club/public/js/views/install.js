// 앱 설치(홈 화면에 추가) — 로그인 화면과 ☰ 메뉴에서 연다.
// 앱을 지웠다가 다시 깔 때 브라우저가 설치 안내를 다시 띄워 주지 않는 경우가 많아서
// (한 번 닫으면 몇 달 동안 안 뜬다) 버튼을 직접 둔다.
// 크롬·엣지·삼성인터넷은 beforeinstallprompt 로 바로 설치 창을 띄우고,
// 그게 안 되는 곳(아이폰, 카톡 같은 앱 안 브라우저)은 손으로 하는 방법을 보여 준다.
import { esc, toast, openModal } from '../ui.js';
import { t } from '../i18n.js';

let deferred = null;   // 브라우저가 넘겨준 설치 요청 — prompt() 는 한 번만 쓸 수 있다

const ua = () => navigator.userAgent;
const isIos = () => /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
// 카톡·페북·인스타·라인·네이버 앱 안에서 연 페이지는 설치가 아예 안 된다
const isInApp = () => /KAKAOTALK|FBAN|FBAV|Instagram|Line\/|NAVER|DaumApps|Telegram/i.test(ua());
const isSamsung = () => /SamsungBrowser/i.test(ua());
export const isStandalone = () => window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

const buttons = () => document.querySelectorAll('[data-install]');
const sync = () => buttons().forEach(b => { b.hidden = isStandalone(); });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();        // 브라우저 기본 띠 대신 우리 버튼으로 띄운다
  deferred = e;
  sync();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  sync();
  toast(t('installDone'));
});

export function initInstall(onOpen) {
  sync();
  buttons().forEach(b => b.onclick = () => { if (onOpen) onOpen(); openInstall(); });
}

// 초대 링크 — 열면 로그인 화면에서 가입 신청서가 바로 뜬다(app.js boot 의 #join).
// 설치 버튼과 달리 앱으로 열려 있어도 보인다(회원이 친구에게 보낼 때 쓰니까).
export const inviteUrl = () => new URL('./#join', location.href).href;

async function copyText(url) {
  try { await navigator.clipboard.writeText(url); toast(t('installCopied')); }
  catch (e) { prompt(t('installCopy'), url); }
}

// 폰 공유 창(카톡·텔레그램·메신저…)을 바로 띄운다. 공유를 못 하는 기기(PC 등)는 초대 창(QR+복사)으로
export async function shareInvite(clubName) {
  const url = inviteUrl();
  if (!navigator.share) return openInvite(clubName);
  try { await navigator.share({ title: clubName, text: t('inviteText', { club: clubName }), url }); }
  catch (e) { if (e.name !== 'AbortError') openInvite(clubName); }   // 공유 창을 그냥 닫은 건 무시
}

export function openInvite(clubName) {
  const url = inviteUrl();
  const m = openModal({
    title: t('inviteTitle'),
    fields: [],
    extra: `<div class="hint">${esc(t('inviteHint'))}</div>
      <img class="invite-qr" src="api/invite/qr.svg?u=${encodeURIComponent(url)}" alt="QR">
      <div class="hint" style="text-align:center">${esc(t('inviteQrHint'))}</div>
      <input class="invite-url" type="text" readonly value="${esc(url)}">
      <button type="button" class="btn btn-primary" style="width:100%" data-copy>${esc(t('installCopy'))}</button>
      ${navigator.share ? `<button type="button" class="btn" style="width:100%;margin-top:8px" data-share>${esc(t('inviteShare'))}</button>` : ''}`,
    saveLabel: t('close'),
    onSave: () => {},
  });
  const box = m.form.querySelector('.invite-url');
  box.onfocus = () => box.select();
  m.form.querySelector('[data-copy]').onclick = () => copyText(url);
  const share = m.form.querySelector('[data-share]');
  if (share) share.onclick = async () => {
    try { await navigator.share({ title: clubName, text: t('inviteText', { club: clubName }), url }); }
    catch (e) { if (e.name !== 'AbortError') copyText(url); }
  };
}

export async function openInstall() {
  if (deferred) {
    const ev = deferred;
    deferred = null;
    try {
      ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') return;
    } catch (e) { /* 아래 안내로 넘어간다 */ }
  }

  let steps;
  if (isInApp()) steps = [t('installInApp'), isIos() ? t('installIos') : t('installAndroid')];
  else if (isIos()) steps = [t('installIos')];
  else if (isSamsung()) steps = [t('installSamsung')];
  else if (isAndroid()) steps = [t('installAndroid'), t('installAndroidStuck')];
  else steps = [t('installDesktop')];

  const m = openModal({
    title: t('installTitle'),
    fields: [],
    extra: `<ol class="install-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="hint">${esc(t('installLink'))}</div>
      <button type="button" class="btn" style="width:100%" data-copy>${esc(t('installCopy'))}</button>`,
    saveLabel: t('close'),
    onSave: () => {},
  });
  m.form.querySelector('[data-copy]').onclick = () => copyText(new URL('./', location.href).href);
}
