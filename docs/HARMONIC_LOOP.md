# Harmonic Loop — hearing the progression

Clade stores harmony **relatively** (Roman numerals, never absolute chords).
That representation is what makes cross-track matching possible, but on its own
it only ever reached the user as symbols on a badge.

The Harmonic Loop turns it into sound: any track's progression can be played
back as real chords, in any key, at the track's own tempo. Two tracks that share
a `I–V–vi–IV` become something you can verify by ear rather than take on trust.

## Modules

| File | Role |
|------|------|
| `src/lib/harmony/theory.ts` | Roman numeral → pitch. Pure functions, no audio. |
| `src/lib/harmony/LoopEngine.ts` | Web Audio playback and scheduling. |
| `src/hooks/useHarmonicLoop.ts` | React binding; owns the engine instance. |
| `src/components/HarmonicLoop.tsx` | The dial, key selector and transport. |
| `src/lib/harmony/theory.test.ts` | Unit tests for the theory layer. |

`HarmonyCard` renders `HarmonicLoop` behind a disclosure, so it appears
everywhere that card already does: the feed, the compare page and the player
drawer.

## theory.ts

Parses a numeral into everything needed to sound it:

```ts
parseRomanChord('bVII7', 'major')
// { rootOffset: 10, quality: 'dominant7', intervals: [0,4,7,10], base: 'VII', ... }
```

Handles leading accidentals (`bIII`, `#iv`), case-derived quality (`vi` → minor),
and explicit modifiers (`maj7`, `7`, `sus2/4`, `°`, `ø`, `+`, `add9`). Mode
selects the scale the degrees are measured against, so `III` is 4 semitones in
major and 3 in minor.

`voiceChord` applies **whole-octave** voice leading: successive chords are
shifted by octaves only, keeping them in a nearby register without altering
chord identity. Shifting by anything else would change the chord.

The module is pure and side-effect free, which is why it carries the tests —
mis-parsing a numeral produces something that sounds wrong rather than something
that throws.

## LoopEngine.ts

Playback uses a **lookahead scheduler** rather than a `setInterval` that plays
notes directly:

```
every 25ms  →  schedule every chord falling within the next 150ms
               onto the Web Audio clock, at an exact `when`
```

Audio events are queued ahead of time against `AudioContext.currentTime`, so
timing is sample-accurate and unaffected by React renders or a busy main thread.
Driving oscillators straight from a timer callback would audibly drift.

Other details worth knowing:

- **Voices are synthesised** (detuned triangle/sine pads plus a bass root), so
  there are no samples to ship and the feature adds nothing to bundle weight.
- **`update()` applies key, tempo and volume live** — the loop keeps playing
  without a gap. Changing the progression or mode rebuilds the chord list.
- **The context starts suspended.** Browsers require a user gesture, so
  `start()` awaits `ctx.resume()`; playback can only begin from a real click.
- **`dispose()` closes the AudioContext.** The hook calls it on unmount, and
  stops playback when the tab is hidden — a phantom pad playing in a background
  tab is worse than silence.

## Adding it elsewhere

```tsx
<HarmonicLoop
  progression={track.progression_roman}   // ['I','V','vi','IV']
  detectedKey={track.detected_key}        // 'C'  — falls back to C
  detectedMode={track.detected_mode}      // 'major' | 'minor'
  bpm={track.tempo}                       // falls back to 96
/>
```

The component renders nothing when no numeral in `progression` parses, so it is
safe to mount against tracks with missing or provisional analysis.

## Testing

```bash
npx vitest run src/lib/harmony/theory.test.ts
```

The theory layer is unit tested (parsing, transposition, voicing, MIDI/frequency
conversion). The engine is not — it needs a real `AudioContext`, so it is
verified by ear.

One gotcha if you extend the tests: JavaScript's `%` yields `-0` for negative
multiples, so `expect(x % 12).toBe(0)` fails against `-0` under `Object.is`.
Wrap in `Math.abs`.
