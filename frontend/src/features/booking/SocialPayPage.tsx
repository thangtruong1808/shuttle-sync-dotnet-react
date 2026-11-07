import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { Alert, Badge, Button, Skeleton, Spinner } from "../../components/ui";
import { PayBar, summaryAside, summaryLines } from "./checkoutUi";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { SocialRoster } from "../courts/CourtSchedule";
import { savedCourtPromo, savedPointShare, socialOffer, socialRegistration, startSocialCheckout, startWaitlistCheckout, venuePromotions, type Promotion, type SocialOffer, type SocialRegistration } from "../venues/venueApi";
import { PaymentResultBanner, paymentOutcomeKind, paymentSettled, useCleanReturnUrl } from "./PaymentResultBanner";
import { FriendPanel } from "./SocialFriendsPanel";
import { pointsQuote as quote, promoDiscount } from "./bookingMath";

const checkoutKey = "shuttle-sync-social-checkout";
const pointPercents = [25, 50, 75, 100] as const;

function percentLabel(value: number) {
  return Number(value.toFixed(2)).toString();
}

async function waitForSocial(slug: string, id: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await socialRegistration(slug, id);
    if (paymentSettled(row) || (row.status === "waitlist" && (row.paymentStatus === "succeeded" || row.cashAmount === 0))) {
      return row;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  return socialRegistration(slug, id);
}

export default function SocialPayPage() {
  const { slug = "", socialId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const [offer, setOffer] = useState<SocialOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [points, setPoints] = useState(0);
  const [paying, setPaying] = useState(false);
  const [outcome, setOutcome] = useState<SocialRegistration | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [promoNote, setPromoNote] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setOffer(null);
    socialOffer(slug, socialId)
      .then((next) => {
        setOffer(next);
        if (next.yourStatus === "confirmed" || next.yourStatus === "waitlist") {
          setOutcome({
            id: next.id,
            status: next.yourStatus,
            courtName: next.yourCourtName ?? "",
            courtNumber: next.yourCourtNumber ?? 0,
            paymentStatus: "succeeded",
            cashAmount: 0,
            pointsRedeemed: 0,
            incentivePoints: next.incentivePoints,
          });
        }
      })
      .catch(() => setError("This drop-in social could not be loaded."))
      .finally(() => setRetrying(false));
  }, [slug, socialId, attempt]);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("promo") || savedCourtPromo();
    venuePromotions(slug)
      .then((list) => {
        setPromotions(list);
        if (!code) return;
        const match = list.find((promotion) => promotion.code.localeCompare(code, undefined, { sensitivity: "accent" }) === 0) ?? null;
        setAppliedCode((current) => current ?? match);
        if (match) setPromoNote((current) => current ?? `${match.code} applied.`);
      })
      .catch(() => setPromotions([]));
  }, [slug, location.search]);

  const pointsChosen = useRef(false);
  useEffect(() => {
    if (pointsChosen.current || !offer || promotions === null) return;
    const wantAll = new URLSearchParams(location.search).get("points") === "100" || savedPointShare() === 100;
    if (!wantAll) return;
    const pointRate = offer.venue.pointsPerDollar || 100;
    const pointDiscount = promoDiscount(offer.price, appliedCode);
    const pointPayable = Math.max(0, Math.round((offer.price - pointDiscount) * 100) / 100);
    const pointMax = Math.min(balance, pointPayable <= 0 ? 0 : Math.floor(pointPayable * pointRate));
    if (pointMax <= 0) return;
    pointsChosen.current = true;
    setPoints(pointMax);
  }, [offer, promotions, appliedCode, balance, location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const returned = params.get("checkout");
    if (returned === "cancel" && status === "authenticated") {
      setFormError("Payment was cancelled. You can register again when you're ready.");
      return;
    }
    if ((returned !== "success" && returned !== "waitlist") || status !== "authenticated") {
      return;
    }
    const id = sessionStorage.getItem(checkoutKey);
    if (!id) {
      return;
    }
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
  }, [dispatch, location.search, slug, status]);

  useCleanReturnUrl(waiting, outcome);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const rate = offer?.venue.pointsPerDollar || 100;
  const fee = offer?.venue.lateCancelFeePercent ?? 0;
  const discount = offer ? promoDiscount(offer.price, appliedCode) : 0;
  const payable = offer ? Math.max(0, Math.round((offer.price - discount) * 100) / 100) : 0;
  const maxPoints = Math.min(balance, payable <= 0 ? 0 : Math.floor(payable * rate));
  const preview = offer ? quote(Math.min(points, maxPoints), balance, rate, payable) : null;
  const cashTooSmall = preview ? preview.cash > 0 && preview.cash < 0.5 : false;
  const joining = offer?.full === true && offer.yourStatus !== "confirmed" && offer.yourStatus !== "waitlist";

  function choosePercent(percent: number) {
    setPoints(Math.floor(maxPoints * percent / 100));
  }

  async function onPay() {
    if (!offer || !preview) return;
    setFormError(null);
    if (cashTooSmall) {
      setFormError("Use enough points to cover the registration, or leave at least $0.50 to pay.");
      return;
    }
    setPaying(true);
    try {
      const joining = offer.full === true && offer.yourStatus !== "confirmed";
      const result = await (joining ? startWaitlistCheckout : startSocialCheckout)(slug, socialId, preview.points, appliedCode?.code ?? "");
      sessionStorage.setItem(checkoutKey, result.registrationId);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.alreadyJoined || result.status === "confirmed" || result.status === "waitlist" || result.cashAmount === 0) {
        setOutcome({
          id: result.registrationId,
          status: result.status === "waitlist" ? "waitlist" : result.status === "confirmed" || result.alreadyJoined ? "confirmed" : result.status,
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

  function retryPayment() {
    sessionStorage.removeItem(checkoutKey);
    setOutcome(null);
    setFormError(null);
    setWaiting(false);
    setPaying(false);
    navigate(`/${slug}/social/${socialId}`, { replace: true });
  }

  const outcomeKind = outcome ? paymentOutcomeKind(outcome) : null;
  const paymentFailed = outcomeKind === "failed" || outcomeKind === "cancelled";
  const paymentProcessing = outcomeKind === "processing";
  const title = waiting
    ? "Checking your payment"
    : paymentFailed
      ? "Payment not confirmed"
      : paymentProcessing
        ? "Waiting for bank confirmation"
        : joining
          ? "Join the waitlist"
          : outcome?.status === "confirmed" || outcome?.status === "waitlist"
            ? "Your public social"
            : "Pay and register";

  return (
    <main>
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Link to={`/${slug}/social`} className="inline-flex min-h-11 items-center text-sm text-accent-text hover:underline">Back to drop-in times</Link>
            <h1 className="mt-1 flex items-center gap-2 font-display text-2xl text-fg sm:text-3xl">
              {waiting || paymentProcessing ? <Spinner className="h-6 w-6 shrink-0 text-accent-text" /> : null}
              <span>{title}</span>
            </h1>
            {waiting ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">We are checking with Stripe. Your place is only saved after Stripe confirms the payment — please wait.</p> : null}
            {paymentFailed ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">That payment did not go through. This place was not saved.</p> : null}
            {paymentProcessing ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">Stripe has the payment, but the bank has not confirmed it yet. Your place stays held until confirmation.</p> : null}
          </div>
        </div>
        {waiting ? <PaymentResultBanner kind="waiting" subject="seat" className="mt-4 max-w-3xl" /> : null}
        {!waiting && paymentFailed ? <PaymentResultBanner kind={outcomeKind === "cancelled" ? "cancelled" : "failed"} subject="seat" onRetry={retryPayment} className="mt-4 max-w-3xl" /> : null}
        {!waiting && paymentProcessing ? <PaymentResultBanner kind="processing" subject="seat" className="mt-4 max-w-3xl" /> : null}
        {status === "unknown" || (!offer && !error) ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <span className="sr-only">Loading drop-in social</span>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
        ) : offer && preview ? (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5">
            <h2 className="font-display text-xl text-fg sm:text-2xl">Drop-in social</h2>
            <p className="mt-1 text-sm text-fg/75">{formatVenueDateTime(offer.startTime, offer.venue.timeZone)} – {formatVenueDateTime(offer.endTime, offer.venue.timeZone)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {joining ? <Badge tone="warning">Full</Badge> : <Badge tone="success">Places open</Badge>}
              {typeof offer.waitlistCount === "number" && offer.waitlistCount > 0 ? <Badge tone="info">{offer.waitlistCount} waiting</Badge> : null}
            </div>
            <CapacityMeter playerCount={offer.playerCount} playersPerCourt={offer.playersPerCourt} courtCount={offer.courtCount ?? offer.courts?.length ?? 0} full={joining} />
            <SocialRoster compact playerCount={offer.playerCount} courtCount={offer.courtCount ?? offer.courts?.length ?? 0} playersPerCourt={offer.playersPerCourt} courts={offer.courts ?? []} />
            <p className="mt-4 text-lg font-semibold text-fg">
              {discount > 0 ? <span className="mr-2 text-base font-normal text-fg/50 line-through"><Money amount={offer.price} currency={offer.venue.currency} /></span> : null}
              <Money amount={discount > 0 ? payable : offer.price} currency={offer.venue.currency} />
            </p>
            {offer.incentivePoints ? (
              <p className="mt-2 text-sm font-semibold text-accent-text">
                +{offer.incentivePoints} pts after the session ends{joining ? ", if a place opens and you play" : ""}
              </p>
            ) : null}
            {typeof offer.waitlistCount === "number" ? (
              <p className="mt-2 text-sm text-fg/70">{offer.waitlistCount} {offer.waitlistCount === 1 ? "person is" : "people are"} on the waitlist.</p>
            ) : null}
            {joining ? (
              <p className="mt-2 text-sm text-accent-text">This social is full. Pay to join the waitlist. If someone cancels before the start, the first person waiting gets the place. If the session starts first, you are refunded in full.</p>
            ) : null}
            <p className="mt-4 text-sm text-fg/75">
              More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps {percentLabel(fee)}% and refunds the rest. Points you used follow the same rule.
            </p>
            {outcome && (outcome.status === "confirmed" || outcome.status === "waitlist") ? <Outcome row={outcome} /> : null}
          </section>
          <section className={summaryAside}>
            {waiting || paymentFailed || paymentProcessing ? (
              <div className="space-y-3" role="status">
                <p className="text-sm leading-relaxed text-fg/80">
                  {waiting
                    ? "Checkout is paused until Stripe answers."
                    : paymentFailed
                      ? "You can start a new payment when you are ready."
                      : "Keep this page, or check My bookings while the bank confirms."}
                </p>
                {formError ? <p className="text-sm text-fg" role="alert">{formError}</p> : null}
                {waiting ? <p className="flex items-center gap-2 text-sm text-fg" role="status"><Spinner className="h-4 w-4" /> Checking the payment…</p> : null}
              </div>
            ) : outcome ? null : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onPay();
                }}
              >
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
                          <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${selected ? "border-accent-text/60 bg-accent/10" : "border-fg/10 bg-inset"}`}>
                            <div className="min-w-0">
                              <p className="break-all font-semibold tracking-wide text-fg">{promotion.code}</p>
                              <p className="text-sm text-accent-text">
                                {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={offer.venue.currency} />}
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
                        className={`min-h-11 min-w-11 rounded-full px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-accent text-accent-fg" : "border border-fg/15 text-fg"}`}
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
                  <p className="mt-1 text-sm text-fg/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {offer.venue.currency} 1.</p>
                </div>
                <dl className={summaryLines}>
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={offer.venue.currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={offer.venue.currency} /></dd></div>
                  <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold text-fg"><dt>To pay</dt><dd><Money amount={preview.cash} currency={offer.venue.currency} /></dd></div>
                </dl>
                {cashTooSmall ? <p className="text-sm text-fg">Use enough points to cover the registration, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-fg" role="alert">{formError}</p> : null}
                {waiting ? <p className="text-sm text-fg" role="status">Checking the payment…</p> : null}
                <PayBar total={<><span>To pay</span><Money amount={preview.cash} currency={offer.venue.currency} /></>}>
                  <Button type="submit" className="w-full" loading={paying || waiting} disabled={cashTooSmall}>
                    {joining ? (preview.cash === 0 ? "Join with points" : "Pay to join the waitlist") : preview.cash === 0 ? "Register with points" : "Continue to Stripe"}
                  </Button>
                </PayBar>
              </form>
            )}
            {outcome?.status === "confirmed" && new Date(offer.startTime).getTime() > Date.now() ? (
              <FriendPanel
                focusFriends={new URLSearchParams(location.search).get("add") === "friends"}
                slug={slug}
                socialId={socialId}
                price={offer.price}
                currency={offer.venue.currency}
                rate={rate}
                balance={balance}
                fee={fee}
                incentivePoints={offer.incentivePoints}
                promotions={promotions}
                returning={new URLSearchParams(location.search).get("checkout")}
              />
            ) : outcome ? (
              <p className="text-sm text-fg/70">Friends can be added after you are registered and before the social starts.</p>
            ) : null}
          </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function CapacityMeter({ playerCount, playersPerCourt, courtCount, full }: { playerCount: number; playersPerCourt?: number; courtCount: number; full: boolean }) {
  const each = playersPerCourt && playersPerCourt > 0 ? playersPerCourt : 8;
  const seats = courtCount > 0 ? courtCount * each : 0;
  if (seats === 0) return null;
  const taken = Math.min(seats, playerCount);
  return (
    <div className="mt-3">
      <p className="text-sm text-fg-muted">{playerCount} of {seats} players</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inset" role="meter" aria-label="Places taken" aria-valuemin={0} aria-valuemax={seats} aria-valuenow={taken}>
        <div className={`h-full rounded-full ${full ? "bg-amber-400" : "bg-accent"}`} style={{ width: `${Math.round((taken / seats) * 100)}%` }} />
      </div>
    </div>
  );
}

function Outcome({ row }: { row: SocialRegistration }) {
  if (row.status === "confirmed") {
    return (
      <Alert tone="success" className="mt-3" title={`You're registered${row.courtName ? ` on ${row.courtName}` : ""}. Have a good game.`}>
        <p>
          {row.pointsRedeemed > 0 ? `${row.pointsRedeemed} points were used. ` : ""}
          {row.cashAmount > 0 ? "Your payment is confirmed. " : "No card payment was needed. "}
          {row.incentivePoints > 0 ? `${row.incentivePoints} points are added after the session ends, and you can use them on a later booking.` : "Reward points from this session can offset a later booking."}
        </p>
        <Link to="/profile/bookings" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-accent-text hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </Alert>
    );
  }
  if (row.status === "waitlist" && (row.paymentStatus === "succeeded" || row.cashAmount === 0)) {
    return (
      <Alert tone="success" className="mt-3" title="You're on the waitlist. If someone cancels, you are first in line.">
        <p>
          {row.pointsRedeemed > 0 ? `${row.pointsRedeemed} points were used. ` : ""}
          {row.cashAmount > 0 ? "Your payment is confirmed. " : "No card payment was needed. "}
          {row.incentivePoints > 0 ? `${row.incentivePoints} points are added after the session ends only if a place opens and you play.` : "If the session starts before a place opens, this is refunded in full."}
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
