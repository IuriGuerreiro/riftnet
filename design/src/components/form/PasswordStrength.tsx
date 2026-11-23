import { cn } from "@/lib/utils";

const LABELS = ["Too short", "Weak", "Okay", "Good", "Strong"] as const;
const COLORS = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"];

function scorePassword(pw: string): number {
  if (pw.length < 8) return 0;
  let score = 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score += 1;
  return Math.min(score, 4);
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 rounded-full transition-colors duration-300",
              i <= Math.max(score, 1) ? COLORS[score] : "bg-surface-4",
            )}
          />
        ))}
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">{LABELS[score]}</span>
    </div>
  );
}
