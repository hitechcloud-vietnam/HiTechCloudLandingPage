// Shared helpers for the dashboard pages.
window.HTC = (() => {
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    const publicPage = ['/app/login', '/app/signup', '/app/forgot', '/app/reset', '/app/invite'].some((p) => location.pathname.startsWith(p));
    if (res.status === 401 && !publicPage) {
      location.href = '/app/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error((data && data.error) || `Lỗi ${res.status}`);
    return data;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function slugify(text) {
    return String(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  }

  function formatVnd(n) {
    return n === 0 ? 'Miễn phí' : `${n.toLocaleString('vi-VN')}đ/tháng`;
  }

  function limit(n) {
    return n === null ? '∞' : n;
  }

  // Current workspace is remembered per browser; falls back to the first one.
  function currentWorkspace(workspaces) {
    let id = null;
    try { id = Number(localStorage.getItem('htc_ws')); } catch {}
    return workspaces.find((w) => w.id === id) || workspaces[0];
  }

  function setWorkspace(id) {
    try { localStorage.setItem('htc_ws', String(id)); } catch {}
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} });
    location.href = '/app/login';
  }

  function publicUrl(site, slug = 'index') {
    const path = slug === 'index' ? '' : slug;
    return `${location.origin}/p/${site.subdomain}/${path}`;
  }

  return { api, esc, $, formData, slugify, formatVnd, limit, currentWorkspace, setWorkspace, logout, publicUrl };
})();
