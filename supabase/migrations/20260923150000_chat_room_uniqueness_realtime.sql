-- Make room chat safe to mount: one global room, one room per track, realtime on.
--
-- Why: 20260122_live_chat.sql seeds the global room with
-- `INSERT ... ON CONFLICT DO NOTHING`, but chat_rooms had no unique key for it
-- to conflict on, so every re-run of that seed added another "Global Chat".
-- Track rooms are created on demand by the client (select, then insert), so two
-- people opening the same track at once could each create one. Clients resolve
-- a room with LIMIT 1, so duplicates split the audience into rooms that can't
-- see each other's messages.
--
-- Also: no migration in this repo adds any table to the supabase_realtime
-- publication, so postgres_changes subscriptions on chat_messages would never
-- receive an event on a database built only from these files.
--
-- Safe to re-run.

DO $$
BEGIN
  IF to_regclass('public.chat_rooms') IS NULL OR to_regclass('public.chat_messages') IS NULL THEN
    RAISE NOTICE 'chat tables not present; skipping chat room uniqueness migration';
    RETURN;
  END IF;

  -- 1. Merge duplicate global / per-track rooms into the oldest one. Messages are
  --    repointed first; the duplicate rooms' memberships only hold last_read_at,
  --    and public rooms don't need membership to read or post, so those cascade.
  UPDATE public.chat_messages m
  SET room_id = r.keeper_id
  FROM (
    SELECT id,
           first_value(id) OVER (
             PARTITION BY type, COALESCE(track_id, '')
             ORDER BY created_at, id
           ) AS keeper_id
    FROM public.chat_rooms
    WHERE type IN ('global', 'track')
  ) r
  WHERE m.room_id = r.id AND r.id <> r.keeper_id;

  DELETE FROM public.chat_rooms c
  USING (
    SELECT id,
           first_value(id) OVER (
             PARTITION BY type, COALESCE(track_id, '')
             ORDER BY created_at, id
           ) AS keeper_id
    FROM public.chat_rooms
    WHERE type IN ('global', 'track')
  ) r
  WHERE c.id = r.id AND r.id <> r.keeper_id;

  -- 2. Enforce it going forward. The constant expression makes the partial
  --    index a singleton: at most one row can ever have type = 'global'.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_single_global
    ON public.chat_rooms ((true)) WHERE type = 'global';

  CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_one_per_track
    ON public.chat_rooms (track_id) WHERE type = 'track';

  -- 3. The app needs a global room to exist.
  INSERT INTO public.chat_rooms (name, type, metadata)
  SELECT 'Global Chat', 'global', '{"description": "Chat with everyone on CladeAI"}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.chat_rooms WHERE type = 'global');

  -- 4. Realtime delivery for new messages.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'chat_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;
