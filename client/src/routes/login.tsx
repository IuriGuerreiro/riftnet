import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useLogin, useRegister } from "../api/auth";
import { credentialsSchema, type Credentials } from "../schemas/auth";
import { Button, Card, ErrorText, Input } from "../components/ui";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const login = useLogin();
  const register = useRegister();
  const action = mode === "login" ? login : register;
  const navigate = useNavigate();

  const form = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const onSubmit = form.handleSubmit((values) =>
    action.mutate(values, { onSuccess: (s) => navigate({ to: s.user.username ? "/" : "/username" }) }),
  );

  return (
    <Card>
      <h1 className="text-2xl font-bold">
        {mode === "login" ? "Welcome back 🐒" : "Create account"}
      </h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input placeholder="Email" type="email" {...form.register("email")} error={form.formState.errors.email?.message} />
        <Input
          placeholder="Password"
          type="password"
          {...form.register("password")}
          error={form.formState.errors.password?.message}
        />
        <ErrorText error={action.error} />
        <Button type="submit" disabled={action.isPending}>
          {mode === "login" ? "Log in" : "Register"}
        </Button>
      </form>
      <button
        className="text-sm text-zinc-400 hover:text-zinc-200"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "No account? Register" : "Have an account? Log in"}
      </button>
    </Card>
  );
}
