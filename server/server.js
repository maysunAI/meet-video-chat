// Video meeting server: WebSocket signalling only. Audio/video flows browser-to-browser over WebRTC; room state lives in memory only.
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 5210;
const app = express();
app.use(express.json({ limit: '10kb' }));
const verOf = (() => { let c = null, t = 0; return () => { if (c && Date.now() - t < 3000) return c; const fs = require('fs'), cr = require('crypto'), dir = require('path').join(__dirname, '..', 'public'); let mx = 0; const h = cr.createHash('md5'); (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = require('path').join(d, e.name); if (e.isDirectory()) return walk(f); const s = fs.statSync(f); mx = Math.max(mx, s.mtimeMs); h.update(e.name + s.size + Math.floor(s.mtimeMs)); }); })(dir); c = { id: h.digest('hex').slice(0, 8), label: new Date(mx + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') }; t = Date.now(); return c; }; })();
app.get('/api/version', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(verOf()); });
app.use(express.static(require('path').join(__dirname, '..', 'public')));

const fs = require('fs'), path = require('path');
const AUTH_URL_BASE = process.env.AUTH_URL || 'http://127.0.0.1:5288';
const SECRET = process.env.MEET_SECRET || (() => { const f = path.join(process.env.DATA_DIR || __dirname, '.meet_secret'); try { return fs.readFileSync(f, 'utf8'); } catch (e) { const k = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(f, k, { mode: 0o600 }); } catch (e2) {} return k; } })();
const COOKIE = 'meetsid', DAYS = 14;
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const mkToken = (u) => { const body = Buffer.from(JSON.stringify({ id: u.id, u: u.username, exp: Date.now() + DAYS * 86400e3 })).toString('base64url'); return body + '.' + sign(body); };
const cookieOf = (h, k) => { const m = String(h || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(k + '=')); return m ? decodeURIComponent(m.slice(k.length + 1)) : ''; };
function userFrom(headers) {
  const t = cookieOf(headers.cookie, COOKIE); const [body, sig] = t.split('.'); if (!body || !sig) return null;
  const good = sign(body); if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp > Date.now() ? { id: o.id, username: o.u } : null; } catch (e) { return null; }
}
const setCk = (req, res, v, age) => res.append('Set-Cookie', `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}` + (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''));
const lfails = new Map();
app.set('trust proxy', 1);
app.use((req, res, next) => { req.user = userFrom(req.headers); next(); });
app.use((req, res, next) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'meet') return res.status(403).json({ error: 'Request denied' }); next(); });
app.post('/api/login', async (req, res) => {
  const a = (lfails.get(req.ip) || []).filter((t) => Date.now() - t < 900e3); lfails.set(req.ip, a);
  if (a.length >= 10) return res.status(429).json({ error: 'Too many attempts, please try again in 15 minutes' });
  const { username, password } = req.body || {};
  try {
    const r = await fetch(AUTH_URL_BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'auth' }, body: JSON.stringify({ username: String(username || ''), password: String(password || '') }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.user) { a.push(Date.now()); return res.status(r.status === 429 ? 429 : 401).json({ error: j.error || 'Wrong username or password' }); }
    setCk(req, res, mkToken(j.user), DAYS * 86400); res.json({ ok: true, user: { id: j.user.id, username: j.user.username } });
  } catch (e) { res.status(502).json({ error: 'Login service is temporarily unavailable' }); }
});
app.post('/api/logout', (req, res) => { setCk(req, res, '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ user: req.user }));
app.get('/api/my-rooms', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first' });
  res.json({ rooms: [...rooms.values()].filter((r) => r.ownerId === req.user.id).map((r) => ({ id: r.id, locked: r.locked, people: insiders(r).length })) });
});

const rooms = new Map(); // id -> { id, hostKey, locked, peers: Map(pid -> peer), emptySince }
const rid = () => crypto.randomBytes(4).toString('hex');
const pid = () => crypto.randomBytes(3).toString('hex');
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Guest';

app.post('/api/create', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Creating a meeting requires login; without an account you can only join other peoples meetings' });
  if (rooms.size > 200) return res.status(503).json({ error: 'The server has too many rooms right now, please try again later' });
  const id = rid(), hostKey = crypto.randomBytes(12).toString('hex');
  rooms.set(id, { id, hostKey, ownerId: req.user.id, ownerName: req.user.username, locked: false, peers: new Map(), emptySince: Date.now() });
  res.json({ room: id, hostKey, user: req.user });
});
app.get('/api/room/:id', (req, res) => { const r = rooms.get(req.params.id); res.json({ exists: !!r, locked: !!(r && r.locked) }); });
const iceHits = new Map();
app.get('/api/ice', (req, res) => {
  const secret = process.env.TURN_SECRET, host = process.env.TURN_HOST;
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const ip = String(req.headers['x-real-ip'] || req.ip || ''); const now = Date.now(); const hits = (iceHits.get(ip) || []).filter((t) => now - t < 3600e3);
  const roomOk = rooms.has(String(req.query.room || '')) && hits.length < 30;
  if (roomOk) { hits.push(now); iceHits.set(ip, hits); }
  if (secret && host && roomOk) {
    const user = String(Math.floor(Date.now() / 1000) + 3600) + ':meet';
    const cred = require('crypto').createHmac('sha1', secret).update(user).digest('base64');
    servers.push({ urls: ['turn:' + host + '?transport=udp', 'turn:' + host + '?transport=tcp'], username: user, credential: cred });
  }
  res.json({ iceServers: servers });
});
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

setInterval(() => { const now = Date.now(); for (const [ip, a] of iceHits) { const b = a.filter((t) => now - t < 3600e3); if (b.length) iceHits.set(ip, b); else iceHits.delete(ip); } }, 600e3).unref();
setInterval(() => { const now = Date.now(); for (const [id, r] of rooms) if (!r.peers.size && now - r.emptySince > 600e3) rooms.delete(id); }, 60e3).unref();

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const insiders = (r) => [...r.peers.values()].filter((p) => p.state === 'in');
const bcast = (r, o, exceptId) => insiders(r).forEach((p) => { if (p.id !== exceptId) send(p.ws, o); });
const pub = (p) => ({ id: p.id, name: p.name, host: p.host, mic: p.mic, cam: p.cam, hand: p.hand });
const hostPeers = (r) => insiders(r).filter((p) => p.host);
const waitingList = (r) => [...r.peers.values()].filter((p) => p.state === 'wait').map((p) => ({ id: p.id, name: p.name }));
const tellHostsWaiting = (r) => hostPeers(r).forEach((h) => send(h.ws, { t: 'waiting', list: waitingList(r) }));

function admit(r, p) {
  p.state = 'in';
  const others = insiders(r).filter((x) => x.id !== p.id).map(pub);
  send(p.ws, { t: 'joined', id: p.id, host: p.host, locked: r.locked, peers: others });
  bcast(r, { t: 'peer-join', peer: pub(p) }, p.id);
  if (r.wb && r.wb.size) send(p.ws, { t: 'draw-sync', strokes: [...r.wb.values()] });
  if (p.host) send(p.ws, { t: 'waiting', list: waitingList(r) });
}
function leave(p) {
  const r = p.room; if (!r || !r.peers.has(p.id)) return;
  r.peers.delete(p.id);
  if (p.state === 'in') bcast(r, { t: 'peer-leave', id: p.id });
  else tellHostsWaiting(r);
  if (!r.peers.size) r.emptySince = Date.now();
}

wss.on('connection', (ws, req0) => {
  const wsUser = userFrom(req0.headers);
  const me = { id: pid(), ws, room: null, name: 'Guest', host: false, state: 'new', mic: true, cam: true, hand: false, last: 0, n: 0 };
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  me.born = Date.now(); const idleT = setInterval(() => { if ((me.state === 'new' && Date.now() - me.born > 90e3) || (me.state === 'wait' && Date.now() - me.born > 30 * 60e3)) { clearInterval(idleT); try { ws.terminate(); } catch (e) {} } }, 15e3); ws.on('close', () => clearInterval(idleT));
  ws.on('message', (raw) => {
    const now = Date.now(); if (now - me.last > 1000) { me.last = now; me.n = 0; } if (++me.n > 60) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const r = me.room;
    if (m.t === 'join') {
      if (me.room) return;
      const room = rooms.get(String(m.room || ''));
      if (!room) return send(ws, { t: 'error', code: 'noroom', msg: 'This meeting does not exist or has ended' });
      me.name = cleanName(m.name); me.room = room;
      const isHost = (!!m.hostKey && m.hostKey === room.hostKey) || (!!wsUser && wsUser.id === room.ownerId);
      if (room.peers.size >= 8) return send(ws, { t: 'error', code: 'full', msg: 'The meeting is full' }), (me.room = null);
      if (!isHost && room.locked) return send(ws, { t: 'error', code: 'locked', msg: 'The host has locked the meeting; you cannot join' }), (me.room = null);
      me.host = isHost; room.peers.set(me.id, me);
      if (isHost) return admit(room, me);
      me.state = 'wait'; send(ws, { t: 'wait' });
      if (!hostPeers(room).length) send(ws, { t: 'wait-nohost' });
      return tellHostsWaiting(room);
    }
    if (!r) return;
    if (m.t === 'leave') return leave(me);
    if (me.host && (m.t === 'admit' || m.t === 'deny')) {
      const p = r.peers.get(String(m.id)); if (!p || p.state !== 'wait') return;
      if (m.t === 'admit') { if (insiders(r).length >= 4) { send(me.ws, { t: 'notice', msg: 'There are already 4 people in the meeting; the P2P version allows at most 4, so nobody else can be admitted' }); return; } admit(r, p); } else { send(p.ws, { t: 'error', code: 'denied', msg: 'The host did not admit you' }); r.peers.delete(p.id); }
      return tellHostsWaiting(r);
    }
    if (me.state !== 'in') return;
    switch (m.t) {
      case 'sig': { const to = r.peers.get(String(m.to)); if (to && to.state === 'in') send(to.ws, { t: 'sig', from: me.id, data: m.data }); break; }
      case 'chat': { const text = String(m.text || '').slice(0, 1000); if (text) bcast(r, { t: 'chat', from: me.id, name: me.name, text, ts: Date.now() }); break; }
      case 'cap': { const text = String(m.text || '').slice(0, 500); if (text) bcast(r, { t: 'cap', from: me.id, name: me.name, text, lang: String(m.lang || '').slice(0, 10), ts: Date.now() }, me.id); break; }
      case 'draw': {
        const layer = m.layer === 'ann' ? 'ann' : 'wb', op = ['seg', 'clear', 'undo'].includes(m.op) ? m.op : null; if (!op) break;
        const sid = String(m.sid || '').slice(0, 40), c = /^#[0-9a-fA-F]{6}$/.test(m.c) ? m.c : '#222222', w = Math.max(1, Math.min(24, +m.w || 4));
        const pts = Array.isArray(m.pts) ? m.pts.slice(0, 60).map((q) => [Math.max(0, Math.min(1, +q[0] || 0)), Math.max(0, Math.min(1, +q[1] || 0))]) : [];
        if (layer === 'wb') {
          r.wb = r.wb || new Map();
          if (op === 'clear') r.wb.clear(); else if (op === 'undo') r.wb.delete(sid);
          else if (sid) { let st = r.wb.get(sid); if (!st) { if (r.wb.size >= 800) break; st = { sid, c, w, pts: [] }; r.wb.set(sid, st); } if (st.pts.length < 4000) st.pts.push(...pts); }
        }
        bcast(r, { t: 'draw', layer, op, sid, c, w, pts, from: me.id }, me.id); break;
      }
      case 'hand': me.hand = !!m.on; bcast(r, { t: 'state', id: me.id, hand: me.hand }); break;
      case 'state': if (typeof m.mic === 'boolean') me.mic = m.mic; if (typeof m.cam === 'boolean') me.cam = m.cam; bcast(r, { t: 'state', id: me.id, mic: me.mic, cam: me.cam }, me.id); break;
      case 'media': bcast(r, { t: 'media', id: me.id, cam: m.cam || null, screen: m.screen || null }, me.id); break;
      case 'react': { const e = String(m.emoji || '').slice(0, 4); if (e) bcast(r, { t: 'react', id: me.id, name: me.name, emoji: e }); break; }
      case 'mute': if (me.host) { const p = r.peers.get(String(m.id)); if (p && p.state === 'in' && !p.host) send(p.ws, { t: 'force-mute' }); } break;
      case 'kick': if (me.host) { const p = r.peers.get(String(m.id)); if (p && !p.host) { send(p.ws, { t: 'kicked' }); leave(p); p.room = null; p.state = 'new'; } } break;
      case 'lock': if (me.host) { r.locked = !!m.on; bcast(r, { t: 'locked', on: r.locked }); } break;
    }
  });
  ws.on('close', () => leave(me));
  ws.on('error', () => {});
});
setInterval(() => { wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) {} }); }, 30e3).unref();

server.listen(PORT, '127.0.0.1', () => console.log('pj110-meet on', PORT));
