async function _fetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(body?.error_code || `HTTP_${res.status}`);
    err.error_code = body?.error_code;
    err.message_mn = body?.message_mn;
    err.body = body;
    throw err;
  }
  return body;
}

window.api = {
  get: (url) => _fetch(url, { method: 'GET' }),
  post: (url, body) => _fetch(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: (url, body) => _fetch(url, { method: 'PATCH', body: JSON.stringify(body) })
};
