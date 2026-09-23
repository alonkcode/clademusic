/**
 * The server decides whether a live capture is good enough to become a
 * track's saved analysis; the browser needs the very same rule to show the
 * listener how close they are and to know when to send. One implementation,
 * imported from where the edge function imports it, so the two cannot drift.
 */
export * from '../../../supabase/functions/_shared/autoPromotion';
