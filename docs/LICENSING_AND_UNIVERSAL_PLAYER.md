# Universal Player + Licensing Model (Global + Israel)

> **Status of this document.** This document describes what Clade's software is *designed* to do and the limits it must stay within. It is not legal advice, and it does not grant, claim, or evidence any license, permission, or partnership. Where it differs from a provider's terms, **the provider's terms control** (§8). Provider terms were last reviewed on **2026-09-26** (see the review log in §12); re-review them before enabling or materially changing any integration. What is built today, as opposed to only designed, is listed in §13.

## Executive framing (what Clade is / is not)

Clade is **a controller, server-side analysis, and analytics layer for licensed playback experiences.**

Clade may provide, each only to the extent the relevant provider permits it (§10–§11):
- a universal player/controller UX across providers,
- provider playback controls through **official mechanisms** (SDKs, embeds, link-outs),
- server-side analysis where the necessary input is legitimately available and permitted,
- real-time analysis visualization,
- internal engagement analytics (truthfully labeled),
- provider-sourced attribution and credits, and licensed rights-grade metadata where available.

Clade does **not** inherently become, and must not be built as:
- a digital service provider (DSP) that transmits audio files,
- a music streaming service,
- a rebroadcaster of provider streams,
- a DRM bypass,
- an unauthorized audio extraction system,
- an offline downloader,
- an unauthorized audio cache.

Two distinctions carry the whole model:

1. **Playback is not analysis.** Playback is the provider delivering audio to the user through the provider's own mechanism. Analysis is a separate, optional path that produces *derived data* (chords, key, tempo, sections). A provider permitting playback says nothing about whether it permits analysis (§9).
2. **The licensed provider remains the service delivering the audio.** Clade's servers are never in the audio delivery path to users.

## 1) How streaming licensing works (in practice)

Most commercial music has two separate copyrights:

1) **Sound recording (“master”)**  
   Controlled by labels/distributors/artists.
2) **Musical work (“composition/publishing”)**  
   Controlled by songwriters/publishers; administered through publishers + collecting societies.

Interactive streaming services (Spotify/Apple Music) clear both categories at scale via:
- master licenses (usually direct commercial deals),
- publishing licenses (performance + mechanical, via territory-specific structures),
- reporting/audit requirements.

Video platforms (YouTube) use a different structure that mixes platform licenses, rights-holder policies, and content identification systems.

## 2) Why Clade does not need blanket music licenses (if built correctly)

Clade generally avoids taking on “DSP licensing” obligations if:
- audio playback occurs only through provider SDKs/embeds/link-outs,
- Clade does not transmit or cache audio,
- Clade does not repackage streams or provide alternative playback endpoints,
- Clade honors provider entitlements (e.g., Spotify Premium requirements).

Clade still must comply with:
- provider developer terms, branding requirements, attribution strings,
- API quotas, rate limits, and permitted metadata usage,
- privacy laws (telemetry disclosures, consent where required).

**These conditions describe the playback path only.** Server-side analysis (§9) puts audio in front of Clade's own servers, which is a different position from the one this section describes. This document does **not** conclude that no additional license or permission is needed for that. It has to be established separately for each provider and input (§12) before the analysis path is enabled for that provider. Until then, the analysis path stays off, and this section's conclusion holds because Clade never touches that provider's audio.

## 3) Provider integration tiers (enforceable design)

### Tier A — SDK playback (highest control, strictest terms)
Examples:
- Spotify Web Playback SDK (premium entitlement)
- Apple Music MusicKit JS (user authorization + Apple developer setup)

Capabilities:
- play/pause/seek/state callbacks (best analytics fidelity)

### Tier B — Official embeds
Examples:
- YouTube IFrame API
- SoundCloud/Bandcamp embeds (where available and permitted)

Capabilities:
- partial state callbacks (YouTube), variable measurement fidelity

### Tier C — Link-out only (still compliant)
Examples:
- Deezer / Amazon Music when no stable approved SDK path exists

Capabilities:
- “Open in provider” + measure outbound click intent (not playback)

