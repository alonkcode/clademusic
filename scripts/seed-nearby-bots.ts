import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  provider: string | null;
};

type UserLocationRow = {
  latitude: number;
  longitude: number;
  radius_km: number;
};

type Args = {
  count: number;
  tag: string;
  nearUserId?: string;
  nearEmail?: string;
  lat?: number;
  lon?: number;
  spreadKm: number;
  botRadiusKm: number;
  activityPerBot: number;
  tracksSample: number;
  commentsPerBot: number;
  resetActivity: boolean;
};

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function readArgValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function sanitizeTag(tag: string): string {
  const cleaned = tag.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'nearby';
}

function hashStringToU32(input: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function kmOffsetToLatLon(baseLat: number, baseLon: number, dxKm: number, dyKm: number) {
  const latRad = (baseLat * Math.PI) / 180;
  const kmPerDegLat = 111;
  const kmPerDegLon = 111 * Math.cos(latRad);
  const dLat = dyKm / kmPerDegLat;
  const dLon = dxKm / (kmPerDegLon || 1e-6);
  return { lat: baseLat + dLat, lon: baseLon + dLon };
}

function randomPointInRadius(rand: () => number, baseLat: number, baseLon: number, radiusKm: number) {
  // Uniform in circle
  const angle = rand() * Math.PI * 2;
  const r = radiusKm * Math.sqrt(rand());
  const dx = r * Math.cos(angle);
  const dy = r * Math.sin(angle);
  return kmOffsetToLatLon(baseLat, baseLon, dx, dy);
}

function buildArgs(argv: string[]): Args {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    console.log(
      [
        'Seed nearby bot users into Supabase.',
        '',
        'Required: provide a base location via ONE of:',
        '  --near-user-id <uuid>   Use an existing user_locations row as the center',
        '  --near-email <email>    Look up a profile by email, then use its user_locations row',
        '  --lat <number> --lon <number>',
        '',
        'Options:',
        '  --count <n>             Number of bot users (default: 50)',
        '  --tag <slug>            Tag for deterministic bot emails (default: nearby)',
        '  --spread-km <km>        How far bots are scattered from center (default: 10)',
        '  --bot-radius-km <km>    Each bot user_locations.radius_km (default: 50)',
        '  --activity-per-bot <n>  Nearby activity rows per bot (default: 4)',
        '  --tracks-sample <n>     Tracks to sample from DB (default: 50)',
        '  --comments-per-bot <n>  Track comments per bot (default: 0)',
        '  --reset-activity        Delete existing bot activity before inserting',
        '',
        'Env (required):',
        '  SUPABASE_SERVICE_ROLE_KEY  (recommended) or SUPABASE_SECRET_KEY',
        '  SUPABASE_URL or VITE_SUPABASE_URL',
      ].join('\n')
    );
    process.exit(0);
  }

  const count = parseNumber(readArgValue(argv, '--count'), 'count') ?? 50;
  const tag = sanitizeTag(readArgValue(argv, '--tag') ?? 'nearby');

  const nearUserId = readArgValue(argv, '--near-user-id');
  const nearEmail = readArgValue(argv, '--near-email');
  const lat = parseNumber(readArgValue(argv, '--lat'), 'lat');
  const lon = parseNumber(readArgValue(argv, '--lon'), 'lon');

  const spreadKm = parseNumber(readArgValue(argv, '--spread-km'), 'spread-km') ?? 10;
  const botRadiusKm = parseNumber(readArgValue(argv, '--bot-radius-km'), 'bot-radius-km') ?? 50;
  const activityPerBot = parseNumber(readArgValue(argv, '--activity-per-bot'), 'activity-per-bot') ?? 4;
  const tracksSample = parseNumber(readArgValue(argv, '--tracks-sample'), 'tracks-sample') ?? 50;
  const commentsPerBot = parseNumber(readArgValue(argv, '--comments-per-bot'), 'comments-per-bot') ?? 0;
  const resetActivity = hasFlag(argv, '--reset-activity');

  return {
    count,
    tag,
    nearUserId: nearUserId || undefined,
    nearEmail: nearEmail || undefined,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    spreadKm,
    botRadiusKm,
    activityPerBot,
    tracksSample,
    commentsPerBot,
    resetActivity,
  };
}

