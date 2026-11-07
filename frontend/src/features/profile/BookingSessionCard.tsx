import { CalendarDays, ChevronDown, Clock, CreditCard, Gift, MapPin, ShieldCheck, TriangleAlert, Undo2, Users, X } from "lucide-react";
import { Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { duration, startsIn } from "./bookingWeek";
import type { BookingRow } from "./profileApi";

export type BookingTab = "upcoming" | "past" | "cancelled";

function bookingStatus(booking: BookingRow, tab: BookingTab) {
  switch (booking.status) {
    case "pending":
      return { label: "Awaiting payment", tone: "bg-amber-400/15 text-amber-700 dark:text-amber-200" };
    case "waitlist":
      return { label: "Waitlist", tone: "bg-sky-400/15 text-sky-700 dark:text-sky-200" };
    case "completed":
      return { label: "Completed", tone: "bg-accent/15 text-accent-text" };
    case "no_show":
      return { label: "No-show", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200" };
    case "expired":
      return { label: "Hold expired", tone: "bg-fg/10 text-fg" };
    case "cancelled":
      return { label: "Cancelled", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200" };
    default:
      return tab === "past" ? { label: "Played", tone: "bg-accent/15 text-accent-text" } : { label: "Confirmed", tone: "bg-accent/15 text-accent-text" };
  }
}

export function sessionKey(booking: BookingRow) {
  return `${booking.venueSlug}|${booking.startTime}|${booking.endTime}|${booking.socialId ? "social" : "court"}`;
}

export function sessionGroups(items: BookingRow[]) {
  const groups = new Map<string, BookingRow[]>();
  for (const item of items) {
    const key = sessionKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function refundOf(booking: BookingRow) {
  if (booking.status !== "cancelled" || !booking.wasPaid) return 0;
  return Math.round(booking.totalAmount * (100 - (booking.cancelFeePercent ?? 0))) / 100;
}

export function SessionGroupCard({
  bookings,
  tab,
  open,
  onToggle,
}: {
  bookings: BookingRow[];
  tab: BookingTab;
  open: boolean;
  onToggle: () => void;
}) {
  const first = bookings[0];
  const zone = first.timeZone || "Australia/Melbourne";
  const start = new Date(first.startTime);
  const social = Boolean(first.socialId);
  const total = bookings.reduce((sum, item) => sum + item.totalAmount, 0);
  const points = bookings.reduce((sum, item) => sum + (item.pointsEarned ?? 0), 0);
  const refunded = bookings.reduce((sum, item) => sum + refundOf(item), 0);
  const pointsBack = bookings.reduce((sum, item) => sum + (item.pointsRedeemed ?? 0), 0);
  const charged = bookings.some((item) => item.wasPaid);
  const statuses = new Map<string, { count: number; tone: string }>();
  for (const item of bookings) {
    const status = bookingStatus(item, tab);
    const current = statuses.get(status.label);
    statuses.set(status.label, { count: (current?.count ?? 0) + 1, tone: status.tone });
  }
  const courtCounts = new Map<string, number>();
  for (const item of bookings) courtCounts.set(item.courtName, (courtCounts.get(item.courtName) ?? 0) + 1);
  const names = [...courtCounts.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
  const unit = social ? "places" : courtCounts.size === bookings.length ? "courts" : "bookings";
  const panelId = `session-${first.id}`;

  return (
    <li className="rounded-2xl border border-border bg-surface shadow-card dark:shadow-none">
      <div className="flex gap-3 p-4 sm:gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-fg/10 bg-fg/[0.04] py-2 text-center sm:w-16">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(start)}</span>
          <span className="font-display text-2xl leading-none text-fg">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric" }).format(start)}</span>
          <span className="text-[11px] uppercase text-fg/70">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, month: "short" }).format(start)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-fg/10 px-2 py-0.5 text-xs font-medium text-fg">
                  {social ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
                  {social ? "Public social" : "Court booking"} · {bookings.length} {unit}
                </span>
                {[...statuses.entries()].map(([label, value]) => (
                  <span key={label} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${value.tone}`}>{value.count} {label}</span>
                ))}
              </div>
              <p className="mt-2 break-words font-medium text-fg">{first.venueName}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg/80">
                <Clock className="h-3.5 w-3.5 shrink-0 text-fg/60" aria-hidden="true" />
                <span>{formatVenueRange(first.startTime, first.endTime, first.timeZone)}</span>
                <span className="text-fg/55">· {duration(first.startTime, first.endTime)}</span>
              </p>
              <p className="mt-0.5 flex items-start gap-1.5 break-words text-xs leading-5 text-fg/65">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/60" aria-hidden="true" />
                <span className="min-w-0">{names}</span>
              </p>
            </div>
            <div className="sm:text-right">
              <p className="font-semibold text-fg"><Money amount={total} currency={first.currency} /></p>
              <p className="text-xs text-fg/55">Total for {bookings.length} {unit}</p>
            </div>
          </div>
          <div className="mt-2 space-y-1 text-xs text-fg/65">
            {tab === "past" && points > 0 ? (
              <p className="flex items-center gap-1.5 text-accent-text"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+{points} reward points earned</p>
            ) : null}
            {tab === "cancelled" ? (
              refunded > 0 ? (
                <p className="flex items-center gap-1.5 text-sky-700 dark:text-sky-200"><Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Refunded <Money amount={refunded} currency={first.currency} /> in total</p>
              ) : !charged ? (
                <p className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Not charged</p>
              ) : null
            ) : null}
            {tab === "cancelled" && pointsBack > 0 && !social ? (
              <p className="flex items-center gap-1.5 text-accent-text"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{pointsBack} points returned to your balance</p>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-fg/10 px-3 py-2 text-sm font-medium text-fg hover:bg-fg/10"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            {open ? `Hide ${unit}` : `Show ${bookings.length} ${unit}`}
          </button>
        </div>
      </div>
      {open ? (
        <ul id={panelId} className="space-y-2 border-t border-fg/10 bg-inset p-3 sm:p-4">
          {bookings.map((booking) => (
            <li key={booking.id} className="rounded-xl border border-fg/10 bg-surface/40 p-3">
              <BookingSummary booking={booking} tab={tab} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function BookingSummary({ booking, tab }: { booking: BookingRow; tab: BookingTab }) {
  const zone = booking.timeZone || "Australia/Melbourne";
  const start = new Date(booking.startTime);
  const social = Boolean(booking.socialId);
  const status = bookingStatus(booking, tab);
  const subtotal = booking.subtotalAmount ?? booking.totalAmount;
  const discount = booking.discountAmount ?? 0;
  const pointsUsed = booking.pointsRedeemed ?? 0;
  const fee = booking.cancelFeePercent ?? 0;
  const lateFee = booking.lateFeePercent ?? 0;
  const freeUntil = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const soon = start.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  const refund = booking.wasPaid ? Math.round(booking.totalAmount * (100 - fee)) / 100 : 0;
  const place = booking.status === "waitlist" ? "Waiting for a place on court" : social ? (booking.courtNumber > 0 ? `Court ${booking.courtNumber}` : "Court assigned on the day") : booking.courtName.trim().toLowerCase() === `court ${booking.courtNumber}` ? booking.courtName : `${booking.courtName} · Court ${booking.courtNumber}`;

  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-fg/10 bg-fg/[0.04] py-2 text-center sm:w-16">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(start)}</span>
        <span className="font-display text-2xl leading-none text-fg">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric" }).format(start)}</span>
        <span className="text-[11px] uppercase text-fg/70">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, month: "short" }).format(start)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-fg/10 px-2 py-0.5 text-xs font-medium text-fg">
                {social ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
                {social ? "Public social" : "Court booking"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
              {tab === "upcoming" ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${soon ? "bg-amber-400/15 text-amber-700 dark:text-amber-200" : "bg-fg/5 text-fg/80"}`}>{startsIn(booking.startTime)}</span>
              ) : null}
            </div>
            <p className="mt-2 break-words font-medium text-fg">{booking.venueName}</p>
            <p className="flex items-start gap-1.5 break-words text-sm text-fg/80"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/60" aria-hidden="true" /><span className="min-w-0">{place}</span></p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg/80">
              <Clock className="h-3.5 w-3.5 shrink-0 text-fg/60" aria-hidden="true" />
              <span>{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</span>
              <span className="text-fg/55">· {duration(booking.startTime, booking.endTime)}</span>
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-semibold text-fg"><Money amount={booking.totalAmount} currency={booking.currency} /></p>
            {discount > 0 || pointsUsed > 0 ? (
              <>
                {subtotal > booking.totalAmount ? <p className="text-xs text-fg/55 line-through"><Money amount={subtotal} currency={booking.currency} /></p> : null}
                {discount > 0 ? <p className="text-xs text-accent-text">Promo −<Money amount={discount} currency={booking.currency} /></p> : null}
                {pointsUsed > 0 ? <p className="text-xs text-accent-text">{pointsUsed} pts used</p> : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-2 space-y-1 text-xs text-fg/65">
          {tab === "upcoming" && booking.canCancel && booking.status !== "waitlist" ? (
            freeUntil.getTime() > Date.now() ? (
              <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden="true" />Free cancellation until {formatVenueDateTime(freeUntil.toISOString(), booking.timeZone)}</p>
            ) : booking.wasPaid && lateFee > 0 ? (
              <p className="flex items-center gap-1.5 text-amber-700/90 dark:text-amber-200/90"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelling now keeps {lateFee}% of the card payment{social ? "" : ". Points you used come back in full"}.</p>
            ) : null
          ) : null}
          {tab === "past" && (booking.pointsEarned ?? 0) > 0 ? (
            <p className="flex items-center gap-1.5 text-accent-text"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+{booking.pointsEarned} reward points earned</p>
          ) : null}
          {tab === "cancelled" ? (
            <>
              {booking.status === "expired" ? (
                <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />The hold ended before payment, so nothing was charged.</p>
              ) : booking.cancelledAt ? (
                <p className="flex items-center gap-1.5"><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelled {formatVenueDateTime(booking.cancelledAt, booking.timeZone)}</p>
              ) : null}
              {booking.status === "cancelled" ? (
                booking.wasPaid ? (
                  <p className="flex items-center gap-1.5 text-sky-700 dark:text-sky-200"><Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Refunded <Money amount={refund} currency={booking.currency} />{fee > 0 ? ` · ${fee}% late-cancel fee kept` : " · full refund"}
                  </p>
                ) : booking.wasPaid === false ? (
                  <p className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Not charged</p>
                ) : null
              ) : null}
              {pointsUsed > 0 && (!social || fee === 0) ? (
                <p className="flex items-center gap-1.5 text-accent-text"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{pointsUsed} points returned to your balance</p>
              ) : null}
            </>
          ) : null}
          {booking.bookedAt ? <p>Booked {formatVenueDateTime(booking.bookedAt, booking.timeZone)}</p> : null}
        </div>
      </div>
    </div>
  );
}

