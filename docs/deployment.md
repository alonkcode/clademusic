# Deployment

## GitHub Pages (Recommended)

This repo deploys automatically on every push to `main` via GitHub Actions:
- Workflow: `.github/workflows/deploy.yml`
- Default target: GitHub Pages (when `DEPLOY_TARGET` repo variable is unset/empty or `github-pages`)

### Setup (one-time)
1. In GitHub: **Settings → Pages**
   - Source: **GitHub Actions**
2. Ensure build-time env vars exist (GitHub **Secrets/Variables**):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`)
   - Optional providers: `VITE_SPOTIFY_CLIENT_ID`, `VITE_SPOTIFY_REDIRECT_URI`, `VITE_YOUTUBE_API_KEY`, `VITE_LASTFM_API_KEY`
3. Confirm base path alignment:
   - Vite: `base` is resolved per host (see [Base path](#base-path) below); GitHub Pages gets `/clademusic/`
   - Router: `basename={import.meta.env.BASE_URL}` in `src/App.tsx`

### Deploy
- Merge/push to `main`.
- Watch the **Deploy** workflow in GitHub Actions.

### Verify
- Site: https://kaospan.github.io/clademusic/
- Feed: https://kaospan.github.io/clademusic/feed

---

## Base path

The app is served from different paths depending on the host, so `base` is
resolved at build time in `vite.config.mjs` / `vite.config.ts`:

```js
const basePath =
  process.env.VITE_BASE_PATH ?? (process.env.VERCEL ? "/" : "/clademusic/");
```

| Host | Base | How it resolves |
|------|------|-----------------|
| GitHub Pages | `/clademusic/` | default |
| Vercel | `/` | `VERCEL` is set automatically by Vercel |
| Anything else | your choice | set `VITE_BASE_PATH` explicitly |

The router reads `import.meta.env.BASE_URL`, so it follows automatically. Any
code that builds an absolute URL must respect `BASE_URL` too — `useAuth.signUp`
does this for `emailRedirectTo`, otherwise confirmation links 404 on Pages.

---

## Vercel

`vercel.json` in the repo root sets the framework, build command, SPA rewrite
and asset caching. The rewrite matters: without it, a refresh on any deep link
(`/feed`, `/track/123`) returns 404 because no file exists at that path.

### Setup (one-time)
1. Import the repo in Vercel.
2. Add environment variables (**Settings → Environment Variables**). The repo's
   `.env` is gitignored, so Vercel starts with nothing:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
   - Optional: `VITE_SPOTIFY_CLIENT_ID`, `VITE_SPOTIFY_REDIRECT_URI`,
     `VITE_YOUTUBE_API_KEY`, `VITE_LASTFM_API_KEY`
3. Update `VITE_SPOTIFY_REDIRECT_URI` to the Vercel origin **without** the
   `/clademusic/` segment, and add the same URL to the Spotify app's allowed
   redirect URIs. A mismatch fails OAuth with `INVALID_CLIENT`.

Without the Supabase vars the app still builds and loads, but the client falls
back to a disabled stub and every query returns an error instead of data — an
easy failure to misread as a broken database.

### Lockfiles
The repo has both `bun.lockb` and `package-lock.json`. Two lockfiles can resolve
to different dependency versions than local, so pick one and delete the other
before relying on a Vercel build.

---

## Manual Deploy (Optional)

If you want to deploy without GitHub Actions (not recommended for this repo), you can use the `gh-pages` script.

```bash
bun run predeploy
bun run deploy
```
