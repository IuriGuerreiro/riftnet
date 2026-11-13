import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useSetUsername } from "../api/auth";
import { usernameSchema, type UsernameForm } from "../schemas/auth";
import { Button, Card, ErrorText, Input } from "../components/ui";

export function UsernamePage() {
  const setUsername = useSetUsername();
  const navigate = useNavigate();
  const form = useForm<UsernameForm>({ resolver: zodResolver(usernameSchema) });

  const onSubmit = form.handleSubmit(({ username }) =>
    setUsername.mutate(username, { onSuccess: () => navigate({ to: "/" }) }),
  );

  return (
    <Card>
      <h1 className="text-2xl font-bold">Pick your username</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input placeholder="username" {...form.register("username")} error={form.formState.errors.username?.message} />
        <ErrorText error={setUsername.error} />
        <Button type="submit" disabled={setUsername.isPending}>
          Continue
        </Button>
      </form>
    </Card>
  );
}
