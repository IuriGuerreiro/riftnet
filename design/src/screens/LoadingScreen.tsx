import { useNavigate } from "@tanstack/react-router";
import { RotateCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { AdeptMorph } from "@/components/brand/AdeptMorph";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";

import type { LoadingSearch } from "./loadingSearch";

const STEPS = ["Starting up", "Checking your session"] as const;
const PROGRESS = [20, 65, 100];
const STEP_MS = 800;

export function LoadingScreen({ state }: LoadingSearch) {
  return (
    <div className="relative isolate flex min-h-full flex-col items-center justify-center bg-ink px-6">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_44%,color-mix(in_srgb,var(--adept-violet)_16%,transparent),transparent_55%)]"
      />
      {state === "error" ? <Offline /> : <Booting hold={state === "hold"} />}
      <p className="absolute bottom-6 text-[11px] text-muted-foreground/80">
        v0.1.0 · design build
      </p>
    </div>
  );
}

function Booting({ hold }: { hold: boolean }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (hold ? (s + 1) % STEPS.length : Math.min(s + 1, STEPS.length)));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [hold]);

  useEffect(() => {
    if (hold || step < STEPS.length) return;
    const id = setTimeout(() => void navigate({ to: "/login", replace: true }), 300);
    return () => clearTimeout(id);
  }, [hold, step, navigate]);

  const progress = PROGRESS[step] ?? 100;

  return (
    <div className="flex flex-col items-center" role="status" aria-live="polite">
      <AdeptMorph size={168} />
      <Wordmark className="mt-8 text-xl" />
      <div className="mt-10 h-0.5 w-44 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p
        key={step}
        className="animate-in fade-in slide-in-from-bottom-1 mt-4 h-5 text-sm text-muted-foreground duration-300"
      >
        {STEPS[Math.min(step, STEPS.length - 1)]}…
      </p>
    </div>
  );
}

function Offline() {
  const navigate = useNavigate();
  return (
    <div className="animate-in fade-in flex max-w-sm flex-col items-center text-center duration-500">
      <div className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-surface-1">
        <WifiOff className="size-7 text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-xl font-semibold">Can't reach Adept</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check your connection, then try again.</p>
      <Button
        className="mt-6"
        variant="secondary"
        onClick={() => void navigate({ to: "/loading", search: {} })}
      >
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}
