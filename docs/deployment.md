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
   - Optional providers: `VITE_SPOTIFY_CLIENT_ID`, `VITE_SPOTIFY_REDIRECT_URI`, `VITE_LASTFM_API_KEY`
   - YouTube search needs `YOUTUBE_API_KEY` set as a Supabase Edge Function secret
     (`supabase secrets set YOUTUBE_API_KEY=...`), not a GitHub/Vite variable — see
     `supabase/functions/search-youtube/index.ts`
3. Confirm base path alignment:
   - Vite: `base` is resolved per host (see [Base path](#base-path) below); GitHub Pages gets `/` once the `CUSTOM_DOMAIN` repo variable is set (serving from www.clademusic.com's root)
   - Router: `basename={import.meta.env.BASE_URL}` in `src/App.tsx`

### Deploy
- Merge/push to `main`.
- Watch the **Deploy** workflow in GitHub Actions.

### Verify
- Site: https://www.clademusic.com
- Feed: https://www.clademusic.com/feed

---

## Base path

The app serves from the domain root everywhere now (`www.clademusic.com`,
Vercel, Netlify), so `base` defaults to `/`. `base` is resolved at build time
in `vite.config.mjs` / `vite.config.ts`:

```js
const basePath = process.env.VITE_BASE_PATH ?? "/";
```

| Host | Base | How it resolves |
|------|------|-----------------|
| GitHub Pages (custom domain) | `/` | default — needs the `CUSTOM_DOMAIN` repo variable set so `deploy.yml` writes the CNAME file |
| Vercel / Netlify | `/` | default |
| Bare `username.github.io/clademusic/` (no custom domain) | `/clademusic/` | set `VITE_BASE_PATH=/clademusic/` explicitly |

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
     `VITE_LASTFM_API_KEY`
   - YouTube search needs `YOUTUBE_API_KEY` set as a Supabase Edge Function secret,
     not a Vercel env var — see `supabase/functions/search-youtube/index.ts`
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

`deploy` passes `--cname www.clademusic.com` so the manual path writes the
same CNAME file the CI workflow does — `gh-pages -d dist` replaces the whole
branch by default, so without it a manual deploy would delete the CNAME file
CI had written and silently break the custom domain until the next CI run.
