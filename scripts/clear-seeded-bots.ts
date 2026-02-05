import { createClient } from '@supabase/supabase-js';

type Args = {
  tag: string;
  count: number;
  dryRun: boolean;
};

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readArgValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}

function sanitizeTag(tag: string): string {
  const cleaned = tag.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'nearby';
}

function makeBotEmail(tag: string, index: number) {
  const suffix = String(index + 1).padStart(4, '0');
  return `bot.${tag}.${suffix}@example.com`;
}

function buildArgs(argv: string[]): Args {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    console.log(
      [
        'Clear seeded bot users created by `seed:bots`.',
        '',
        'Options:',
        '  --tag <slug>    Tag used when creating bots (default: nearby)',
        '  --count <n>     How many bots to clear (default: 50)',
        '  --dry-run       Print what would be deleted without doing it',
        '',
        'Env (required):',
        '  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
        '  SUPABASE_URL or VITE_SUPABASE_URL',
      ].join('\n')
    );
    process.exit(0);
  }

  const tag = sanitizeTag(readArgValue(argv, '--tag') ?? 'nearby');
  const count = parseNumber(readArgValue(argv, '--count'), 'count') ?? 50;
  const dryRun = hasFlag(argv, '--dry-run');

  return { tag, count, dryRun };
}

async function safeDeleteByUserId(supabase: ReturnType<typeof createClient>, table: string, userId: string) {
  try {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw error;
  } catch (err: any) {
    console.warn(`⚠️  Failed to delete from ${table} for user ${userId}:`, err?.message || err);
  }
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
    throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`🧹 Clearing ${args.count} bots (tag=${args.tag})${args.dryRun ? ' [dry-run]' : ''}`);

  let deletedUsers = 0;
  let missingUsers = 0;

  for (let i = 0; i < args.count; i++) {
    const email = makeBotEmail(args.tag, i);
    const { data: profile, error } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle<{ id: string }>();
    if (error) throw error;

    if (!profile?.id) {
      missingUsers++;
      continue;
    }

    if (args.dryRun) {
      console.log(`   Would delete bot: ${email} (${profile.id})`);
      continue;
    }

    // Tables without FKs to auth.users can leave orphans; clear them explicitly.
    await safeDeleteByUserId(supabase, 'user_locations', profile.id);
    await safeDeleteByUserId(supabase, 'nearby_activity', profile.id);
    await safeDeleteByUserId(supabase, 'user_interactions', profile.id);
    await safeDeleteByUserId(supabase, 'track_comments', profile.id);

    const { error: deleteError } = await supabase.auth.admin.deleteUser(profile.id);
    if (deleteError) {
      console.warn(`⚠️  Failed to delete auth user for ${email}:`, deleteError.message);
      continue;
    }

    deletedUsers++;
    if ((i + 1) % 10 === 0 || i === args.count - 1) {
      console.log(`   ${i + 1}/${args.count} processed...`);
    }
  }

  console.log('✅ Done');
  console.log(`   Deleted users: ${deletedUsers}`);
  console.log(`   Missing users: ${missingUsers}`);
}

main().catch((err) => {
  console.error('❌ clear-seeded-bots failed:', err?.message || err);
  process.exit(1);
});

