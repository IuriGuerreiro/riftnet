import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useForm } from "react-hook-form";

import { useSetUsername } from "../api/auth";
import { Button, Card, ErrorText, Input } from "../components/ui";
import { type UsernameForm, usernameSchema } from "../schemas/auth";
import { readWorkspaceSearch } from "../schemas/workspace";

export function UsernamePage() {
  const setUsername = useSetUsername();
  const navigate = useNavigate();
  const { invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const form = useForm<UsernameForm>({ resolver: zodResolver(usernameSchema) });

  const onSubmit = form.handleSubmit(({ username }) =>
    setUsername.mutate(username, {
      onSuccess: () => void navigate({ to: "/", search: { invite } }),
    }),
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
        <Button type="submit" disabled={setUsername.isPending}>
          Continue
        </Button>
      </form>
    </Card>
  );
}
