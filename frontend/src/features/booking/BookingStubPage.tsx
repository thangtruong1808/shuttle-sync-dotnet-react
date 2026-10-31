import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ArrowRight, CalendarDays, CircleCheck, Clock } from "lucide-react";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { Alert, Button, Skeleton, Spinner } from "../../components/ui";
import { PayBar, summaryAside, summaryLines } from "./checkoutUi";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { bookingPayment, refreshUnpaidHolds, type BookingPayment } from "../profile/profileApi";
import { startCheckout, venuePromotions, venueSlot, type CourtSlotDetail, type Promotion } from "../venues/venueApi";
import { PaymentResultBanner, paymentOutcomeKind, paymentSettled, useCleanReturnUrl } from "./PaymentResultBanner";
import { pointsQuote as quote, promoDiscount } from "./bookingMath";

const checkoutKey = "shuttle-sync-checkout";
const pointPercents = [25, 50, 75, 100] as const;

function percentLabel(value: number) {
  return Number(value.toFixed(2)).toString();
}

async function waitForBooking(id: string): Promise<BookingPayment> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await bookingPayment(id);
    if (paymentSettled(row)) {
      return row;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return bookingPayment(id);
}

export default function BookingStubPage() {
  const { slug = "", sessionId = "" } = useParams();
  const location = useLocation();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const [slot, setSlot] = useState<CourtSlotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [points, setPoints] = useState(0);
  const [paying, setPaying] = useState(false);
  const [outcome, setOutcome] = useState<BookingPayment | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [promoNote, setPromoNote] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setSlot(null);
    venueSlot(slug, sessionId)
      .then(setSlot)
      .catch(() => setError("This slot could not be loaded."))
      .finally(() => setRetrying(false));
  }, [slug, sessionId, attempt]);

  useEffect(() => {
    venuePromotions(slug).then(setPromotions).catch(() => setPromotions([]));
  }, [slug]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const returned = params.get("checkout");
    if (returned === "cancel" && status === "authenticated") {
      setFormError("Payment was cancelled on Stripe. You can try again.");
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
        refreshUnpaidHolds();
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

  useCleanReturnUrl(waiting, outcome);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }

  const rate = slot?.venue.pointsPerDollar || 100;
  const fee = slot?.venue.lateCancelFeePercent ?? 0;
  const discount = slot ? promoDiscount(slot.price, appliedCode) : 0;
  const payable = slot ? Math.max(0, Math.round((slot.price - discount) * 100) / 100) : 0;
  const maxPoints = Math.min(balance, payable <= 0 ? 0 : Math.floor(payable * rate));
  const preview = slot ? quote(Math.min(points, maxPoints), balance, rate, payable) : null;
  const cashTooSmall = preview ? preview.cash > 0 && preview.cash < 0.5 : false;

  function choosePercent(percent: number) {
    setPoints(Math.floor(maxPoints * percent / 100));
  }

  async function onPay() {
    if (!slot || !preview) return;
    setFormError(null);
    if (cashTooSmall) {
      setFormError("Use enough points to cover the booking, or leave at least $0.50 to pay.");
      return;
    }
    setPaying(true);
    try {
      const result = await startCheckout(slug, sessionId, preview.points, appliedCode?.code ?? "");
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
        refreshUnpaidHolds();
      }
    } catch (reason) {
      setFormError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The booking could not be started." : "The booking could not be started.");
    } finally {
      setPaying(false);
    }
  }

  const outcomeKind = outcome ? paymentOutcomeKind(outcome) : null;
  const paymentFailed = outcomeKind === "failed" || outcomeKind === "cancelled";
  const paymentProcessing = outcomeKind === "processing";
  const paidView = Boolean(outcome?.status === "confirmed" || waiting || paymentProcessing);

  return (
    <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
      <Link to={`/${slug}/courts`} className="text-sm text-accent-text hover:underline">Back to courts</Link>
      <h1 className="mt-3 flex items-center gap-2 font-display text-3xl text-fg">
        {waiting || paymentProcessing ? <Spinner className="h-7 w-7 shrink-0 text-accent-text" /> : outcome?.status === "confirmed" ? <CircleCheck className="h-8 w-8 shrink-0 text-accent-text" aria-hidden="true" /> : null}
        <span>{waiting ? "Checking your payment" : paymentFailed ? "Payment not confirmed" : paymentProcessing ? "Waiting for bank confirmation" : outcome?.status === "confirmed" ? "Court secured" : "Checkout"}</span>
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">
        {waiting
          ? "We are checking with Stripe. The court is only saved after Stripe confirms the payment — please wait."
          : paymentFailed
            ? "That payment did not go through. The court was not booked."
            : paymentProcessing
              ? "Stripe has the payment, but the bank has not confirmed it yet. The court stays held until confirmation."
              : paidView
                ? "Your court is secured. You can review it in My bookings."
                : "Review the session, apply rewards or a promotion, then pay securely with Stripe."}
      </p>
      {waiting ? <PaymentResultBanner kind="waiting" subject="court" className="mt-6 max-w-3xl" /> : null}
      {!waiting && paymentFailed ? <PaymentResultBanner kind={outcomeKind === "cancelled" ? "cancelled" : "failed"} subject="court" retryTo={`/${slug}/courts`} className="mt-6 max-w-3xl" /> : null}
      {!waiting && paymentProcessing ? <PaymentResultBanner kind="processing" subject="court" className="mt-6 max-w-3xl" /> : null}
      {status === "unknown" || (!slot && !error) ? (
        <div className="mt-6 space-y-2" aria-busy="true">
          <span className="sr-only">Loading slot</span>
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
      ) : slot && preview ? (
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="rounded-3xl border border-fg/10 bg-surface/80 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg/60">Session</p>
            <h2 className="mt-1 font-display text-2xl text-fg">{slot.courtName}</h2>
            <p className="mt-2 text-sm text-fg/75">Court {slot.courtNumber}</p>
            <p className="mt-1 text-sm text-fg">{formatVenueDateTime(slot.startTime, slot.venue.timeZone)} – {formatVenueDateTime(slot.endTime, slot.venue.timeZone)}</p>
            <p className="mt-4 text-2xl font-semibold text-fg">
              {discount > 0 ? <span className="mr-2 text-base font-normal text-fg/50 line-through"><Money amount={slot.price} currency={slot.venue.currency} /></span> : null}
              <Money amount={discount > 0 ? payable : slot.price} currency={slot.venue.currency} />
            </p>
            {slot.incentivePoints ? <p className="mt-2 text-sm font-semibold text-accent-text">+{slot.incentivePoints} pts after the session ends</p> : null}
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-fg/75">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-fg/60" aria-hidden="true" />
              <span>More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps {percentLabel(fee)}% and refunds the rest.</span>
            </p>
            {outcome?.status === "confirmed" ? <Outcome row={outcome} /> : null}
          </section>
          <section className={summaryAside}>
            {outcome?.status === "confirmed" ? (
              <Alert tone="success" title="Payment confirmed">
                <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text hover:underline">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  View my bookings
                </Link>
              </Alert>
            ) : waiting || paymentFailed || paymentProcessing ? (
              <div className="space-y-3" role="status">
                <p className="text-sm leading-relaxed text-fg/80">
                  {waiting
                    ? "Checkout is paused until Stripe answers."
                    : paymentFailed
                      ? "You can start a new payment when you are ready."
                      : "Keep this page, or check My bookings while the bank confirms."}
                </p>
                {formError ? <p className="text-sm text-fg" role="alert">{formError}</p> : null}
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onPay();
                }}
              >
                <div className="rounded-2xl border border-fg/10 bg-inset p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg/60">Checkout</p>
                  <p className="mt-1 text-lg font-semibold text-fg">Pay and secure</p>
                  <p className="mt-1 text-sm text-fg/75">Card, PayTo, or bank debit through Stripe.</p>
                </div>
                <div>
                  <p className="text-sm text-fg/80">Promotion code</p>
                  {promotions === null ? (
                    <div className="mt-2 space-y-2" aria-busy="true">
                      <span className="sr-only">Loading promotion codes</span>
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : promotions.length > 0 ? (
                    <ul className="mt-2 grid gap-2">
                      {promotions.map((promotion) => {
                        const selected = appliedCode?.id === promotion.id;
                        return (
                          <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${selected ? "border-accent-text/60 bg-accent/10 hover:bg-accent/20" : "border-fg/10 bg-inset hover:bg-fg/10"}`}>
                            <div className="min-w-0">
                              <p className="break-all font-semibold tracking-wide text-fg">{promotion.code}</p>
                              <p className="text-sm text-accent-text">
                                {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={slot.venue.currency} />}
                                {promotion.venueId ? "" : " · all venues"}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant={selected ? "primary" : "secondary"}
                              className="w-full shrink-0 sm:w-auto"
                              disabled={paying || waiting}
                              onClick={() => {
                                if (selected) {
                                  setAppliedCode(null);
                                  setPromoNote(null);
                                  return;
                                }
                                setAppliedCode(promotion);
                                setPromoNote(`${promotion.code} applied.`);
                              }}
                            >
                              {selected ? "Applied" : "Apply"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-fg/70">No active promotion codes right now.</p>
                  )}
                  {promoNote ? <p className="mt-2 text-sm text-fg" role="status">{promoNote}</p> : null}
                </div>
                <div>
                  <p className="text-sm text-fg/80">Reward points</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pointPercents.map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        disabled={paying || waiting || maxPoints === 0}
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-accent text-accent-fg hover:bg-lime-300" : "border border-fg/15 text-fg hover:bg-fg/10"}`}
                        onClick={() => choosePercent(percent)}
                      >
                        {percent}%
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(maxPoints, 1)}
                    step={1}
                    value={Math.min(points, maxPoints)}
                    disabled={paying || waiting || maxPoints === 0}
                    aria-label="Reward points"
                    className="mt-3 w-full accent-accent-text disabled:opacity-60"
                    onChange={(event) => setPoints(Number(event.target.value))}
                  />
                  <p className="mt-1 text-sm text-fg/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {slot.venue.currency} 1.</p>
                </div>
                <dl className={summaryLines}>
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={slot.venue.currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={slot.venue.currency} /></dd></div>
                  <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold text-fg"><dt>To pay</dt><dd><Money amount={preview.cash} currency={slot.venue.currency} /></dd></div>
                </dl>
                {cashTooSmall ? <p className="text-sm text-fg">Use enough points to cover the booking, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-fg" role="alert">{formError}</p> : null}
                {waiting ? <p className="flex items-center gap-2 text-sm text-fg" role="status"><Spinner className="h-4 w-4" /> Checking the payment…</p> : null}
                <PayBar total={<><span>To pay</span><Money amount={preview.cash} currency={slot.venue.currency} /></>}>
                  <Button type="submit" className="w-full" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={paying || waiting} disabled={cashTooSmall}>
                    {preview.cash === 0 ? "Book with points" : "Continue to Stripe"}
                  </Button>
                </PayBar>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Outcome({ row }: { row: BookingPayment }) {
  if (row.status === "confirmed") {
    return (
      <Alert tone="success" className="mt-6" title="You're booked. Have a good game.">
        <p>
          The court is held for you. Arrive a few minutes early.
          {row.pointsRedeemed > 0 ? ` ${row.pointsRedeemed} points were used.` : ""}
          {row.cashAmount > 0 ? " Your payment is confirmed." : " No card payment was needed."}
        </p>
        <Link to="/profile/bookings" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-accent-text hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </Alert>
    );
  }
  return null;
}

