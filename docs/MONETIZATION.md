# Monetization & Business Plan

**Status**: Living document — first version, written from the code as it actually
runs today, not from an external pitch deck. Where something is aspirational
rather than shipped, it's labeled as such.
**Last updated**: August 31, 2026

---

## 1. TL;DR

- Clade sells **monthly subscriptions** via Stripe: **Free**, **Starter**, **Pro**.
- Each plan grants a **credit allowance** that **resets every billing period**
  (not a rollover balance).
- **The credit balance is tracked and displayed, but nothing in the app
  currently spends credits.** There is no feature today that checks or
  deducts a user's balance before letting them do something. This is the
  single most important fact in this document — see [§4](#4-the-credits-system-what-actually-happens-today).
- **Three different pricing models currently exist in the codebase, and only
  one of them is wired to real payments.** The public `/pricing` marketing
  page shows different plans, names, and prices than the ones that actually
  process a Stripe checkout. See [§5](#5-known-inconsistency-three-pricing-models-in-one-codebase) —
  this needs a decision, not just documentation, and is flagged in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

---

## 2. What Clade is, for anyone reading this cold

A TikTok-style music discovery app that finds and compares songs by
**harmonic structure** (chord progressions, cadence, key/mode) rather than
genre or mood. Users browse a feed, play tracks via embedded Spotify/YouTube,
see a rotating chord readout for whatever's playing, and can now (as of this
session) get automatic verse/chorus segmentation from live-captured audio.
The things worth paying for are the parts that cost the business real money
per use or per user: analysis compute, storage, and — per the credit
scaffold already in the schema — presumably future AI/analysis-heavy
features.

---

## 3. The actual, functional billing system

**Where it lives**: `src/pages/BillingPage.tsx` (`/billing`, reached from
Profile → "Manage plan"), `supabase/functions/billing-checkout`,
`supabase/functions/billing-webhook`, and the `subscriptions` / `credits` /
`billing_events` tables (`supabase/migrations/20260124_billing_core.sql`).

This is the one real, end-to-end path: a signed-in user opens `/billing`,
picks a plan, `billing-checkout` creates a Stripe Checkout session, Stripe
redirects back after payment, and `billing-webhook` (verified via Stripe's
webhook signature) updates `subscriptions` and grants credits.

| Plan | Price | Billing period | Credit allowance |
|---|---|---|---|
| **Free** | ₪0 | — | 50 |
| **Starter** | ₪149 | / month | 500 |
| **Pro** | ₪349 | / month | 2,000 |

(Source: `PLAN_COPY` in `BillingPage.tsx`, cross-checked against
`CREDIT_ALLOWANCE` in `billing-webhook/index.ts` — the two agree with each
other, which is why this table is the one treated as "real" in this
document.)

### What happens on payment events

- `checkout.session.completed` and `invoice.paid` → upsert the subscription
  row, then **set** (not add to) the credit balance to that plan's
  allowance. A Pro subscriber who renews goes back to exactly 2,000, not
  2,000 + whatever was left.
- `invoice.payment_failed` → currently logged; whether the subscription is
  actually downgraded on repeated failure is worth confirming against
  Stripe's own dunning/retry settings before relying on it.
- `customer.subscription.deleted` / `.updated` → subscription row updated
  accordingly (see `billing-webhook/index.ts` for the exact field mapping).

### Currency and Stripe product setup

Prices are quoted in **₪ (ILS)** in the UI. Stripe price/product creation
itself isn't fully traced in this pass — confirm the live Stripe dashboard
prices are actually configured in ILS to match what's displayed, since a
mismatch there (charging in USD while showing ₪) would be a real,
user-facing billing bug, not just a documentation gap.

---

## 4. The credits system: what actually happens today

The schema (`credits` table: `user_id`, `balance`, `updated_at`) and the
granting logic (webhook sets balance on payment) are real and working.
**Consumption is not.** A full repo search for anything that reads a
user's balance to gate an action, or decrements it, turns up nothing —
`credits.balance` is written by the webhook and read back only to *display*
a number on `/billing` ("Balance: 50"). No edge function, hook, or service in
this codebase checks it before doing anything.

This matches the project's own roadmap: `docs/ROADMAP.md` and `TASKS.md`
both list **"Credit system configuration"** as an open, unstarted item under
Admin/System Configuration.

**In plain terms: paying for Starter or Pro today gets you a subscription
row and a bigger number on a balance display. It does not currently unlock
anything a Free user can't already do**, because nothing in the app checks
plan or credit balance to gate a feature. This is the gap between "billing
works" and "monetization works" — the former is true, the latter isn't yet.

### What a credit-consuming feature would need (not built)

1. **A metering point** — something that costs the business real money per
   use and is worth rationing. The best current candidate in this codebase
   is the **live audio-based detection work from this session**
   (`src/lib/harmony/sectionDetection.ts`, `useLiveChordDetection.ts`): it
   runs real DSP client-side today (free to the business, since it's the
   user's own CPU/mic), but if it's ever moved server-side, or paired with a
   heavier ML analysis pipeline (the `HARMONIC_ANALYSIS_ARCHITECTURE.md`
   pipeline already discusses a hybrid cached + async-ML approach for new
   tracks), that's real per-call cost.
2. **A spend function** — e.g. `public.spend_credits(user_id, amount)`,
   mirroring the existing `public.set_credits`, that decrements
   transactionally and rejects the action (with a clear "out of credits"
   error) at zero balance rather than going negative.
3. **A gate in the client** — a hook (`useCredits()`-shaped) that reads the
   balance, shows it contextually near the metered action, and surfaces an
   upgrade prompt when it hits zero, rather than only being visible as a
   line on the billing page.
4. **A decision on what's free vs. metered.** Recommendation: keep
   browsing, playback, the feed, and chord/section display **free and
   unmetered** (they're either free to serve or already core to the
   product's identity), and meter only genuinely expensive, optional,
   power-user actions if/when they exist server-side.

None of the above exists yet. It's scoped here because "how do credits
work" was asked directly, and the honest answer is "they're granted and
displayed; the spending half of the system hasn't been built."

---

## 5. Known inconsistency: three pricing models in one codebase

Found while writing this document — worth fixing, not just recording.

| Where | Plans shown | Prices | Wired to real payments? |
|---|---|---|---|
| `/billing` (`BillingPage.tsx`) + `billing-webhook` | Free / Starter / Pro | ₪0 / ₪149 / ₪349 | **Yes** — this is the real path |
| `/pricing` (`PricingPreview.tsx`, public marketing page) | Free Trial / Solo QA / Small Team / Team | ₪0 / ₪149 / ₪399 / ₪799 | No — static marketing copy, no plan keys match the backend at all |
| `src/services/billing.ts` | Premium Monthly / Annual / Lifetime | $9.99 / $89.99 / $199.99 (USD) | No — **dead code**, confirmed nothing in the app imports it |

The practical problem: a visitor reads pricing on `/pricing` ("Solo QA,
₪149/mo"), signs up, and lands on `/billing`, which shows **completely
different plan names** at overlapping-but-different prices ("Starter,
₪149/mo"). Even at the one price point that happens to match (₪149), the
plan *name* and feature list don't. That's a trust problem before it's a
documentation problem.

**Recommendation** (not yet done — flagging for a decision, since which set
of names/tiers is the "real" one going forward is a product call, not a
purely technical one):
1. Decide whether Free/Starter/Pro (functional) or
   Free Trial/Solo/Small Team/Team (marketing) is the intended public
   pricing structure — most likely the former should win since it's the one
   actually wired to Stripe, and the marketing copy should be rewritten to
   match it (in the app's own voice — harmonic discovery, not "Israeli
   automation market," which is what `PricingPreview.tsx` literally says
   today and reads like leftover boilerplate from an unrelated template).
2. Delete `src/services/billing.ts` (dead code) or clearly mark it
   deprecated if it's being kept as reference for a future one-time/lifetime
   tier.
3. Once reconciled, this document's §3 table becomes the single source of
   truth and `/pricing` should be generated from (or at least kept in sync
   with) `PLAN_COPY`, not hand-duplicated.

---

## 6. Monetization strategy — options going forward

Framed as a menu of directions with tradeoffs, not a locked commitment —
none of this is built, and revenue/market-size figures aren't invented here
since there's no historical data yet to project from.

### Option A — Freemium subscriptions (current schema's direction)
Free tier for browsing/discovery, paid tiers unlock server-side analysis
depth or volume (e.g. priority/faster analysis for newly-added tracks,
higher rate limits on search, export/API access for power users). This is
what the `credits`/`subscriptions` schema is already shaped for — lowest
effort to finish, since billing plumbing exists.

- *Pro*: infrastructure already ~70% there (billing works, metering
  doesn't).
- *Con*: needs a genuinely valuable metered feature to justify payment —
  right now there's nothing a Free user can't already do.

### Option B — One-time purchases (credit packs, no subscription)
Sell credit packs directly (₪49 for 200 credits, etc.) instead of/alongside
subscriptions. Lower commitment for casual users; `src/services/billing.ts`'s
abandoned Premium Monthly/Annual/**Lifetime** idea is closer to this shape
than to the credits model, which is likely why it was superseded rather than
finished.

- *Pro*: simpler mental model for users who don't want a subscription.
- *Con*: less predictable recurring revenue; would need its own Stripe
  price objects and a different webhook path than what exists today.

### Option C — B2B / catalog & rights-holder side
Already sketched (not built) in
[`LICENSING_AND_UNIVERSAL_PLAYER.md`](LICENSING_AND_UNIVERSAL_PLAYER.md)
§6: engagement analytics for labels, education licensing, provider
affiliate/referral programs. Orthogonal to the consumer subscription — could
run in parallel once there's enough usage data to be worth selling.

### Recommendation for the next concrete step

Reconcile §5 first (one pricing story, not three), then pick **one** metered
feature to wire credit consumption to before building anything else billing-
related — right now every dollar of subscription revenue is arguably
unearned, since Starter/Pro don't unlock anything. The section-boundary
detection built this session is a reasonable first candidate if/when it
grows a server-side, per-call-cost component; until then, Option A's
metering has nothing real to meter.

---

## 7. Open questions for a human to decide

These are genuine product/business decisions, not technical ones — noted
here rather than guessed at:

1. Which pricing structure (§5) is the intended public one?
2. What should Starter/Pro actually unlock, concretely, that Free doesn't?
3. Is the credits system meant to meter a *feature* (pay-per-use) or just be
   a soft usage cap (rate limiting dressed as currency)? The schema (a
   resetting-per-period balance) reads more like the latter.
4. Is a one-time/lifetime tier (per the abandoned `billing.ts`) still
   wanted alongside subscriptions, or was it correctly abandoned?
