import { useId, useState } from "react";

import { Button, ErrorText, Input, Modal } from "../../components/ui";
import { useActivity } from "../../stores/activity";
import { useConnection } from "../../stores/connection";

export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const ws = useConnection((s) => s.ws);
  const { published, publish } = useActivity();
  const shared = published?.ws === ws ? published.label : "";
  const [label, setLabel] = useState(shared);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  async function save(next: string) {
    if (!ws || busy) return;
    setBusy(true);
    setError(null);
    try {
      await publish(ws, next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update your activity");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Set activity"
      onClose={onClose}
      footer={
        <>
          {shared && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              disabled={!ws || busy}
              onClick={() => void save("")}
            >
              Stop sharing
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!ws || busy || !label.trim()}>
            {shared ? "Update" : "Share"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) void save(label.trim());
        }}
      >
        <Input
          autoFocus
          label="What are you playing?"
          value={label}
          maxLength={100}
          placeholder="e.g. Minecraft"
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
          hint="Only your friends can see this. It changes to Streaming while you share your screen."
        />
        <ErrorText error={error} />
      </form>
    </Modal>
  );
}
