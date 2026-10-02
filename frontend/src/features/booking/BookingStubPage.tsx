import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { CalendarDays, CircleCheck } from "lucide-react";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { PageSection } from "../../components/layout/SiteLayout";
import { Button, Skeleton } from "../../components/ui";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { bookingPayment, type BookingPayment } from "../profile/profileApi";
import { startCheckout, venuePromotions, venueSlot, type CourtSlotDetail, type Promotion } from "../venues/venueApi";

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

function percentLabel(value: number) {
  return Number(value.toFixed(2)).toString();
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
      .catch(() => setError("This slot could not be loaded."));
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
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
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
      }
    } catch (reason) {
      setFormError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The booking could not be started." : "The booking could not be started.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <main>
      <PageSection>
        <Link to={`/${slug}/courts`} className="text-sm text-line hover:underline">Back to courts</Link>
        <h1 className="mt-3 font-display text-3xl text-white">Book this court</h1>
        {status === "unknown" || (!slot && !error) ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <span className="sr-only">Loading slot</span>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : slot && preview ? (
          <article className="mt-6 max-w-xl rounded-3xl border border-white/10 bg-pine/80 p-6">
            <h2 className="font-display text-2xl text-white">{slot.courtName}</h2>
            <p className="mt-2 text-mist/75">Court {slot.courtNumber}</p>
            <p className="mt-1 text-mist/75">{formatVenueDateTime(slot.startTime, slot.venue.timeZone)} – {formatVenueDateTime(slot.endTime, slot.venue.timeZone)}</p>
            <p className="mt-4 text-lg font-semibold text-white">
              {discount > 0 ? <span className="mr-2 text-base font-normal text-mist/50 line-through"><Money amount={slot.price} currency={slot.venue.currency} /></span> : null}
              <Money amount={discount > 0 ? payable : slot.price} currency={slot.venue.currency} />
            </p>
            {slot.incentivePoints ? <p className="mt-2 text-sm font-semibold text-line">+{slot.incentivePoints} pts after the session ends</p> : null}
            <p className="mt-4 text-sm text-mist/75">
              More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps {percentLabel(fee)}% and refunds the rest.
            </p>
            {outcome ? (
              <Outcome row={outcome} />
            ) : (
              <form
                className="mt-6 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onPay();
                }}
              >
                <div>
                  <p className="text-sm text-mist/80">Promotion code</p>
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
                          <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${selected ? "border-line/60 bg-line/10" : "border-white/10 bg-black/20"}`}>
                            <div className="min-w-0">
                              <p className="break-all font-semibold tracking-wide text-white">{promotion.code}</p>
                              <p className="text-sm text-line">
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
                    <p className="mt-2 text-sm text-mist/70">No active promotion codes right now.</p>
                  )}
                  {promoNote ? <p className="mt-2 text-sm text-mist" role="status">{promoNote}</p> : null}
                </div>
                <div>
                  <p className="text-sm text-mist/80">Reward points</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pointPercents.map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        disabled={paying || waiting || maxPoints === 0}
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-line text-ink" : "border border-white/15 text-mist"}`}
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
                    className="mt-3 w-full accent-line disabled:opacity-60"
                    onChange={(event) => setPoints(Number(event.target.value))}
                  />
                  <p className="mt-1 text-sm text-mist/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {slot.venue.currency} 1.</p>
                </div>
                <dl className="grid gap-1 text-sm text-mist/80">
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={slot.venue.currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={slot.venue.currency} /></dd></div>
                  <div className="flex justify-between gap-3 font-semibold text-white"><dt>To pay</dt><dd><Money amount={preview.cash} currency={slot.venue.currency} /></dd></div>
                </dl>
                {cashTooSmall ? <p className="text-sm text-mist">Use enough points to cover the booking, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                {waiting ? <p className="text-sm text-mist" role="status">Checking the payment…</p> : null}
                <Button type="submit" loading={paying || waiting} disabled={cashTooSmall}>
                  {preview.cash === 0 ? "Book with points" : "Continue to Stripe"}
                </Button>
              </form>
            )}
          </article>
        ) : null}
      </PageSection>
    </main>
  );
}

function Outcome({ row }: { row: BookingPayment }) {
  if (row.status === "confirmed") {
    return (
      <div className="mt-6 space-y-3 rounded-2xl border border-line/30 bg-line/10 p-4" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-line">
          <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          You're booked. Have a good game.
        </p>
        <p className="text-sm text-mist/80">
          The court is held for you. Arrive a few minutes early.
          {row.pointsRedeemed > 0 ? ` ${row.pointsRedeemed} points were used.` : ""}
          {row.cashAmount > 0 ? " Your payment is confirmed." : " No card payment was needed."}
        </p>
        <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </div>
    );
  }
  if (row.status === "expired" || row.paymentStatus === "failed") {
    return <p className="mt-6 text-sm text-mist" role="alert">The payment did not go through. The slot has been released and your points are back.</p>;
  }
  return (
    <div className="mt-6 space-y-3" role="status">
      <p className="text-sm text-mist/80">Your slot is held until the bank confirms this payment. Direct debit can take a few business days. PayTo can take a few minutes.</p>
      <Link to="/profile/bookings" className="inline-flex text-sm text-line hover:underline">View my bookings</Link>
    </div>
  );
}

