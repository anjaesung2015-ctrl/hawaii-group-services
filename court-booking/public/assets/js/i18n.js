window.__i18n = { messages: {}, lang: 'mn' };

async function loadLocale(lang = 'mn') {
  const res = await fetch(`/booking/locales/${lang}.json`).catch(() => fetch(`/locales/${lang}.json`));
  window.__i18n.messages = await res.json();
  window.__i18n.lang = lang;
}

function t(key, vars = {}) {
  let s = window.__i18n.messages[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
window.t = t;
window.loadLocale = loadLocale;
