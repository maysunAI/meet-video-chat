/* "About / Version & updates": polls the server for a new version and offers a one-click reload. */

(function () {
  if (window.AppUpdate || window.top !== window) return;
  const cs = document.currentScript, apiUrl = (cs && cs.getAttribute('data-url')) || '';
  const own = !!document.querySelector('meta[name="t00-update"][content="own"]');
  const E = (t, p = {}, ...k) => { const e = document.createElement(t); Object.assign(e, p); k.flat().forEach((x) => e.append(x)); return e; };
  const st = (el, css) => { el.style.cssText = css; return el; };
  const fmtT = (ms) => { try { return new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); } catch (e) { return ''; } };

  async function ask() {
    if (apiUrl) { const r = await fetch(apiUrl + (apiUrl.includes('?') ? '&' : '?') + '_=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
    const u = location.origin + location.pathname;
    const r = await fetch(u, { method: 'HEAD', cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const et = r.headers.get('etag'), lm = r.headers.get('last-modified'), cl = r.headers.get('content-length');
    const id = (et || lm || cl || '').replace(/[^A-Za-z0-9]/g, '').slice(-12) || 'unknown';
    return { id, label: lm ? fmtT(Date.parse(lm)) : (et ? 'etag' : 'unknown') };
  }
  let loaded = null; ask().then((j) => { loaded = j; }).catch(() => {});

  async function hardReload() {
    try { if (navigator.serviceWorker) (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister()); if (window.caches) (await caches.keys()).forEach((k) => caches.delete(k)); } catch (e) {}
    const u = new URL(location.href); u.searchParams.set('_r', Date.now().toString(36)); location.replace(u.toString());
  }

  let banner = null;
  function showBanner(j) {
    if (banner || document.getElementById('appupdatebanner')) return;
    banner = E('div', { id: 'appupdatebanner' }, E('span', { textContent: '🔄 New version available (' + j.label + ')' }),
      E('button', { textContent: 'Click to update', onclick: hardReload }), E('button', { textContent: '×', title: 'Not now', onclick: () => banner.remove() }));
    st(banner, 'position:fixed;top:0;left:0;right:0;z-index:2147483600;display:flex;gap:10px;align-items:center;justify-content:center;padding:8px 12px;background:#1f6feb;color:#fff;font:14px/1.3 system-ui,sans-serif');
    banner.querySelectorAll('button').forEach((b) => st(b, 'border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;padding:4px 10px;font-size:14px;cursor:pointer'));
    document.body.append(banner);
  }
  async function poll() { try { const j = await ask(); if (loaded && j.id !== loaded.id) showBanner(j); else if (!loaded) loaded = j; } catch (e) {} }
  setInterval(poll, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });

  function card() {
    const msg = E('div', { className: 'sub', style: 'min-height:1.4em;margin-top:6px;font-size:.9rem' }), ver = E('div', { className: 'sub', style: 'font-size:.9rem' });
    const show = () => { ver.textContent = 'Current version: ' + (loaded ? loaded.label + ' (' + loaded.id + ')' : 'loading…'); }; show(); if (!loaded) ask().then((j) => { loaded = j; show(); }).catch(() => { ver.textContent = 'Current version: unavailable (network problem?)'; });
    const chk = E('button', { className: 'pri', textContent: '🔄 Check and update to the latest version', onclick: async () => {
      msg.textContent = 'Checking…';
      try { const j = await ask(); if (loaded && j.id !== loaded.id) { msg.textContent = 'New version found: ' + j.label + ', updating…'; setTimeout(hardReload, 600); } else if (!loaded) { loaded = j; show(); msg.textContent = 'Current version noted. If it does not feel up to date, click "Force reload"'; } else msg.textContent = '✅ Already the latest version (' + j.label + ')'; }
      catch (e) { msg.textContent = '❌ Check failed: ' + e.message; }
    } });
    const force = E('button', { textContent: 'Force reload (clear cache)', onclick: () => { msg.textContent = 'Clearing cache and reloading…'; hardReload(); } });
    return E('div', { className: 'card', id: 'appupdatecard' }, E('h2', { textContent: 'ℹ️ About · Version & updates' }), ver,
      E('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' }, chk, force), msg,
      E('div', { className: 'sub', style: 'margin-top:6px;font-size:.85rem', textContent: 'The page will tell you automatically when a new version is available; you can also click the buttons above. Your data lives on the server and is not lost by updating.' }));
  }

  function pill() {
    if (own || document.getElementById('appupdatepill')) return;
    const b = E('button', { id: 'appupdatepill', textContent: 'ℹ︎', title: 'About · Version & updates' });
    st(b, 'position:fixed;right:6px;bottom:6px;z-index:2147483000;width:26px;height:26px;border-radius:50%;border:1px solid rgba(128,128,128,.5);background:rgba(255,255,255,.75);color:#333;font:14px/1 system-ui;padding:0;opacity:.55;cursor:pointer');
    b.onclick = () => {
      if (document.getElementById('appupdatemodal')) return;
      const m = E('div', { id: 'appupdatemodal' }); st(m, 'position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px');
      const c = card(); st(c, 'background:#fff;color:#222;border-radius:12px;padding:16px;max-width:380px;width:100%;font:15px/1.5 system-ui,sans-serif;box-sizing:border-box');
      c.querySelectorAll('button').forEach((x) => st(x, 'padding:8px 12px;border:1px solid #bbb;border-radius:8px;background:#f5f5f5;color:#222;font-size:14px;cursor:pointer'));
      c.querySelector('h2').style.cssText = 'margin:0 0 6px;font-size:17px';
      const x = E('button', { textContent: 'Close', onclick: () => m.remove() }); st(x, 'margin-top:10px;padding:8px 12px;border:1px solid #bbb;border-radius:8px;background:#f5f5f5;color:#222;font-size:14px;cursor:pointer;width:100%');
      c.append(x); m.append(c); m.addEventListener('click', (e) => { if (e.target === m) m.remove(); }); document.body.append(m);
    };
    document.body.append(b);
  }
  if (!own) { if (document.readyState === 'complete') setTimeout(pill, 600); else window.addEventListener('load', () => setTimeout(pill, 600)); }

  window.AppUpdate = { card, check: ask, hardReload };
})();
