import type { ReactNode } from "react";
import { Spinner } from "./ui";

export function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency || "AUD",
  }).format(amount);
  return <span>{formatted}</span>;
}

export function venueToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function formatVenueRange(start: string, end: string, timeZone: string): string {
  const zone = timeZone || "Australia/Melbourne";
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time.format(new Date(start))} – ${time.format(new Date(end))}`;
}

export function formatVenueDay(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function formatVenueDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CourtImage({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-inset">
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-fg-muted" role="img" aria-label={alt}>
          Court photo coming soon
        </div>
      )}
    </div>
  );
}

function EmptyMark() {
  return (
    <svg className="mx-auto h-16 w-16 text-accent-text" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="currentColor" fillOpacity="0.12" />
      <g transform="translate(20 16)" fill="currentColor">
        <path d="M7.1 13.2C7.4 8.6 8.8 4.4 9.8 2.6c.4-.7 1.5-.3 1.3.5-.6 2.6-1.8 6.4-1.9 9.1 0 .6-.5 1-1.1 1h-.1c-.5 0-.9-.4-.9-1Z" />
        <path d="M11.1 13.6c.1-4.8.9-9.2 1.5-11 .2-.6 1.1-.6 1.3 0 .6 1.8 1.4 6.2 1.4 11 0 .6-.5 1.1-1.1 1.1h-.6c-.6 0-1.1-.5-1.1-1.1Z" />
        <path d="M16.9 13.2c-.1-2.7-1.3-6.5-1.9-9.1-.2-.8.9-1.2 1.3-.5 1 1.8 2.4 6 2.7 10.6 0 .6-.4 1-.9 1h-.1c-.6 0-1.1-.4-1.1-1Z" />
        <path d="M8.2 14.8h7.6l-1.05 2.15a1.55 1.55 0 0 1-1.4.8h-2.7a1.55 1.55 0 0 1-1.4-.8L8.2 14.8Z" />
        <circle cx="12" cy="19.7" r="2.05" />
      </g>
    </svg>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center">
      <EmptyMark />
      <p className="mt-4 font-medium text-fg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  loading = false,
}: {
  message: string;
  onRetry: () => void;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-5" role="alert" aria-live="assertive">
      <p className="text-sm text-rose-800 dark:text-rose-100">{message}</p>
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-fg/15 px-3.5 py-2 text-sm font-semibold text-fg hover:bg-fg/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onRetry}
      >
        {loading ? <Spinner className="h-4 w-4" /> : null}
        Try again
      </button>
    </div>
  );
}

export function initials(name: string | null, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
