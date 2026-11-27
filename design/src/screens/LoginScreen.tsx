import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/form/Field";
import { PasswordInput } from "@/components/form/PasswordInput";
import { SubmitButton } from "@/components/form/SubmitButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { mockLogin } from "@/mock/auth";
import { type LoginForm, loginSchema } from "@/schemas/auth";

export function LoginScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await mockLogin(email, password);
      await navigate({ to: "/app" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  });

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your Adept account."
      footer={
        <>
          New to Adept?{" "}
          <Link to="/register" className="font-medium text-brand-text hover:underline">
            Create an account
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
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          aside={
            <Link to="/forgot" className="text-xs font-medium text-brand-text hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
        </Field>
        <SubmitButton pending={isSubmitting}>{isSubmitting ? "Logging in" : "Log in"}</SubmitButton>
      </form>
    </AuthShell>
  );
}
