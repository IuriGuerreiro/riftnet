import { useEffect } from "react";

import { Button } from "../../components/ui";
import { desktopUpdatesEnabled, useDesktopUpdates } from "./updates";

export function DesktopUpdateBanner() {
  if (!desktopUpdatesEnabled) return null;
  return <StartupUpdateCheck />;
}

function StartupUpdateCheck() {
  const checkForUpdate = useDesktopUpdates((state) => state.checkForUpdate);

  useEffect(() => {
    void checkForUpdate(true);
  }, [checkForUpdate]);

  return <UpdateDetails className="border-b border-surface-0 bg-surface-2 px-4 py-2" />;
}

function UpdateDetails({ className = "" }: { className?: string }) {
  const { status, checkForUpdate, dismiss, install, restart } = useDesktopUpdates();

  if (status.kind === "idle" || status.kind === "checking" || status.kind === "current") {
    return null;
  }

  return (
    <section
      aria-label="Desktop updates"
      className={`flex shrink-0 flex-wrap items-center gap-2 text-sm ${className}`}
    >
      {status.kind === "available" && (
        <>
          <p role="status" className="mr-auto">
            Version {status.update.version} is available. The app may restart during installation.
          </p>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Later
          </Button>
          <Button size="sm" onClick={() => void install()}>
            Update now
          </Button>
          {status.update.body && (
            <details className="basis-full">
              <summary className="cursor-pointer text-fg-muted">Release notes</summary>
              <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                {status.update.body}
              </p>
            </details>
          )}
        </>
      )}
      {status.kind === "installing" && (
        <p role="status">
          {status.percent === null
            ? "Downloading update…"
            : status.percent === 100
              ? "Verifying and installing update…"
              : `Downloading update… ${status.percent}%`}
        </p>
      )}
      {status.kind === "installed" && (
        <>
          <p role="status" className="mr-auto">
            {status.restartFailed
              ? "Close and reopen the app to finish updating."
              : "Update installed. Restart to use the new version."}
          </p>
          <Button size="sm" onClick={() => void restart()}>
            Restart app
          </Button>
        </>
      )}
      {status.kind === "failed" && (
        <>
          <p role="status" className="mr-auto">
            {status.message}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void checkForUpdate()}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </>
      )}
    </section>
  );
}

export function DesktopUpdateSettings() {
  const { status, checkForUpdate } = useDesktopUpdates();
  if (!desktopUpdatesEnabled) return null;
  if (status.kind !== "idle" && status.kind !== "checking" && status.kind !== "current") {
    return <UpdateDetails />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={status.kind === "checking"}
        onClick={() => void checkForUpdate()}
      >
        Check for updates
      </Button>
      <span role="status" className="text-xs text-fg-muted">
        {status.kind === "checking" && "Checking…"}
        {status.kind === "current" && "You’re up to date."}
      </span>
    </div>
  );
}
