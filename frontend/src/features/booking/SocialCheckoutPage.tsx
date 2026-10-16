import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, CircleCheck, Clock, ShieldCheck } from "lucide-react";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDay, formatVenueRange } from "../../components/format";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { socialOffer, socialRegistration, startSocialBatchCheckout, venuePromotions, type Promotion, type SocialOffer, type SocialRegistration } from "../venues/venueApi";

const checkoutKey = "shuttle-sync-social-batch";
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

async function waitForSocial(slug: string, id: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await socialRegistration(slug, id);
    if (row.status === "confirmed" || row.status === "expired" || row.paymentStatus === "failed") {
      return row;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return socialRegistration(slug, id);
}

export default function SocialCheckoutPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const [offers, setOffers] = useState<SocialOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [points, setPoints] = useState(0);
  const [paying, setPaying] = useState(false);
  const [outcome, setOutcome] = useState<SocialRegistration | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [promoNote, setPromoNote] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length < 2) return;
    setError(null);
    setOffers(null);
    Promise.all(ids.map((id) => socialOffer(slug, id)))
      .then(setOffers)
      .catch(() => setError("These drop-in times could not be loaded."));
  }, [slug, params, attempt, ids.length]);

  useEffect(() => {
    if (slug) venuePromotions(slug).then(setPromotions).catch(() => setPromotions([]));
  }, [slug]);

  useEffect(() => {
    const returned = params.get("checkout");
    if (returned === "cancel" && status === "authenticated") {
      setFormError("Payment was cancelled. You can register again when you're ready.");
      return;
    }
    if (returned !== "success" || status !== "authenticated") return;
    const id = sessionStorage.getItem(checkoutKey);
    if (!id) return;
    let active = true;
    setWaiting(true);
    waitForSocial(slug, id)
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
  }, [dispatch, params, slug, status]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (ids.length === 1) {
    return <Navigate to={`/${slug}/social/${ids[0]}`} replace />;
  }
  if (ids.length === 0) {
    return <Navigate to={`/${slug}/social`} replace />;
  }

  const offer = offers?.[0] ?? null;
  const price = offers?.reduce((sum, item) => sum + item.price, 0) ?? 0;
  const incentive = offers?.reduce((sum, item) => sum + (item.incentivePoints || 0), 0) ?? 0;
  const rate = offer?.venue.pointsPerDollar || 100;
  const fee = offer?.venue.lateCancelFeePercent ?? 0;
  const currency = offer?.venue.currency ?? "AUD";
  const zone = offer?.venue.timeZone ?? "Australia/Melbourne";
  const discount = offers ? promoDiscount(price, appliedCode) : 0;
  const payable = Math.max(0, Math.round((price - discount) * 100) / 100);
  const maxPoints = Math.min(balance, payable <= 0 ? 0 : Math.floor(payable * rate));
  const preview = offers ? quote(Math.min(points, maxPoints), balance, rate, payable) : null;
  const cashTooSmall = preview ? preview.cash > 0 && preview.cash < 0.5 : false;

  function choosePercent(percent: number) {
    setPoints(Math.floor(maxPoints * percent / 100));
  }

  async function onPay() {
    if (!offers || !preview) return;
    setFormError(null);
    if (cashTooSmall) {
      setFormError("Use enough points to cover the registration, or leave at least $0.50 to pay.");
      return;
    }
    setPaying(true);
    try {
      const result = await startSocialBatchCheckout(slug, ids, preview.points, appliedCode?.code ?? "");
      sessionStorage.setItem(checkoutKey, result.registrationId);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.alreadyJoined || result.status === "confirmed" || result.cashAmount === 0) {
        setOutcome({
          id: result.registrationId,
          status: result.status === "confirmed" || result.alreadyJoined ? "confirmed" : result.status,
          courtName: result.courtName,
          courtNumber: result.courtNumber,
          paymentStatus: result.status === "confirmed" || result.cashAmount === 0 ? "succeeded" : null,
          cashAmount: result.cashAmount,
          pointsRedeemed: result.pointsRedeemed,
          incentivePoints: result.incentivePoints,
        });
        void dispatch(loadCurrentUser());
      }
    } catch (reason) {
      setFormError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The registration could not be started." : "The registration could not be started.");
    } finally {
      setPaying(false);
    }
  }

  const paidView = Boolean(outcome?.status === "confirmed" || waiting);

  return (
    <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
      <Link to={`/${slug}/social`} className="text-sm text-line hover:underline">Back to drop-in times</Link>
      <h1 className="mt-3 flex items-center gap-2 font-display text-3xl text-white">
        {paidView ? waiting ? <Spinner className="h-7 w-7 shrink-0 text-line" /> : <CircleCheck className="h-8 w-8 shrink-0 text-line" aria-hidden="true" /> : null}
        <span>{paidView ? waiting ? "Checking your payment" : "You're registered" : "Checkout"}</span>
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">
        {paidView
          ? "Stripe confirms the payment before places are saved. Review them in My bookings."
          : "Review your drop-in times, apply rewards or a promotion, then pay securely with Stripe."}
      </p>
      {status === "unknown" || (!offers && !error) ? (
        <div className="mt-6 space-y-2" aria-busy="true">
          <span className="sr-only">Loading drop-in times</span>
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
      ) : offers && preview ? (
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="rounded-3xl border border-white/10 bg-pine/80 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist/60">Sessions</p>
            <h2 className="mt-1 font-display text-2xl text-white">{offers.length} drop-in times</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {offers.map((item) => (
                <li key={item.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 transition-colors hover:border-line/40 hover:bg-white/5">
                  <p className="text-sm font-semibold text-white">{formatVenueDay(item.startTime, zone)}</p>
                  <p className="mt-1 whitespace-nowrap text-sm text-mist/80">{formatVenueRange(item.startTime, item.endTime, zone)}</p>
                  <p className="mt-2 text-sm font-semibold text-white"><Money amount={item.price} currency={currency} /></p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-mist/75">A court is assigned for each time, starting with court 1.</p>
            <p className="mt-4 text-2xl font-semibold text-white">
              {discount > 0 ? <span className="mr-2 text-base font-normal text-mist/50 line-through"><Money amount={price} currency={currency} /></span> : null}
              <Money amount={discount > 0 ? payable : price} currency={currency} />
            </p>
            {incentive > 0 ? <p className="mt-2 text-sm font-semibold text-line">+{incentive} pts after the sessions end</p> : null}
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-mist/75">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-mist/60" aria-hidden="true" />
              <span>More than 24 hours before each start, you get a full refund. Within 24 hours, the venue keeps {percentLabel(fee)}% and refunds the rest.</span>
            </p>
            {outcome ? <Outcome row={outcome} count={offers.length} /> : null}
          </section>
          <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-pine/90 p-4 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)] sm:p-5 lg:sticky lg:top-4">
            {outcome?.status === "confirmed" ? (
              <div className="space-y-3" role="status">
                <p className="flex items-center gap-2 font-semibold text-line">
                  <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                  Payment confirmed
                </p>
                <Link to="/profile/bookings" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  View my bookings
                </Link>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onPay();
                }}
              >
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist/60">Checkout</p>
                  <p className="mt-1 text-lg font-semibold text-white">Pay and register</p>
                  <p className="mt-1 text-sm text-mist/75">Card, PayTo, or bank debit through Stripe.</p>
                </div>
                <div>
                  <p className="text-sm text-mist/80">Promotion code</p>
                  {promotions === null ? (
                    <div className="mt-2" aria-busy="true">
                      <span className="sr-only">Loading promotion codes</span>
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : promotions.length > 0 ? (
                    <ul className="mt-2 grid gap-2">
                      {promotions.map((promotion) => {
                        const chosen = appliedCode?.id === promotion.id;
                        return (
                          <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${chosen ? "border-line/60 bg-line/10 hover:bg-line/20" : "border-white/10 bg-black/20 hover:bg-white/10"}`}>
                            <div className="min-w-0">
                              <p className="break-all font-semibold tracking-wide text-white">{promotion.code}</p>
                              <p className="text-sm text-line">
                                {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant={chosen ? "primary" : "secondary"}
                              className="w-full shrink-0 sm:w-auto"
                              disabled={paying || waiting}
                              onClick={() => {
                                if (chosen) {
                                  setAppliedCode(null);
                                  setPromoNote(null);
                                  return;
                                }
                                setAppliedCode(promotion);
                                setPromoNote(`${promotion.code} applied.`);
                              }}
                            >
                              {chosen ? "Applied" : "Apply"}
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
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-line text-ink hover:bg-lime-300" : "border border-white/15 text-mist hover:bg-white/10"}`}
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
                  <p className="mt-1 text-sm text-mist/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {currency} 1.</p>
                </div>
                <dl className="grid gap-1 text-sm text-mist/80">
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={currency} /></dd></div>
                  <div className="flex justify-between gap-3 font-semibold text-white"><dt>To pay</dt><dd><Money amount={preview.cash} currency={currency} /></dd></div>
                </dl>
                {cashTooSmall ? <p className="text-sm text-mist">Use enough points to cover the registration, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                {waiting ? <p className="flex items-center gap-2 text-sm text-mist" role="status"><Spinner className="h-4 w-4" /> Checking the payment…</p> : null}
                <Button type="submit" className="w-full" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={paying || waiting} disabled={cashTooSmall}>
                  {preview.cash === 0 ? "Register with points" : "Continue to Stripe"}
                </Button>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Outcome({ row, count }: { row: SocialRegistration; count: number }) {
  if (row.status === "confirmed") {
    return (
      <div className="mt-6 space-y-3 rounded-2xl border border-line/30 bg-line/10 p-4" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-line">
          <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          You're registered for {count} drop-in times. Have a good game.
        </p>
        <p className="text-sm text-mist/80">
          {row.pointsRedeemed > 0 ? `${row.pointsRedeemed} points were used. ` : ""}
          {row.cashAmount > 0 ? "Your payment is confirmed. " : "No card payment was needed. "}
          {row.incentivePoints > 0 ? `${row.incentivePoints} points are added after the sessions end, and you can use them on a later booking.` : "Reward points from these sessions can offset a later booking."}
        </p>
        <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </div>
    );
  }
  if (row.status === "expired" || row.paymentStatus === "failed") {
    return <p className="mt-6 text-sm text-mist" role="alert">The payment did not go through. The seats were released and your points are back.</p>;
  }
  return (
    <div className="mt-6 space-y-3" role="status">
      <p className="text-sm text-mist/80">Your seats are held until the bank confirms this payment. Direct debit can take a few business days. PayTo can take a few minutes.</p>
      <Link to="/profile/bookings" className="inline-flex text-sm text-line hover:underline">View my bookings</Link>
    </div>
  );
}
