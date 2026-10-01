import { useEffect, useState } from "react";
import { formatVenueRange } from "../../components/format";
import type { Availability, ScheduleBooking } from "../venues/venueApi";

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

export function upcomingBookings<T extends { startTime: string; endTime: string }>(bookings: T[], now: number): T[] {
  return bookings
    .filter((booking) => new Date(booking.endTime).getTime() > now)
    .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
}

export function SessionClock({ start, end }: { start: string; end: string }) {
  const now = useNow();
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (now >= endMs) {
    return <p className="text-sm text-mist/65">This session has ended.</p>;
  }
  if (now < startMs) {
    return <p className="text-sm text-mist">Starts in {clock(startMs - now)}</p>;
  }
  return <p className="text-sm font-medium text-line">Ends in {clock(endMs - now)}</p>;
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
  if (now < startMs) {
    return `${range}. Starts in ${clock(startMs - now)}.`;
  }
  return `${range}. Ends in ${clock(endMs - now)}.`;
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

export function DayChart({ schedule, now, compact = false }: { schedule: Availability; now: number; compact?: boolean }) {
  const windowStart = new Date(schedule.windowStart).getTime();
  const windowEnd = new Date(schedule.windowEnd).getTime();
  const span = Math.max(windowEnd - windowStart, 1);
  const marks = axisMarks(windowStart, windowEnd, schedule.venue.timeZone);

  return (
    <section className="mt-6" aria-labelledby="day-chart">
      <h2 id="day-chart" className="font-display text-2xl font-semibold text-white">Day at a glance</h2>
      <p className="mt-1 text-sm text-mist/70">Each booking shows its time above the lime block. The pale track is still open. Amber is closed.</p>
      <div className="mt-4 grid text-[11px] text-mist/55 sm:grid-cols-[9rem_1fr]">
        <span className="hidden sm:block" />
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
            <li key={court.id} className="grid items-end gap-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
              <span className="pb-1.5 text-sm font-medium text-white">{court.courtName}</span>
              <div className="relative" style={{ height: `${rowHeight}rem` }}>
                <div className="absolute inset-x-0 bottom-0 h-8 overflow-visible rounded-lg bg-white/10">
                  {closures.map((closure) => {
                    const place = band(closure.startTime, closure.endTime, windowStart, span);
                    return (
                      <span
                        key={closure.id}
                        className="absolute inset-y-0 bg-amber-400/80"
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
                        className="group absolute inset-y-0 border border-white/30 bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
                        style={{ left: `${item.left}%`, width: `${item.width}%` }}
                        aria-label={tip}
                      >
                        <span
                          className={`pointer-events-none absolute z-10 w-max whitespace-nowrap rounded bg-ink/90 px-1 text-[11px] font-medium leading-4 text-white ${item.left > 82 ? "right-0" : item.left < 8 ? "left-0" : "left-1/2 -translate-x-1/2 text-center"}`}
                          style={{ bottom: `calc(100% + ${compact ? 0.15 + item.lane * 0.95 : 0.25 + item.lane * 1.25}rem)` }}
                        >
                          {label}
                        </span>
                        <span className="pointer-events-none absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white shadow-lg group-hover:block group-focus-visible:block">
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
    </section>
  );
}
