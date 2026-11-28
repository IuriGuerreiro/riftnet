import { Pick } from "@/components/Controls";
import { saveSettings, world } from "@/mock/world";

export function DevicePicks() {
  const s = world.settings;
  return (
    <>
      <Pick
        label="Microphone"
        value={s.input}
        options={["Default microphone", "USB headset", "Webcam mic"]}
        onChange={(input) => saveSettings({ input })}
      />
      <Pick
        label="Speakers"
        value={s.output}
        options={["Default speakers", "USB headset", "Monitor"]}
        onChange={(output) => saveSettings({ output })}
      />
      <Pick
        label="Camera"
        value={s.camera}
        options={["Built-in camera", "USB webcam"]}
        onChange={(camera) => saveSettings({ camera })}
      />
    </>
  );
}