**A tier describes playback control only. It confers no analysis, storage, or processing rights.** Per-provider analysis status is in §10–§11.

## 4) Counting plays per user (internal analytics vs provider “streams”)

Do **not** label internal metrics as “streams” for royalty purposes.

Use definitions that are true and defensible:
- **Playback intent**: user clicked play/open.
- **Playback session**: a bounded session with a session_id.
- **Qualified play (internal)**: exceeded threshold (e.g., 30 seconds of active playback) measured from SDK/embed state when available.

Provider partnerships may enable “official stream” attribution later, but that is contractual and provider-defined.

## 5) Crediting rights holders correctly (realistic approach)

### What you can do immediately (no new licenses)
Provider-sourced attribution:
- artist(s), track title, album, label (if exposed), ISRC (sometimes)
- clear source attribution (“Data via Spotify/Apple/YouTube”)

### What requires licensed metadata
Rights-grade crediting (writers/publishers/splits, ISWC mapping) typically requires:
- licensing commercial rights metadata sources, and/or
- direct partner feeds (labels/publishers) with contractual permissions.

Recommended normalized identifiers:
- **ISRC** (recording) and **ISWC** (work/composition), plus party registries.

## 6) Monetization compatible with providers + rights orgs

Provider-side:
- referral traffic / affiliate programs where offered
- API quota agreements for scale
- co-marketing as a discovery/education layer

Rights-holder side:
- engagement analytics and discovery funnels (catalog strategy)
- education licensing (institutional)
- licensed rights metadata upgrades (premium feature)

## 7) Global + Israel operational checklist (high level)

### Legal/Policy
- Terms of Service and Privacy Policy: telemetry + provider delegation disclosures
- DMCA/notice-and-takedown posture if any UGC exists
- Trademark/branding compliance for each provider

### Product enforcement
- single active playback surface (no mixing / rebroadcast)
- strict “no caching” and “no clip export” rules unless separately licensed; this covers audio used as analysis input, which is processed transiently and never stored, cached, exported, or returned to any client
- entitlement-aware fallbacks (SDK → embed → link-out)
- provider-gated analysis: analysis for a provider is off unless a §12 review has enabled it
- when a provider restricts something, disable the capability; never build a workaround

### Data governance
- retention limits for raw telemetry; aggregate where possible
- user deletion pathways for analytics where required
- provider-imposed retention limits on provider data (e.g., YouTube API data, §11) take precedence over Clade defaults

## 8) Compliance hierarchy: provider rules outrank Clade's architecture

**Nothing in the Clade license, product architecture, internal documentation, or implementation requirements overrides Spotify for Developers terms, Spotify platform rules, Spotify API/SDK restrictions, or any other provider's applicable requirements.**

The MIT License covers Clade's own source code. It grants no rights in any provider's content, APIs, or SDKs, and it does not authorize any use a provider prohibits.

```text
Applicable law
      ↓
Provider contractual/developer requirements
      ↓
Provider API/SDK technical restrictions
      ↓
Clade license/product requirements
      ↓
Implementation
```

A requirement lower in this list can only be *narrower* than the one above it. The implementation must never move upward by treating a Clade requirement (“the architecture supports server-side analysis”) as permission to violate a provider restriction. Where a provider's rules are stricter than Clade's general architecture, **the provider's restrictions control that integration.**

Working rules that follow from this:

- **Technical possibility is not permission.** “The API allows it,” “the browser lets the user share the tab,” or “the module can process the samples” never justify a capability on their own.
- **Disable, don't work around.** If a provider restricts a capability, or its rules are unclear, the capability is turned off for that provider. No workaround designed to circumvent a provider restriction is implemented.
- **Stop and flag uncertainty.** When it is unclear whether a provider permits an analysis technique, work stops on that technique and the question is recorded in §13 for a human decision. It is not resolved by reasoning toward the permissive reading.
- **Provider-aware, not provider-uniform.** No provider is assumed to permit what another permits. A method supported for one provider is not thereby available for Spotify or any other.

## 9) Architecture: playback path and analysis path

