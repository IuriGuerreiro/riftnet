import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useLogin, useRegister } from "../api/auth";
import { AuthLayout } from "../components/AuthLayout";
import { Button, Card, ErrorText, Input } from "../components/ui";
import { type Credentials, credentialsSchema } from "../schemas/auth";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const login = useLogin();
  const register = useRegister();
  const action = mode === "login" ? login : register;
  const navigate = useNavigate();

  const form = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const onSubmit = form.handleSubmit((values) =>
    action.mutate(values, {
      onSuccess: (s) => void navigate({ to: s.user.username ? "/" : "/username" }),
    }),
  );

  return (
    <AuthLayout>
      <Card>
        <h1 className="text-2xl font-bold">
          {mode === "login" ? "Welcome back" : "Create an account"}
        </h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            label="Email"
            autoComplete="email"
            type="email"
            {...form.register("email")}
            error={form.formState.errors.email?.message}
          />
          <Input
            label="Password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            type="password"
            {...form.register("password")}
            error={form.formState.errors.password?.message}
          />
          <ErrorText error={action.error} />
          <Button type="submit" block size="lg" disabled={action.isPending}>
            {action.isPending
              ? mode === "login"
                ? "Logging in…"
                : "Creating account…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </Button>
        </form>
        <button
          type="button"
          className="text-sm text-brand hover:underline"
          onClick={() => {
            login.reset();
            register.reset();
            form.clearErrors();
            setMode(mode === "login" ? "register" : "login");
          }}
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </Card>
    </AuthLayout>
  );
}
