import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, CircleAlert, CircleCheck, Clock, CreditCard, Gift, Repeat, TriangleAlert, Unlock } from "lucide-react";
import { Badge, Button, Spinner } from "../../components/ui";
import { Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { AuthRequestError } from "../auth/authApi";
import { deleteSeries, deleteSeriesPreview, refreshUnpaidHolds, setCourtRepeat, type CourtWeekCourt, type SeriesCancelPreview } from "./profileApi";
import { WeekEditor } from "./WeekEditor";
import { formatWeekDate, leadCourt, timeGroups, topUpSource, weekOfYear, weekPayNote, weekSpan, sameSlot } from "./bookingWeek";

function WeekPayStatus({ courts }: { courts: CourtWeekCourt[] }) {
  const paid = courts.filter((court) => court.status === "confirmed").length;
  if (paid === courts.length) {
    return <Badge tone="success" icon={<CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}>Paid</Badge>;
  }
  const dueAt = new Date(leadCourt(courts).startTime).getTime() - 24 * 60 * 60 * 1000;
  const dueNow = dueAt <= Date.now();
  const Icon = dueNow ? CircleAlert : Clock;
  return (
    <Badge tone={dueNow ? "danger" : "warning"} icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}>
      {paid > 0 ? `Partly paid · ${paid} of ${courts.length}` : dueNow ? "Pay now" : "Held for you"}
    </Badge>
  );
}

