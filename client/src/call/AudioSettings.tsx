import { useEffect, useRef, useState } from "react";

import { Button, ErrorText, Modal } from "../components/ui";
import { activeAudioDevices, peerConnection, useCalls } from "../stores/calls";
import {
  audioDefaults,
  type AudioPreferences,
  pushKeys,
  useAudioSettings,
} from "./audioPreferences";
import { canSelectOutput, captureMicrophone, routeOutput } from "./callAudio";

const selectClass = "w-full rounded-control bg-surface-1 px-3 py-2 text-sm text-fg";

export function VolumeControl({
  label,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between gap-2">
        {label}
        <span className="font-mono tabular-nums text-fg-subtle">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        className="mt-1 w-full accent-current"
      />
    </label>
  );
}

export function AudioSettings({ onClose }: { onClose: () => void }) {
  const {
    inputId,
    outputId,
    inputVolume,
    voiceVolume,
    suppression,
    echoCancellation,
    autoGainControl,
    inputMode,
    automaticSensitivity,
    sensitivity,
    pushKey,
    releaseDelay,
    update,
  } = useAudioSettings();
  const shareAudio = useAudioSettings((state) => state.shareAudio);
  const joined = useCalls((state) => state.joined);
  const shortcutStatus = useCalls((state) => state.shortcutStatus);
  const activeError = useCalls((state) => (state.current ? state.audioError : null));
  const activeStatus = useCalls((state) => (state.current ? state.audioStatus : null));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [test, setTest] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const monitorRef = useRef<HTMLAudioElement>(null);
  const conRef = useRef<AudioContext | null>(null);
  const sinkSupported = canSelectOutput(HTMLAudioElement.prototype);

  async function refreshDevices() {
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }

  useEffect(() => {
    const refresh = () => void refreshDevices().catch(() => {});
    refresh();
    if (!window.isSecureContext) return;
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  useEffect(() => {
    const monitor = monitorRef.current;
    if (!test || !monitor) return;
    let dispose = () => {};
    let cancelled = false;
    let frame = 0;
    const prefs = {
      ...useAudioSettings.getState(),
      inputId,
      suppression,
      echoCancellation,
      autoGainControl,
    };
    void captureMicrophone(prefs, false, true)
      .then(async (mic) => {
        if (cancelled) {
          mic.close();
          return;
        }
        dispose = mic.close;
        gainRef.current = mic.gain;
        if (mic.gain) mic.gain.gain.value = useAudioSettings.getState().inputVolume / 100;
        if (suppression === "enhanced" && !mic.enhanced)
          setStatus("Enhanced suppression is unavailable. Using Standard.");
        monitor.srcObject = new MediaStream([mic.track]);
        await monitor.play();
        await refreshDevices();
        const analyser = mic.analyser;
        if (!analyser) return;
        const samples = new Float32Array(analyser.fftSize);
        function sample(node: AnalyserNode) {
          if (cancelled) return;
          node.getFloatTimeDomainData(samples);
          setLevel(
            Math.min(
              1,
              samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
            ),
          );
          frame = requestAnimationFrame(() => sample(node));
        }
        sample(analyser);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : "Could not test microphone");
        setTest(false);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      gainRef.current = null;
      monitor.srcObject = null;
      dispose();
    };
  }, [test, inputId, suppression, echoCancellation, autoGainControl]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = inputVolume / 100;
  }, [inputVolume]);

  useEffect(() => {
    if (monitorRef.current)
      void routeOutput(monitorRef.current, outputId).catch(() =>
        setError("Using the system output."),
      );
  }, [outputId]);

  useEffect(
    () => () => {
      void conRef.current?.close();
    },
    [],
  );

  async function testSpeaker() {
    setError(null);
    await conRef.current?.close().catch(() => {});
    const context = new AudioContext();
    conRef.current = context;
    try {
      void context.resume().catch(() => {});
      const audio = new Audio();
      const output = context.createMediaStreamDestination();
      audio.srcObject = output.stream;
      await routeOutput(audio, outputId).catch(() => setError("Using the system output."));
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime((0.12 * voiceVolume) / 100, now + 0.03);
      gain.gain.linearRampToValueAtTime(0, now + 0.45);
      oscillator.frequency.value = 523.25;
      oscillator.connect(gain).connect(output);
      await audio.play();
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
      oscillator.onended = () => {
        audio.srcObject = null;
        void context.close();
        if (conRef.current === context) conRef.current = null;
      };
    } catch {
      if (context.state !== "closed") void context.close();
      if (conRef.current === context) conRef.current = null;
      setError("Could not play the test sound.");
    }
  }

  function options(kind: MediaDeviceKind, selected: string) {
    const available = devices.filter(
      (device) => device.kind === kind && device.deviceId && device.deviceId !== "default",
    );
    return (
      <>
        <option value="">System default</option>
        {selected && !available.some((device) => device.deviceId === selected) && (
          <option value={selected}>Saved device unavailable</option>
        )}
        {available.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Device ${index + 1}`}
          </option>
        ))}
      </>
    );
  }

  return (
    <Modal open title="Voice & Audio" onClose={onClose}>
      <section className="space-y-3">
        <h3 className="font-semibold">Microphone</h3>
        <label className="block space-y-1 text-sm">
          <span>Input device</span>
          <select
            className={selectClass}
            value={inputId}
            onChange={(event) => update({ inputId: event.currentTarget.value })}
          >
            {options("audioinput", inputId)}
          </select>
        </label>
        <VolumeControl
          label="Input volume"
          value={inputVolume}
          max={200}
          onChange={(value) => update({ inputVolume: value })}
        />
        <label className="block space-y-1 text-sm">
          <span>Noise suppression</span>
          <select
            className={selectClass}
            value={suppression}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "off" || value === "standard" || value === "enhanced") {
                setStatus(null);
                update({ suppression: value });
              }
            }}
          >
            <option value="off">Off</option>
            <option value="standard">Standard</option>
            <option value="enhanced">Enhanced · RNNoise</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              setStatus(null);
              setLevel(0);
              setTest(!test);
            }}
          >
            {test ? "Stop mic test" : "Test microphone"}
          </Button>
          <meter
            className="min-w-0 flex-1"
            aria-label="Microphone level"
            min={0}
            max={1}
            value={test ? level : 0}
          />
        </div>
        {test && (
          <p className="text-xs text-fg-subtle">Use headphones to listen for background noise.</p>
        )}
        <audio ref={monitorRef} />
      </section>
      <section className="space-y-3 border-t border-surface-3 pt-4">
        <h3 className="font-semibold">Speakers</h3>
        <label className="block space-y-1 text-sm">
          <span>Output device</span>
          <select
            className={selectClass}
            disabled={!sinkSupported}
            value={sinkSupported ? outputId : ""}
            onChange={(event) => update({ outputId: event.currentTarget.value })}
          >
            {options("audiooutput", outputId)}
          </select>
        </label>
        {!sinkSupported && (
          <p className="text-xs text-fg-subtle">This client uses the system output.</p>
        )}
        <VolumeControl
          label="Call volume"
          value={voiceVolume}
          onChange={(value) => update({ voiceVolume: value })}
        />
        <Button variant="secondary" size="sm" onClick={() => void testSpeaker()}>
          Play test sound
        </Button>
      </section>
      <section className="space-y-3 border-t border-surface-3 pt-4">
        <h3 className="font-semibold">Input mode</h3>
        <label className="block space-y-1 text-sm">
          <span>When to transmit</span>
          <select
            className={selectClass}
            value={inputMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "open" || value === "voice" || value === "push")
                update({ inputMode: value });
            }}
          >
            <option value="open">Open mic</option>
            <option value="voice">Voice activation</option>
            <option value="push">Push to talk</option>
          </select>
        </label>
        {inputMode === "voice" && (
          <>
            <Toggle
              label="Automatic sensitivity"
              checked={automaticSensitivity}
              onChange={(value) => update({ automaticSensitivity: value })}
            />
            {!automaticSensitivity && (
              <VolumeControl
                label="Sensitivity"
                value={sensitivity}
                onChange={(value) => update({ sensitivity: value })}
              />
            )}
          </>
        )}
        {inputMode === "push" && (
          <>
            <label className="block space-y-1 text-sm">
              <span>Push-to-talk key</span>
              <select
                className={selectClass}
                value={pushKey}
                onChange={(event) => {
                  const key = pushKeys.find((value) => value === event.currentTarget.value);
                  if (key) update({ pushKey: key });
                }}
              >
                {pushKeys.map((key) => (
                  <option key={key}>{key}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="flex justify-between">
                Release delay <span>{releaseDelay} ms</span>
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                step={25}
                value={releaseDelay}
                onChange={(event) => update({ releaseDelay: event.currentTarget.valueAsNumber })}
                className="mt-1 w-full accent-current"
              />
            </label>
            {shortcutStatus && (
              <p role="status" className="text-xs text-fg-subtle">
                {shortcutStatus}
              </p>
            )}
          </>
        )}
      </section>
      <section className="space-y-3 border-t border-surface-3 pt-4">
        <h3 className="font-semibold">Screen sharing</h3>
        <Toggle
          label="Include screen audio when available"
          checked={shareAudio}
          onChange={(value) => update({ shareAudio: value })}
        />
      </section>
      <details className="space-y-3 border-t border-surface-3 pt-4">
        <summary className="cursor-pointer font-semibold">Advanced microphone</summary>
        <div className="flex flex-wrap gap-2" aria-label="Microphone presets">
          {Object.entries(presets).map(([label, prefs]) => (
            <Button
              key={label}
              size="sm"
              variant="secondary"
              onClick={() => {
                setStatus(null);
                update(prefs);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Toggle
          label="Echo cancellation"
          checked={echoCancellation}
          onChange={(value) => update({ echoCancellation: value })}
        />
        <Toggle
          label="Automatic microphone gain"
          checked={autoGainControl}
          onChange={(value) => update({ autoGainControl: value })}
        />
        {test && level >= 0.98 && (
          <p role="status" className="text-sm text-warning">
            Your mic is clipping. Lower the input volume.
          </p>
        )}
      </details>
      {joined && (
        <AudioDiagnostics output={devices.find((device) => device.deviceId === outputId)?.label} />
      )}
      {(status ?? activeStatus) && (
        <p role="status" className="text-sm text-fg-subtle">
          {status ?? activeStatus}
        </p>
      )}
      <ErrorText error={error ?? activeError} />
      <Button size="sm" variant="ghost" onClick={() => update(audioDefaults)}>
        Reset audio defaults
      </Button>
    </Modal>
  );
}

const presets: Record<string, Partial<AudioPreferences>> = {
  Headset: {
    echoCancellation: false,
    autoGainControl: true,
    suppression: "standard",
    inputMode: "open",
    inputVolume: 100,
  },
  Speakers: {
    echoCancellation: true,
    autoGainControl: true,
    suppression: "standard",
    inputMode: "open",
    inputVolume: 100,
  },
  Music: {
    echoCancellation: false,
    autoGainControl: false,
    suppression: "off",
    inputMode: "open",
    inputVolume: 100,
  },
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-current"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function AudioDiagnostics({ output }: { output?: string }) {
  const [readout, setReadout] = useState<{
    rtt?: number;
    jitter?: number;
    lost?: number;
    sending: boolean;
  } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let lastSent: number | undefined;
    async function sample() {
      const stats = await peerConnection()?.getStats();
      if (!stats || !alive) return;
      const snapshot: NonNullable<typeof readout> = { sending: false };
      let sent = 0;
      stats.forEach(
        (report: {
          type: string;
          nominated?: boolean;
          currentRoundTripTime?: number;
          kind?: string;
          jitter?: number;
          packetsLost?: number;
          packetsSent?: number;
        }) => {
          if (
            report.type === "candidate-pair" &&
            report.nominated &&
            report.currentRoundTripTime !== undefined
          )
            snapshot.rtt = Math.round(report.currentRoundTripTime * 1000);
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            if (report.jitter !== undefined)
              snapshot.jitter = Math.max(snapshot.jitter ?? 0, Math.round(report.jitter * 1000));
            if (report.packetsLost !== undefined)
              snapshot.lost = (snapshot.lost ?? 0) + report.packetsLost;
          }
          if (
            report.type === "outbound-rtp" &&
            report.kind === "audio" &&
            report.packetsSent !== undefined
          ) {
            sent += report.packetsSent;
          }
        },
      );
      snapshot.sending = lastSent !== undefined && sent > lastSent;
      lastSent = sent;
      setReadout(snapshot);
    }
    const update = () => void sample().catch(() => {});
    update();
    const timer = window.setInterval(update, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open]);
  const { input } = activeAudioDevices();
  return (
    <details
      className="space-y-3 border-t border-surface-3 pt-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">Call diagnostics</summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>Microphone</dt>
        <dd>{input ?? "Unavailable"}</dd>
        <dt>Output selection</dt>
        <dd>{output ?? "System default"}</dd>
        <dt>Outgoing audio</dt>
        <dd>{readout?.sending ? "Packets sending" : "Waiting for packets"}</dd>
        <dt>Round-trip time</dt>
        <dd>{readout?.rtt === undefined ? "—" : `${readout.rtt} ms`}</dd>
        <dt>Jitter</dt>
        <dd>{readout?.jitter === undefined ? "—" : `${readout.jitter} ms`}</dd>
        <dt>Packets lost</dt>
        <dd>{readout?.lost ?? "—"}</dd>
      </dl>
    </details>
  );
}
