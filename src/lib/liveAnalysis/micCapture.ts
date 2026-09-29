/**
 * Microphone capture for the phone/tablet analysis route.
 *
 * Produces the exact frames the live-analysis service expects: 16-bit mono
 * PCM at ANALYSIS_SAMPLE_RATE. The graph is resampled by the AudioContext
 * rather than by hand - asking for a 22.05 kHz context and letting the source
 * node convert the microphone's native 48 kHz is both cheaper and harder to
 * get subtly wrong than writing an interpolator.
 *
 * The constraints below are the whole reason this file is not three lines.
 * `echoCancellation`, `noiseSuppression` and `autoGainControl` all default to
 * ON, and all three are tuned for a voice call: they gate quiet passages,
 * duck whatever they decide is echo, and continuously rescale the input.
 * Against music that destroys exactly the things the detectors measure, and
 * it does it quietly - the audio still sounds like the song, the chroma just
 * stops matching the templates. Leaving them on would look like a broken DSP.
 */

import { ANALYSIS_SAMPLE_RATE } from '../../../services/live-analysis/protocol';

/** ~93ms at 22.05 kHz: well inside the one-second frame ceiling, and few enough
 *  messages per second that the main thread does nothing noticeable. */
export const FRAME_SAMPLES = 2048;

/**
 * Runs inside the AudioWorklet. Kept as a source string and loaded from a blob
 * rather than a separate module so it needs no bundler-specific worklet
 * handling; the app ships no other worker and sets no CSP that would block it.
 *
 * It converts to Int16 here, not on the main thread, so each message carries
 * half the bytes and transfers rather than copies.
 */
const WORKLET_SOURCE = `
class MicFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSamples = options.processorOptions.frameSamples;
    this.buffer = new Int16Array(this.frameSamples);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.filled === this.frameSamples) {
        const frame = this.buffer.slice();
        this.port.postMessage(frame, [frame.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic-frame', MicFrameProcessor);
`;

export interface MicCaptureHandle {
  /** What the context actually gave us - the service accepts 8k-48k, so an
   *  engine that refused 22.05 kHz still works, it just sends more bytes. */
  sampleRate: number;
  stop: () => void;
}

export const micCaptureSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof window !== 'undefined' &&
  typeof window.AudioContext === 'function' &&
  typeof window.AudioWorkletNode === 'function';

/**
 * Opens the microphone and calls `onFrame` with each completed frame.
 *
 * Throws if permission is denied or the device has no microphone; the caller
 * turns that into a message, since "you said no" and "there is no mic" want
 * different copy.
 */
export async function startMicCapture(onFrame: (samples: Int16Array) => void): Promise<MicCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  let ctx: AudioContext | null = null;
  let workletUrl: string | null = null;
  try {
    ctx = new AudioContext({ sampleRate: ANALYSIS_SAMPLE_RATE });
    // Started from a click, but a context can still come up suspended.
    if (ctx.state === 'suspended') await ctx.resume();

    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'mic-frame', {
      numberOfOutputs: 1,
      processorOptions: { frameSamples: FRAME_SAMPLES },
    });
    node.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);

    // Silent sink. Some engines only pull a graph that reaches the
    // destination, and any gain above zero would put the microphone into the
    // speakers while the song is playing through them - a feedback loop, and
    // the analysis would be listening to itself.
    const silence = ctx.createGain();
    silence.gain.value = 0;
    source.connect(node);
    node.connect(silence);
    silence.connect(ctx.destination);

    const sampleRate = ctx.sampleRate;
    const capturedCtx = ctx;
    const capturedUrl = workletUrl;
    return {
      sampleRate,
      stop: () => {
        node.port.onmessage = null;
        node.disconnect();
        source.disconnect();
        silence.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void capturedCtx.close();
        URL.revokeObjectURL(capturedUrl);
      },
    };
  } catch (error) {
    // Never leave the microphone light on because setup failed halfway.
    stream.getTracks().forEach((track) => track.stop());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    void ctx?.close();
    throw error;
  }
}