### 9.1 Two separate paths

- **Playback path.** The user's player (provider SDK, embed, or provider app) receives audio from the provider through the provider's own mechanism. Clade sends control commands through the provider's official API and reads the provider's state callbacks. Clade's servers do not carry, copy, or re-serve this audio.
- **Analysis path.** An optional path that produces derived data about a track. It exists for a provider only where that provider's rules allow a suitable analysis input. It never carries audio *to* a client, and it does not exist for a provider that has not been reviewed and enabled (§12).

### 9.2 Live Track Analysis (server-side, cross-device)

```text
Official provider playback
        │
        ▼
Provider-authorized integration
        │
        ▼
Permitted analysis input          ← exists only if the provider's rules allow it;
        │                            otherwise the path ends here and playback continues normally
        ▼
Clade server-side analysis
        │
        ▼
Live analysis results
        │
        ▼
Client visualization
```

This is **not** the architecture, and must not be built:

```text
Spotify/YouTube stream
        ↓
Clade server
        ↓
Clade redistributes stream
        ↓
client
```

Design requirements for the analysis path:

1. **Input is gated per provider.** The “permitted analysis input” step is selected by a per-provider capability decision that defaults to *disabled* and is changed only by a documented §12 review. The analysis code itself is provider-neutral and has no notion of whether an input is permitted; that decision is made upstream of it.
2. **Audio is transient.** Audio used as analysis input is processed in memory, bounded in length, and discarded. It is never persisted, cached, exported, forwarded, or returned to any client. Only derived results leave the analysis step.
3. **Results, not audio.** What is produced and delivered is structured derived data: timestamped chord spans, key and tempo estimates, and section boundaries. Harmony is stored relatively (Roman numerals, relative tonal center), per `docs/HARMONIC_ANALYSIS_ARCHITECTURE.md`. Stored derived data remains subject to any provider retention or storage limits (§11).
4. **Playback stays with the provider.** Results are aligned to the position the provider's own player reports. Clade does not become the playback clock.

### 9.3 Cross-device availability

Client-side capture only works where the browser allows it. `useLiveChordDetection` requires `getDisplayMedia` with tab audio, which works on desktop Chrome/Edge, is not exposed by Safari, and is not implemented by mobile browsers. Server-side analysis is designed so that **availability of analysis no longer depends on the viewing device's capture ability**: results attach to the track and playback session and can be shown on any signed-in device that is displaying that track, including phones and Safari.

This is availability of *results*. No device receives audio from Clade, and no device needs to capture audio. Cross-device availability applies only for providers where the analysis path is enabled.

### 9.4 Real-time result delivery

Results are designed to reach the client as a stream of small structured messages (new chord span, key/tempo snapshot, section boundary) that the client renders against the provider player's reported position. Nothing on this channel carries audio.

## 10) Capability matrix

“Conditional” means the architecture *can* support the capability, but only for a provider and input the provider's current documentation and agreements permit. It is off by default. The exact per-provider answer must be determined from the provider's current documentation and agreements; a provider is never marked as supporting a capability merely because the code can perform it.

| Capability                                        | Clade architecture | Provider permission required |
| ------------------------------------------------- | -----------------: | ---------------------------: |
| Universal player UI                               |                Yes |                          Yes |
| Official provider playback                        |                Yes |                          Yes |
| Server-side live analysis                         |        Conditional |                          Yes |
| Audio processing                                  |        Conditional |                          Yes |
| Audio storage                                     |        Conditional |                          Yes |
| Audio caching                                     |        Conditional |                          Yes |
| Derived analysis data storage (chords/key/tempo)  |        Conditional |                          Yes |
| Provider stream proxying                          |                 No |                          N/A |
| Rebroadcast / redistribution of provider audio    |                 No |                          N/A |
| Mixing provider audio with other audio            |                 No |                          N/A |
| DRM / technical-protection circumvention          |                 No |                          N/A |
| Unauthorized downloading / stream ripping         |                 No |                          N/A |

## 11) Provider compliance

