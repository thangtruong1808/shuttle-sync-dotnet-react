import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueRange, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { useNow } from "../courts/CourtSchedule";
import { rememberVenueSlug, venueAvailability, type PublicSocial } from "../venues/venueApi";

export default function SocialPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSelector((state: RootState) => state.auth.status);
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const now = useNow();
  const [date, setDate] = useState("");
  const [socials, setSocials] = useState<PublicSocial[] | null>(null);
  const [timeZone, setTimeZone] = useState("Australia/Melbourne");
  const [currency, setCurrency] = useState("AUD");
  const [fee, setFee] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (venue) {
      setDate((current) => current || venueToday(venue.timeZone));
      setFee(venue.lateCancelFeePercent);
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !date) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSocials(null);
    venueAvailability(slug, date, "", "")
      .then((next) => {
        if (controller.signal.aborted) return;
        setSocials(next.socials ?? []);
        setTimeZone(next.venue.timeZone);
        setCurrency(next.venue.currency);
        setFee(next.venue.lateCancelFeePercent);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Drop-in times could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, date, attempt]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const openSocials = (socials ?? []).filter((social) => new Date(social.endTime).getTime() > now);

  return (
    <main>
      <PageSection>
        <Link to={`/${slug}`} className="text-sm text-line hover:underline">Back to the venue</Link>
        <h1 className="mt-3 font-display text-3xl text-white">Register for public social</h1>
        <p className="mt-2 max-w-xl text-sm text-mist/75">Join a drop-in game. You do not need your own group. Your place is confirmed after payment, starting on court 1 with 8 players on each court.</p>
        <p className="mt-2 max-w-xl text-sm text-mist/75">{`More than 24 hours before the start, you get a full refund. Within 24 hours, the venue keeps ${Number(fee.toFixed(2))}% and refunds the rest.`}</p>
        <div className="mt-6 max-w-xl rounded-3xl border border-white/10 bg-pine/80 p-6">
          <label className="text-sm block max-w-xs">
            <span className="mb-1 flex items-center gap-2 text-mist/70">Date {loading ? <Spinner className="h-3.5 w-3.5" /> : null}</span>
            <PickerInput type="date" required value={date} disabled={loading || !date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
          </label>
          {error ? (
            <div className="mt-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
          ) : status === "unknown" || loading || socials === null ? (
            <div className="mt-4" aria-busy="true">
              <span className="sr-only">Loading drop-in times</span>
              <Skeleton className="h-16" />
            </div>
          ) : openSocials.length === 0 ? (
            <p className="mt-4 text-sm text-mist/70">No drop-in social on this day yet.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {openSocials.map((social) => (
                <li key={social.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="whitespace-nowrap text-sm text-white">{formatVenueRange(social.startTime, social.endTime, timeZone)}</p>
                    <p className="text-sm text-mist/75">
                      {social.yourStatus === "confirmed" && social.yourCourtName
                        ? `You're on ${social.yourCourtName}.`
                        : `${social.playerCount} player${social.playerCount === 1 ? "" : "s"} joined.`}
                      {typeof social.price === "number" ? <> · <Money amount={social.price} currency={currency} /></> : null}
                    </p>
                  </div>
                  <Button type="button" className="w-full sm:w-auto" onClick={() => navigate(`/${slug}/social/${social.id}`)}>
                    {social.yourStatus === "confirmed" ? "View registration" : social.yourStatus === "pending" ? "Finish payment" : "Continue"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>
    </main>
  );
}
