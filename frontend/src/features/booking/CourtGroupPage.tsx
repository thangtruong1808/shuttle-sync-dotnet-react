import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ArrowRight, CalendarDays, CircleCheck } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { Button, Skeleton } from "../../components/ui";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { bookingPayment, type BookingPayment } from "../profile/profileApi";
import { courtHold, startGroupCheckout, venuePromotions, type CourtHoldSession, type Promotion } from "../venues/venueApi";

const checkoutKey = "shuttle-sync-checkout";
const pointPercents = [25, 50, 75, 100] as const;

function quote(requested: number, balance: number, rate: number, price: number) {
  const safeRate = rate < 1 ? 100 : rate;
  const points = Math.min(Math.max(0, Math.floor(requested)), Math.max(balance, 0), price <= 0 ? 0 : Math.floor(price * safeRate));
  const value = Math.floor((points * 100) / safeRate) / 100;
  const used = value <= 0 ? 0 : points;
  const cash = Math.round((price - (value <= 0 ? 0 : value)) * 100) / 100;
  return { points: used, value: value <= 0 ? 0 : value, cash };
}

function promoDiscount(price: number, promo: Promotion | null) {
  if (!promo) return 0;
  const amount = promo.discountType === "percent" ? Math.round(price * promo.discountValue) / 100 : promo.discountValue;
  return Math.min(price, Math.max(0, amount));
}

async function waitForBooking(id: string): Promise<BookingPayment> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await bookingPayment(id);
    if (row.status === "confirmed" || row.status === "expired" || row.paymentStatus === "failed") {
      return row;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return bookingPayment(id);
}