function makeBotEmail(tag: string, index: number) {
  const suffix = String(index + 1).padStart(4, '0');
  return `bot.${tag}.${suffix}@example.com`;
}

function makeDisplayName(rand: () => number) {
  const firstNames = [
    'Alex', 'Jordan', 'Taylor', 'Sam', 'Casey', 'Riley', 'Avery', 'Morgan', 'Cameron', 'Drew',
    'Chris', 'Jamie', 'Kendall', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Skyler', 'Dakota', 'Emerson',
    'Ariana', 'Billie', 'SZA', 'Kendrick', 'Drake', 'Bad', 'Frank', 'Doja', 'Lana', 'Travis',
  ] as const;
  const lastInitials = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return `${pick(rand, firstNames)} ${pick(rand, lastInitials)}.`;
}

function makeAvatarUrl(seed: string) {
  const encoded = encodeURIComponent(seed);
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encoded}`;
}

function randomRecentIso(rand: () => number, maxHoursAgo = 12): string {
  const maxMs = maxHoursAgo * 60 * 60 * 1000;
  const delta = Math.floor(rand() * maxMs);
  return new Date(Date.now() - delta).toISOString();
}

async function resolveCenterLocation(args: Args, supabase: ReturnType<typeof createClient>) {
  if (args.nearUserId) {
    const { data, error } = await supabase
      .from('user_locations')
      .select('latitude, longitude, radius_km')
      .eq('user_id', args.nearUserId)
      .maybeSingle<UserLocationRow>();

    if (error) throw error;
    if (!data) {
      throw new Error(
        `No user_locations row found for user_id=${args.nearUserId}. Enable location sharing in-app first, or pass --lat/--lon.`
      );
    }

    return {
      lat: Number(data.latitude),
      lon: Number(data.longitude),
      radiusKm: Number(data.radius_km),
      source: `user:${args.nearUserId}`,
    };
  }

  if (args.nearEmail) {
    const normalized = args.nearEmail.trim().toLowerCase();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalized)
      .maybeSingle<{ id: string }>();

    if (profileError) throw profileError;
    if (!profile?.id) {
      throw new Error(`No profile found with email=${normalized}.`);
    }

    const { data: loc, error: locError } = await supabase
      .from('user_locations')
      .select('latitude, longitude, radius_km')
      .eq('user_id', profile.id)
      .maybeSingle<UserLocationRow>();

    if (locError) throw locError;
    if (!loc) {
      throw new Error(
        `No user_locations row found for email=${normalized}. Enable location sharing in-app first, or pass --lat/--lon.`
      );
    }

    return {
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      radiusKm: Number(loc.radius_km),
      source: `email:${normalized}`,
    };
  }

  if (typeof args.lat === 'number' && typeof args.lon === 'number') {
    return { lat: args.lat, lon: args.lon, radiusKm: args.spreadKm, source: 'args' };
  }

  throw new Error('Missing base location. Provide --near-user-id, --near-email, or --lat/--lon.');
}

async function loadTrackSample(args: Args, supabase: ReturnType<typeof createClient>): Promise<TrackRow[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('id,title,artist,provider')
    .limit(args.tracksSample);

  if (error) throw error;
  return (data ?? []) as TrackRow[];
}

async function upsertBotLocation(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  lat: number,
  lon: number,
  radiusKm: number
) {
  const { error } = await supabase
    .from('user_locations')
    .upsert({
      user_id: userId,
      latitude: lat,
      longitude: lon,
      sharing_enabled: true,
      radius_km: radiusKm,
    });

  if (error) throw error;
}

async function insertNearbyActivity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  track: TrackRow,
  listenedAt: string
) {
  const { error } = await supabase.from('nearby_activity').insert({
    user_id: userId,
    track_id: track.id,
    artist: track.artist ?? null,
    listened_at: listenedAt,
  });
  if (error) throw error;
}

async function insertPlayEvent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  track: TrackRow,
  playedAt: string
) {
  const provider = (track.provider ?? 'spotify').toString();
  const { error } = await supabase.from('play_events').insert({
    user_id: userId,
    track_id: track.id,
    provider,
    action: 'open_web',
    played_at: playedAt,
    context: 'bot-seed',
    metadata: { bot: true },
  });
  if (error) throw error;
}

async function tryInsertComment(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  track: TrackRow,
  content: string
) {
  try {
    const { error } = await supabase.from('track_comments').insert({
      user_id: userId,
      track_id: track.id,
      content,
      parent_id: null,
    });
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}

async function ensureBotUser(
  supabase: ReturnType<typeof createClient>,
  email: string,
  displayName: string,
  avatarUrl: string
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;
  if (existing?.id) {
    // Keep profile fresh
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: displayName, avatar_url: avatarUrl })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return { id: existing.id, created: false };
  }

  const password = `Bot!${randomUUID().replace(/-/g, '')}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (error) throw error;
  if (!data.user?.id) throw new Error('Failed to create user (missing id).');

  const { error: profileUpdateError } = await supabase
    .from('profiles')
    .update({ display_name: displayName, avatar_url: avatarUrl })
    .eq('id', data.user.id);
  if (profileUpdateError) throw profileUpdateError;

  return { id: data.user.id, created: true };
}

