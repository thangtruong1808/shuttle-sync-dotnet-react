import { useEffect, useState } from "react";
import { formatVenueDay, formatVenueRange } from "../../components/format";
import { Eye } from "lucide-react";
import { Button } from "../../components/ui";
import { socialRoster, type SocialRosterCourt, type Availability, type CourtSocial, type ScheduleBooking, type SocialCourtLoad } from "../venues/venueApi";

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function RegistrationNames({ courts }: { courts: SocialRosterCourt[] }) {
  if (courts.length === 0) {
    return <p className="mt-2 text-sm text-fg/70">No one is registered yet.</p>;
  }

  return (
    <ul className="mt-2 space-y-2">
      {courts.map((court) => (
        <li key={court.courtNumber}>
          <p className="text-sm font-medium text-fg">{court.courtName}: {court.players.length} {court.players.length === 1 ? "player" : "players"}</p>
          <ul className="mt-1">
            {court.players.map((name, index) => (
              <li key={`${court.courtNumber}-${index}`} className="text-sm text-fg/80">{name}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function CourtRoster({ slug, socialId, courtNumber }: { slug: string; socialId: string; courtNumber?: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [courts, setCourts] = useState<SocialRosterCourt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (courts) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await socialRoster(slug, socialId);
      setCourts(typeof courtNumber === "number" ? next.courts.filter((court) => court.courtNumber === courtNumber) : next.courts);
    } catch {
      setError("Registration could not be loaded.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <Button type="button" variant="secondary" className="w-full" icon={<Eye className="h-4 w-4" aria-hidden="true" />} loading={loading} onClick={() => void toggle()}>
        {open ? "Hide registration" : "View registration"}
      </Button>
      {error ? <p className="mt-2 text-sm text-fg" role="alert">{error}</p> : null}
      {open && courts ? <RegistrationNames courts={courts} /> : null}
    </div>
  );
}

export function SocialTimes({ times, timeZone, now, slug, courtNumber }: { times: CourtSocial[]; timeZone: string; now: number; slug?: string; courtNumber?: number }) {
  const open = times.filter((time) => new Date(time.endTime).getTime() > now);
  if (open.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-fg">Drop-in social</p>
      <ul className="mt-2 grid gap-2">
        {open.map((time) => {
          const each = time.playersPerCourt ?? 8;
          const allowed = typeof time.courtLimit === "number" && time.courtLimit > 0 ? time.courtLimit * each : 0;
          const full = time.full === true || (
            typeof time.totalPlayers === "number" &&
            allowed > 0 &&
            time.totalPlayers >= allowed
          );
          return (
          <li key={time.id} className="rounded-2xl border border-accent-text/40 px-3 py-2">
            <p className="text-sm font-semibold text-fg">{formatVenueDay(time.startTime, timeZone)}</p>
            <p className="whitespace-nowrap text-sm text-fg">{formatVenueRange(time.startTime, time.endTime, timeZone)}</p>
            <p className="text-sm text-fg/80">{time.players === 0 ? "No one on this court yet" : `${time.players} of ${each} on this court`}</p>
            {typeof time.totalPlayers === "number" && allowed > 0 ? (
              <p className="text-sm text-fg/70">
                {time.totalPlayers} of {allowed} players
                {" · "}
                {each} per court
                {" · "}
                {time.courtLimit} {time.courtLimit === 1 ? "court" : "courts"}
              </p>
            ) : typeof time.totalPlayers === "number" ? (
              <p className="text-sm text-fg/70">
                {time.totalPlayers} registered
                {" · "}
                {typeof time.courtLimit === "number" ? `${time.courtsUsed ?? 0} of ${time.courtLimit} courts` : `${time.courtsUsed ?? 0} courts`}
                {" · "}
                {each} players each
              </p>
            ) : (
              <p className="text-sm text-fg/70">Each court holds {each} players.</p>
            )}
            {full ? (
              <p className="mt-1 text-sm text-accent-text">This social is full. Join the waitlist from Register for public social. If someone cancels, the first person waiting gets the place.</p>
            ) : null}
            {typeof time.waitlistCount === "number" && (full || time.waitlistCount > 0) ? (
              <p className="text-sm text-fg/70">{time.waitlistCount} {time.waitlistCount === 1 ? "person" : "people"} on the waitlist.</p>
            ) : null}
            <SessionClock start={time.startTime} end={time.endTime} />
            {slug ? <CourtRoster slug={slug} socialId={time.id} courtNumber={courtNumber} /> : null}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

export function upcomingBookings<T extends { startTime: string; endTime: string }>(bookings: T[], now: number): T[] {
  return bookings
    .filter((booking) => new Date(booking.endTime).getTime() > now)
    .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
}

export function BookedTime({ start, end, timeZone, unpaid = false }: { start: string; end: string; timeZone: string; unpaid?: boolean }) {
  return (
    <p className={`text-sm ${unpaid ? "text-amber-800 dark:text-amber-100" : "text-fg"}`}>
      <span className={`font-semibold ${unpaid ? "text-amber-700 dark:text-amber-200" : ""}`}>{unpaid ? "Held" : "Booked"}</span>
      <span className="text-fg-muted"> · </span>
      <span className="whitespace-nowrap">{formatVenueRange(start, end, timeZone)}</span>
    </p>
  );
}

function prettyDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function IncentiveNote({ points, startsOn, endsOn }: { points: number; startsOn: string; endsOn: string }) {
  return (
    <p className="mt-2 text-sm leading-snug text-accent-text">
      <span className="font-semibold">+{points} pts</span>
      <span className="mt-0.5 block font-normal text-fg/80">
        Book a court or join a public social from {prettyDate(startsOn)} to {prettyDate(endsOn)}. These points are added after that session ends.
      </span>
    </p>
  );
}

export function SocialRoster({
  playerCount,
  courtCount,
  playersPerCourt = 8,
  courts,
  compact = false,
}: {
  playerCount: number;
  courtCount: number;
  playersPerCourt?: number;
  courts: SocialCourtLoad[];
  compact?: boolean;
}) {
  const each = playersPerCourt > 0 ? playersPerCourt : 8;
  const used = [...courts].sort((left, right) => left.courtNumber - right.courtNumber);
  const courtsUsed = used.length;
  return (
    <div className="mt-2 rounded-2xl border border-fg/10 bg-inset p-3">
      <p className="text-sm font-semibold text-fg">
        {playerCount} player{playerCount === 1 ? "" : "s"} registered
        <span className="font-normal text-fg/70">
          {" · "}
          {courtCount > 0 ? `${courtsUsed} of ${courtCount} courts in use` : `${courtsUsed} court${courtsUsed === 1 ? "" : "s"} in use`}
        </span>
      </p>
      {compact ? null : (
        <p className="mt-1 text-sm leading-snug text-fg/75">Each court holds {each} players. The next player uses another court only after the earlier court is full{courtCount > 0 ? `, up to ${courtCount} courts` : ""}. If someone leaves, the next player moves up.</p>
      )}
      {used.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {used.map((court) => (
            <li key={court.courtNumber} className="rounded-xl border border-fg/10 px-2.5 py-2">
              <p className="truncate text-xs text-fg/60">{court.courtName}</p>
              <p className="text-sm font-semibold text-fg">{court.players} / {each}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-fg/70">No one has joined this time yet.</p>
      )}
    </div>
  );
}

export function SessionClock({ start, end }: { start: string; end: string }) {
  const now = useNow(1000);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (now >= endMs) {
    return <p className="text-sm text-fg/65">This session has ended.</p>;
  }
  if (now < startMs) {
    return <p className="text-sm text-fg">Starts in {clock(startMs - now)}</p>;
  }
  return <p className="text-sm font-medium text-accent-text">Ends in {clock(endMs - now)}</p>;
}

function band(startIso: string, endIso: string, windowStart: number, span: number) {
  const left = Math.max(0, Math.min(1, (new Date(startIso).getTime() - windowStart) / span));
  const right = Math.max(0, Math.min(1, (new Date(endIso).getTime() - windowStart) / span));
  return { left: left * 100, width: Math.max(0, (right - left) * 100) };
}

function bookingTip(booking: ScheduleBooking, timeZone: string, now: number): string {
  const range = formatVenueRange(booking.startTime, booking.endTime, timeZone);
  const startMs = new Date(booking.startTime).getTime();
  const endMs = new Date(booking.endTime).getTime();
  const label = booking.status === "pending" ? "Held, waiting for payment" : "Booked";
  if (now < startMs) {
    return `${label}, ${range}. Starts in ${clock(startMs - now)}.`;
  }
  return `${label}, ${range}. Ends in ${clock(endMs - now)}.`;
}

function clockParts(value: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "Australia/Melbourne",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { hour, minute };
}

function venueClock(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "Australia/Melbourne",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h12",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const period = (parts.find((part) => part.type === "dayPeriod")?.value ?? "").toLowerCase();
  return { hour, minute, period };
}

function clockText(hour: number, minute: number): string {
  return minute === 0 ? String(hour) : `${hour}:${String(minute).padStart(2, "0")}`;
}

export function compactSlotLabel(startIso: string, endIso: string, timeZone: string): string {
  const start = venueClock(startIso, timeZone);
  const end = venueClock(endIso, timeZone);
  const startText = clockText(start.hour, start.minute);
  const endText = clockText(end.hour, end.minute);
  const even = start.minute === 0 && end.minute === 0;
  if (start.period === end.period) {
    return even ? `${startText}–${endText}${start.period}` : `${startText}–${endText} ${start.period}`;
  }
  if (even) {
    return `${startText}${start.period}–${endText}${end.period}`;
  }
  const startSide = start.minute === 0 ? `${startText}${start.period}` : `${startText} ${start.period}`;
  const endSide = end.minute === 0 ? `${endText}${end.period}` : `${endText} ${end.period}`;
  return `${startSide}–${endSide}`;
}

const freeTrack = "bg-inset";
const closedBand = "bg-surface-2 bg-[repeating-linear-gradient(-45deg,rgb(var(--fg)/0.28)_0_3px,transparent_3px_7px)]";
const chartColumns = "grid-cols-[7.5rem_minmax(28rem,1fr)]";

function ChartLegend() {
  const items = [
    { label: "Free", className: freeTrack },
    { label: "Taken", className: "bg-accent" },
    { label: "Held", className: "bg-amber-400" },
    { label: "Closed", className: closedBand },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-muted">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-5 rounded-sm border border-border ${item.className}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function axisMarks(windowStart: number, windowEnd: number, timeZone: string) {
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    hour: "numeric",
    minute: "2-digit",
  });
  const marks = [{ ratio: 0, label: time.format(new Date(windowStart)) }];
  for (let cursor = windowStart; cursor < windowEnd; cursor += 15 * 60 * 1000) {
    const { hour, minute } = clockParts(cursor, timeZone);
    if (minute === 0 && hour % 6 === 0 && cursor > windowStart + 30 * 60 * 1000) {
      marks.push({ ratio: (cursor - windowStart) / (windowEnd - windowStart), label: time.format(new Date(cursor)) });
    }
  }
  marks.push({ ratio: 1, label: time.format(new Date(windowEnd)) });
  return marks;
}

export function DayChart({ schedule, now, compact = false, collapsible = false }: { schedule: Availability; now: number; compact?: boolean; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const windowStart = new Date(schedule.windowStart).getTime();
  const windowEnd = new Date(schedule.windowEnd).getTime();
  const span = Math.max(windowEnd - windowStart, 1);
  const marks = axisMarks(windowStart, windowEnd, schedule.venue.timeZone);

  return (
    <section className="mt-6" aria-labelledby="day-chart">
      {collapsible ? (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left shadow-card hover:bg-surface-2 dark:shadow-none"
          aria-expanded={open}
          aria-controls="day-chart-panel"
          onClick={() => setOpen((value) => !value)}
        >
          <span id="day-chart" className="font-display text-2xl font-semibold text-fg">Day at a glance</span>
          <span className="shrink-0 text-sm font-semibold text-accent-text">{open ? "Hide chart" : "Show chart"}</span>
        </button>
      ) : (
        <h2 id="day-chart" className="font-display text-2xl font-semibold text-fg">Day at a glance</h2>
      )}
      {collapsible && !open ? (
        <p className="mt-2 text-sm text-fg/70">Show the chart to see which times are booked and which are still open.</p>
      ) : (
      <div id={collapsible ? "day-chart-panel" : undefined}>
      <p className="mt-1 text-sm text-fg-muted">Each booking shows its time above its block.</p>
      <ChartLegend />
      <div className="mt-4 overflow-x-auto">
      <div className="min-w-[36rem]">
      <div className={`grid text-[11px] tabular-nums text-fg-muted ${chartColumns}`}>
        <span className="sticky left-0 z-20 bg-canvas" />
        <div className="relative h-4">
          {marks.map((mark) => (
            <span
              key={mark.ratio}
              className={`absolute top-0 whitespace-nowrap ${mark.ratio === 0 ? "left-0" : mark.ratio === 1 ? "right-0" : "-translate-x-1/2"}`}
              style={mark.ratio === 0 || mark.ratio === 1 ? undefined : { left: `${mark.ratio * 100}%` }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-2 grid gap-4">
        {schedule.courts.map((court) => {
          const closures = schedule.closures.filter((closure) => closure.courtId === null || closure.courtId === court.id);
          const bookings = upcomingBookings(court.bookings, now);
          const placed = bookings.map((booking) => {
            const place = band(booking.startTime, booking.endTime, windowStart, span);
            const width = Math.max(place.width, 1.6);
            const left = Math.min(place.left, Math.max(0, 100 - width));
            return { booking, left, width, lane: 0 };
          });
          const labelFootprint = compact ? 14 : 28;
          placed.forEach((item, index) => {
            let lane = 0;
            const footprint = Math.max(item.width, labelFootprint);
            while (placed.slice(0, index).some((other) => other.lane === lane && other.left < item.left + footprint && item.left < other.left + Math.max(other.width, labelFootprint))) {
              lane += 1;
            }
            item.lane = lane;
          });
          const lanes = Math.max(1, ...placed.map((item) => item.lane + 1), 1);
          const rowHeight = compact ? 2.05 + lanes * 1.05 : 2.25 + lanes * 1.35;
          return (
            <li key={court.id} className={`grid items-end gap-3 ${chartColumns}`}>
              <span className="sticky left-0 z-20 truncate bg-canvas pb-1.5 pr-2 text-sm font-medium text-fg shadow-[4px_0_8px_-6px_rgb(var(--shadow)/0.45)]">{court.courtName}</span>
              <div className="relative" style={{ height: `${rowHeight}rem` }}>
                <div className={`absolute inset-x-0 bottom-0 h-8 overflow-visible rounded-lg ${freeTrack}`}>
                  {closures.map((closure) => {
                    const place = band(closure.startTime, closure.endTime, windowStart, span);
                    return (
                      <span
                        key={closure.id}
                        className={`absolute inset-y-0 ${closedBand}`}
                        style={{ left: `${place.left}%`, width: `${place.width}%` }}
                      />
                    );
                  })}
                  {placed.map((item) => {
                    const tip = bookingTip(item.booking, schedule.venue.timeZone, now);
                    const label = compact
                      ? compactSlotLabel(item.booking.startTime, item.booking.endTime, schedule.venue.timeZone)
                      : formatVenueRange(item.booking.startTime, item.booking.endTime, schedule.venue.timeZone);
                    return (
                      <button
                        key={item.booking.id}
                        type="button"
                        className={`group absolute inset-y-0 border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${item.booking.status === "pending" ? "border-amber-100/40 bg-amber-400 focus-visible:outline-amber-700 dark:focus-visible:outline-amber-200" : "border-fg/30 bg-accent focus-visible:outline-accent-text"}`}
                        style={{ left: `${item.left}%`, width: `${item.width}%` }}
                        aria-label={tip}
                      >
                        <span
                          className={`pointer-events-none absolute z-10 w-max whitespace-nowrap rounded bg-canvas/90 px-1 text-[11px] font-medium leading-4 text-fg ${item.left > 82 ? "right-0" : item.left < 8 ? "left-0" : "left-1/2 -translate-x-1/2 text-center"}`}
                          style={{ bottom: `calc(100% + ${compact ? 0.15 + item.lane * 0.95 : 0.25 + item.lane * 1.25}rem)` }}
                        >
                          {label}
                        </span>
                        <span className="pointer-events-none absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-canvas px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-fg shadow-lg group-hover:block group-focus-visible:block">
                          {tip}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="sr-only">
                {court.courtName}: {bookings.length === 0 ? "no booking still ahead" : bookings.map((booking) => bookingTip(booking, schedule.venue.timeZone, now)).join(" ")}
              </p>
            </li>
          );
        })}
      </ul>
      </div>
      </div>
      </div>
      )}
    </section>
  );
}
