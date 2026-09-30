#!/usr/bin/env node
/**
 * Fails when a commit changes what the app does without a CHANGELOG.md entry.
 *
 * Work reaches `main` by direct push, so the PR template's "Updated
 * CHANGELOG.md" box is never seen, and the changelog went a month and ~170
 * commits without an entry. This checks every commit in a range instead.
 *
 *   node scripts/check-changelog.mjs <base>..<head>   # a range, e.g. origin/main..HEAD
 *   node scripts/check-changelog.mjs <sha>            # one commit
 *
 * A commit passes when it:
 *   - touches no runtime code (src/, supabase/, services/, public/, index.html),
 *     counting tests as not runtime; or
 *   - changes CHANGELOG.md itself; or
 *   - has a subject starting test:, refactor:, ci:, chore:, docs:, style: or
 *     build: (no behavior change by convention); or
 *   - says `[no changelog]` in its message.
 * Merge commits are skipped: the commits they bring in are checked themselves.
 *
 * No dependencies, so CI can run it with the runner's own node.
 */

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const RUNTIME = /^(src|supabase|services|public)\/|^index\.html$/;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|^src\/test\//;
const EXEMPT_SUBJECT = /^(test|tests|refactor|ci|chore|docs|style|build)(\([^)]*\))?!?:/i;
const OPT_OUT = /\[no changelog\]/i;

function commitsIn(spec) {
  const [base, head] = spec.includes('..') ? spec.split('..') : [null, spec];
  // A push that creates a branch reports an all-zero "before"; a force push
  // can report one this clone never had. Either way, check only the tip.
  const usableBase = base && !/^0+$/.test(base) && exists(base) ? base : null;
  const range = usableBase ? `${usableBase}..${head}` : `${head}^!`;
  const list = git('rev-list', '--no-merges', range);
  return list ? list.split('\n') : [];
}

function exists(rev) {
  try {
    git('cat-file', '-e', `${rev}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function check(sha) {
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean);
  const message = git('log', '-1', '--format=%B', sha);
  const subject = message.split('\n')[0];
  const runtime = files.filter((f) => RUNTIME.test(f) && !TEST.test(f));

  if (runtime.length === 0) return null;
  if (files.includes('CHANGELOG.md')) return null;
  if (EXEMPT_SUBJECT.test(subject) || OPT_OUT.test(message)) return null;
  return { sha: sha.slice(0, 8), subject, runtime };
}

const spec = process.argv[2];
if (!spec) {
  console.error('usage: node scripts/check-changelog.mjs <base>..<head> | <sha>');
  process.exit(2);
}

const missing = commitsIn(spec).map(check).filter(Boolean);
if (missing.length === 0) {
  console.log('Changelog check passed.');
  process.exit(0);
}

for (const m of missing) {
  const shown = m.runtime.slice(0, 5).join(', ') + (m.runtime.length > 5 ? `, +${m.runtime.length - 5} more` : '');
  // ::error:: turns into an annotation on the run when this runs in GitHub Actions.
  console.log(`::error::${m.sha} "${m.subject}" changes ${shown} but not CHANGELOG.md`);
}
console.log(
  `\n${missing.length} commit(s) change runtime code without a CHANGELOG.md entry.\n` +
    'Add an entry under "## [Unreleased]" in the same commit (see AGENTS.md, "Documentation"),\n' +
    'or, if nothing a user or operator would notice changed, start the subject with\n' +
    'test:/refactor:/ci:/chore:/docs:/style:/build: or put "[no changelog]" and a reason in the message.'
);
process.exit(1);
