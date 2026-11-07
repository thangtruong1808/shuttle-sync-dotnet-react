import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, Tag } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, venueToday } from "../../components/format";
import { useVenues } from "../../components/layout/SiteLayout";
import { Alert, Button, controlClass, Field, PickerInput, Select, Skeleton, Spinner } from "../../components/ui";
import { AuthRequestError } from "../auth/authApi";
import { abandonCourtCheckout, courtPrice, forgetOpenCheckout, openCourtHold, payNowHold, readOpenCheckout, rememberOpenCheckout, rememberVenueSlug, venueAvailability, venuePromotions, type AvailableCourt, type CourtRateLine, type Promotion, type ScheduleClosure } from "../venues/venueApi";
import { courtBusyLabel, pointsQuote, promoDiscount, sessionAmount, shownHoldError, startsWithin24Hours, unavailableReason } from "./bookingMath";
import { PayBar, Step, summaryAside, summaryLines } from "./checkoutUi";
import { WeekExtendPage } from "./WeekExtendPage";

const pointPercents = [25, 50, 75, 100] as const;

function FreshCourtBooking() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const [prefill] = useState(() => {
    const params = new URLSearchParams(location.search);
    const weeks = Number(params.get("weeks"));
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date") ?? "" : "",
      start: /^\d{2}:\d{2}$/.test(params.get("start") ?? "") ? params.get("start") ?? "" : "",
      end: /^\d{2}:\d{2}$/.test(params.get("end") ?? "") ? params.get("end") ?? "" : "",
      courtIds: (params.get("courts") ?? "").split(",").filter(Boolean),
      weeks: Number.isInteger(weeks) && weeks >= 1 && weeks <= 12 ? weeks : 1,
      repeat: params.get("repeat") === "1",
    };
  });
  const [date, setDate] = useState(prefill.date);
  const [form, setForm] = useState({ courtIds: prefill.courtIds, start: prefill.start, end: prefill.end, weeks: prefill.weeks, repeat: prefill.repeat });
  const [courts, setCourts] = useState<AvailableCourt[] | null>(null);
  const [closures, setClosures] = useState<ScheduleClosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [quoted, setQuoted] = useState<number | null>(null);
  const [rateLines, setRateLines] = useState<CourtRateLine[]>([]);
  const [scheduledRate, setScheduledRate] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [droppedNote, setDroppedNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [points, setPoints] = useState(0);

  useEffect(() => {
    if (!slug || status !== "authenticated") return;
    let active = true;
    venuePromotions(slug)
      .then((next) => { if (active) setPromotions(next); })
      .catch(() => { if (active) setPromotions([]); });
    return () => {
      active = false;
    };
  }, [slug, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    function release() {
      setBusy(false);
      const open = readOpenCheckout();
      if (!open) return;
      setReleasing(true);
      abandonCourtCheckout(open.slug, open.groupId)
        .catch(() => undefined)
        .finally(() => {
          forgetOpenCheckout();
          if (!active) return;
          setReleasing(false);
          setAttempt((value) => value + 1);
        });
    }
    function onShow(event: PageTransitionEvent) {
      if (event.persisted) release();
    }
    release();
    window.addEventListener("pageshow", onShow);
    return () => {
      active = false;
      window.removeEventListener("pageshow", onShow);
    };
  }, [status]);

  useEffect(() => {
    if (venue) {
      setDate((current) => current || venueToday(venue.timeZone));
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !date) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    venueAvailability(slug, date, "", "")
      .then((next) => {
        if (controller.signal.aborted) return;
        setCourts(next.courts);
        setClosures(next.closures ?? []);
        setForm((current) => ({
          ...current,
          courtIds: current.courtIds.filter((id) => next.courts.some((court) => court.id === id)),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Courts could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, date, attempt]);

  useEffect(() => {
    if (!courts) return;
    const timeZone = venue?.timeZone ?? "Australia/Melbourne";
    const busyIds = new Set(courts.filter((court) => courtBusyLabel(court, closures, date, form.start, form.end, timeZone)).map((court) => court.id));
    if (busyIds.size === 0) return;
    setForm((current) => {
      const dropped = current.courtIds.filter((id) => busyIds.has(id));
      if (dropped.length === 0) return current;
      const names = courts.filter((court) => dropped.includes(court.id)).map((court) => court.courtName);
      setDroppedNote(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} already taken at this time, so we unticked ${names.length === 1 ? "it" : "them"}.`);
      return { ...current, courtIds: current.courtIds.filter((id) => !busyIds.has(id)) };
    });
  }, [courts, closures, date, form.start, form.end, venue?.timeZone]);

  useEffect(() => {
    if (!slug || !date || !form.start || !form.end) {
      setQuoted(null);
      setRateLines([]);
      setScheduledRate(false);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    courtPrice(slug, date, form.start, form.end, form.weeks)
      .then((result) => {
        if (controller.signal.aborted) return;
        setQuoted(result.courtAmount);
        setRateLines(result.lines ?? []);
        setScheduledRate(result.scheduled);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setQuoted(null);
        setRateLines([]);
        setScheduledRate(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoting(false);
      });
    return () => controller.abort();
  }, [slug, date, form.start, form.end, form.weeks]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }

  const rate = venue?.hourlyRate ?? 0;
  const currency = venue?.currency ?? "AUD";
  const flat = sessionAmount(form.start, form.end, rate);
  const each = quoted ?? (flat === null ? null : flat * form.weeks);
  const payAtRegistration = startsWithin24Hours(date, form.start, venue?.timeZone ?? "Australia/Melbourne");
  const pointsRate = venue?.pointsPerDollar || 100;
  const weekSubtotal = each === null || form.courtIds.length === 0 ? 0 : Math.round((each / Math.max(form.weeks, 1)) * form.courtIds.length * 100) / 100;
  const weekDiscount = promoDiscount(weekSubtotal, appliedCode);
  const weekPayable = Math.max(0, Math.round((weekSubtotal - weekDiscount) * 100) / 100);
  const maxPoints = Math.min(balance, weekPayable <= 0 ? 0 : Math.floor(weekPayable * pointsRate));
  const payPreview = pointsQuote(Math.min(points, maxPoints), balance, pointsRate, weekPayable);
  const showPayOptions = weekSubtotal > 0;
  const cashTooSmall = showPayOptions && payPreview.cash > 0 && payPreview.cash < 0.5;
  const fullTotal = each === null ? 0 : Math.round(each * form.courtIds.length * 100) / 100;
  const weekSavings = showPayOptions ? Math.round((weekDiscount + payPreview.value) * 100) / 100 : 0;
  const totalAfterSavings = Math.max(0, Math.round((fullTotal - weekSavings) * 100) / 100);

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const blocked = unavailableReason(courts ?? [], closures, form.courtIds, date, form.start, form.end, venue?.timeZone ?? "Australia/Melbourne");
    if (blocked) {
      setFormError(blocked);
      return;
    }
    if (cashTooSmall) {
      setFormError("Use enough points to cover this week, or leave at least $0.50 to pay.");
      return;
    }
    setBusy(true);
    try {
      if (payAtRegistration) {
        const result = await payNowHold(slug, form.courtIds, date, form.start, form.end, form.repeat, form.weeks, undefined, { points: payPreview.points, promotionCode: appliedCode?.code });
        sessionStorage.setItem("shuttle-sync-checkout", result.bookingId);
        if (result.checkoutUrl) {
          rememberOpenCheckout(slug, result.groupId);
          window.location.assign(result.checkoutUrl);
          return;
        }
        navigate(`/${slug}/book/group/${result.groupId}?checkout=success`);
        return;
      }
      const opened = await openCourtHold(slug, form.courtIds, date, form.start, form.end, form.weeks, form.repeat);
      navigate(`/${slug}/book/group/${opened.groupId}`, { state: { promotionCode: appliedCode?.code, points: payPreview.points } });
    } catch (reason) {
      sessionStorage.removeItem("shuttle-sync-held-note");
      setFormError(shownHoldError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] : undefined));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = payAtRegistration ? (showPayOptions && payPreview.cash === 0 ? "Pay this week with points" : "Pay this week now") : "Continue";
  const canSubmit = !(busy || releasing || loading || quoting || cashTooSmall || form.courtIds.length === 0 || !date || !form.start || !form.end);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link to={`/${slug}`} className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">Back to the venue</Link>
      <h1 className="mt-2 font-display text-3xl font-semibold text-fg">Book a court</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">Choose the courts and the time you want each week. A week that starts in more than 24 hours can be held, and you pay it before that session. A week that starts within 24 hours is not saved unless you pay for it now.</p>
      {status === "unknown" || (!date && !venue) ? (
        <div className="mt-6" aria-busy="true">
          <span className="sr-only">Loading booking form</span>
          <Skeleton className="h-28" />
        </div>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <form id="book-court" className="grid gap-4" onSubmit={onContinue}>
            <Step index={1} title="Date and time">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date">
                  {({ id }) => (
                    <span className="relative block">
                      <PickerInput id={id} type="date" required value={date} disabled={busy || loading} onChange={(event) => { setFormError(null); setDate(event.target.value); }} className={controlClass} />
                      {loading ? <Spinner className="absolute right-10 top-1/2 h-3.5 w-3.5 -translate-y-1/2" /> : null}
                    </span>
                  )}
                </Field>
                <Field label="Start" required>
                  {({ id }) => <PickerInput id={id} type="time" required value={form.start} disabled={busy} onChange={(event) => { setFormError(null); setForm({ ...form, start: event.target.value }); }} className={controlClass} />}
                </Field>
                <Field label="End" required>
                  {({ id }) => <PickerInput id={id} type="time" required value={form.end} disabled={busy} onChange={(event) => { setFormError(null); setForm({ ...form, end: event.target.value }); }} className={controlClass} />}
                </Field>
                <Field label="Weeks">
                  {({ id }) => (
                    <Select id={id} value={form.weeks} disabled={busy} onChange={(event) => setForm({ ...form, weeks: Number(event.target.value) })}>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((weeks) => (
                        <option key={weeks} value={weeks}>{weeks === 1 ? "This week only" : `${weeks} weeks`}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </Step>
            <Step index={2} title="Courts">
            <fieldset className="min-w-0">
              <legend className="sr-only">Courts</legend>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {(courts ?? []).map((court) => {
                  const taken = courtBusyLabel(court, closures, date, form.start, form.end, venue?.timeZone ?? "Australia/Melbourne");
                  const checked = !taken && form.courtIds.includes(court.id);
                  return (
                    <label
                      key={court.id}
                      title={taken ? `${court.courtName} is ${taken.toLowerCase()} at this time` : undefined}
                      className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${taken ? "cursor-not-allowed border-fg/5 bg-inset text-fg/40" : checked ? "border-accent-text/50 bg-accent/10 text-fg" : "border-fg/10 bg-inset text-fg"}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-accent-text"
                        checked={checked}
                        disabled={busy || loading || Boolean(taken)}
                        onChange={() => {
                          setFormError(null);
                          setDroppedNote(null);
                          setForm({
                            ...form,
                            courtIds: checked ? form.courtIds.filter((id) => id !== court.id) : [...form.courtIds, court.id],
                          });
                        }}
                      />
                      <span className={`truncate ${taken ? "line-through" : ""}`}>{court.courtName}</span>
                      {taken ? <span className="ml-auto shrink-0 rounded-full border border-fg/10 px-2 py-0.5 text-[11px] font-medium text-fg/60">{taken}</span> : null}
                    </label>
                  );
                })}
              </div>
              {droppedNote ? <Alert tone="warning" className="mt-3">{droppedNote}</Alert> : null}
            </fieldset>
            </Step>
            <Step index={3} title="Repeat">
              <label className="flex min-h-11 items-start gap-2.5 py-1 text-sm text-fg">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-accent-text"
                  checked={form.repeat}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, repeat: event.target.checked })}
                />
                <span>Keep {form.weeks} {form.weeks === 1 ? "week" : "weeks"} ahead. When one week passes, the next week is held automatically. You still pay each week before 24 hours of that session.</span>
              </label>
            </Step>
            {showPayOptions ? (
              <Step index={4} title="Promotion and points">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">Promotion code</p>
                    {promotions === null ? (
                      <div className="mt-2" aria-busy="true"><span className="sr-only">Loading promotion codes</span><Skeleton className="h-14" /></div>
                    ) : promotions.length > 0 ? (
                      <ul className="mt-2 grid gap-2">
                        {promotions.map((promotion) => {
                          const selected = appliedCode?.id === promotion.id;
                          return (
                            <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${selected ? "border-accent-text/60 bg-accent/10" : "border-border bg-inset"}`}>
                              <div className="min-w-0">
                                <p className="break-all font-semibold text-fg">{promotion.code}</p>
                                <p className="text-sm text-accent-text">{promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}</p>
                              </div>
                              <Button type="button" variant={selected ? "primary" : "secondary"} className="w-full sm:w-auto" disabled={busy || releasing} onClick={() => setAppliedCode(selected ? null : promotion)}>
                                {selected ? "Applied" : "Apply"}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="mt-2 text-sm text-fg-muted">No active promotion codes right now.</p>}
                    {appliedCode ? <p className="mt-2 text-sm text-fg" role="status">{appliedCode.code} applied.</p> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">Reward points</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pointPercents.map((percent) => (
                        <button key={percent} type="button" disabled={busy || releasing || maxPoints === 0} className={`min-h-11 min-w-11 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-accent text-accent-fg hover:bg-lime-300" : "border border-border text-fg hover:bg-fg/5"}`} onClick={() => setPoints(Math.floor(maxPoints * percent / 100))}>
                          {percent}%
                        </button>
                      ))}
                    </div>
                    <input type="range" min={0} max={Math.max(maxPoints, 1)} step={1} value={Math.min(points, maxPoints)} disabled={busy || releasing || maxPoints === 0} aria-label="Reward points" className="mt-3 w-full accent-accent-text disabled:opacity-60" onChange={(event) => setPoints(Number(event.target.value))} />
                    <p className="mt-1 text-sm text-fg-muted">{Math.min(points, maxPoints)} of {balance} points. {pointsRate} points = {currency} 1.</p>
                    {!payAtRegistration ? <p className="mt-2 text-sm text-fg-muted">Your code and points carry over to the next step, where you can pay this week now or later from My bookings.</p> : null}
                    {cashTooSmall ? <p className="mt-2 text-sm text-fg">Use enough points to cover this week, or leave at least $0.50 to pay.</p> : null}
                  </div>
                </div>
              </Step>
            ) : null}
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            {releasing ? (
              <p className="flex items-center gap-2 text-sm text-fg" role="status">
                <Spinner className="h-4 w-4" /> You left the Stripe page before paying. Releasing that payment so you can book again.
              </p>
            ) : null}
            {error ? <ErrorState message={error} loading={loading} onRetry={() => setAttempt((value) => value + 1)} /> : null}
          </form>
          <aside className={summaryAside}>
            <h2 className="font-display text-lg font-semibold text-fg">Order summary</h2>
            {form.weeks > 1 && rateLines.length > 0 ? <p className="mt-3 text-sm text-fg-muted">Hours below are for one court across {form.weeks} weeks.</p> : null}
            <dl className={`mt-4 ${summaryLines}`}>
              {rateLines.map((line) => {
                const scale = form.weeks > 1 || form.courtIds.length === 0 ? 1 : form.courtIds.length;
                const amount = Math.round(line.amount * scale * 100) / 100;
                const suffix = form.weeks > 1 ? "" : form.courtIds.length > 1 ? ` × ${form.courtIds.length} courts` : form.courtIds.length === 0 ? ", each court" : "";
                return (
                  <div key={`${line.scheduled}-${line.start}-${line.end}-${line.hourlyRate}-${line.minutes}`} className="flex justify-between gap-3">
                    <dt>{rateLineLabel(line)}{suffix}</dt>
                    <dd className="text-fg"><Money amount={amount} currency={currency} /></dd>
                  </div>
                );
              })}
              <div className="flex justify-between gap-3"><dt>This week, {form.courtIds.length} {form.courtIds.length === 1 ? "court" : "courts"}</dt><dd className="text-fg"><Money amount={weekSubtotal} currency={currency} /></dd></div>
              {weekDiscount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={weekDiscount} currency={currency} /></dd></div> : null}
              <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={payPreview.value} currency={currency} /></dd></div>
              <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2 font-semibold text-fg"><dt>{payAtRegistration ? "To pay now" : "To pay for this week"}</dt><dd><Money amount={payPreview.cash} currency={currency} /></dd></div>
            </dl>
            <div className="mt-4 text-sm leading-relaxed text-fg-muted">
              {each === null || form.courtIds.length === 0 ? (
                <p>Choose at least 30 minutes and one court. You can hold the same time for up to 12 weeks.</p>
              ) : (
                <>
                  <p className="font-semibold text-fg">
                    Total for every selected court and week: <span className="tabular-nums"><Money amount={totalAfterSavings} currency={currency} /></span>
                    {weekSavings > 0 ? <span className="ml-2 font-normal text-fg-muted line-through"><Money amount={fullTotal} currency={currency} /></span> : null}
                  </p>
                  {weekSavings > 0 ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-accent-text">
                      <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>You save <Money amount={weekSavings} currency={currency} /> on this week with {weekDiscount > 0 && payPreview.value > 0 ? "your promotion code and points" : weekDiscount > 0 ? "your promotion code" : "your points"}.</span>
                    </p>
                  ) : null}
                  <p className="mt-1">You do not pay every later week now. Each of those weeks is held until 24 hours before it starts. {scheduledRate ? "This total uses the venue rate for the days and hours you chose. " : ""}{payAtRegistration ? "The first week starts within 24 hours, so it is not held. Pay for that week now or those courts stay open." : "Pay each week before 24 hours of that session, or those courts are released."} {quoting ? <Spinner className="inline h-3.5 w-3.5" /> : null}</p>
                </>
              )}
            </div>
            <PayBar total={each !== null && form.courtIds.length > 0 ? <><span>Total</span><Money amount={payAtRegistration ? payPreview.cash : totalAfterSavings} currency={currency} /></> : undefined}>
              <Button type="submit" form="book-court" className="w-full" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={busy || releasing} disabled={!canSubmit}>
                {submitLabel}
              </Button>
            </PayBar>
          </aside>
        </div>
      )}
    </main>
  );
}

const rateDayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function rateLineLabel(line: CourtRateLine) {
  const hours = Math.floor(line.minutes / 60);
  const rest = line.minutes % 60;
  const length = [hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
  if (!line.scheduled) return `Standard rate · ${length}`;
  const selected = line.days.map((on, index) => (on ? index : -1)).filter((index) => index >= 0);
  const days = selected.length === 7
    ? "Every day"
    : selected.join(",") === "0,1,2,3,4"
      ? "Weekdays"
      : selected.join(",") === "5,6"
        ? "Weekends"
        : selected.map((index) => rateDayNames[index]).join(", ");
  return `${days}, ${rateClock(line.start)}–${rateClock(line.end)} · ${length}`;
}

function rateClock(value: string) {
  const [hourText, minuteText = "00"] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export default function BookCourtPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const groupId = new URLSearchParams(location.search).get("groupId");
  if (groupId) return <WeekExtendPage slug={slug} groupId={groupId} search={location.search} />;
  return <FreshCourtBooking />;
}