export default function CourtGroupPage() {
  const { slug = "", groupId = "" } = useParams();
  const location = useLocation();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const [sessions, setSessions] = useState<CourtHoldSession[] | null>(null);
  const [timeZone, setTimeZone] = useState("Australia/Melbourne");
  const [currency, setCurrency] = useState("AUD");
  const [rate, setRate] = useState(100);
  const [fee, setFee] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [points, setPoints] = useState(0);
  const [paying, setPaying] = useState(false);
  const [outcome, setOutcome] = useState<BookingPayment | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [promoNote, setPromoNote] = useState<string | null>(null);
  const [heldNote] = useState(() => {
    const note = sessionStorage.getItem("shuttle-sync-held-note");
    if (note) sessionStorage.removeItem("shuttle-sync-held-note");
    return note;
  });
  const [picked, setPicked] = useState<string[]>([]);
  const checkoutState = new URLSearchParams(location.search).get("checkout");

  useEffect(() => {
    setError(null);
    setSessions(null);
    courtHold(slug, groupId)
      .then((hold) => {
        if (hold.released) {
          setSessions([]);
          setError("That payment was not finished, so the courts due within 24 hours were released. Later weeks stay in My bookings.");
          return;
        }
        setSessions(hold.sessions);
        setTimeZone(hold.timeZone);
        setCurrency(hold.currency);
        setRate(hold.pointsPerDollar || 100);
        setFee(hold.lateCancelFeePercent);
        const requested = new URLSearchParams(window.location.search).get("bookings")?.split(",").filter(Boolean) ?? [];
        const pending = hold.sessions.filter((session) => session.status === "pending");
        const week = pending.find((session) => requested.includes(session.bookingId))?.startTime ?? pending[0]?.startTime;
        setPicked(pending.filter((session) => session.startTime === week && (requested.length === 0 || requested.includes(session.bookingId))).map((session) => session.bookingId));
      })
      .catch(() => setError("This court hold could not be loaded."));
  }, [slug, groupId, attempt]);

  useEffect(() => {
    venuePromotions(slug).then(setPromotions).catch(() => setPromotions([]));
  }, [slug]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const returned = params.get("checkout");
    if (returned === "cancel" && status === "authenticated") {
      setFormError("Payment was cancelled. The courts stay held until 24 hours before each session.");
      return;
    }
    if ((returned !== "success" && !params.get("redirect_status")) || status !== "authenticated") {
      return;
    }
    const id = sessionStorage.getItem(checkoutKey);
    if (!id) {
      return;
    }
    let active = true;
    setWaiting(true);
    waitForBooking(id)
      .then((row) => {
        if (!active) return;
        setOutcome(row);
        void dispatch(loadCurrentUser());
        setAttempt((value) => value + 1);
      })
      .catch(() => {
        if (active) setFormError("The payment status could not be checked.");
      })
      .finally(() => {
        if (active) setWaiting(false);
      });
    return () => {
      active = false;
    };
  }, [dispatch, location.search, status]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const unpaid = (sessions ?? []).filter((session) => session.status === "pending" && picked.includes(session.bookingId));
  const subtotal = unpaid.reduce((sum, session) => sum + session.price, 0);
  const discount = promoDiscount(subtotal, appliedCode);
  const payable = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const maxPoints = Math.min(balance, payable <= 0 ? 0 : Math.floor(payable * rate));
  const preview = sessions ? quote(Math.min(points, maxPoints), balance, rate, payable) : null;
  const cashTooSmall = preview ? preview.cash > 0 && preview.cash < 0.5 : false;
  const incentive = unpaid.reduce((sum, session) => sum + session.incentivePoints, 0);

  async function onPay() {
    if (!preview || unpaid.length === 0) return;
    setFormError(null);
    if (cashTooSmall) {
      setFormError("Use enough points to cover these courts, or leave at least $0.50 to pay.");
      return;
    }
    setPaying(true);
    try {
      const result = await startGroupCheckout(slug, groupId, preview.points, appliedCode?.code ?? "", unpaid.map((session) => session.bookingId));
      sessionStorage.setItem(checkoutKey, result.bookingId);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.status === "confirmed" || result.cashAmount === 0) {
        setOutcome({
          id: result.bookingId,
          status: result.status,
          paymentStatus: result.status === "confirmed" ? "succeeded" : null,
          currency: result.currency,
          cashAmount: result.cashAmount,
          pointsRedeemed: result.pointsRedeemed,
          pointsValue: result.pointsValue,
        });
        void dispatch(loadCurrentUser());
        setAttempt((value) => value + 1);
      }
    } catch (reason) {
      setFormError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The payment could not be started." : "The payment could not be started.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
      <Link to={`/${slug}/book`} className="text-sm text-line hover:underline">Back to booking</Link>
      <h1 className="mt-3 font-display text-3xl text-white">Pay one week</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/75">There is no deposit and you do not have to pay every later week today. Tick the courts for one week, then pay that week. A week that starts within 24 hours is paid once, when you register.</p>
      {status === "unknown" || (!sessions && !error) ? (
        <div className="mt-6 space-y-2" aria-busy="true">
          <span className="sr-only">Loading court hold</span>
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
      ) : sessions && preview ? (
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-pine/80 p-4 sm:p-5">
            <h2 className="font-display text-2xl text-white">Sessions</h2>
            <ul className="mt-3 grid gap-2">
              {sessions.map((session) => {
                const selected = picked.includes(session.bookingId);
                const pending = session.status === "pending";
                return (
                  <li key={session.bookingId} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                    <label className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex min-w-0 items-start gap-2">
                        {pending ? (
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-line"
                            checked={selected}
                            disabled={paying || waiting}
                            onChange={() => {
                              setPoints(0);
                              setPicked((current) => {
                                const currentWeek = sessions.find((item) => current.includes(item.bookingId))?.startTime;
                                if (currentWeek && currentWeek !== session.startTime) {
                                  return [session.bookingId];
                                }
                                return selected ? current.filter((id) => id !== session.bookingId) : [...current, session.bookingId];
                              });
                            }}
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block font-medium text-white">{session.courtName}</span>
                          <span className="block text-sm text-mist/70">{formatVenueDateTime(session.startTime, timeZone)} – {formatVenueDateTime(session.endTime, timeZone)}</span>
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-white"><Money amount={session.price} currency={currency} /></span>
                        <span className="block text-xs text-mist/60">{session.status === "confirmed" ? "Secured" : session.payNow ? "Pay now" : "Held"}</span>
                      </span>
                    </label>
                    {session.incentivePoints > 0 && pending ? <p className="mt-1 text-sm text-line">+{session.incentivePoints} pts after this session ends</p> : null}
                  </li>
                );
              })}
            </ul>
            {unpaid.some((session) => session.payNow) ? <p className="mt-3 text-sm text-mist/75">A session starting within 24 hours is only held for 30 minutes. Pay now to keep it.</p> : null}
          </section>
          <section className="rounded-3xl border border-white/10 bg-pine/80 p-4 sm:p-5">
            {checkoutState === "success" || sessions.every((session) => session.status !== "pending") ? (
              <div className="space-y-3" role="status">
                <p className="flex items-center gap-2 font-semibold text-line">
                  <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {waiting ? "Checking the payment…" : "This week is paid."}
                </p>
                {heldNote ? <p className="text-sm leading-relaxed text-mist/80">{heldNote}</p> : null}
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  View my bookings
                </Link>
              </div>
            ) : checkoutState === "cancel" ? (
              <p className="text-sm leading-relaxed text-mist" role="status">{formError ?? "Payment was cancelled. Courts due within 24 hours were released. Later weeks stay in My bookings."}</p>
            ) : (
              <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onPay(); }}>
                {outcome?.status === "confirmed" ? <p className="text-sm font-semibold text-line" role="status">That week is secured. Choose another week when you are ready.</p> : null}
                <div>
                  <p className="text-sm text-mist/80">Promotion code</p>
                  {promotions === null ? (
                    <div className="mt-2" aria-busy="true"><span className="sr-only">Loading promotion codes</span><Skeleton className="h-14" /></div>
                  ) : promotions.length > 0 ? (
                    <ul className="mt-2 grid gap-2">
                      {promotions.map((promotion) => {
                        const selected = appliedCode?.id === promotion.id;
                        return (
                          <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${selected ? "border-line/60 bg-line/10" : "border-white/10 bg-black/20"}`}>
                            <div className="min-w-0">
                              <p className="break-all font-semibold text-white">{promotion.code}</p>
                              <p className="text-sm text-line">{promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}</p>
                            </div>
                            <Button type="button" variant={selected ? "primary" : "secondary"} className="w-full sm:w-auto" disabled={paying || waiting} onClick={() => { setAppliedCode(selected ? null : promotion); setPromoNote(selected ? null : `${promotion.code} applied.`); }}>
                              {selected ? "Applied" : "Apply"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="mt-2 text-sm text-mist/70">No active promotion codes right now.</p>}
                  {promoNote ? <p className="mt-2 text-sm text-mist" role="status">{promoNote}</p> : null}
                </div>
                <div>
                  <p className="text-sm text-mist/80">Reward points</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pointPercents.map((percent) => (
                      <button key={percent} type="button" disabled={paying || waiting || maxPoints === 0} className={`rounded-full px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-line text-ink" : "border border-white/15 text-mist"}`} onClick={() => setPoints(Math.floor(maxPoints * percent / 100))}>
                        {percent}%
                      </button>
                    ))}
                  </div>
                  <input type="range" min={0} max={Math.max(maxPoints, 1)} step={1} value={Math.min(points, maxPoints)} disabled={paying || waiting || maxPoints === 0} aria-label="Reward points" className="mt-3 w-full accent-line disabled:opacity-60" onChange={(event) => setPoints(Number(event.target.value))} />
                  <p className="mt-1 text-sm text-mist/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {currency} 1.</p>
                </div>
                <dl className="grid gap-1 text-sm text-mist/80">
                  <div className="flex justify-between gap-3"><dt>{unpaid.length} {unpaid.length === 1 ? "session" : "sessions"}</dt><dd><Money amount={subtotal} currency={currency} /></dd></div>
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={currency} /></dd></div>
                  <div className="flex justify-between gap-3 font-semibold text-white"><dt>To pay</dt><dd><Money amount={preview.cash} currency={currency} /></dd></div>
                </dl>
                {incentive > 0 ? <p className="text-sm font-semibold text-line">+{incentive} pts after these sessions end, once they are paid.</p> : null}
                <p className="text-sm text-mist/70">More than 24 hours before a session, a paid court is refunded in full. Within 24 hours, the venue keeps {Number(fee.toFixed(2))}%.</p>
                {cashTooSmall ? <p className="text-sm text-mist">Use enough points to cover these courts, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                {waiting ? <p className="text-sm text-mist" role="status">Checking the payment…</p> : null}
                <Button type="submit" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={paying || waiting} disabled={cashTooSmall || unpaid.length === 0}>
                  {preview.cash === 0 ? "Secure with points" : "Pay and secure"}
                </Button>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
