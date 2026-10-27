import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <LoaderCircle className={`motion-safe:animate-spin ${className}`} aria-hidden="true" />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-fg/10 ${className}`} aria-hidden="true" />;
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-fg-muted",
  accent: "border-accent-text/30 bg-accent/15 text-accent-text",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  warning: "border-amber-500/30 bg-amber-400/15 text-amber-800 dark:text-amber-200",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  info: "border-sky-500/30 bg-sky-400/10 text-sky-800 dark:text-sky-200",
};

export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTones[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

const alertTones: Record<Exclude<Tone, "neutral" | "accent">, { box: string; icon: typeof Info }> = {
  success: { box: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100", icon: CircleCheck },
  warning: { box: "border-amber-500/30 bg-amber-400/10 text-amber-900 dark:text-amber-100", icon: TriangleAlert },
  danger: { box: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-100", icon: CircleAlert },
  info: { box: "border-sky-500/30 bg-sky-400/10 text-sky-900 dark:text-sky-100", icon: Info },
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: keyof typeof alertTones;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = alertTones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} aria-live={tone === "danger" ? "assertive" : "polite"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${box} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
