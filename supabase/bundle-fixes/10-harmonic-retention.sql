-- Replacement for the two generated columns on harmonic_fingerprints.
--
-- The migration declared:
--   reuse_until     timestamptz GENERATED ALWAYS AS (analysis_timestamp + interval '90 days')  STORED
--   reanalyze_after timestamptz GENERATED ALWAYS AS (analysis_timestamp + interval '365 days') STORED
--
-- Postgres rejects both with:
--   ERROR: 42P17: generation expression is not immutable
--
-- `timestamptz + interval` is STABLE, not IMMUTABLE: adding an interval has to
-- resolve against the session TimeZone setting (it is what makes DST arithmetic
-- correct), and a STORED generated column may only use immutable expressions.
--
-- The build script rewrites those two lines into plain columns with defaults;
-- this trigger keeps them correct when analysis_timestamp is set or changed,
-- which is the behaviour the generated columns were meant to provide.

CREATE OR REPLACE FUNCTION public.set_harmonic_retention()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.reuse_until     := COALESCE(NEW.analysis_timestamp, now()) + interval '90 days';
  NEW.reanalyze_after := COALESCE(NEW.analysis_timestamp, now()) + interval '365 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hf_retention ON public.harmonic_fingerprints;
CREATE TRIGGER trg_hf_retention
  BEFORE INSERT OR UPDATE OF analysis_timestamp ON public.harmonic_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public.set_harmonic_retention();
