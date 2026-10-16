// Club rules — members read, the owner edits (rules appendix art. 2).
// The app itself is in English, but the rules document is written in Korean and Mongolian,
// so this screen has its own language picker. Also opens from the application form (before login).
import { api, esc, toast, openModal, errText, $$ } from '../ui.js';
import { t } from '../i18n.js';

const DOC_LANGS = [['ko', 'rulesLangKo'], ['mn', 'rulesLangMn']];
let lastLang = 'ko';            // 마지막으로 본 언어를 기억한다

// 장 제목(■)과 조문(제N조 / N дугаар зүйл)만 굵게 — 긴 글을 눈으로 따라가기 쉽게
export function renderRules(body) {
  return esc(body)
    .split('\n')
    .map(line => {
      if (/^■/.test(line)) return `<div class="rl-chapter">${line.replace(/^■\s*/, '')}</div>`;
      if (/^(제\s*\d+조|\d+\s*(дугаар|дүгээр)\s*зүйл)/.test(line)) return `<div class="rl-article">${line}</div>`;
      if (!line.trim()) return '<div class="rl-gap"></div>';
      return `<div class="rl-line">${line}</div>`;
    })
    .join('');
}

export async function openRules({ canEdit = false, onAgree = null, lang = null } = {}) {
  const docLang = lang || lastLang;
  let d;
  try { d = await api(`/docs/rules?lang=${docLang}`); }
  catch (e) { toast(errText(e), true); return; }
  lastLang = d.lang;

  const picker = DOC_LANGS.map(([code, key]) =>
    `<button type="button" class="rl-lang${code === d.lang ? ' on' : ''}" data-doc-lang="${code}">${esc(t(key))}</button>`).join('');

  const m = openModal({
    title: t('rulesTitle'),
    fields: [],
    extra: `
      <div class="rl-top">
        <div class="rl-langs">${picker}</div>
        <div class="rl-meta">${esc(t('rulesVersion', { v: d.version }))} · ${esc(String(d.updated_at).slice(0, 10))}</div>
      </div>
      <div class="rl-body">${renderRules(d.body)}</div>
      ${onAgree ? `<label class="rl-agree"><input type="checkbox" data-agree><span>${esc(t('rulesAgreeCheck'))}</span></label>` : ''}
      ${canEdit ? `<button type="button" class="btn btn-sm" style="width:100%;margin-top:12px" data-edit>${esc(t('rulesEdit'))}</button>` : ''}`,
    saveLabel: onAgree ? t('rulesAgreeBtn') : t('close'),
    onSave: async () => {
      if (!onAgree) return;
      if (!m.form.querySelector('[data-agree]').checked) return t('rulesAgreeCheck');
      await onAgree();
    },
  });

  // 언어를 바꾸면 그 언어의 원문으로 다시 띄운다
  $$('[data-doc-lang]', m.form).forEach(b => b.onclick = () => {
    if (b.dataset.docLang === d.lang) return;
    m.close();
    openRules({ canEdit, onAgree, lang: b.dataset.docLang });
  });

  const edit = m.form.querySelector('[data-edit]');
  if (edit) edit.onclick = () => { m.close(); editRules(d); };
}

// 공지 탭의 회칙 카드에서 바로 고칠 때 — 마지막으로 본 언어로 연다
export async function editRulesNow(onSaved) {
  try { editRules(await api(`/docs/rules?lang=${lastLang}`), onSaved); }
  catch (e) { toast(errText(e), true); }
}

// 개정 — 긴 글이라 통째로 고친다. 저장하면 판 번호가 1 올라가고 전원에게 다시 동의를 받는다.
// '작은 수정'에 체크하면(오타·띄어쓰기) 판 번호는 그대로 — 회원에게 다시 묻지 않는다.
function editRules(d, onSaved) {
  const other = d.lang === 'mn' ? 'ko' : 'mn';
  const m = openModal({
    title: `${t('rulesEdit')} (${d.lang === 'mn' ? t('rulesLangMn') : t('rulesLangKo')})`,
    fields: [
      { name: 'body', label: t('rulesTitle'), type: 'textarea', value: d.body },
      { name: 'minor', label: t('rulesMinor'), type: 'checkbox', value: false },
    ],
    extra: `<div class="hint">${esc(t('rulesEditHint'))}</div>
      <button type="button" class="btn btn-sm btn-ghost" style="width:100%" data-other>${esc(t('rulesEditOther', { l: t(other === 'mn' ? 'rulesLangMn' : 'rulesLangKo') }))}</button>`,
    onSave: async (v) => {
      if (!v.body || v.body.length < 50) return t('required');
      const r = await api('/docs/rules', { method: 'PUT', body: { lang: d.lang, body: v.body, minor: !!v.minor } });
      toast(t('rulesSaved', { v: r.version }));
      if (onSaved) onSaved();
    },
  });
  m.form.querySelector('textarea[name="body"]').classList.add('rules-edit');
  // 다른 언어 원문으로 바꿔서 고치기 (지금 쓰던 건 저장 안 됨)
  m.form.querySelector('[data-other]').onclick = async () => {
    m.close();
    lastLang = other;
    editRulesNow(onSaved);
  };
}

// 아직 동의하지 않은 회원에게 로그인 직후 한 번 띄운다
export async function askAgreeIfNeeded(state) {
  if (state.rules_agreed) return;
  await openRules({
    canEdit: false,
    onAgree: async () => {
      await api('/auth/agree-rules', { method: 'POST' });
      state.rules_agreed = true;
      toast(t('rulesAgreed'));
    },
  });
}
