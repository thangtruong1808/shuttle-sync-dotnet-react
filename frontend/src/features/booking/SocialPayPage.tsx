import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { CalendarDays, CircleCheck } from "lucide-react";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { SocialRoster } from "../courts/CourtSchedule";
import { cancelBooking, renameFriend } from "../profile/profileApi";
import { socialFriends, socialOffer, socialRegistration, startFriendCheckout, startSocialCheckout, startWaitlistCheckout, venuePromotions, type Promotion, type SocialFriend, type SocialOffer, type SocialRegistration } from "../venues/venueApi";
import { PaymentResultBanner, paymentOutcomeKind, paymentSettled } from "./PaymentResultBanner";

const checkoutKey = "shuttle-sync-social-checkout";
const friendKey = "shuttle-sync-friend-group";
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
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const balance = useSelector((state: RootState) => state.auth.user?.rewardPoints ?? 0);
  const [offer, setOffer] = useState<SocialOffer | null>(null);
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
      .catch(() => setError("This drop-in social could not be loaded."));
  }, [slug, socialId, attempt]);

  useEffect(() => {
    venuePromotions(slug).then(setPromotions).catch(() => setPromotions([]));
  }, [slug]);

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
      <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Link to={`/${slug}/social`} className="text-sm text-line hover:underline">Back to drop-in times</Link>
            <h1 className="mt-1 flex items-center gap-2 font-display text-2xl text-white sm:text-3xl">
              {waiting || paymentProcessing ? <Spinner className="h-6 w-6 shrink-0 text-line" /> : null}
              <span>{title}</span>
            </h1>
            {waiting ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">We are checking with Stripe. Your place is only saved after Stripe confirms the payment — please wait.</p> : null}
            {paymentFailed ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">That payment did not go through. This place was not saved.</p> : null}
            {paymentProcessing ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">Stripe has the payment, but the bank has not confirmed it yet. Your place stays held until confirmation.</p> : null}
          </div>
        </div>
        {waiting ? <PaymentResultBanner kind="waiting" subject="seat" className="mt-4 max-w-3xl" /> : null}
        {!waiting && paymentFailed ? <PaymentResultBanner kind={outcomeKind === "cancelled" ? "cancelled" : "failed"} subject="seat" retryTo={`/${slug}/social/${socialId}`} className="mt-4 max-w-3xl" /> : null}
        {!waiting && paymentProcessing ? <PaymentResultBanner kind="processing" subject="seat" className="mt-4 max-w-3xl" /> : null}
        {status === "unknown" || (!offer && !error) ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <span className="sr-only">Loading drop-in social</span>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : offer && preview ? (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-pine/80 p-4 sm:p-5">
            <h2 className="font-display text-xl text-white sm:text-2xl">Drop-in social</h2>
            <p className="mt-1 text-sm text-mist/75">{formatVenueDateTime(offer.startTime, offer.venue.timeZone)} – {formatVenueDateTime(offer.endTime, offer.venue.timeZone)}</p>
            <SocialRoster compact playerCount={offer.playerCount} courtCount={offer.courtCount ?? offer.courts?.length ?? 0} playersPerCourt={offer.playersPerCourt} courts={offer.courts ?? []} />
            <p className="mt-4 text-lg font-semibold text-white">
              {discount > 0 ? <span className="mr-2 text-base font-normal text-mist/50 line-through"><Money amount={offer.price} currency={offer.venue.currency} /></span> : null}
              <Money amount={discount > 0 ? payable : offer.price} currency={offer.venue.currency} />
            </p>
            {offer.incentivePoints ? (
              <p className="mt-2 text-sm font-semibold text-line">
                +{offer.incentivePoints} pts after the session ends{joining ? ", if a place opens and you play" : ""}
              </p>
            ) : null}
            {typeof offer.waitlistCount === "number" ? (
              <p className="mt-2 text-sm text-mist/70">{offer.waitlistCount} {offer.waitlistCount === 1 ? "person is" : "people are"} on the waitlist.</p>
            ) : null}
            {joining ? (
              <p className="mt-2 text-sm text-line">This social is full. Pay to join the waitlist. If someone cancels before the start, the first person waiting gets the place. If the session starts first, you are refunded in full.</p>
            ) : null}
            <p className="mt-4 text-sm text-mist/75">
              More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps {percentLabel(fee)}% and refunds the rest. Points you used follow the same rule.
            </p>
            {outcome && (outcome.status === "confirmed" || outcome.status === "waitlist") ? <Outcome row={outcome} /> : null}
          </section>
          <section className="rounded-3xl border border-white/10 bg-pine/80 p-4 sm:p-5">
            {waiting || paymentFailed || paymentProcessing ? (
              <div className="space-y-3" role="status">
                <p className="text-sm leading-relaxed text-mist/80">
                  {waiting
                    ? "Checkout is paused until Stripe answers."
                    : paymentFailed
                      ? "You can start a new payment when you are ready."
                      : "Keep this page, or check My bookings while the bank confirms."}
                </p>
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                {waiting ? <p className="flex items-center gap-2 text-sm text-mist" role="status"><Spinner className="h-4 w-4" /> Checking the payment…</p> : null}
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
                  <p className="mt-1 text-sm text-mist/70">{Math.min(points, maxPoints)} of {balance} points. {rate} points = {offer.venue.currency} 1.</p>
                </div>
                <dl className="grid gap-1 text-sm text-mist/80">
                  {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={offer.venue.currency} /></dd></div> : null}
                  <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={offer.venue.currency} /></dd></div>
                  <div className="flex justify-between gap-3 font-semibold text-white"><dt>To pay</dt><dd><Money amount={preview.cash} currency={offer.venue.currency} /></dd></div>
                </dl>
                {cashTooSmall ? <p className="text-sm text-mist">Use enough points to cover the registration, or leave at least $0.50 to pay.</p> : null}
                {formError ? <p className="text-sm text-mist" role="alert">{formError}</p> : null}
                {waiting ? <p className="text-sm text-mist" role="status">Checking the payment…</p> : null}
                <Button type="submit" className="w-full sm:w-auto" loading={paying || waiting} disabled={cashTooSmall}>
                  {joining ? (preview.cash === 0 ? "Join with points" : "Pay to join the waitlist") : preview.cash === 0 ? "Register with points" : "Continue to Stripe"}
                </Button>
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
              <p className="text-sm text-mist/70">Friends can be added after you are registered and before the social starts.</p>
            ) : null}
          </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Outcome({ row }: { row: SocialRegistration }) {
  if (row.status === "confirmed") {
    return (
      <div className="mt-3 space-y-2 rounded-2xl border border-line/30 bg-line/10 p-3" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-line">
          <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          You're registered{row.courtName ? ` on ${row.courtName}` : ""}. Have a good game.
        </p>
        <p className="text-sm text-mist/80">
          {row.pointsRedeemed > 0 ? `${row.pointsRedeemed} points were used. ` : ""}
          {row.cashAmount > 0 ? "Your payment is confirmed. " : "No card payment was needed. "}
          {row.incentivePoints > 0 ? `${row.incentivePoints} points are added after the session ends, and you can use them on a later booking.` : "Reward points from this session can offset a later booking."}
        </p>
        <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </div>
    );
  }
  if (row.status === "waitlist" && (row.paymentStatus === "succeeded" || row.cashAmount === 0)) {
    return (
      <div className="mt-3 space-y-2 rounded-2xl border border-line/30 bg-line/10 p-3" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-line">
          <CircleCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          You're on the waitlist. If someone cancels, you are first in line.
        </p>
        <p className="text-sm text-mist/80">
          {row.pointsRedeemed > 0 ? `${row.pointsRedeemed} points were used. ` : ""}
          {row.cashAmount > 0 ? "Your payment is confirmed. " : "No card payment was needed. "}
          {row.incentivePoints > 0 ? `${row.incentivePoints} points are added after the session ends only if a place opens and you play.` : "If the session starts before a place opens, this is refunded in full."}
        </p>
        <Link to="/profile/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </div>
    );
  }
  return null;
}

function FriendPanel({
  slug,
  socialId,
  price,
  currency,
  rate,
  balance,
  fee,
  incentivePoints,
  promotions,
  returning,
  focusFriends = false,
}: {
  slug: string;
  socialId: string;
  price: number;
  currency: string;
  rate: number;
  balance: number;
  fee: number;
  incentivePoints: number;
  promotions: Promotion[] | null;
  returning: string | null;
  focusFriends?: boolean;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const [friends, setFriends] = useState<SocialFriend[]>([]);
  const [placesLeft, setPlacesLeft] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [names, setNames] = useState<string[]>([""]);
  const [points, setPoints] = useState(0);
  const [appliedCode, setAppliedCode] = useState<Promotion | null>(null);
  const [paying, setPaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    socialFriends(slug, socialId)
      .then((next) => {
        if (!active) return;
        setFriends(next.friends);
        setPlacesLeft(next.placesLeft);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setError("Friends could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [slug, socialId, attempt]);

  useEffect(() => {
    if (returning === "friends-cancel") {
      setError("Payment was cancelled. You can add these friends again when you're ready.");
      return;
    }
    if (returning !== "friends") return;
    const group = sessionStorage.getItem(friendKey);
    if (!group) return;
    let active = true;
    setWaiting(true);
    const look = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const next = await socialFriends(slug, socialId);
        if (!active) return;
        setFriends(next.friends);
        setPlacesLeft(next.placesLeft);
        const mine = next.friends.filter((friend) => friend.checkoutGroupId === group);
        if (mine.length > 0 && mine.every((friend) => friend.status !== "pending")) {
          setNotice(
            mine.every((friend) => friend.status === "confirmed")
              ? "Your friends are registered."
              : mine.every((friend) => friend.status === "waitlist")
                ? "Your friends are on the waitlist. If someone cancels, the first person waiting gets the place."
                : "The payment did not finish. Those seats were released and your points are back.",
          );
          void dispatch(loadCurrentUser());
          setWaiting(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (active) setWaiting(false);
    };
    look().catch(() => {
      if (active) {
        setError("The payment status could not be checked.");
        setWaiting(false);
      }
    });
    return () => {
      active = false;
    };
  }, [dispatch, returning, slug, socialId]);

  const filled = names.map((name) => name.trim()).filter((name) => name.length > 0);
  const subtotal = Math.round(price * filled.length * 100) / 100;
  const discount = promoDiscount(subtotal, appliedCode);
  const payable = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const maxPoints = Math.min(balance, payable <= 0 ? 0 : Math.floor(payable * rate));
  const preview = filled.length > 0 ? quote(Math.min(points, maxPoints), balance, rate, payable) : null;
  const cashTooSmall = preview ? preview.cash > 0 && preview.cash < 0.5 : false;
  const pendingFriends = friends.some((friend) => friend.status === "pending");

  async function onPay() {
    if (filled.length === 0 || !preview) {
      setError("Enter at least one friend's name.");
      return;
    }
    if (cashTooSmall) {
      setError("Use enough points to cover these friends, or leave at least $0.50 to pay.");
      return;
    }
    setError(null);
    setNotice(null);
    setPaying(true);
    try {
      const result = await startFriendCheckout(slug, socialId, filled, preview.points, appliedCode?.code ?? "");
      if (result.friendGroupId) sessionStorage.setItem(friendKey, result.friendGroupId);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setNames([""]);
      setPoints(0);
      setNotice(filled.length === 1 ? "Your friend is registered." : "Your friends are registered.");
      void dispatch(loadCurrentUser());
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "These friends could not be added." : "These friends could not be added.");
    } finally {
      setPaying(false);
    }
  }

  async function onSaveName(id: string) {
    const name = draftName.trim();
    if (name.length === 0) {
      setError("Enter a friend's name.");
      return;
    }
    setSavingId(id);
    setError(null);
    setNotice(null);
    try {
      const saved = await renameFriend(id, name);
      setFriends((current) => current.map((friend) => friend.id === id ? { ...friend, name: saved.name } : friend));
      setEditingId(null);
      setNotice("Name saved.");
    } catch (reason) {
      setError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This friend's name could not be saved." : "This friend's name could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  async function onCancel(id: string) {
    setPendingId(id);
    setError(null);
    setNotice(null);
    try {
      const result = await cancelBooking(id);
      const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: result.currency }).format(result.refundAmount);
      const parts = [`Cancelled. Refund amount: ${money}.`];
      if (result.feePercent > 0) parts.push(`A ${Number(result.feePercent.toFixed(2))}% late fee was kept on that friend's share.`);
      if (result.pointsRestored > 0) parts.push(`${result.pointsRestored} points were returned.`);
      setNotice(parts.join(" "));
      setConfirmId(null);
      void dispatch(loadCurrentUser());
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This friend could not be cancelled." : "This friend could not be cancelled.");
    } finally {
      setPendingId(null);
    }
  }

  useEffect(() => {
    if (!focusFriends || !loaded) return;
    document.getElementById("add-friends")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusFriends, loaded]);

  const friendLimit = placesLeft > 0 ? placesLeft : 8;

  return (
    <section id="add-friends">
      <h3 className="font-display text-2xl text-white">Add friends</h3>
      {!loaded ? (
        <div className="mt-4 space-y-2" aria-busy="true">
          <span className="sr-only">Loading friends</span>
          <Skeleton className="h-14 w-full" />
        </div>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed text-mist/75">
        Each friend takes a place and is charged the session price. Cancelling one friend refunds only that person. More than 24 hours before the start, that share comes back in full. Within 24 hours, the venue keeps {percentLabel(fee)}% of that friend's share.
      </p>
      {loaded && placesLeft === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-line">This social is full. Pay to put these friends on the waitlist. If someone cancels, the first person waiting gets the place. If the session starts first, that friend's payment is refunded in full.</p>
      ) : null}
      {incentivePoints > 0 ? (
        <p className="mt-2 text-sm font-semibold text-line">
          +{incentivePoints} pts for each friend after the session ends{placesLeft === 0 ? ", if a place opens and they play" : ""}
          {filled.length > 0 ? `. These ${filled.length} friend${filled.length === 1 ? "" : "s"} add +${incentivePoints * filled.length} pts.` : "."}
        </p>
      ) : null}
      {friends.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {friends.map((friend) => (
            <li key={friend.id} className="rounded-2xl border border-white/10 px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  {editingId === friend.id ? (
                    <form
                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onSaveName(friend.id);
                      }}
                    >
                      <label className="min-w-0 flex-1 text-sm text-mist/80">
                        Friend name
                        <input
                          value={draftName}
                          maxLength={80}
                          disabled={savingId === friend.id}
                          className="mt-1 w-full rounded-2xl border border-white/15 bg-black/20 px-3 py-2 text-white outline-none focus:border-line disabled:opacity-60"
                          onChange={(event) => setDraftName(event.target.value)}
                        />
                      </label>
                      <Button type="submit" className="w-full sm:mt-6 sm:w-auto" loading={savingId === friend.id}>Save name</Button>
                      <Button type="button" variant="secondary" className="w-full sm:mt-6 sm:w-auto" disabled={savingId === friend.id} onClick={() => setEditingId(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <p className="truncate font-semibold text-white">{friend.name}</p>
                      <p className="text-sm text-mist/70">
                        {friend.status === "confirmed" ? friend.courtName : friend.status === "waitlist" ? "Waitlist" : "Waiting for payment"}
                        {friend.status === "confirmed" ? <> · <Money amount={friend.amount} currency={currency} /></> : null}
                      </p>
                    </>
                  )}
                </div>
                {editingId === friend.id ? null : (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId !== null || paying || waiting || savingId !== null} onClick={() => { setEditingId(friend.id); setDraftName(friend.name); setConfirmId(null); }}>Edit name</Button>
                    {friend.canCancel ? (
                      confirmId === friend.id ? (
                        <>
                          <Button variant="danger" className="w-full sm:w-auto" loading={pendingId === friend.id} onClick={() => void onCancel(friend.id)}>Confirm cancel</Button>
                          <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === friend.id} onClick={() => setConfirmId(null)}>Keep friend</Button>
                        </>
                      ) : (
                        <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId !== null || paying || waiting || savingId !== null} onClick={() => setConfirmId(friend.id)}>Cancel</Button>
                      )
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {pendingFriends ? <p className="mt-3 text-sm text-mist/70">Unpaid friends are replaced when you pay for a new list.</p> : null}
      {loaded ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onPay();
          }}
        >
          <div className="space-y-2">
            {names.map((name, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1 text-sm text-mist/80">
                  Friend {index + 1}
                  <input
                    value={name}
                    disabled={paying || waiting}
                    maxLength={80}
                    className="mt-1 w-full rounded-2xl border border-white/15 bg-black/20 px-3 py-2 text-white outline-none focus:border-line disabled:opacity-60"
                    onChange={(event) => setNames((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                  />
                </label>
                {names.length > 1 ? (
                  <Button type="button" variant="secondary" className="w-full sm:mt-6 sm:w-auto" disabled={paying || waiting} onClick={() => setNames((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
                ) : null}
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" disabled={paying || waiting || names.length >= friendLimit} onClick={() => setNames((current) => [...current, ""])}>
            Add another friend
          </Button>
          <p className="text-sm text-mist/70">{placesLeft > 0 ? `${placesLeft} place${placesLeft === 1 ? "" : "s"} left. ` : "These friends join the waitlist. "}{filled.length} friend{filled.length === 1 ? "" : "s"} · <Money amount={subtotal} currency={currency} /></p>
          {promotions === null ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading promotion codes</span>
              <Skeleton className="h-14 w-full" />
            </div>
          ) : promotions.length > 0 ? (
            <ul className="grid gap-2">
              {promotions.map((promotion) => {
                const selected = appliedCode?.id === promotion.id;
                return (
                  <li key={promotion.id} className={`flex flex-col gap-2 rounded-2xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${selected ? "border-line/60 bg-line/10" : "border-white/10 bg-black/20"}`}>
                    <div className="min-w-0">
                      <p className="break-all font-semibold tracking-wide text-white">{promotion.code}</p>
                      <p className="text-sm text-line">{promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}</p>
                    </div>
                    <Button type="button" variant={selected ? "primary" : "secondary"} className="w-full shrink-0 sm:w-auto" disabled={paying || waiting} onClick={() => setAppliedCode(selected ? null : promotion)}>
                      {selected ? "Applied" : "Apply"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div>
            <p className="text-sm text-mist/80">Reward points</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pointPercents.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  disabled={paying || waiting || maxPoints === 0}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${points === Math.floor(maxPoints * percent / 100) && maxPoints > 0 ? "bg-line text-ink" : "border border-white/15 text-mist"}`}
                  onClick={() => setPoints(Math.floor(maxPoints * percent / 100))}
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
              aria-label="Reward points for friends"
              className="mt-3 w-full accent-line disabled:opacity-60"
              onChange={(event) => setPoints(Number(event.target.value))}
            />
          </div>
          {preview ? (
            <dl className="grid gap-1 text-sm text-mist/80">
              {discount > 0 ? <div className="flex justify-between gap-3"><dt>Promotion</dt><dd>-<Money amount={discount} currency={currency} /></dd></div> : null}
              <div className="flex justify-between gap-3"><dt>Points value</dt><dd><Money amount={preview.value} currency={currency} /></dd></div>
              <div className="flex justify-between gap-3 font-semibold text-white"><dt>To pay for {filled.length} friend{filled.length === 1 ? "" : "s"}</dt><dd><Money amount={preview.cash} currency={currency} /></dd></div>
            </dl>
          ) : null}
          {cashTooSmall ? <p className="text-sm text-mist">Use enough points to cover these friends, or leave at least $0.50 to pay.</p> : null}
          {error ? <p className="text-sm text-mist" role="alert">{error}</p> : null}
          {notice ? <p className="text-sm text-mist" role="status">{notice}</p> : null}
          {waiting ? <p className="text-sm text-mist" role="status">Checking the payment…</p> : null}
          <Button type="submit" loading={paying || waiting} disabled={filled.length === 0 || cashTooSmall}>
            {placesLeft === 0 ? (preview?.cash === 0 ? "Join with points" : "Pay to join the waitlist") : preview?.cash === 0 ? "Add friends with points" : "Pay for friends"}
          </Button>
        </form>
      ) : null}
      {placesLeft === 0 && error ? <p className="mt-3 text-sm text-mist" role="alert">{error}</p> : null}
    </section>
  );
}
