/**
 * The phone and tablet route to live analysis: capture the room with the
 * device's own microphone and let the live-analysis service run the DSP.
 *
 * It returns exactly the shape `useLiveChordDetection` does, so everything
 * above it - useAnalyzeTrack, the auto-promotion rule, AnalyzeTrackPanel -
 * works unchanged and neither knows nor cares which route produced the
 * analysis. The two hooks are siblings, not layers: the local one runs the
 * DSP in the tab off shared tab audio, this one ships PCM to a server. See
 * useTrackAnalysisSource for which one a given device gets.
 *
 * Why a server at all: mobile browsers do not implement `getDisplayMedia`, so
 * there is no tab audio to analyse. The microphone is the only audio a phone
 * will give a web page, and the analysis has to happen somewhere.
 *
 * Playback is untouched. The track still plays through the provider's own
 * player; nothing here fetches, proxies or stores provider audio, and the
 * service refuses any source but `microphone`
 * (services/live-analysis/protocol.ts, `providerAnalysisCapability`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlayer } from '@/player/PlayerContext';
import { PlaybackClock } from '@/lib/harmony/playbackClock';
import { sectionProgressions as buildSectionProgressions, type ChordSpan } from '@/lib/harmony/chordTimeline';
import type { DetectedChord } from '@/lib/harmony/chordDetection';
import type { DetectedSection } from '@/lib/harmony/sectionDetection';
import type { KeyEstimate } from '@/lib/harmony/keyEstimation';
import type { TempoReading } from '@/lib/harmony/tempoDetection';
import { LiveAnalysisClient, liveAnalysisUrl, type AnalysisUpdate } from '@/lib/liveAnalysis/liveAnalysisClient';
import { micCaptureSupported, startMicCapture, type MicCaptureHandle } from '@/lib/liveAnalysis/micCapture';
import type { UseLiveChordDetectionResult, LiveDetectionStatus } from '@/hooks/useLiveChordDetection';

const TRACK_END_TOLERANCE_MS = 1_500;

/**
 * A client-side mirror of the service's own id rule, so a malformed track id
 * gets a sentence the listener can act on instead of an opaque `bad_request`
 * close. The service validates authoritatively either way, so the two drifting
 * apart costs a worse error message, never a wrong result.
 */
const TOKEN_CHARS = /^[A-Za-z0-9:_.-]+$/;

/** Turns the DOMException getUserMedia throws into something worth reading. */
function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it for this site and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is already in use by another app.';
  }
  return error instanceof Error ? `Could not start the microphone: ${error.message}` : 'Could not start the microphone.';
}

