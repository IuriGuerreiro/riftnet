import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/SubmitButton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { mockCheckUsername, suggestUsernames } from "@/mock/auth";
import { USERNAME_RE, type UsernameForm, usernameSchema } from "@/schemas/auth";

type Availability = "idle" | "checking" | "free" | "taken";

function useAvailability(raw: string): Availability {
  const name = raw.trim().toLowerCase();
  const valid = USERNAME_RE.test(name);
  const [result, setResult] = useState<{ name: string; free: boolean } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const id = setTimeout(() => {
      void mockCheckUsername(name).then((free) => {
        if (live) setResult({ name, free });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [name, valid]);

  if (!valid) return "idle";
  if (result?.name !== name) return "checking";
  return result.free ? "free" : "taken";
}

const STATUS_ICON = {
  idle: null,
  checking: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
  free: <Check className="size-4 text-success" />,
  taken: <X className="size-4 text-destructive" />,
} as const;

export function UsernameScreen() {
  const navigate = useNavigate();
  const form = useForm<UsernameForm>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const username = useWatch({ control: form.control, name: "username" });
  const status = useAvailability(username);
  const display = username.trim().toLowerCase();

  const onSubmit = form.handleSubmit(async () => {
    if (status !== "free") return;
    await navigate({ to: "/app" });
  });

  const pick = (name: string) => form.setValue("username", name, { shouldValidate: true });

  return (
    <AuthShell
      title="Pick a username"
      subtitle="This is how friends find you. You can change it later."
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-6">
        <Field
          id="username"
          label="Username"
          error={errors.username?.message ?? (status === "taken" ? "That one's taken." : undefined)}
          hint={
            status === "free" ? (
              <span className="text-success">Nice, it's yours.</span>
            ) : (
              "3 to 32 characters: letters, numbers, _ and ."
            )
          }
        >
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground">
              @
            </span>
            <Input
              id="username"
              autoFocus
              autoComplete="username"
              spellCheck={false}
              placeholder="yourname"
              aria-invalid={!!errors.username || status === "taken"}
              className="h-11 pr-10 pl-7"
              {...form.register("username")}
            />
            <span className="absolute inset-y-0 right-3 grid place-items-center">
              {STATUS_ICON[status]}
            </span>
          </div>
        </Field>

        {status === "taken" && (
          <div className="animate-in fade-in -mt-2 flex flex-wrap gap-2">
            {suggestUsernames(display).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-foreground transition-colors hover:border-brand hover:text-brand"
              >
                @{s}
              </button>
            ))}
          </div>
        )}

        <ProfilePreview name={display} />

        <SubmitButton pending={isSubmitting}>Continue</SubmitButton>
      </form>
    </AuthShell>
  );
}

function ProfilePreview({ name }: { name: string }) {
  const initial = name.at(0)?.toUpperCase() ?? "?";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
      <div className="relative">
        <div className="grid size-11 place-items-center rounded-full bg-brand/20 text-base font-semibold text-brand">
          {initial}
        </div>
        <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-surface-1 bg-success" />
      </div>
      <div className="min-w-0">
        <p className={cn("truncate text-sm font-semibold", !name && "text-muted-foreground")}>
          {name || "yourname"}
        </p>
        <p className="truncate text-xs text-muted-foreground">@{name || "yourname"} · Online</p>
      </div>
      <span className="ml-auto text-[11px] tracking-wide text-muted-foreground/70 uppercase">
        Preview
      </span>
    </div>
  );
}
