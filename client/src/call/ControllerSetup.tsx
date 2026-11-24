import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { Button, ErrorText, Modal } from "../components/ui";
import { platform } from "../platform";
import { useCalls } from "../stores/calls";
import { padState } from "./padState";

const statusSchema = z.object({
  supported: z.boolean(),
  driver: z.boolean(),
  helper: z.boolean(),
});
const installSchema = z.enum(["ready", "declined", "restart_needed"]);
const reportSchema = z.object({
  slots: z.array(z.number()),
  median_ms: z.number(),
  worst_ms: z.number(),
});

async function run(cmd: string): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<unknown>(cmd);
}

export function ControllerSetup() {
  const [asking, setAsking] = useState(false);
  const inCall = useCalls((s) => s.current !== null || s.incoming !== null);
  const status = useQuery({
    queryKey: ["pad-status"],
    enabled: platform.kind === "desktop",
    queryFn: async () => statusSchema.parse(await run("pad_status")),
  });
  const install = useMutation({
    mutationFn: async () => installSchema.parse(await run("pad_install")),
    onSuccess: async (result) => {
      await status.refetch();
      if (result !== "restart_needed") setAsking(false);
    },
  });
  const test = useMutation({
    mutationFn: async () => reportSchema.parse(await run("pad_test")),
  });

  const state = padState(status.data);
  if (state === "unsupported") return null;
  const close = () => {
    if (!install.isPending) setAsking(false);
  };

  return (
    <section aria-label="Controller support" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "missing" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              install.reset();
              setAsking(true);
            }}
          >
            Set up controllers
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={test.isPending || inCall}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing…" : "Test controllers"}
          </Button>
        )}
        <span role="status" className="text-xs text-fg-muted">
          {state === "ready" && inCall && "Leave your call to test controllers."}
          {test.data &&
            `Works: slots ${test.data.slots.map((s) => s + 1).join(" and ")}, ${test.data.median_ms.toFixed(1)} ms typical, ${test.data.worst_ms.toFixed(1)} ms worst.`}
        </span>
      </div>
      <ErrorText error={status.error ?? test.error} />

      <Modal
        open={asking}
        title="Install controller support?"
        onClose={close}
        footer={
          install.data === "restart_needed" ? (
            <Button size="sm" onClick={close}>
              OK
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={install.isPending} onClick={close}>
                Don’t install
              </Button>
              <Button
                size="sm"
                disabled={install.isPending || inCall}
                onClick={() => install.mutate()}
              >
                {install.isPending ? "Installing…" : install.error ? "Try again" : "Install"}
              </Button>
            </>
          )
        }
      >
        {install.data === "restart_needed" ? (
          <p className="text-sm">Restart Windows to finish setting up controllers.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              To give friends virtual controllers, Adept needs <b>usbip-win2</b> (a driver) and{" "}
              <b>VIIPER</b> (which creates the controllers). Both are free and open source.
            </p>
            <p>
              Windows will ask for permission if the driver isn’t installed. USB devices may
              disconnect for a moment.
            </p>
            <p className="flex gap-3">
              <GitHubLink repo="vadimgrn/usbip-win2" />
              <GitHubLink repo="Alia5/VIIPER" />
            </p>
            {inCall && <p className="text-warning">Leave your call before installing.</p>}
            <ErrorText error={install.error} />
          </div>
        )}
      </Modal>
    </section>
  );
}

function GitHubLink({ repo }: { repo: string }) {
  return (
    <a
      className="underline"
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {repo} on GitHub
    </a>
  );
}
