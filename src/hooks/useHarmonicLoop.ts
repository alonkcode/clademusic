/**
 * useHarmonicLoop
 *
 * React binding for HarmonicLoopEngine: owns the engine instance, keeps it in
 * sync with props, and exposes the currently sounding step for visualisation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HarmonicLoopEngine } from '@/lib/harmony/LoopEngine';
import { parsePitchClass, parseRomanChord, type ParsedChord } from '@/lib/harmony/theory';

export interface UseHarmonicLoopOptions {
  progression: string[];
  /** Key as written, e.g. "C", "F#". Falls back to C when unknown. */
  detectedKey?: string;
  mode?: 'major' | 'minor' | 'unknown';
  /** Track tempo; a sensible default is used when unavailable. */
  bpm?: number;
  beatsPerChord?: number;
}

const DEFAULT_BPM = 96;
const DEFAULT_VOLUME = 0.7;

export function useHarmonicLoop({
  progression,
  detectedKey,
  mode,
  bpm,
  beatsPerChord = 4,
}: UseHarmonicLoopOptions) {
  const detectedTonic = parsePitchClass(detectedKey) ?? 0;
  const resolvedMode: 'major' | 'minor' = mode === 'minor' ? 'minor' : 'major';

  const [tonic, setTonic] = useState(detectedTonic);
  const [tempo, setTempo] = useState(Math.round(bpm ?? DEFAULT_BPM));
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);

  // Re-sync when we navigate to a different track.
  useEffect(() => setTonic(detectedTonic), [detectedTonic]);
  useEffect(() => setTempo(Math.round(bpm ?? DEFAULT_BPM)), [bpm]);

  const chords: ParsedChord[] = useMemo(
    () =>
      progression
        .map((symbol) => parseRomanChord(symbol, resolvedMode))
        .filter((c): c is ParsedChord => c !== null),
    [progression, resolvedMode]
  );

  const engineRef = useRef<HarmonicLoopEngine | null>(null);

  useEffect(() => {
    const engine = new HarmonicLoopEngine({
      progression,
      tonicPitchClass: tonic,
      mode: resolvedMode,
      bpm: tempo,
      beatsPerChord,
      volume,
    });
    engineRef.current = engine;
    const unsubscribe = engine.onStep(setActiveStep);

    return () => {
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
      setIsPlaying(false);
      setActiveStep(-1);
    };
    // Rebuilding on progression/mode change is intentional: a new track is a
    // new loop. Tonic/tempo/volume are pushed in live below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progression, resolvedMode, beatsPerChord]);

  useEffect(() => {
    engineRef.current?.update({ tonicPitchClass: tonic, bpm: tempo, volume });
  }, [tonic, tempo, volume]);

  const toggle = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isRunning) {
      engine.stop();
      setIsPlaying(false);
    } else {
      await engine.start();
      setIsPlaying(engine.isRunning);
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setIsPlaying(false);
  }, []);

  // Stop the loop if the tab is hidden — nobody wants a phantom pad playing.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  return {
    chords,
    tonic,
    setTonic,
    tempo,
    setTempo,
    volume,
    setVolume,
    isPlaying,
    activeStep,
    toggle,
    stop,
    isPlayable: chords.length > 0,
    /** Semitones the user has transposed away from the detected key. */
    transposition: ((tonic - detectedTonic + 12) % 12),
  };
}
