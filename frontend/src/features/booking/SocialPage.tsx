import { useEffect, useState } from "react";
import { ArrowRight, Clock, UserPlus, Users } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDay, formatVenueRange } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { Badge, Button, Skeleton } from "../../components/ui";
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
        <Link to={`/${slug}`} className="text-sm text-accent-text hover:underline">Back to the venue</Link>
        <h1 className="mt-3 font-display text-3xl text-fg sm:text-4xl">Register for public social</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">Choose one or more open times. You register and pay for them together. A court is assigned when you register, filling court 1 first up to the players and courts set for that time.</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg/75">{`More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps ${Number(fee.toFixed(2))}% and refunds the rest.`}</p>
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
            <p className="text-sm text-fg/70">No drop-in social is open yet.</p>
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
              <Button type="button" className="mt-4 w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} disabled={selected.length === 0} onClick={continueRegistration}>
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
  const seats = limit > 0 ? limit * each : 0;
  const taken = seats > 0 ? Math.min(seats, social.playerCount) : 0;
  const details = (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {full ? <Badge tone="warning">Full</Badge> : null}
        {yours === "waitlist" ? <Badge tone="info">Waitlist</Badge> : null}
        {waiting > 0 ? <Badge tone="neutral">{waiting} waiting</Badge> : null}
      </div>
      <p className="text-sm font-semibold text-fg">{formatVenueDay(social.startTime, timeZone)}</p>
      <p className="whitespace-nowrap text-sm text-fg">{formatVenueRange(social.startTime, social.endTime, timeZone)}</p>
      <SessionClock start={social.startTime} end={social.endTime} />
      {limit > 0 ? (
        <div className="mt-2">
          <p className="text-sm text-fg-muted">{social.playerCount} of {seats} players · {each} per court · {limit} {limit === 1 ? "court" : "courts"}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inset" role="meter" aria-label="Places taken" aria-valuemin={0} aria-valuemax={seats} aria-valuenow={taken}>
            <div className={`h-full rounded-full ${full ? "bg-amber-400" : "bg-accent"}`} style={{ width: `${seats === 0 ? 0 : Math.round((taken / seats) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <SocialRoster playerCount={social.playerCount} courtCount={social.courtLimit ?? courtCount} playersPerCourt={social.playersPerCourt} courts={social.courts ?? []} />
      <p className="mt-3 text-sm text-fg/75">
        {yours === "confirmed" && social.yourCourtName
          ? `You're on ${social.yourCourtName}.`
          : yours === "waitlist"
            ? "You're on the waitlist."
            : full
              ? "This social is full."
              : "Places are still open."}
        {typeof social.price === "number" ? <> · <Money amount={social.price} currency={currency} /></> : null}
      </p>
      <p className="text-sm text-fg/70">{waiting} {waiting === 1 ? "person" : "people"} on the waitlist.</p>
      {full ? (
        <p className="mt-2 text-sm leading-relaxed text-accent-text">This social is full. Join the waitlist to register, or add friends if you already have a place. If someone cancels, the first person waiting gets the place.</p>
      ) : null}
      {social.repeatWeekly ? <p className="mt-2 text-sm font-medium text-accent-text">This slot repeats weekly.</p> : null}
    </>
  );

  return (
    <article className={`flex h-full flex-col rounded-2xl border p-4 shadow-card dark:shadow-none ${pressed ? "border-accent-text/60 bg-accent/10" : full ? "border-amber-500/40 bg-surface" : "border-border bg-surface"}`}>
      {canSelect ? (
        <button type="button" className="w-full text-left" aria-pressed={pressed} onClick={onToggle}>
          {details}
        </button>
      ) : (
        <div>{details}</div>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-4">
        {full && yours !== "confirmed" && yours !== "waitlist" ? (
          <Button type="button" className="w-full" icon={<Clock className="h-4 w-4" aria-hidden="true" />} onClick={() => onOpen(false)}>Join the waitlist</Button>
        ) : null}
        {full && yours === "confirmed" ? (
          <Button type="button" className="w-full" icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => onOpen(true)}>Add friends to the waitlist</Button>
        ) : null}
        {yours === "waitlist" ? (
          <Button type="button" className="w-full" icon={<Users className="h-4 w-4" aria-hidden="true" />} onClick={() => onOpen(false)}>View waitlist place</Button>
        ) : null}
        {yours === "confirmed" && !full ? (
          <Button type="button" className="w-full" icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => onOpen(true)}>Add friends</Button>
        ) : null}
        <CourtRoster slug={slug} socialId={social.id} />
      </div>
    </article>
  );
}