export function useRemoteChordDetection(): UseLiveChordDetectionResult {
  const [status, setStatus] = useState<LiveDetectionStatus>('idle');
  const [chord, setChord] = useState<DetectedChord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedSections, setDetectedSections] = useState<DetectedSection[]>([]);
  const [chordSpans, setChordSpans] = useState<ChordSpan[]>([]);
  const [detectedKey, setDetectedKey] = useState<KeyEstimate | null>(null);
  const [tempo, setTempo] = useState<TempoReading | null>(null);
  const [timingAligned, setTimingAligned] = useState(false);

  const clientRef = useRef<LiveAnalysisClient | null>(null);
  const micRef = useRef<MicCaptureHandle | null>(null);
  const clockRef = useRef(new PlaybackClock());

  const { positionMs, durationMs, isPlaying, provider, trackId, canonicalTrackId } = usePlayer();
  const { accessToken } = useAuth();

  const supported = micCaptureSupported() && liveAnalysisUrl() !== null;

  // Same reasoning as the local hook: the provider relays a position rarely
  // (and the guest Spotify embed never), so frames are stamped from the
  // interpolated clock rather than the raw report. `aligned` is what decides
  // whether the result may be stored at all.
  useEffect(() => {
    clockRef.current.report(positionMs, isPlaying, performance.now());
    const estimate = clockRef.current.positionSec(performance.now());
    clientRef.current?.updatePlayer(
      estimate === null ? 0 : estimate * 1000,
      isPlaying,
      clockRef.current.aligned
    );
  }, [positionMs, isPlaying]);

  const handleUpdate = useCallback((update: AnalysisUpdate) => {
    setChord(update.chord);
    setChordSpans(update.chordSpans);
    setDetectedSections(update.sections);
    setDetectedKey(update.key);
    setTempo(update.tempo);
    // The server's own verdict, not the client clock's: these are the times
    // the spans actually carry, so it is the server that knows whether they
    // are the song's clock or just time since the capture began.
    setTimingAligned(update.aligned);
  }, []);

  /** Releases the microphone and the socket. The analysis so far is kept. */
  const teardown = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    clientRef.current?.stop();
    clientRef.current = null;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setChord(null);
    setStatus('idle');
  }, [teardown]);

  const reset = useCallback(() => {
    setChord(null);
    setDetectedSections([]);
    setChordSpans([]);
    setDetectedKey(null);
    setTempo(null);
    setTimingAligned(false);
    clockRef.current.reset();
  }, []);

  const start = useCallback(async () => {
    const url = liveAnalysisUrl();
    if (!supported || !url) {
      setStatus('unsupported');
      setErrorMessage('Live analysis is not available on this device.');
      return;
    }
    if (!accessToken) {
      setStatus('error');
      setErrorMessage('Sign in again to analyze this track.');
      return;
    }
    const id = trackId ?? canonicalTrackId;
    if (!provider || !id || !TOKEN_CHARS.test(id)) {
      setStatus('error');
      setErrorMessage('Start a track before analyzing it.');
      return;
    }

    setStatus('requesting');
    setErrorMessage(null);
    reset();

    let mic: MicCaptureHandle;
    try {
      // The permission prompt happens here, so it is the first thing that can
      // fail and the only one that needs the user to do something.
      mic = await startMicCapture((samples) => clientRef.current?.sendFrame(samples));
    } catch (error) {
      setStatus('error');
      setErrorMessage(micErrorMessage(error));
      return;
    }
    micRef.current = mic;

    const client = new LiveAnalysisClient({
      url,
      token: accessToken,
      provider,
      trackId: id,
      sampleRate: Math.round(mic.sampleRate),
      onReady: () => setStatus('capturing'),
      onUpdate: handleUpdate,
      onError: (message, fatal) => {
        setErrorMessage(message);
        if (fatal) {
          teardown();
          setStatus('error');
        }
      },
      onStopped: (reason) => {
        teardown();
        setChord(null);
        if (reason === 'client') {
          setStatus('idle');
          return;
        }
        setStatus('error');
        setErrorMessage(
          reason === 'max_duration'
            ? 'Live analysis reached its time limit.'
            : reason === 'idle_timeout' || reason === 'paused_timeout'
              ? 'Live analysis stopped because the track was not playing.'
              : 'Live analysis stopped unexpectedly.'
        );
      },
    });
    clientRef.current = client;
    client.updatePlayer(positionMs, isPlaying, clockRef.current.aligned);
    client.connect();
  }, [
    supported,
    accessToken,
    provider,
    trackId,
    canonicalTrackId,
    handleUpdate,
    teardown,
    reset,
    positionMs,
    isPlaying,
  ]);

  // Derived here rather than sent over the wire: the service has no reason to
  // know how a section maps to a progression, and this is the same function
  // the local path uses, so both routes produce an identical payload shape.
  const sectionProgressions = useMemo(
    () => buildSectionProgressions(detectedSections, chordSpans),
    [detectedSections, chordSpans]
  );

  useEffect(() => teardown, [teardown]); // never leave the mic open on unmount

  return {
    status,
    supported,
    chord,
    errorMessage,
    detectedSections,
    chordSpans,
    sectionProgressions,
    detectedKey,
    tempo,
    timingAligned,
    atTrackEnd:
      Number.isFinite(durationMs) &&
      durationMs > 0 &&
      Number.isFinite(positionMs) &&
      positionMs >= durationMs - TRACK_END_TOLERANCE_MS,
    start,
    stop,
    reset,
  };
}