Findings below come from the providers' published texts, retrieved on **2026-09-26** by automated fetch. Section references and quotations must be confirmed against the primary documents by a maintainer or counsel before anyone relies on them. **Absence of a prohibition in a reviewed text is not a grant of permission** (§8).

### 11.1 Reviewed providers

| Field | Spotify | YouTube |
| --- | --- | --- |
| Permitted playback mechanism | Spotify Web Playback SDK, embeds, and link-out; playback controls via the official Web API | YouTube IFrame Player API; the player must be visible in the page (no background player, Developer Policies III.I.9) |
| Permitted APIs/SDKs | Spotify Web API and Web Playback SDK under the Developer Terms and Policy | YouTube IFrame Player API; YouTube Data API (Clade proxies search through its own Edge Function) |
| Permitted analysis capabilities | **None established.** Developer Policy III.13 prohibits analyzing Spotify Content “for any purpose” (§11.2). Provider-supplied analysis data, if the API offers any to Clade's registered app, is the kind of input that would be provider-authorized; its availability has **not** been verified | **None established.** The reviewed texts do not address analysis or processing of YouTube content; that is treated as *not permitted* until confirmed |
| Restrictions on audio access | Audio only through Spotify's playback mechanisms; no stream ripping or functionality that makes it easier to capture or make permanent copies (Terms IV.2.2) | Audio and video components may not be separated, isolated, or modified (Developer Policies III.I.7–8) |
| Restrictions on storing audio | Not permitted | Not permitted |
| Restrictions on transforming content | No reverse engineering or derivative works of the Platform (Terms IV.2.1); no ML/AI training on, or ingestion of, Spotify Content (Terms IV.2.1, Policy III.14); no segue, mix, re-mix, or overlap with other audio (Policy III.7) | Player may not be modified, built upon, or blocked, and its links, ads, and notices may not be removed or obscured (Developer Policies III.I.4–6) |
| Restrictions on synchronization | Policy III.6 prohibits synchronizing sound recordings with visual media. Whether an on-screen chord/section display falls under this is **open** (§13) | Not addressed in the reviewed sections |
| Restrictions on caching | Do not store or build databases of Spotify Content beyond what is strictly necessary to operate the app; keep data current and delete older data (Terms IV.3.1.1); local caching limited to metadata and cover art (Terms IV.3.2) | API data other than authorized data: 30 calendar days maximum before refresh or deletion (Developer Policies III.E.4) |
| Attribution requirements | Attribute content as supplied by Spotify using the Spotify Marks; metadata, cover art, and preview clips must link back to Spotify (Policy II.4); do not remove IP notices (Terms VII.1.4) | Follow the YouTube Branding Guidelines (API Services Terms 10.3); retain proprietary-rights notices (Terms 11) |
| User/account requirements | Streaming through the Platform is for Premium subscribers only (Policy IV.1); user authorizes their own Spotify account | No user account needed for the embed; Clade's own API client registration and quota apply |
| Applicable developer-platform terms | Spotify Developer Terms (v10, effective 2025-05-15), Spotify Developer Policy (effective 2025-05-15), Spotify API/SDK documentation and branding guidelines | YouTube API Services Terms of Service and Developer Policies (both marked last updated 2026-09-14 UTC), YouTube Branding Guidelines |
| **Analysis path status** | **Disabled by rule (§11.2).** Playback and metadata are unaffected | **Disabled by rule.** Playback through the visible IFrame player is unaffected |

### 11.2 Spotify

**Clade's Spotify integration must comply with the current Spotify for Developers Platform Terms, Developer Policy, API/SDK documentation, and applicable Spotify requirements.**

The Clade license does **not** grant permission to:
- obtain Spotify audio through unauthorized means,
- circumvent DRM or technical protections,
- intercept protected playback,
- download Spotify audio,
- cache Spotify audio outside permitted mechanisms,
- rebroadcast Spotify audio,
- create an unauthorized Spotify stream proxy,
- alter Spotify content in a manner prohibited by Spotify,
- bypass Spotify's official playback mechanisms,
- use Spotify APIs or SDKs in ways prohibited by Spotify's current developer rules.

