// 폰 알림 켜기/끄기 — ☰ 메뉴에서 연다.
// 아이폰은 '홈 화면에 추가' 한 상태에서만 알림을 받을 수 있다(iOS 제약)。
import { api, esc, toast, openModal, errText, $ } from '../ui.js';
import { t } from '../i18n.js';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
}

export async function openPushPanel() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const m = openModal({
    title: t('pushTitle'),
    fields: [],
    extra: `<div data-push>${esc(t('loading'))}</div>`,
    saveLabel: t('close'),
    onSave: () => {},
  });
  const box = m.form.querySelector('[data-push]');

  if (!supported) { box.innerHTML = `<div class="hint">${esc(t('pushNo'))}</div>`; return; }
  if (isIos() && !isStandalone()) {
    box.innerHTML = `<div class="hint"><b>${esc(t('pushNeedHome'))}</b><br>${esc(t('pushHowIos'))}</div>`;
    return;
  }

  const draw = async () => {
    const d = await api('/push');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    const onHere = !!sub;        // 이 기기에서 켜져 있는지

    box.innerHTML = onHere
      ? `<div class="push-on">🔔 ${esc(t('pushOn'))}</div>
         <div class="hint">${esc(t('pushWhat'))}</div>
         <div class="modal-actions">
           <button type="button" class="btn" data-test>${esc(t('pushTest'))}</button>
           <button type="button" class="btn btn-danger" data-off>${esc(t('pushOff'))}</button>
         </div>`
      : `<div class="hint">${esc(t('pushWhat'))}</div>
         <button type="button" class="btn btn-primary" style="width:100%;margin-top:8px" data-on>🔔 ${esc(t('pushTurnOn'))}</button>
         ${d.devices ? `<div class="hint">${esc(t('pushOtherDevice', { n: d.devices }))}</div>` : ''}`;

    const on = box.querySelector('[data-on]');
    if (on) on.onclick = async () => {
      on.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast(t('pushDenied'), true); on.disabled = false; return; }
        const r = await navigator.serviceWorker.register('sw.js', { scope: './' });
        await navigator.serviceWorker.ready;
        const info = await api('/push');
        const s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(info.publicKey) });
        await api('/push', { method: 'POST', body: s.toJSON() });
        toast(t('pushOn'));
        draw();
      } catch (e) {
        toast(errText(e), true);
        on.disabled = false;
      }
    };

    const off = box.querySelector('[data-off]');
    if (off) off.onclick = async () => {
      const reg2 = await navigator.serviceWorker.getRegistration();
      const s = reg2 && await reg2.pushManager.getSubscription();
      if (s) {
        await api('/push', { method: 'DELETE', body: { endpoint: s.endpoint } }).catch(() => {});
        await s.unsubscribe().catch(() => {});
      } else {
        await api('/push', { method: 'DELETE' }).catch(() => {});
      }
      toast(t('pushOffDone'));
      draw();
    };

    const test = box.querySelector('[data-test]');
    if (test) test.onclick = async () => {
      test.disabled = true;
      try { await api('/push/test', { method: 'POST' }); toast(t('pushSent')); }
      catch (e) { toast(errText(e), true); }
      test.disabled = false;
    };
  };

  draw().catch(() => { box.innerHTML = `<div class="hint">${esc(t('failed'))}</div>`; });
}
