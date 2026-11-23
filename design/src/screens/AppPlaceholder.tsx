import { Link } from "@tanstack/react-router";

import { AdeptMark } from "@/components/brand/AdeptMark";
import { Button } from "@/components/ui/button";

export function AppPlaceholder() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
      <AdeptMark tone="mono" className="size-12 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You're in</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        The app shell (server rail, channels, chat) is the next screen we build.
      </p>
      <Button asChild variant="secondary">
        <Link to="/login">Back to login</Link>
      </Button>
    </div>
  );
}
