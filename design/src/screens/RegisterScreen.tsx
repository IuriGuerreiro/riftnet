import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { AuthShell } from "@/components/auth/AuthShell";
import { LegalLink } from "@/components/auth/LegalLink";
import { Field } from "@/components/form/Field";
import { PasswordInput } from "@/components/form/PasswordInput";
import { PasswordStrength } from "@/components/form/PasswordStrength";
import { SubmitButton } from "@/components/form/SubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockRegister } from "@/mock/auth";
import { type RegisterForm, registerSchema } from "@/schemas/auth";

export function RegisterScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", confirm: "", terms: false },
  });
  const { errors, isSubmitting } = form.formState;
  const password = useWatch({ control: form.control, name: "password" });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await mockRegister(email);
      await navigate({ to: "/verify" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  });

  return (
    <AuthShell
      title="Create your account"
      subtitle="It takes less than a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-text hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        {error && (
          <Alert
            variant="destructive"
            className="animate-in fade-in border-destructive/30 bg-destructive/10"
          >
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="h-11"
            {...form.register("email")}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          <PasswordStrength password={password} />
        </Field>
        <Field id="confirm" label="Confirm password" error={errors.confirm?.message}>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
            {...form.register("confirm")}
          />
        </Field>
        <div className="grid gap-2">
          <div className="flex items-start gap-3">
            <Controller
              control={form.control}
              name="terms"
              render={({ field }) => (
                <Checkbox
                  id="terms"
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  aria-invalid={!!errors.terms}
                  className="mt-0.5"
                />
              )}
            />
            <Label
              htmlFor="terms"
              className="text-sm leading-snug font-normal text-muted-foreground"
            >
              <span>
                I agree to the <LegalLink title="Terms of Service">Terms of Service</LegalLink> and{" "}
                <LegalLink title="Privacy Policy">Privacy Policy</LegalLink>.
              </span>
            </Label>
          </div>
          {errors.terms && (
            <p role="alert" className="text-xs text-destructive">
              {errors.terms.message}
            </p>
          )}
        </div>
        <SubmitButton pending={isSubmitting}>
          {isSubmitting ? "Creating account" : "Create account"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
