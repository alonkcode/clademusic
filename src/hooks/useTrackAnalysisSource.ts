/**
 * Picks how this device captures audio for live analysis.
 *
 * Two routes exist and they are mutually exclusive per device:
 *   - tab audio (`useLiveChordDetection`), where the DSP runs in the tab off a
 *     `getDisplayMedia` share. Desktop Chrome/Edge only.
 *   - the microphone (`useRemoteChordDetection`), where PCM goes to the
 *     live-analysis service. This is what phones and tablets get, since mobile
 *     browsers do not implement `getDisplayMedia` at all.
 *
 * Tab audio wins wherever it is available: it is a clean digital signal rather
 * than a room recording, it costs no server capacity, and it asks for no
 * microphone. The microphone route is the fallback, not the default.
 *
 * Both hooks are called on every render because hooks cannot be called
 * conditionally. That is harmless - neither opens a device, a socket or a
 * permission prompt until its `start()` is called, and only the returned one
 * ever gets that call.
 */

import { useLiveChordDetection, type UseLiveChordDetectionResult } from '@/hooks/useLiveChordDetection';
import { useRemoteChordDetection } from '@/hooks/useRemoteChordDetection';

export type AnalysisRoute = 'tab-audio' | 'microphone' | 'none';

export interface TrackAnalysisSource extends UseLiveChordDetectionResult {
  /** Which capture this device actually got, for copy that has to differ. */
  route: AnalysisRoute;
}

export function useTrackAnalysisSource(): TrackAnalysisSource {
  const local = useLiveChordDetection();
  const remote = useRemoteChordDetection();

  if (local.supported) return { ...local, route: 'tab-audio' };
  if (remote.supported) return { ...remote, route: 'microphone' };
  // Neither: Safari, or a phone with no service configured. `supported` stays
  // false and the panel says so rather than offering a button that cannot work.
  return { ...remote, route: 'none' };
}
