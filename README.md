# meet-video-chat

Login-free video meetings in the browser. Guests join with a link and a nickname; creating a meeting requires a login. Audio and video go **directly between browsers** (WebRTC peer-to-peer mesh); the Node server only does WebSocket signalling and keeps room state in memory.

## Features
- Join by link, no registration; host controls (admit from waiting room, mute, remove, lock)
- Camera / microphone / screen sharing, gallery and screen-first views
- Chat, raise hand, emoji, whiteboard and annotation on a shared screen
- Browser-to-browser file transfer (never touches the server)
- Live captions per participant (browser speech recognition) and a downloadable transcript
- Echo guard (half-duplex fallback) and bitrate adaptation for up to 4 people

## Run
```
npm install
npm start          # http://127.0.0.1:5210  (PORT env to change)
```
Camera and microphone need **https** (or localhost). Put it behind a reverse proxy (nginx/Caddy) with TLS and WebSocket upgrade on `/ws`.

## Configuration (environment variables)
- `PORT` - listen port (default 5210, bound to 127.0.0.1)
- `AUTH_URL` - base URL of **your** login service. The server calls `POST {AUTH_URL}/api/login` with `{username, password}` and the header `X-Requested-With: auth`; it must answer `{ "user": { "id": ..., "username": "..." } }` with HTTP 200 on success. The server then issues its own signed 14-day cookie. Replace this call in `server/server.js` if you want a different login.
- `MEET_SECRET` - cookie signing secret (otherwise generated into `.meet_secret`)
- `TURN_HOST`, `TURN_SECRET` - optional coturn (`use-auth-secret`) relay; credentials are only handed out for existing rooms and are rate limited

## Honest limits
- Peer-to-peer mesh: **max 4 people**. More needs an SFU (LiveKit, mediasoup, Janus, ...).
- Without TURN, a few networks (corporate firewalls, symmetric NAT) cannot connect.
- Phone browsers can mostly not share the screen.
- Remote-controlling another computer is not possible from a web page (browser limitation).
- The login service is **not included**; there is no automated test suite in this repository.
- Live captions use the browser speech recognition (Chrome sends audio to Google).
