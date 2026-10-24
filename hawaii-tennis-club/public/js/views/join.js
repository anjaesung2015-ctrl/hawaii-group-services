// 가입 신청서 — 로그인 화면에서 연다. 종이 '회칙 동의서'를 그대로 옮겼다:
// 성명 · 영문 이름 · 연락처 · 티셔츠 사이즈 · 추천 회원 + 회칙 동의 · 개인정보 동의.
// 회칙은 신청서 안의 상자에서 읽는다(따로 창을 열면 쓰던 내용이 날아가서).
// 회칙을 끝까지 내려 읽어야 동의 칸이 켜지고, 두 동의가 다 있어야 보내진다 → 그때서야 임원에게 알림이 간다.
// 맨 위에서 동호인반 / 엘리트선수반을 고른다. 선수반 신청서는 회칙 대신 개인정보 동의만, 오너가 승인한다.
import { api, esc, toast, openModal, pickFacePhoto, avatar, $ } from '../ui.js';
import { t, levelLabel, fmtMoney } from '../i18n.js';
import { renderRules } from './rules.js';
import { bankCard, bindBankCopy } from './dues.js';

const LEVELS = ['newbie', 'beginner', 'intermediate', 'advanced'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

// 맨 위 반 고르기 — 누르면 그 반 신청서로 다시 연다
function programSwitch(m, current) {
  m.form.insertAdjacentHTML('afterbegin', `
    <div class="join-prog rl-langs" role="group">
      <button type="button" class="rl-lang ${current === 'club' ? 'on' : ''}" data-prog="club">${esc(t('joinClub'))}</button>
      <button type="button" class="rl-lang ${current === 'elite' ? 'on' : ''}" data-prog="elite">${esc(t('joinElite'))}</button>
    </div>`);
  m.form.querySelectorAll('[data-prog]').forEach(b => b.onclick = () => {
    if (b.dataset.prog !== current) openJoinForm(b.dataset.prog);
  });
}

// 얼굴 사진(선택) — 고르고 틀에 맞춘 뒤 신청할 때 함께 보낸다. 승인되면 그대로 회원 사진이 된다.
function photoPicker(m) {
  let photo = null;
  const box = m.form.querySelector('[data-photo-box]');
  const draw = () => {
    box.innerHTML = `${avatar(m.form.querySelector('[name="name"]').value, photo, 'photo-preview')}
      <button type="button" class="btn btn-sm" data-photo>📷 ${esc(t(photo ? 'photoChoose' : 'joinPhotoAdd'))}</button>
      ${photo ? `<button type="button" class="btn btn-sm btn-danger" data-photo-del>${esc(t('photoRemove'))}</button>` : ''}`;
    box.querySelector('[data-photo]').onclick = async () => {
      const data = await pickFacePhoto();
      if (data) { photo = data; draw(); }
    };
    const del = box.querySelector('[data-photo-del]');
    if (del) del.onclick = () => { photo = null; draw(); };
  };
  draw();
  return () => photo;
}

const photoField = () => `
  <div class="field"><span>${esc(t('joinPhoto'))}</span>
    <div class="photo-edit" data-photo-box></div>
    <div class="hint" style="margin:0">${esc(t('joinPhotoHint'))}</div>
  </div>`;

export function openJoinForm(program = 'club') {
  if (program === 'elite') return openEliteForm();
  let getPhoto = () => null;
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
      ${photoField()}
      <div class="hint">${esc(t('joinHint'))}</div>
      <div data-bank></div>
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
      await api('/join', { method: 'POST', body: { ...v, agree: true, privacy: true, photo_data: getPhoto() || undefined } });
      toast(t('joinDone'));
      $('#loginPhone').value = v.phone;
    },
  });

  programSwitch(m, 'club');
  getPhoto = photoPicker(m);

  // 회칙 상자 — 끝까지 내려 읽으면 동의 칸이 켜진다
  const box = m.form.querySelector('[data-rules]');
  const agree = m.form.querySelector('[name="agree"]');

  // 입회비 계좌 — 설정은 로그인 없이 읽힌다. 못 불러오면 카드 없이 신청서만.
  const bankEl = m.form.querySelector('[data-bank]');
  api('/settings').then(s => {
    const fee = s.joining_fee ? `${fmtMoney(s.joining_fee)}${s.currency || ''}` : '';
    bankEl.innerHTML = bankCard(s, fee ? t('bankJoinHead', { fee }) : t('bankPayTo'));
    bindBankCopy(bankEl);
  }).catch(() => {});

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

// 엘리트선수반 신청서 — 주니어는 부모 번호로. 회칙 대신 개인정보 동의만, 입회비 없이 월 수강료 안내. 오너가 승인한다.
function openEliteForm() {
  let getPhoto = () => null;
  const m = openModal({
    title: t('joinRequest'),
    fields: [
      { name: 'name', label: t('joinName'), placeholder: t('joinName') },
      { name: 'phone', label: t('elitePhone'), type: 'tel', inputmode: 'numeric', maxlength: 15, placeholder: '99112233' },
      { name: 'pin', label: t('joinPin'), type: 'tel', inputmode: 'numeric', maxlength: 4, placeholder: '1234' },
      { name: 'birth_year', label: t('eliteBirthYear'), type: 'number', min: 1940, max: 2030, placeholder: '2012' },
      { name: 'level', label: t('level'), type: 'select', value: 'intermediate',
        options: LEVELS.map(l => ({ value: l, label: levelLabel(l) })) },
      { name: 'parent_name', label: t('eliteParentName') },
      { name: 'parent_phone', label: t('eliteParentPhone'), type: 'tel', inputmode: 'numeric', maxlength: 15 },
      { name: 'memo', label: t('memo') },
    ],
    extra: `
      ${photoField()}
      <div class="hint">${esc(t('joinEliteHint'))}</div>
      <div data-bank></div>
      <label class="rl-agree"><input type="checkbox" name="privacy"><span>${esc(t('joinPrivacy'))}</span></label>`,
    saveLabel: t('joinSend'),
    onSave: async (v, form) => {
      if (!v.name) return t('required');
      if (!/^\d{4}$/.test(v.pin)) return t('pin4');
      if (!form.querySelector('[name="privacy"]').checked) return t('joinNeedPrivacy');
      await api('/join', { method: 'POST', body: { ...v, program: 'elite', privacy: true, photo_data: getPhoto() || undefined } });
      toast(t('joinEliteDone'));
      $('#loginPhone').value = v.phone;
    },
  });
  programSwitch(m, 'elite');
  getPhoto = photoPicker(m);

  // 수강료 계좌 — 입회비 없이 월 수강료(매월 20일까지)
  const bankEl = m.form.querySelector('[data-bank]');
  api('/settings').then(s => {
    bankEl.innerHTML = bankCard(s, t('eliteJoinFeeHead', { fee: `${fmtMoney(s.elite_fee)}${s.currency || ''}`, day: 20 }));
    bindBankCopy(bankEl);
  }).catch(() => {});
}
