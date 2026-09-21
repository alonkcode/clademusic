-- The feed's Vibe and Share buttons only ever updated FeedPage's local React
-- state (a Map<trackId, Set<InteractionType>> that's thrown away on refresh) -
-- unlike Like/Save/Harmonic, nothing about them ever reached the database.
--
-- Like/Save/Harmonic already have a home: 20260122_unified_interactions.sql's
-- toggle_like / toggle_bookmark / toggle_harmony_save RPCs, writing to the
-- boolean+timestamp columns on the single per-(user,track) row in
-- public.user_interactions (see bundle-fixes/00-compat-prelude.sql for why
-- that row shape won over the older one-row-per-interaction_type design).
--
-- This adds the same shape for Vibe (a toggle, like the other three) and Share
-- (a counter - a track can be shared any number of times, so it isn't a
-- boolean). get_interaction_state must be dropped and recreated because
-- CREATE OR REPLACE FUNCTION cannot add a column to an existing TABLE(...)
-- return type.

BEGIN;

ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS vibed BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS vibed_at TIMESTAMPTZ;
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS last_shared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_interactions_vibed ON public.user_interactions(user_id) WHERE vibed = TRUE;

-- Toggle vibe (mirrors toggle_harmony_save / toggle_bookmark)
CREATE OR REPLACE FUNCTION public.toggle_vibe(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_vibed BOOLEAN;
BEGIN
  INSERT INTO public.user_interactions (user_id, track_id, vibed, vibed_at)
  VALUES (p_user_id, p_track_id, TRUE, NOW())
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET
    vibed = NOT public.user_interactions.vibed,
    vibed_at = CASE
      WHEN NOT public.user_interactions.vibed THEN NOW()
      ELSE NULL
    END;

  SELECT vibed INTO v_is_vibed
  FROM public.user_interactions
  WHERE user_id = p_user_id AND track_id = p_track_id;

  RETURN v_is_vibed;
END;
$$ LANGUAGE plpgsql;

-- Record a share event. Not a toggle: share_count only ever goes up.
CREATE OR REPLACE FUNCTION public.record_share(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.user_interactions (user_id, track_id, share_count, last_shared_at)
  VALUES (p_user_id, p_track_id, 1, NOW())
  ON CONFLICT (user_id, track_id)
  DO UPDATE SET
    share_count = public.user_interactions.share_count + 1,
    last_shared_at = NOW();
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS public.get_interaction_state(UUID, TEXT);

CREATE FUNCTION public.get_interaction_state(
  p_user_id UUID,
  p_track_id TEXT
)
RETURNS TABLE (
  liked BOOLEAN,
  harmony_saved BOOLEAN,
  bookmarked BOOLEAN,
  vibed BOOLEAN,
  play_count INTEGER,
  last_played_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(ui.liked, FALSE),
    COALESCE(ui.harmony_saved, FALSE),
    COALESCE(ui.bookmarked, FALSE),
    COALESCE(ui.vibed, FALSE),
    COALESCE(ui.play_count, 0),
    ui.last_played_at
  FROM public.user_interactions ui
  WHERE ui.user_id = p_user_id AND ui.track_id = p_track_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, FALSE, 0, NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.toggle_vibe IS
'DRY function to toggle vibe state (More like this - vibe). Returns new state.';
COMMENT ON FUNCTION public.record_share IS
'Increments a per-user share_count for a track. Not a toggle - a track can be shared repeatedly.';

COMMIT;

NOTIFY pgrst, 'reload schema';