async function resetBotActivity(supabase: ReturnType<typeof createClient>, userId: string) {
  const { error: nearbyError } = await supabase.from('nearby_activity').delete().eq('user_id', userId);
  if (nearbyError) throw nearbyError;
  const { error: playError } = await supabase.from('play_events').delete().eq('user_id', userId).eq('context', 'bot-seed');
  if (playError) throw playError;
}

async function main() {
  const args = buildArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing env: SUPABASE_URL (or VITE_SUPABASE_URL).');
  }
  if (!serviceKey) {
    throw new Error(
      'Missing env: SUPABASE_SERVICE_ROLE_KEY (recommended). This script creates Auth users and must run with a secret key.'
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const center = await resolveCenterLocation(args, supabase);
  const tracks = await loadTrackSample(args, supabase);
  if (tracks.length === 0) {
    throw new Error('No tracks found in `public.tracks`. Seed tracks first (e.g. `bun run seed`).');
  }

  const seed = hashStringToU32(`${args.tag}:${center.source}`);

  // eslint-disable-next-line no-console
  console.log(
    `🤖 Seeding ${args.count} bot users around (${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}) (spread=${args.spreadKm}km, tag=${args.tag})`
  );

  let created = 0;
  let updated = 0;
  let activityRows = 0;
  let commentRows = 0;

  for (let i = 0; i < args.count; i++) {
    const email = makeBotEmail(args.tag, i);
    const localRand = mulberry32(hashStringToU32(`${seed}:${i}`));
    const displayName = makeDisplayName(localRand);
    const avatarUrl = makeAvatarUrl(`${args.tag}:${i}:${displayName}`);

    const { id: userId, created: didCreate } = await ensureBotUser(supabase, email, displayName, avatarUrl);
    if (didCreate) created++;
    else updated++;

    const point = randomPointInRadius(localRand, center.lat, center.lon, args.spreadKm);
    await upsertBotLocation(supabase, userId, point.lat, point.lon, args.botRadiusKm);

    if (args.resetActivity) {
      await resetBotActivity(supabase, userId);
    }

    const activityN = Math.max(0, Math.floor(args.activityPerBot));
    for (let j = 0; j < activityN; j++) {
      const track = pick(localRand, tracks);
      const ts = randomRecentIso(localRand, 12);
      await insertNearbyActivity(supabase, userId, track, ts);
      await insertPlayEvent(supabase, userId, track, ts);
      activityRows += 2;
    }

    const commentsN = Math.max(0, Math.floor(args.commentsPerBot));
    for (let j = 0; j < commentsN; j++) {
      const track = pick(localRand, tracks);
      const phrases = [
        'This one is on repeat.',
        'The chords here are so satisfying.',
        'That groove is undeniable.',
        'Instant vibe.',
        'The production is clean.',
      ] as const;
      const ok = await tryInsertComment(supabase, userId, track, pick(localRand, phrases));
      if (ok) commentRows++;
    }

    if ((i + 1) % 10 === 0 || i === args.count - 1) {
      console.log(`   ${i + 1}/${args.count} bots processed...`);
    }
  }

  console.log('✅ Bot seeding complete');
  console.log(`   Created: ${created}, Updated: ${updated}`);
  console.log(`   Activity rows: ${activityRows}, Comment rows: ${commentRows}`);
}

main().catch((err) => {
  console.error('❌ seed-nearby-bots failed:', err?.message || err);
  process.exit(1);
});
