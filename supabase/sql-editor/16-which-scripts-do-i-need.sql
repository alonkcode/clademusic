-- Read-only. Answers "which of these scripts still need running on THIS
-- project?" Changes nothing, so it is always safe to run first.
--
-- Run the two blocks SEPARATELY: the Supabase SQL Editor only shows the
-- result of the last statement in a run.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> paste one block -> Run.


-- ============================================================
-- BLOCK 1: which scripts are already applied?
-- ============================================================
-- Every column is TRUE when that script's effect is already present. Run the
-- scripts whose column comes back FALSE, lowest number first. A column that
-- is already TRUE can still be re-run safely (08/10/11 are all idempotent) -
-- it just isn't necessary.
--
-- Deliberately built out of to_regclass/to_regproc and a pg_proc lookup
-- rather than out of `SELECT ... FROM public.<table>`: those return NULL for
-- something that does not exist, whereas querying a missing table aborts the
-- whole statement. That is what lets this same block run on a completely
-- empty project and truthfully answer "no, none of it is there".
SELECT
  -- 01-06 laid down the base schema at all.
  to_regclass('public.profiles') IS NOT NULL
    AND to_regclass('public.tracks') IS NOT NULL          AS base_schema_01_06,

  -- 08-hotfix-signup: the SECOND signup trigger must be SECURITY DEFINER, or
  -- new signups fail with "Database error saving new user". Checked on the
  -- flag itself rather than on the function merely existing, because the
  -- pre-hotfix version exists too - it just isn't SECURITY DEFINER.
  COALESCE(
    (SELECT p.prosecdef
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_auto_playlists'
      LIMIT 1),
    FALSE)                                                AS hotfix_08_signup,

  -- 10-hotfix-credits: spend_credit() is what live detection actually calls,
  -- and public.credits is the table BillingPage reads. Note the app reads
  -- public.credits, NOT the older public.user_credits from 01-core-schema.
  to_regproc('public.spend_credit') IS NOT NULL
    AND to_regclass('public.credits') IS NOT NULL         AS hotfix_10_credits,

  -- 11-hotfix-rls-recursion: these helper functions are what broke the
  -- infinite-recursion policy cycles on playlists and chat. Without them,
  -- /playlists and chat reads fail outright with 42P17.
  to_regproc('public.can_read_playlist') IS NOT NULL
    AND to_regproc('public.is_chat_room_member') IS NOT NULL AS hotfix_11_rls;


-- ============================================================
-- BLOCK 2: is a credit top-up actually warranted?
-- ============================================================
-- Run this one only if BLOCK 1 said hotfix_10_credits = true; public.credits
-- does not exist before then, and querying a missing table is an error rather
-- than an empty result.
--
-- below_2500 = 0 means 14-topup-all-credits.sql has nothing left to do.
SELECT COUNT(*)                                        AS accounts_with_credits,
       COUNT(*) FILTER (WHERE balance < 2500)          AS below_2500,
       COALESCE(MIN(balance), 0)                       AS lowest_balance,
       COALESCE(MAX(balance), 0)                       AS highest_balance
FROM public.credits;
