import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/form/Field";
import { PasswordInput } from "@/components/form/PasswordInput";
import { PasswordStrength } from "@/components/form/PasswordStrength";
import { SubmitButton } from "@/components/form/SubmitButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const COPY = {
  ask: ["Reset your password", "We'll email you a link."],
  sent: ["Check your email", "Open the link we sent to choose a new password."],
  reset: ["Choose a new password", "Use 8 or more characters."],
  expired: ["This link expired", "Ask for a new one to continue."],
  done: ["Password changed", "You can log in with it now."],
} as const;

export function ForgotScreen() {
  const [step, setStep] = useState<keyof typeof COPY>("ask");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, subtitle] = COPY[step];
  return (
    <AuthShell
      title={title}
      subtitle={subtitle}
      footer={
        <Link to="/login" className="font-medium text-brand-text hover:underline">
          Back to login
        </Link>
      }
    >
      {step === "ask" && (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("sent");
          }}
        >
          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </Field>
          <SubmitButton pending={false}>Send link</SubmitButton>
        </form>
      )}
      {step === "sent" && (
        <div className="grid gap-3">
          <Button onClick={() => setStep("reset")}>Open the link (mock)</Button>
          <Button variant="ghost" onClick={() => setStep("expired")}>
            Open an expired link (mock)
          </Button>
        </div>
      )}
      {step === "expired" && <Button onClick={() => setStep("ask")}>Send a new link</Button>}
      {step === "reset" && (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length >= 8) setStep("done");
          }}
        >
          <Field id="password" label="New password">
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrength password={password} />
          </Field>
          <SubmitButton pending={false} disabled={password.length < 8}>
            Save password
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
