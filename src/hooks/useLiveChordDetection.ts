import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChordSmoother,
  chromaFromMagnitudes,
  matchChordTemplate,
  type DetectedChord,
} from '@/lib/harmony/chordDetection';

export type LiveDetectionStatus = 'idle' | 'requesting' | 'capturing' | 'unsupported' | 'error';

export interface UseLiveChordDetectionResult {
  status: LiveDetectionStatus;
  /** null on 'unsupported'/'error', or set once feature-detection has run. */
  supported: boolean | null;
  chord: DetectedChord | null;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

const FFT_SIZE = 8192; // higher resolution than the default 2048, for cleaner low-note bins
const TICK_MS = 120;

/**
 * Detects the chord in whatever audio the browser lets the user share -
 * typically the tab playing a YouTube/Spotify embed - using real captured
 * sound, not any pre-analyzed track data.
 *
 * Hard platform limits, not a bug to fix:
 *   - Requires `getDisplayMedia` with an audio track. Desktop Chrome/Edge
 *     support tab-audio sharing; Safari does not expose it at all; mobile
 *     browsers do not implement getDisplayMedia. `supported` reflects this.
 *   - Even where supported, the OS/browser picker requires the user to
 *     explicitly check "share tab audio" - if they don't, the resulting
 *     stream has a video track but zero audio tracks, which surfaces as a
 *     specific error rather than silently doing nothing.
 *   - Capturing your own tab means the synthesised preview loop
 *     (useHarmonicLoop) must not play at the same time, or it becomes part of
 *     what gets "detected".
 */
export function useLiveChordDetection(): UseLiveChordDetectionResult {
  const [status, setStatus] = useState<LiveDetectionStatus>('idle');
  const [chord, setChord] = useState<DetectedChord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const smootherRef = useRef(new ChordSmoother());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    smootherRef.current.reset();
    setChord(null);
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      setStatus('unsupported');
      setErrorMessage('This browser cannot share tab audio. Try desktop Chrome or Edge.');
      return;
    }

    setStatus('requesting');
    setErrorMessage(null);

    try {
      // Most browsers only allow capturing tab AUDIO as part of a screen/tab
      // share that also includes video - requesting audio alone is rejected.
      // The video track is discarded immediately below; nothing is recorded
      // or displayed from it.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = stream.getAudioTracks();
      stream.getVideoTracks().forEach((t) => t.stop());

      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('error');
        setErrorMessage('No audio was shared - check "share tab audio" in the picker and try again.');
        return;
      }

      streamRef.current = stream;

      const AudioCtor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtor();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.4; // built-in temporal smoothing on top of ChordSmoother
      source.connect(analyser);
      analyserRef.current = analyser;

      const magnitudes = new Float32Array(analyser.frequencyBinCount);
      // Linear magnitudes: dB output would need a costly conversion per bin
      // per tick for no benefit here, since only relative energy matters.
      const linear = new Float32Array(analyser.frequencyBinCount);

      intervalRef.current = setInterval(() => {
        analyser.getFloatFrequencyData(magnitudes);
        for (let i = 0; i < magnitudes.length; i++) {
          // getFloatFrequencyData returns dBFS; convert back to linear.
          linear[i] = Math.pow(10, magnitudes[i] / 20);
        }
        const chroma = chromaFromMagnitudes(linear, ctx.sampleRate, FFT_SIZE);
        const raw = matchChordTemplate(chroma);
        const smoothed = smootherRef.current.push(raw);
        setChord(smoothed);
      }, TICK_MS);

      setStatus('capturing');

      // The browser's own "stop sharing" control ends the stream track directly.
      audioTracks[0].addEventListener('ended', stop);
    } catch (err) {
      // Includes the user dismissing the picker (NotAllowedError) - not a bug,
      // just declining to share, so no need to alarm about it.
      const message = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setErrorMessage(
        message.includes('Permission') || message.includes('cancel')
          ? 'Sharing was cancelled.'
          : `Could not start audio capture: ${message}`
      );
    }
  }, [supported, stop]);

  useEffect(() => stop, [stop]); // release the stream/context on unmount

  return { status, supported, chord, errorMessage, start, stop };
}