If Spotify's rules prohibit a particular server-side analysis method, that method is **not implemented for Spotify**, even where the general Clade architecture supports server-side analysis for another provider.

Provisions in the retrieved texts that bear directly on Live Track Analysis:

- **Developer Policy, Section III (“Some prohibited applications”), item 13:** “Do not analyze the Spotify Content or the Spotify Service for any purpose, including without limitation, creating new or derived listenership metrics, benchmarking, functionality, usage statistics, user metrics, or building profiles of users, including for the purpose of targeting them with advertising or marketing.”
- **Developer Policy III.14 / Developer Terms IV.2.1:** no use of the Spotify Platform or Spotify Content “to train a machine learning or AI model or otherwise ingest Spotify Content into a machine learning or AI model.”
- **Developer Policy III.7:** “Do not permit any device or system to segue, mix, re-mix, or overlap any Spotify Content with any other audio content (including other Spotify Content).”
- **Developer Policy III.6:** “Do not synchronize any sound recordings with any visual media, including any advertising, film, television program, slideshow, video, or similar content.”
- **Developer Terms IV.2.2:** no “stream ripping or other functionalities that make it easier for users to capture or otherwise make permanent copies of Spotify Content.”
- **Developer Terms IV.3.1.1:** do not “store, aggregate or create compilations or databases of Spotify Content, other than as strictly necessary to operate” the app.
- **Developer Policy IV.1 (“Streaming and Commercial Use”):** streaming through the Platform is only for Premium subscribers.

**Consequence.** Item 13 is broad, and Clade has no written confirmation from Spotify that server-side or capture-based analysis of Spotify audio falls outside it. Under §8 the question is therefore treated as unresolved and the analysis path stays **off for Spotify**. Enabling it requires written confirmation from Spotify or a Spotify agreement that covers it, recorded in the §12 log. Nothing in this repository should be read as having that confirmation.

### 11.3 YouTube

Playback is through the official IFrame Player, displayed and unmodified. The reviewed texts are silent on analysis of YouTube content, and they do restrict separating or isolating the audio component of YouTube content (III.I.7–8). Silence is not permission, so the analysis path stays **off for YouTube** until confirmed (§8, §13). API data must be refreshed or deleted within 30 calendar days unless it is authorized data (III.E.4).

### 11.4 Providers not yet reviewed

| Provider | Playback mechanism (from §3) | Analysis / audio processing / audio storage / caching |
| --- | --- | --- |
| Apple Music | Tier A: MusicKit JS | **Not reviewed. Disabled.** |
| SoundCloud, Bandcamp | Tier B: official embeds where available and permitted | **Not reviewed. Disabled.** |
| Deezer, Amazon Music | Tier C: link-out only | **Not reviewed. Disabled.** |

For each of these, the §11.1 fields (permitted APIs, analysis, audio access, storage, transformation, synchronization, caching, attribution, account requirements, applicable terms) must be completed from the provider's current documentation before any capability beyond its stated playback tier is enabled.

## 12) Dynamic compliance

Provider capabilities and restrictions must be reviewed against the provider's **current** documentation and contractual requirements before enabling or materially changing an integration. Today's provider rules are not assumed to stay unchanged.

- **Before enabling** any analysis, storage, caching, or processing capability for a provider: complete the §11.1 fields for that provider from its current terms, policies, and API/SDK documentation, record the review below, and only then enable the capability for that provider.
- **When a provider changes its rules**, or Clade's use of the provider materially changes: re-review, and adapt the implementation to the new restrictions.
- **When a restriction applies or is unclear:** prefer disabling the capability over implementing an unauthorized workaround. Where a provider's rules require it, delete or refresh data already held.
- **When uncertain whether a technique is permitted:** stop, flag it in §13, and do not implement it.

### Review log

