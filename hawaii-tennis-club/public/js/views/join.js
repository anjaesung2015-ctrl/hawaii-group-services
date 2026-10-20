// 가입 신청서 — 로그인 화면에서 연다. 종이 '회칙 동의서'를 그대로 옮겼다:
// 성명 · 영문 이름 · 연락처 · 티셔츠 사이즈 · 추천 회원 + 회칙 동의 · 개인정보 동의.
// 회칙은 신청서 안의 상자에서 읽는다(따로 창을 열면 쓰던 내용이 날아가서).
// 회칙을 끝까지 내려 읽어야 동의 칸이 켜지고, 두 동의가 다 있어야 보내진다 → 그때서야 임원에게 알림이 간다.
import { api, esc, toast, openModal, $ } from '../ui.js';
import { t, levelLabel } from '../i18n.js';
import { renderRules } from './rules.js';

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

export function openJoinForm() {
  const m = openModal({
    title: t('joinRequest'),
    fields: [
      { name: 'name', label: t('joinName'), placeholder: t('joinName') },
      { name: 'name_en', label: t('joinNameEn'), placeholder: 'Bat-Erdene' },
      { name: 'phone', label: t('phone'), type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: '99112233' },
      { name: 'pin', label: t('joinPin'), type: 'tel', inputmode: 'numeric', maxlength: 4, placeholder: '1234' },
      { name: 'shirt_size', label: t('joinShirt'), type: 'select', value: '',
        options: [{ value: '', label: '—' }, ...SIZES.map(s => ({ value: s, label: s }))] },
      { name: 'level', label: t('level'), type: 'select', value: 'beginner',
        options: LEVELS.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'is_coach', label: t('joinAs'), type: 'select', value: '0',
        options: [{ value: '0', label: t('joinAsMember') }, { value: '1', label: t('joinAsCoach') }] },
      { name: 'recommenders', label: t('joinRecommenders'), placeholder: t('joinRecommendersPh') },
    ],
    extra: `
      <div class="hint">${esc(t('joinHint'))}</div>
      <div class="section-head" style="margin:14px 2px 6px"><h2>${esc(t('rulesTitle'))}</h2><span class="spacer"></span>
        <div class="rl-langs" data-langs>
          <button type="button" class="rl-lang on" data-lang="ko">${esc(t('rulesLangKo'))}</button>
          <button type="button" class="rl-lang" data-lang="mn">${esc(t('rulesLangMn'))}</button>
        </div></div>
      <div class="rl-body join-rules" data-rules>${esc(t('loading'))}</div>
      <div class="hint" data-read-hint>↓ ${esc(t('joinReadToEnd'))}</div>
      <label class="rl-agree is-off" data-agree-wrap><input type="checkbox" name="agree" disabled><span>${esc(t('rulesAgreeCheck'))}</span></label>
      <label class="rl-agree"><input type="checkbox" name="privacy"><span>${esc(t('joinPrivacy'))}</span></label>`,
    saveLabel: t('joinSend'),
    onSave: async (v, form) => {
      if (!v.name || !v.name_en) return t('required');
      if (!/^\d{4}$/.test(v.pin)) return t('pin4');
      if (!v.shirt_size) return t('joinShirtPick');
      if (!form.querySelector('[name="agree"]').checked) return t('joinNeedRules');
      if (!form.querySelector('[name="privacy"]').checked) return t('joinNeedPrivacy');
      await api('/join', { method: 'POST', body: { ...v, agree: true, privacy: true } });
      toast(t('joinDone'));
      $('#loginPhone').value = v.phone;
    },
  });

  // 회칙 상자 — 끝까지 내려 읽으면 동의 칸이 켜진다
  const box = m.form.querySelector('[data-rules]');
  const agree = m.form.querySelector('[name="agree"]');
  const wrap = m.form.querySelector('[data-agree-wrap]');
  const hint = m.form.querySelector('[data-read-hint]');
  let read = false;
  const check = () => {
    if (read || box.scrollTop + box.clientHeight < box.scrollHeight - 24) return;
    read = true;
    agree.disabled = false;
    wrap.classList.remove('is-off');
    hint.textContent = '✓ ' + t('joinReadDone');
  };
  box.addEventListener('scroll', check, { passive: true });

  const load = async (lang) => {
    try {
      const d = await api(`/docs/rules?lang=${lang}`);
      box.innerHTML = renderRules(d.body);
      box.scrollTop = 0;
      check();        // 글이 짧아 스크롤이 없으면 바로 켠다
    } catch (e) { box.textContent = t('failed'); }
  };
  m.form.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
    m.form.querySelectorAll('[data-lang]').forEach(x => x.classList.toggle('on', x === b));
    load(b.dataset.lang);
  });
  load('ko');
}
