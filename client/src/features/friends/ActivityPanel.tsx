import { useState } from "react";

import { fieldClass } from "../../components/ui";
import { useActivity } from "../../stores/activity";
import { useConnection } from "../../stores/connection";

export function ActivityPanel() {
  const ws = useConnection((s) => s.ws);
  const [label, setLabel] = useState("");
  const { published, publish: publishActivity } = useActivity();
  const shared = published?.ws === ws ? published.label : "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function publish(next: string) {
    if (!ws || busy) return;
    setBusy(true);
    setError("");
    try {
      await publishActivity(ws, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update activity");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2 border-b border-zinc-800 p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void publish(label.trim());
      }}
    >
      <label className="block" htmlFor="activity-label">
        Game or stream label
      </label>
      <input
        id="activity-label"
        className={fieldClass}
        value={label}
        maxLength={100}
        placeholder="e.g. Minecraft"
        onChange={(e) => setLabel(e.target.value)}
      />
      <p className="text-zinc-400">
        Manual selection. Only accepted friends see this label. Sharing your screen changes Playing
        to Streaming.
      </p>
      <div className="flex gap-3">
        <button className="text-brand disabled:opacity-50" disabled={!ws || busy || !label.trim()}>
          {shared ? "Update activity" : "Share activity"}
        </button>
        {shared && (
          <button
            type="button"
            className="text-zinc-400"
            disabled={!ws || busy}
            onClick={() => void publish("")}
          >
            Stop sharing activity
          </button>
        )}
      </div>
      {shared && <p role="status">Sharing: {shared}</p>}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
