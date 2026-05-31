window.__i18n = { messages: {}, lang: 'mn' };

// URL query ?lang=ko 또는 ?lang=mn 감지. 미지원/없으면 mn
function detectLang() {
  const SUPPORTED = ['mn', 'ko'];
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('lang');
    if (q && SUPPORTED.includes(q)) return q;
  } catch (e) {}
  return 'mn';
}

async function loadLocale(lang) {
  if (!lang) lang = detectLang();
  const prefix = window.PATH_PREFIX || '';
  try {
    const res = await fetch(`${prefix}/locales/${lang}.json`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    window.__i18n.messages = await res.json();
    window.__i18n.lang = lang;
  } catch (e) {
    // 폴백: mn
    if (lang !== 'mn') {
      console.warn('Failed to load', lang, '- falling back to mn');
      return loadLocale('mn');
    }
    throw e;
  }
}

function t(key, vars = {}) {
  let s = window.__i18n.messages[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
window.t = t;
window.loadLocale = loadLocale;
window.detectLang = detectLang;
