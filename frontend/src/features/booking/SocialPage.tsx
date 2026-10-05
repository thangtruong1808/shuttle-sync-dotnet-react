import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDay, formatVenueRange } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { Button, Skeleton } from "../../components/ui";
import { CourtRoster, SessionClock, SocialRoster, useNow } from "../courts/CourtSchedule";
import { openSocials, rememberVenueSlug, type PublicSocial } from "../venues/venueApi";

export default function SocialPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSelector((state: RootState) => state.auth.status);
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const now = useNow();
  const [socials, setSocials] = useState<PublicSocial[] | null>(null);
  const [timeZone, setTimeZone] = useState(venue?.timeZone ?? "Australia/Melbourne");
  const [currency, setCurrency] = useState(venue?.currency ?? "AUD");
  const [fee, setFee] = useState(venue?.lateCancelFeePercent ?? 0);
  const [courtCount, setCourtCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (venue) {
      setFee(venue.lateCancelFeePercent);
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || status === "anonymous") return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    openSocials(slug)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSocials(next.socials ?? []);
        setTimeZone(next.venue.timeZone);
        setCurrency(next.venue.currency);
        setFee(next.venue.lateCancelFeePercent);
        setCourtCount(next.courtCount ?? 0);
        setSelected((current) => current.filter((id) => (next.socials ?? []).some((social) => social.id === id && social.yourStatus !== "confirmed" && !social.full)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Drop-in times could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, attempt, status]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const open = (socials ?? []).filter((social) => new Date(social.endTime).getTime() > now);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function continueRegistration() {
    if (selected.length === 1) {
      navigate(`/${slug}/social/${selected[0]}`);
      return;
    }
    if (selected.length > 1) {
      navigate(`/${slug}/social/checkout?ids=${selected.map(encodeURIComponent).join(",")}`);
    }
  }

  return (
    <main>
      <PageSection>
        <Link to={`/${slug}`} className="text-sm text-line hover:underline">Back to the venue</Link>
        <h1 className="mt-3 font-display text-3xl text-white sm:text-4xl">Register for public social</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">Choose one or more open times. You register and pay for them together. A court is assigned when you register, filling court 1 first up to the players and courts set for that time.</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist/75">{`More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps ${Number(fee.toFixed(2))}% and refunds the rest.`}</p>
        <div className="mt-6">
          {error ? (
            <ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} />
          ) : status === "unknown" || loading || socials === null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              <span className="sr-only">Loading drop-in times</span>
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : open.length === 0 ? (
            <p className="text-sm text-mist/70">No drop-in social is open yet.</p>
          ) : (
            <>
              <div role="group" aria-label="Available drop-in times" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {open.map((social) => (
                  <SessionCard
                    key={social.id}
                    social={social}
                    timeZone={timeZone}
                    currency={currency}
                    courtCount={courtCount}
                    slug={slug}
                    pressed={selected.includes(social.id)}
                    onToggle={() => toggle(social.id)}
                    onOpen={(friends) => navigate(`/${slug}/social/${social.id}${friends ? "?add=friends" : ""}`)}
                  />
                ))}
              </div>
              <Button type="button" className="mt-4 w-full sm:w-auto" disabled={selected.length === 0} onClick={continueRegistration}>
                {selected.length > 1 ? `Continue with ${selected.length} times` : "Continue"}
              </Button>
            </>
          )}
        </div>
      </PageSection>
    </main>
  );
}

function SessionCard({
  social,
  timeZone,
  currency,
  courtCount,
  slug,
  pressed,
  onToggle,
  onOpen,
}: {
  social: PublicSocial;
  timeZone: string;
  currency: string;
  courtCount: number;
  slug: string;
  pressed: boolean;
  onToggle: () => void;
  onOpen: (friends: boolean) => void;
}) {
  const each = social.playersPerCourt && social.playersPerCourt > 0 ? social.playersPerCourt : 8;
  const limit = social.courtLimit ?? courtCount;
  const full = social.full === true || (limit > 0 && social.playerCount >= limit * each);
  const yours = social.yourStatus;
  const canSelect = !full && yours !== "confirmed" && yours !== "waitlist";
  const waiting = social.waitlistCount ?? 0;
  const details = (
    <>
      <p className="text-sm font-semibold text-white">{formatVenueDay(social.startTime, timeZone)}</p>
      <p className="whitespace-nowrap text-sm text-white">{formatVenueRange(social.startTime, social.endTime, timeZone)}</p>
      <SessionClock start={social.startTime} end={social.endTime} />
      {limit > 0 ? (
        <p className="mt-2 text-sm text-mist/80">{social.playerCount} of {limit * each} players · {each} per court · {limit} {limit === 1 ? "court" : "courts"}</p>
      ) : null}
      <SocialRoster playerCount={social.playerCount} courtCount={social.courtLimit ?? courtCount} playersPerCourt={social.playersPerCourt} courts={social.courts ?? []} />
      <p className="mt-3 text-sm text-mist/75">
        {yours === "confirmed" && social.yourCourtName
          ? `You're on ${social.yourCourtName}.`
          : yours === "waitlist"
            ? "You're on the waitlist."
            : full
              ? "This social is full."
              : "Places are still open."}
        {typeof social.price === "number" ? <> · <Money amount={social.price} currency={currency} /></> : null}
      </p>
      <p className="text-sm text-mist/70">{waiting} {waiting === 1 ? "person" : "people"} on the waitlist.</p>
      {full ? (
        <p className="mt-2 text-sm leading-relaxed text-line">This social is full. Join the waitlist to register, or add friends if you already have a place. If someone cancels, the first person waiting gets the place.</p>
      ) : null}
      {social.repeatWeekly ? <p className="mt-2 text-sm font-medium text-line">This slot repeats weekly.</p> : null}
    </>
  );

  return (
    <article className={`flex h-full flex-col rounded-3xl border p-4 ${pressed ? "border-line/60 bg-line/10" : full ? "border-line/40 bg-pine/80" : "border-white/10 bg-pine/80 hover:border-line/40"}`}>
      {canSelect ? (
        <button type="button" className="w-full text-left" aria-pressed={pressed} onClick={onToggle}>
          {details}
        </button>
      ) : (
        <div>{details}</div>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-4">
        {full && yours !== "confirmed" && yours !== "waitlist" ? (
          <Button type="button" className="w-full" onClick={() => onOpen(false)}>Join the waitlist</Button>
        ) : null}
        {full && yours === "confirmed" ? (
          <Button type="button" className="w-full" onClick={() => onOpen(true)}>Add friends to the waitlist</Button>
        ) : null}
        {yours === "waitlist" ? (
          <Button type="button" className="w-full" onClick={() => onOpen(false)}>View waitlist place</Button>
        ) : null}
        {yours === "confirmed" && !full ? (
          <Button type="button" className="w-full" onClick={() => onOpen(true)}>Add friends</Button>
        ) : null}
        <CourtRoster slug={slug} socialId={social.id} />
      </div>
    </article>
  );
}
