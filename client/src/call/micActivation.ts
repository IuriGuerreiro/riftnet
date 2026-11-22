import type { AudioPreferences } from "./audioPreferences";
import type { Microphone } from "./callAudio";

export function startVoiceActivation(mic: Microphone, prefs: () => AudioPreferences) {
  const { analyser, gate } = mic;
  if (!analyser || !gate) return () => {};
  const samples = new Float32Array(analyser.fftSize);
  let lastVoice = -Infinity;
  let floor = 0.005;
  let wasOpen = false;
  const timer = window.setInterval(() => {
    const { inputMode, automaticSensitivity, sensitivity } = prefs();
    let open = true;
    if (inputMode === "voice") {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      const now = performance.now();
      floor += (Math.min(rms, 0.03) - floor) * (rms < floor ? 0.1 : 0.002);
      const threshold = automaticSensitivity
        ? Math.max(0.008, floor * 3)
        : 10 ** ((-65 + (100 - sensitivity) * 0.5) / 20);
      if (rms >= threshold) lastVoice = now;
      open = now - lastVoice < 220;
    }
    if (open === wasOpen) return;
    wasOpen = open;
    gate.gain.setTargetAtTime(Number(open), gate.context.currentTime, 0.008);
  }, 25);
  return () => window.clearInterval(timer);
}
