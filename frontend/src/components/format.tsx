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

export function formatVenueDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CourtImage({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-black/30">
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-mist/45" role="img" aria-label={alt}>
          Court photo coming soon
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-mist/70">{body}</p>
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
    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-5" role="alert">
      <p className="text-sm text-rose-100">{message}</p>
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm font-semibold text-mist hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed disabled:opacity-60"
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