| Date | Provider | Documents reviewed | Outcome | Reviewer |
| --- | --- | --- | --- | --- |
| 2026-09-26 | Spotify | Developer Terms (v10, effective 2025-05-15); Developer Policy (effective 2025-05-15) | Analysis of Spotify audio not established as permitted, so disabled by rule. Open questions in §13 | Claude Code, from automated retrieval of the published pages. Not a legal review |
| 2026-09-26 | YouTube | API Services Terms of Service; Developer Policies (both marked last updated 2026-09-14 UTC) | Visible IFrame playback permitted. Analysis not addressed, so not established and disabled by rule. Open questions in §13 | Claude Code, as above. Not a legal review |
| — | Apple Music, SoundCloud, Bandcamp, Deezer, Amazon Music | Not reviewed | Analysis, processing, storage, and caching disabled by default | — |

## 13) Implementation status and open compliance questions

### What exists in the repository today (2026-09-26 worktree)

- **Client-side live detection, implemented.** `src/hooks/useLiveChordDetection.ts` analyzes tab audio the user explicitly shares through `getDisplayMedia` (desktop Chrome/Edge only). `src/hooks/useAnalyzeTrack.ts` offers it for tracks with no stored analysis and submits **derived results only** (no audio) to `supabase/functions/ingest-detection`, which stores them as that track's analysis for all users.
- **Server-side DSP, present but not wired.** `supabase/functions/_shared/dsp/previewAnalysis.ts` (`analyzePcm`) runs the chord/key/tempo pipeline over decoded samples. It has **no audio source, no fetching, no decoding, and no function or route that calls it**; only its tests reference it. It is provider-neutral and does not decide whether an input is permitted.
- **`harmonic-analysis` Edge Function is a placeholder.** It returns a randomly chosen mock progression and does not read audio. Its `method: 'ml_audio'` response label must not be read as real audio analysis.
- **Not implemented:** the per-provider capability gate (§9.2), server-side Live Track Analysis, and cross-device real-time result delivery (§9.3–§9.4). Those sections describe design intent.

### Open questions (each needs an owner or counsel decision; none is resolved by this document)

1. **Spotify: capture-based analysis.** `useAnalyzeTrack` currently treats `spotify` as a supported provider, so a user can run capture-based analysis while Spotify plays. Whether that is compatible with Developer Policy III.13 (and Terms IV.2.2) is unresolved. Under §8 the analysis path should be off for Spotify; the code does not yet enforce that.
2. **YouTube: capture-based analysis.** The same code path treats `youtube` as supported. The reviewed texts do not address analysis, and III.I.7–8 restricts isolating the audio component.
3. **Shared catalog of derived results.** `ingest-detection` stores analysis derived from provider playback for all users. Whether that is a permitted use of provider content (for example, Spotify Terms IV.3.1.1 on databases of Spotify Content) is unresolved.
4. **Spotify: synchronization.** Whether showing chords and sections against Spotify playback falls under Policy III.6 is unresolved.
5. **Spotify: overlap with other audio.** The synthesized harmonic-loop preview must never sound at the same time as Spotify playback (Policy III.7). Confirm this holds in every player state.
6. **Provider preview clips as analysis input.** `src/services/harmonicAnalysis.ts` carries a TODO to pass the provider's preview URL (`audio_preview_url`) to the analysis function. That must **not** be implemented for Spotify (Policy III.13) or for any provider that has not passed a §12 review.
7. **ML pipeline.** `harmonic-analysis` describes a future ML pipeline. Any such pipeline must exclude provider content that the provider's rules bar from ML/AI ingestion (Spotify Terms IV.2.1, Policy III.14).
8. **Unreviewed providers.** Apple Music, SoundCloud, Bandcamp, Deezer, and Amazon Music (§11.4).

## 14) What this document does and does not do

It describes what Clade's software is designed to do, and the constraints on it. It does **not**:
- claim that Clade holds any license, permission, partnership, or agreement with any provider, label, publisher, or collecting society that has not actually been obtained,
- create legal authorization for functionality a provider does not permit,
- imply endorsement by, or affiliation with, Spotify, YouTube, Apple, or any other provider,
- constitute legal advice. Global and Israel-specific counsel review is still required before launch.
