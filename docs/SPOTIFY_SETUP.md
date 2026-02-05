# Spotify Integration Setup Guide

## Quick Start

### 1. Get Spotify API Credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click "Create App"
4. Fill in the details:
   - **App Name**: CladeMusic (or your app name)
   - **App Description**: Music discovery platform with harmonic analysis
   - **Redirect URI**: `http://localhost:5173/spotify-callback` (for local development)
5. Check "Web API" in the API selection
6. Accept the terms and click "Save"
7. Copy your **Client ID** (you'll need this for .env.local)

### 2. Configure Environment Variables

Create a `.env.local` file in your project root:

```bash
# Supabase Configuration (REQUIRED)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-here

# Spotify OAuth (REQUIRED for Spotify features)
VITE_SPOTIFY_CLIENT_ID=your-spotify-client-id-from-step-1
VITE_SPOTIFY_REDIRECT_URI=http://localhost:5173/spotify-callback
```

**Important Notes:**
- Never commit `.env.local` to Git (it's already in `.gitignore`)
- Use `.env.example` as a template
- For production, update the redirect URI to match your deployed domain

### 3. Setup Supabase

#### Get Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project or select existing one
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_PUBLISHABLE_KEY`

#### Run Database Migrations

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

### 4. Test the Connection

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://localhost:5173/profile`

3. Click "Connect Spotify"

4. Authorize the app

5. You should see your recently played tracks!

## Common Issues

### ❌ "Spotify client ID not configured"

**Solution**: Add `VITE_SPOTIFY_CLIENT_ID` to your `.env.local` file

### ❌ "Invalid redirect URI"

**Solution**: Make sure the redirect URI in your `.env.local` matches exactly what you configured in the Spotify Developer Dashboard:
- Local: `http://localhost:5173/spotify-callback`
- Production: `https://yourdomain.com/spotify-callback`

### ❌ "Token refresh failed"

**Solution**: 
1. Disconnect Spotify in your profile
2. Reconnect Spotify
3. Make sure your Spotify app has all required scopes enabled

### ❌ "Supabase is not configured"

**Solution**: Add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env.local`

### ❌ "No recently played tracks"

**Possible causes:**
1. You haven't played any tracks on Spotify recently
2. Your Spotify account privacy settings may block this data
3. Token expired - try disconnecting and reconnecting

## Production Deployment

### Update Spotify App Settings

1. Go to your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Select your app
3. Click "Edit Settings"
4. Add production redirect URI:
   - `https://yourdomain.com/spotify-callback`
5. Save changes

### Update Environment Variables

Update your production environment variables (e.g., Vercel/Netlify):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SPOTIFY_CLIENT_ID=your-client-id
VITE_SPOTIFY_REDIRECT_URI=https://yourdomain.com/spotify-callback
```

## Spotify Scopes Required

The app requests these scopes for full functionality:

- `user-read-email` - Read user email
- `user-read-private` - Read user profile
- `user-top-read` - Read top tracks/artists
- `user-read-recently-played` - Read recently played tracks
- `user-library-read` - Read saved tracks
- `playlist-read-private` - Read private playlists
- `streaming` - Web playback SDK
- `user-modify-playback-state` - Control playback
- `user-read-playback-state` - Read playback state
- `user-read-currently-playing` - Read currently playing
- `app-remote-control` - Remote control

## Debugging

Enable detailed logging by checking the browser console. Look for messages prefixed with:
- `[Spotify Connect]` - OAuth flow
- `[Spotify Callback]` - Callback handling
- `[Spotify Auth]` - Token management
- `[Spotify User]` - API calls

## Security Notes

- Never expose your Spotify Client Secret (we use PKCE which doesn't require it)
- Keep `.env.local` out of version control
- Tokens are securely stored in Supabase with encryption at rest
- Access tokens expire after 1 hour and are automatically refreshed

## Need Help?

Check:
1. Browser console for detailed error messages
2. Supabase logs for database errors
3. Spotify Developer Dashboard for API quota/errors

## Testing Without Spotify

The app works without Spotify connection - you just won't see:
- Recently played tracks
- Top tracks/artists
- Music DNA stats
- Personalized recommendations

All other features work normally.
