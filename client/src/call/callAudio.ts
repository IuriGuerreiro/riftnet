import type { AudioPreferences } from "./audioPreferences";

export interface Microphone {
  track: MediaStreamTrack;
  input: MediaStreamTrack;
  analyser: AnalyserNode | null;
  gain: GainNode | null;
  gate: GainNode | null;
  enhanced: boolean;
  close: () => void;
}

function stop(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function captureMicrophone(
  prefs: AudioPreferences,
  allowDefault = false,
  preview = false,
): Promise<Microphone> {
  const constraints: MediaTrackConstraints = {
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGainControl,
    noiseSuppression: prefs.suppression === "standard",
    channelCount: { ideal: 1 },
  };
  function open(deviceId: string) {
    return navigator.mediaDevices.getUserMedia({
      audio: { ...constraints, ...(deviceId && { deviceId: { exact: deviceId } }) },
    });
  }
  const raw = await open(prefs.inputId).catch((error: unknown) => {
    if (
      allowDefault &&
      prefs.inputId &&
      error instanceof DOMException &&
      ["NotFoundError", "OverconstrainedError"].includes(error.name)
    )
      return open("");
    throw error;
  });
  const input = raw.getAudioTracks()[0];
  if (!input) {
    stop(raw);
    throw new Error("No microphone found");
  }
  let context: AudioContext | undefined;
  try {
    context = new AudioContext(prefs.suppression === "enhanced" ? { sampleRate: 48000 } : {});
    if (context.state === "suspended") {
      const audioContext = context;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Audio is suspended")), 750);
        void audioContext
          .resume()
          .then(resolve, reject)
          .finally(() => window.clearTimeout(timer));
      });
    }
    const source = context.createMediaStreamSource(raw);
    const gain = context.createGain();
    gain.gain.value = prefs.inputVolume / 100;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const output = context.createMediaStreamDestination();
    output.channelCount = 1;
    let tail: AudioNode = source;
    let suppressor: { destroy: () => void } | undefined;
    if (prefs.suppression === "enhanced") {
      const node = await createSuppressor(context);
      suppressor = node;
      source.connect(node);
      tail = node;
    }
    const gate = context.createGain();
    gate.gain.value = Number(preview || prefs.inputMode !== "voice");
    tail.connect(gain).connect(analyser).connect(gate).connect(output);
    const audioContext = context;
    const track = output.stream.getAudioTracks()[0];
    if (!track) throw new Error("Could not create the microphone stream");
    return {
      input,
      track,
      analyser,
      gain,
      gate,
      enhanced: Boolean(suppressor),
      close: () => {
        stop(raw);
        stop(output.stream);
        suppressor?.destroy();
        void audioContext.close();
      },
    };
  } catch {
    if (context) void context.close().catch(() => {});
    if (prefs.suppression === "enhanced") {
      stop(raw);
      return captureMicrophone({ ...prefs, suppression: "standard" }, allowDefault, preview);
    }
    return {
      track: input,
      input,
      analyser: null,
      gain: null,
      gate: null,
      enhanced: false,
      close: () => stop(raw),
    };
  }
}

async function createSuppressor(context: AudioContext) {
  const [
    { RnnoiseWorkletNode, loadRnnoise },
    { default: worklet },
    { default: wasm },
    { default: simd },
  ] = await Promise.all([
    import("@sapphi-red/web-noise-suppressor"),
    import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"),
  ]);
  const [wasmBinary] = await Promise.all([
    loadRnnoise({ url: wasm, simdUrl: simd }),
    context.audioWorklet.addModule(worklet),
  ]);
  return new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
}

export interface OutputElement extends HTMLAudioElement {
  setSinkId(id: string): Promise<void>;
}

export function canSelectOutput(audio: HTMLAudioElement): audio is OutputElement {
  return "setSinkId" in audio && typeof audio.setSinkId === "function";
}

export async function routeOutput(audio: HTMLAudioElement, device: string) {
  if (!canSelectOutput(audio)) return;
  try {
    await audio.setSinkId(device);
  } catch (error) {
    await audio.setSinkId("");
    throw error;
  }
}

export class CallPlayback {
  private readonly audio = new Audio();
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private volume = 1;
  private outputId = "";

  constructor() {
    this.audio.autoplay = true;
  }

  attach(track: MediaStreamTrack) {
    this.close();
    const stream = new MediaStream([track]);
    this.audio.srcObject = stream;
    try {
      const context = new AudioContext();
      this.context = context;
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      const output = context.createMediaStreamDestination();
      source.connect(gain).connect(limiter).connect(output);
      void context
        .resume()
        .then(() => {
          if (this.context !== context || context.state !== "running") return;
          this.gain = gain;
          this.audio.srcObject = output.stream;
          this.applyVolume();
          void this.audio.play().catch(() => {});
        })
        .catch(() => {});
    } catch {
      this.closeGraph();
    }
    this.applyVolume();
    void this.audio.play().catch(() => {});
  }

  configure(volume: number, outputId: string) {
    this.volume = volume;
    this.applyVolume();
    if (this.outputId !== outputId) {
      this.outputId = outputId;
      void routeOutput(this.audio, outputId).catch(() => {});
    }
  }

  private applyVolume() {
    if (this.gain)
      this.gain.gain.setTargetAtTime(this.volume, this.gain.context.currentTime, 0.015);
    this.audio.volume = this.gain ? 1 : Math.min(1, this.volume);
  }

  private closeGraph() {
    if (this.context) void this.context.close().catch(() => {});
    this.context = this.gain = null;
  }

  close() {
    this.closeGraph();
    this.audio.srcObject = null;
  }
}
