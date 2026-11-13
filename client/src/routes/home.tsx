import { useNavigate } from "@tanstack/react-router";
import { useLogout, useMe } from "../api/auth";
import { platform } from "../platform";
import { Button, Card, ErrorText } from "../components/ui";

// Test page: proves the token works. Will become the app's main screen.
export function HomePage() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <Card>
      <h1 className="text-2xl font-bold">
        Hi, <span className="text-brand">{me.data?.username ?? "…"}</span>
      </h1>
      <ErrorText error={me.error} />
      <pre className="overflow-auto rounded-lg bg-zinc-800 p-3 text-xs">{JSON.stringify(me.data, null, 2)}</pre>
      <p className="text-xs text-zinc-500">
        {platform.kind} · {platform.httpUrl}
      </p>
      <Button onClick={() => logout.mutate(undefined, { onSettled: () => navigate({ to: "/login" }) })}>
        Log out
      </Button>
    </Card>
  );
}
