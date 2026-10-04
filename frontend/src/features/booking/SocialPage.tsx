import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDay, formatVenueRange } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { Button, Skeleton } from "../../components/ui";
import { SessionClock, useNow } from "../courts/CourtSchedule";
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
        <h1 className="mt-3 font-display text-3xl text-white">Register for public social</h1>
        <p className="mt-2 max-w-xl text-sm text-mist/75">Choose one or more open times. You register and pay for them together. A court is assigned when you register, starting with court 1 and 8 players on each court.</p>
        <p className="mt-2 max-w-xl text-sm text-mist/75">{`More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps ${Number(fee.toFixed(2))}% and refunds the rest.`}</p>
        <div className="mt-6 max-w-xl rounded-3xl border border-white/10 bg-pine/80 p-6">
          {error ? (
            <ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} />
          ) : status === "unknown" || loading || socials === null ? (
            <div aria-busy="true">
              <span className="sr-only">Loading drop-in times</span>
              <Skeleton className="h-16" />
            </div>
          ) : open.length === 0 ? (
            <p className="text-sm text-mist/70">No drop-in social is open yet.</p>
          ) : (
            <>
              <div role="group" aria-label="Available drop-in times" className="grid gap-2">
                {open.map((social) => {
                  const locked = social.yourStatus === "confirmed" || social.full === true;
                  const pressed = selected.includes(social.id);
                  return (
                    <div key={social.id} className={`rounded-2xl border px-3 py-2 ${pressed ? "border-line/60 bg-line/10" : "border-white/10"}`}>
                      <button
                        type="button"
                        className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                        aria-pressed={locked ? undefined : pressed}
                        disabled={locked}
                        onClick={() => toggle(social.id)}
                      >
                        <p className="text-sm font-semibold text-white">{formatVenueDay(social.startTime, timeZone)}</p>
                        <p className="whitespace-nowrap text-sm text-white">{formatVenueRange(social.startTime, social.endTime, timeZone)}</p>
                        <SessionClock start={social.startTime} end={social.endTime} />
                        <p className="text-sm text-mist/75">
                          {social.yourStatus === "confirmed" && social.yourCourtName
                            ? `You're on ${social.yourCourtName}.`
                            : social.full
                              ? "Full"
                              : `${social.playerCount} player${social.playerCount === 1 ? "" : "s"} joined.`}
                          {typeof social.price === "number" ? <> · <Money amount={social.price} currency={currency} /></> : null}
                        </p>
                        {social.repeatWeekly ? <p className="text-sm font-medium text-line">This slot repeats weekly.</p> : null}
                      </button>
                      {social.yourStatus === "confirmed" ? (
                        <Button type="button" variant="secondary" className="mt-2 w-full sm:w-auto" onClick={() => navigate(`/${slug}/social/${social.id}`)}>
                          View registration
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
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
