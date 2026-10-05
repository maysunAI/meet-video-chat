/* File transfer between browsers over a WebRTC DataChannel; files never touch or get stored on the server. */

(function () {
  const CHUNK = 16 * 1024, MAX = 200 * 1024 * 1024, HIGH = 1 << 20;
  const E = (t, p = {}, ...k) => { const e = document.createElement(t); Object.assign(e, p); k.flat().forEach((x) => e.append(x)); return e; };
  const human = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  let panel = null, list = null;
  function ensurePanel() {
    if (panel) return;
    panel = E('div', { id: 'xferPanel', style: 'position:fixed;right:10px;bottom:70px;width:min(340px,92vw);max-height:50vh;overflow:auto;background:var(--card,#222);color:var(--ink,#eee);border:1px solid #888;border-radius:10px;padding:8px 10px;z-index:60;font-size:.9rem;display:none' });
    const head = E('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px' }, E('b', { textContent: '📎 Send file (sent directly to the other person, not through the server)' }));
    const close = E('button', { textContent: '✕', onclick: () => { panel.style.display = 'none'; } }); head.append(close);
    list = E('div'); panel.append(head, list); document.body.append(panel);
  }
  const open = () => { ensurePanel(); panel.style.display = 'block'; };
  function row(text) { open(); const r = E('div', { style: 'margin:6px 0;padding:4px 0;border-top:1px solid #8884' }); r.append(E('div', { textContent: text })); const bar = E('progress', { max: 100, value: 0, style: 'width:100%' }); r.append(bar); list.prepend(r); return { r, bar, set: (t) => { r.firstChild.textContent = t; } }; }

  function attach(pe, pc) {
    if (pe.dc) return;
    const dc = pc.createDataChannel('file', { negotiated: true, id: 7 }); dc.binaryType = 'arraybuffer'; pe.dc = dc;
    let cur = null;
    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'meta') { if (m.size > MAX) { cur = null; return; } cur = { name: String(m.name || 'file').slice(0, 120), size: m.size, got: 0, parts: [], ui: row('Receiving "' + String(m.name).slice(0, 60) + '" from ' + (pe.name || 'the other person') + ' (' + human(m.size) + ')…') }; }
        else if (m.t === 'end' && cur) {
          const blob = new Blob(cur.parts), url = URL.createObjectURL(blob);
          cur.ui.bar.value = 100; cur.ui.set('Received: ' + cur.name + ' (' + human(cur.size) + ') from ' + (pe.name || 'the other person'));
          cur.ui.r.append(E('a', { href: url, download: cur.name, textContent: '⬇ Save to this device', style: 'color:#7cc4ff' }));
          if (cur.got !== cur.size) cur.ui.r.append(E('div', { textContent: '⚠ Size does not match; the file may be incomplete', style: 'color:#f90' }));
          cur = null;
        }
        return;
      }
      if (!cur) return; cur.parts.push(ev.data); cur.got += ev.data.byteLength; cur.ui.bar.value = Math.min(99, Math.round(cur.got / cur.size * 100));
    };
    dc.onerror = () => {};
  }

  async function sendTo(pe, file) {
    const dc = pe.dc; const ui = row('Sending "' + file.name + '" to ' + (pe.name || 'the other person') + ' (' + human(file.size) + ')…');
    if (!dc || dc.readyState !== 'open') { ui.set('Cannot send: the connection with ' + (pe.name || 'the other person') + ' is not ready yet, please try again shortly'); return; }
    dc.bufferedAmountLowThreshold = HIGH / 2;
    dc.send(JSON.stringify({ t: 'meta', name: file.name, size: file.size }));
    let off = 0;
    while (off < file.size) {
      if (dc.readyState !== 'open') { ui.set('Interrupted: connection lost (' + human(off) + ' sent)'); return; }
      if (dc.bufferedAmount > HIGH) await new Promise((res) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; res(); }; });
      const buf = await file.slice(off, off + CHUNK).arrayBuffer(); dc.send(buf); off += buf.byteLength; ui.bar.value = Math.round(off / file.size * 100);
    }
    dc.send(JSON.stringify({ t: 'end' })); ui.bar.value = 100; ui.set('Sent: ' + file.name + ' (' + human(file.size) + ') to ' + (pe.name || 'the other person'));
  }

  function pick(peers) {
    const ready = [...peers.values()].filter((p) => p.dc && p.dc.readyState === 'open');
    if (!ready.length) { open(); row('There is nobody to send files to right now (the other person must join the meeting and be connected first)'); return; }
    const inp = E('input', { type: 'file', multiple: true });
    inp.onchange = async () => {
      const files = [...inp.files];
      for (const f of files) {
        if (f.size > MAX) { row('"' + f.name + '" is too large (over 200MB); please share a cloud-drive link instead'); continue; }
        for (const pe of ready) await sendTo(pe, f);
      }
    };
    inp.click();
  }
  window.FileXfer = { attach, pick, open };
})();
