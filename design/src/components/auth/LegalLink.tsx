import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function LegalLink({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="underline-offset-2 hover:underline">
          {children}
        </button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Placeholder text. The real document goes here before launch.
        </p>
      </DialogContent>
    </Dialog>
  );
}
