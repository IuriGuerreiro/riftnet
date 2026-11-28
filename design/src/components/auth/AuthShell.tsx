import type { ReactNode } from "react";

import { Lockup } from "@/components/brand/Lockup";

import { BrandPanel } from "./BrandPanel";
import { LegalLink } from "./LegalLink";

const YEAR = new Date().getFullYear();

export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-full bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <main className="flex flex-col px-6 py-6 sm:px-12 sm:py-8">
        <Lockup />
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="animate-in fade-in slide-in-from-bottom-2 w-full max-w-sm duration-500">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-8">{children}</div>
            {footer !== undefined && (
              <div className="mt-8 text-center text-sm text-muted-foreground">{footer}</div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground/70">
          © {YEAR} Riftnet · <LegalLink title="Terms of Service">Terms</LegalLink> ·{" "}
          <LegalLink title="Privacy Policy">Privacy</LegalLink>
        </p>
      </main>
      <div className="hidden p-3 lg:flex">
        <BrandPanel className="flex flex-1" />
      </div>
    </div>
  );
}
