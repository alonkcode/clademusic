# Live analysis service

A small Bun WebSocket service that runs Clade's chord / key / tempo / section
analysis for listeners whose device cannot do it locally - in practice, phones
and tablets, which have no tab-audio capture (`getDisplayMedia`).

## What it is, and is not

Audio comes from **the listener's own microphone**, captured in the browser
with their permission. Playback is untouched: the track still plays through
Spotify's or YouTube's own official player. The service:

- never fetches, proxies, downloads or stores any provider's audio;
- keeps no audio at all - a chunk is analysed and overwritten in a 16k-sample ring;
- sends the client only results (a chord change, a snapshot every 3 s), never audio.

There is deliberately **no server-side route to a provider's audio**. Neither
Spotify nor YouTube offers an official way to hand playable audio to a server
(Spotify's SDK/embed is DRM-protected; YouTube's player exposes no audio;
downloading either breaks their terms). `providerAnalysisCapability()` in
`protocol.ts` states this per provider, and a client that asks for anything but
`source: "microphone"` is told *"Live analysis isn't available for this
provider."* If a provider ever ships an official integration, that field is
where it is declared.

## Privacy note (needs a decision from you)

The microphone route sends the listener's captured audio to this service. It
is analysed in memory and discarded, and the UI says so before asking for the
microphone, but `PrivacyPolicyPage` does not currently mention it. That is
legal copy, so it has not been edited.

## Why a separate service

The rest of production is static hosting (Vercel, GitHub Pages) plus Supabase.
None of it can hold a live analysis session:

| Host | Why it cannot |
| --- | --- |
| Vercel / GitHub Pages | Static files and short serverless calls; no WebSocket server, no process that outlives a request. |
| Supabase Edge Functions | Wall-clock limited per invocation, and isolates share no memory, so per-session state, the concurrency cap and idle cleanup cannot work across requests. |
| Supabase Realtime | Broadcasts database changes; it cannot run analysis. |

So this is the smallest addition that can: one container, no database, no
dependencies (Bun's built-in WebSocket server and `fetch`).

## Run it

```
docker build -f services/live-analysis/Dockerfile -t clade-live-analysis .   # from the repo root
docker run -p 8787:8787 \
  -e SUPABASE_URL=https://<ref>.supabase.co \
  -e SUPABASE_ANON_KEY=<publishable key> \
  -e ALLOWED_ORIGINS=https://www.clademusic.com,https://alonkcode.github.io \
  clade-live-analysis
```

or without Docker: `bun services/live-analysis/main.ts` with the same variables.

| Variable | | |
| --- | --- | --- |
| `SUPABASE_URL` | required | Used to validate access tokens (`/auth/v1/user`). |
| `SUPABASE_ANON_KEY` | required | The publishable key. Public by design; **no service-role key is needed or wanted**. |
| `ALLOWED_ORIGINS` | required | Exact origins, comma-separated. `*` is refused at startup. Every site that serves the app must be listed (www.clademusic.com and each GitHub Pages origin). |
| `PORT` | 8787 | |
| `MAX_SESSIONS` | 50 | Concurrent sessions. The CPU guard; see Capacity. |
| `MAX_SESSIONS_PER_USER` | 2 | |

Put it behind TLS - the browser connects with `wss://`. Any host with WebSocket
support works (Fly.io, Railway, Render, or the existing VPS behind nginx/Caddy).
For nginx:

```
location /ws {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}
```

Then set **`VITE_LIVE_ANALYSIS_WS_URL`** (for example `wss://live.clademusic.com/ws`)
in **both** GitHub Actions secrets and Vercel, and redeploy without build cache
(Vite inlines `VITE_*` at build time). While it is unset the app simply
reports live analysis as unavailable on devices that need this service; it does
not break.

## Protocol

`protocol.ts` is the single definition, imported by both sides.

- Client -> server, text: `hello` (token, source, provider, track, sample rate, optional `resume`), `sync` (position, playing, playbackRate, timestamp), `ping`, `stop`.
- Client -> server, binary: audio frames. 10-byte header (version, flags, seq, position at capture) then little-endian int16 mono at 22.05 kHz. The position is stamped **per chunk at capture**, so alignment to the song does not depend on network jitter.
- Server -> client: `ready`, `chord` (only on change), `snapshot` (every 3 s, chord spans as a delta), `state`, `error`, `stopped`, `pong`.

The token goes in `hello`, not the URL, so it never appears in a proxy log.

## Limits and lifecycle

All in `sessionManager.ts`: global and per-user session caps, a creation rate
limit, and a sweep every 5 s enforcing an idle timeout (30 s of silence), a
paused timeout (2 min), a resume window (30 s after a dropped connection) and a
15 minute ceiling. A tab that is closed, frozen or abandoned is ended by the
sweep. Connections are capped, unauthenticated sockets are closed after 5 s,
inbound audio is limited to 2x real time, and a client that cannot drain its
socket is skipped for droppable frames and disconnected after 10 s.

Ownership: a connection is bound to one authenticated user and one session at
`hello`; later messages never name a session. `resume` needs the session id,
its secret key **and** the same user, and every failure looks the same as "no
such session".

Errors shown to listeners are fixed strings (`ERROR_MESSAGES`). Stack traces
and upstream detail go to the server log only.

## Logs

One JSON object per line. Lifecycle events use these names:
`analysis_session_started`, `analysis_session_connected`,
`analysis_session_reconnected`, `analysis_session_stopped`,
`analysis_session_error`, `analysis_provider_unsupported`. They are Clade's
own analytics - nothing here is, or should be described as, provider
engagement data. Session secrets and tokens are never logged.

## Capacity (measured, Bun 1.4.2, this repo's Windows dev box)

`bun services/live-analysis/smoke.ts --bench 20 12`, 20 real-time sessions:

| | |
| --- | --- |
| CPU | ~9% of one core for all 20 (client and server share the process, so this is an upper bound) - about 0.5% per session |
| Memory | ~1 MB growth for 20 sessions; heap 13 MB after 10 minutes of audio in one session |
| Uplink | ~44 KB/s per session (int16, 22.05 kHz mono) |
| Downlink | ~100 B/s per session, roughly 450x smaller than the audio sent |
| Long captures | Cost per minute of audio stays flat over 10 minutes; chroma history thins itself to a fixed bound; snapshots stay ~260 B |

## Checks

- Rules (limits, ownership, timeouts, backpressure, isolation, analysis): Vitest, `src/lib/liveAnalysis/server*.test.ts`.
- The real server on real sockets: `bun services/live-analysis/smoke.ts` (exits 1 on any failure).
- Not covered here: a real phone's microphone. See the app-side notes on acoustic capture.
