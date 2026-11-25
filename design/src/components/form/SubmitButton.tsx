import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function SubmitButton({
  pending,
  disabled = false,
  children,
}: {
  pending: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled}
      className="h-11 w-full text-[15px] font-semibold shadow-[0_8px_24px_-8px_var(--adept-violet)]"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}
