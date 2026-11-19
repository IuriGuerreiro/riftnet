import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import { useSetUsername } from "../api/auth";
import { Button, Card, ErrorText, Input } from "../components/ui";
import { type UsernameForm, usernameSchema } from "../schemas/auth";

export function UsernamePage() {
  const setUsername = useSetUsername();
  const navigate = useNavigate();
  const form = useForm<UsernameForm>({ resolver: zodResolver(usernameSchema) });

  const onSubmit = form.handleSubmit(({ username }) =>
    setUsername.mutate(username, { onSuccess: () => void navigate({ to: "/" }) }),
  );

  return (
    <Card>
      <h1 className="text-2xl font-bold">Pick your username</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input
          placeholder="username"
          {...form.register("username")}
          error={form.formState.errors.username?.message}
        />
        <ErrorText error={setUsername.error} />
        <Button type="submit" block size="lg" disabled={setUsername.isPending}>
          Continue
        </Button>
      </form>
    </Card>
  );
}