export function SeriesCard({ weeks, topUps = [], open, onToggle, openWeek, onOpenWeek, onChanged }: { weeks: CourtWeekCourt[][]; topUps?: CourtWeekCourt[]; open: boolean; onToggle: () => void; openWeek: string | null; onOpenWeek: (key: string | null) => void; onChanged: () => void }) {
  const ordered = [...weeks].sort((left, right) => left[0].startTime < right[0].startTime ? -1 : 1);
  const sample = ordered[0][0];
  const everyCourt = ordered.flat();
  const sharedTime = everyCourt.every((court) => sameSlot(court, sample));
  const nextCourt = [...everyCourt].filter((court) => new Date(court.endTime).getTime() > Date.now()).sort((left, right) => left.startTime < right.startTime ? -1 : 1)[0] ?? sample;
  const nextUnpaid = ordered.find((week) => week.some((court) => court.status === "pending"));
  const securedWeeks = ordered.filter((week) => week.every((court) => court.status === "confirmed")).length;
  const heldWeeks = ordered.length - securedWeeks;
  const horizon = sample.seriesWeeks || ordered.length;
  const due = nextUnpaid ? new Date(new Date(leadCourt(nextUnpaid).startTime).getTime() - 24 * 60 * 60 * 1000) : null;
  const dueSoon = due !== null && due.getTime() <= Date.now();
  const note = ordered.find((week) => week[0].repeatNote)?.[0].repeatNote;
  const [repeatBusy, setRepeatBusy] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [confirmSeries, setConfirmSeries] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesPreview, setSeriesPreview] = useState<SeriesCancelPreview | null>(null);
  const unpaidCourts = ordered.flat().filter((court) => court.status === "pending" && new Date(court.startTime).getTime() > Date.now()).length;

  async function removeSeries() {
    if (!confirmSeries) {
      setSeriesBusy(true);
      setSeriesError(null);
      try {
        setSeriesPreview(await deleteSeriesPreview(sample.groupId));
        setConfirmSeries(true);
      } catch (reason) {
        setSeriesError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The refund could not be checked." : "The refund could not be checked.");
      } finally {
        setSeriesBusy(false);
      }
      return;
    }
    setSeriesBusy(true);
    setSeriesError(null);
    try {
      await deleteSeries(sample.groupId);
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      setSeriesError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This booking could not be deleted." : "This booking could not be deleted.");
    } finally {
      setSeriesBusy(false);
    }
  }

  async function onRepeat(enabled: boolean) {
    setRepeatBusy(true);
    setRepeatError(null);
    try {
      const saved = await setCourtRepeat(sample.groupId, enabled);
      if (saved.note) setRepeatError(saved.note);
      onChanged();
    } catch (reason) {
      setRepeatError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This repeat could not be saved." : "This repeat could not be saved.");
    } finally {
      setRepeatBusy(false);
    }
  }

  return (
    <li className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left transition-colors hover:bg-fg/5" aria-expanded={open} onClick={onToggle}>
          <span className="flex items-start gap-2">
            <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-fg transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-medium text-fg">{sample.venueName}</span>
              <span className="mt-1 block text-sm text-fg">{sharedTime ? formatVenueRange(sample.startTime, sample.endTime, sample.timeZone) : <>Next session {formatWeekDate(nextCourt.startTime, nextCourt.timeZone)} · {formatVenueRange(nextCourt.startTime, nextCourt.endTime, nextCourt.timeZone)}</>}</span>
              <span className="mt-1 block text-sm leading-relaxed text-fg/80">{weekSpan(ordered)}. {ordered.length} {ordered.length === 1 ? "week" : "weeks"}{sharedTime ? " at this time" : ", each court at its current time"}.{sharedTime ? <> Next session {formatWeekDate(nextCourt.startTime, nextCourt.timeZone)}.</> : null}</span>
              <span className="mt-1 block text-sm text-fg">{securedWeeks} {securedWeeks === 1 ? "week" : "weeks"} secured · {heldWeeks} {heldWeeks === 1 ? "week" : "weeks"} held.{due ? dueSoon ? " The next session is inside 24 hours. Pay now to keep it." : ` Pay the next week before ${formatVenueDateTime(due.toISOString(), nextUnpaid ? leadCourt(nextUnpaid).timeZone : sample.timeZone)}.` : ""}</span>
            </span>
          </span>
        </button>
        <div className="flex w-full shrink-0 flex-col gap-2 rounded-xl border border-border bg-inset p-2 sm:w-auto">
          {nextUnpaid ? (
            <Link to={`/${sample.venueSlug}/book/group/${sample.groupId}?bookings=${nextUnpaid.filter((court) => court.status === "pending").map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:bg-lime-300 sm:w-auto">
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
              Pay next week
            </Link>
          ) : (
            <p className="text-sm font-semibold text-accent-text sm:pt-1">All weeks are paid.</p>
          )}
          <Button type="button" variant="danger" className="w-full sm:w-auto" loading={seriesBusy} disabled={seriesBusy || repeatBusy} onClick={() => void removeSeries()}>
            {confirmSeries ? "Confirm delete" : "Delete all weeks"}
          </Button>
        </div>
      </div>
      {confirmSeries && seriesPreview && !seriesBusy ? (
        <div className="mt-3 rounded-2xl border border-rose-300/40 bg-rose-500/10 p-3 sm:p-4" role="status">
          <p className="flex items-center gap-2 font-semibold text-rose-800 dark:text-rose-100">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Delete every week in this booking?
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-fg">
            {unpaidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-200" aria-hidden="true" />
                <span>{unpaidCourts} unpaid {unpaidCourts === 1 ? "court is" : "courts are"} released. Nothing is charged.</span>
              </li>
            ) : null}
            {seriesPreview.paidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <span>
                  {seriesPreview.paidCourts} paid {seriesPreview.paidCourts === 1 ? "court is" : "courts are"} cancelled. You paid <Money amount={seriesPreview.charged} currency={seriesPreview.currency} />.{" "}
                  <span className="font-semibold text-fg"><Money amount={seriesPreview.refund} currency={seriesPreview.currency} /> is refunded to your card.</span>
                </span>
              </li>
            ) : null}
            {seriesPreview.fee > 0 ? (
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-200" aria-hidden="true" />
                <span>
                  {seriesPreview.lateCourts} paid {seriesPreview.lateCourts === 1 ? "court starts" : "courts start"} within 24 hours, so the venue keeps{" "}
                  <span className="font-semibold text-rose-800 dark:text-rose-100"><Money amount={seriesPreview.fee} currency={seriesPreview.currency} /></span> ({Number(seriesPreview.feePercent.toFixed(2))}% late-cancel fee).
                </span>
              </li>
            ) : seriesPreview.paidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <span>Every paid court is more than 24 hours away, so the refund is in full.</span>
              </li>
            ) : null}
            {seriesPreview.pointsBack > 0 || seriesPreview.pointsKept > 0 ? (
              <li className="flex items-start gap-2">
                <Gift className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <span>
                  {seriesPreview.pointsBack > 0 ? `${seriesPreview.pointsBack} points come back to your balance.` : ""}
                  {seriesPreview.pointsBack > 0 && seriesPreview.pointsKept > 0 ? " " : ""}
                  {seriesPreview.pointsKept > 0 ? `${seriesPreview.pointsKept} points are kept by the venue.` : ""}
                </span>
              </li>
            ) : null}
            <li className="flex items-start gap-2">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-fg/70" aria-hidden="true" />
              <span>Keep weeks ahead is turned off, so no week is added back.</span>
            </li>
          </ul>
          <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => { setConfirmSeries(false); setSeriesPreview(null); }}>Keep all weeks</Button>
        </div>
      ) : null}
      {seriesError ? <p className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-800 dark:text-rose-100" role="alert">{seriesError}</p> : null}
      {open ? (
        <div className="mt-4">
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-1 accent-accent-text" checked={Boolean(sample.repeatHold)} disabled={repeatBusy} onChange={(event) => void onRepeat(event.target.checked)} />
            <span>Keep {horizon} {horizon === 1 ? "week" : "weeks"} ahead. When one week starts, the next free week is held for you. You still pay each week before 24 hours of that session.</span>
          </label>
          {repeatBusy ? <span className="mt-2 inline-flex items-center gap-2 text-sm text-fg" role="status"><Spinner className="h-3.5 w-3.5" /> Saving repeat</span> : null}
          {note ? <p className="mt-2 text-sm text-fg" role="status">{note}</p> : null}
          {repeatError && repeatError !== note ? <p className="mt-2 text-sm text-fg" role="alert">{repeatError}</p> : null}
          <p className="mt-3 text-sm text-fg/75">No deposit. Open one week to change its courts. Pay that week before 24 hours of the session, or those courts are released.</p>
          <ul className="mt-3 space-y-2">
            {ordered.map((courts) => {
              const yearWeek = weekOfYear(courts[0].startTime, courts[0].timeZone);
              const key = `${courts[0].groupId}|${yearWeek.year}-W${yearWeek.week}`;
              const slots = timeGroups(courts);
              const amount = courts.reduce((sum, court) => sum + court.price, 0);
              const opened = openWeek === key;
              const payNote = weekPayNote(courts);
              const allPaid = payNote === null;
              return (
                <li key={key} className={`rounded-xl border border-l-4 border-fg/10 ${allPaid ? "border-l-accent/70" : "border-l-amber-300/70"}`}>
                  <button type="button" className="flex w-full flex-col gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/10 sm:flex-row sm:items-center sm:justify-between" aria-expanded={opened} onClick={() => onOpenWeek(opened ? null : key)}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">Week {yearWeek.week} of {yearWeek.year}</span>
                        <WeekPayStatus courts={courts} />
                      </span>
                      {slots.map((slot) => (
                        <span key={`${slot[0].startTime}|${slot[0].endTime}`} className="mt-1 flex items-start gap-1.5 text-sm text-fg/75">
                          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg/60" aria-hidden="true" />
                          <span>{slots.length > 1 ? `${slot.map((court) => court.courtName).join(", ")} · ` : ""}{formatWeekDate(slot[0].startTime, slot[0].timeZone)} · {formatVenueRange(slot[0].startTime, slot[0].endTime, slot[0].timeZone)} · {slot.length} {slot.length === 1 ? "court" : "courts"}</span>
                        </span>
                      ))}
                      {payNote ? <span className="block text-sm text-amber-800/90 dark:text-amber-100/90">{payNote}</span> : null}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold text-fg"><Money amount={amount} currency={courts[0].currency} /></span>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-fg">
                        {opened ? "Hide courts" : "Show courts"}
                        <ChevronDown className={`h-4 w-4 transition-transform ${opened ? "rotate-180" : ""}`} aria-hidden="true" />
                      </span>
                    </span>
                  </button>
                  {opened ? (
                    <div className="space-y-3 px-3 pb-3">
                      {slots.map((slot) => (
                        <WeekEditor
                          key={slot.map((court) => court.bookingId).join("-")}
                          courts={slot}
                          pendingTopUp={topUps.filter((row) => { const source = topUpSource(row.cancelReason); return source !== null && Math.abs(source - new Date(slot[0].startTime).getTime()) < 2000; })}
                          onChanged={onChanged}
                        />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}


