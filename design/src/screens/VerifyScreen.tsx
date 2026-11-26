import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";

export function VerifyScreen() {
  const navigate = useNavigate();
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait === 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  return (
    <AuthShell title="Confirm your email" subtitle="Open the link we just sent you.">
      <div className="grid gap-3">
        <Button onClick={() => void navigate({ to: "/username" })}>I confirmed it (mock)</Button>
        <Button variant="ghost" disabled={wait > 0} onClick={() => setWait(30)}>
          {wait > 0 ? `Send again in ${wait}s` : "Send again"}
        </Button>
        <Button variant="link" onClick={() => void navigate({ to: "/register" })}>
          Use a different email
        </Button>
      </div>
    </AuthShell>
  );
}
