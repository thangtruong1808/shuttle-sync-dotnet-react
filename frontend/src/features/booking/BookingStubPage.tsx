import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState, Money, formatVenueDateTime } from "../../components/format";
import { PageSection } from "../../components/layout/SiteLayout";
import { Skeleton } from "../../components/ui";
import { venueSlot, type CourtSlotDetail } from "../venues/venueApi";

export default function BookingStubPage() {
  const { slug = "", sessionId = "" } = useParams();
  const [slot, setSlot] = useState<CourtSlotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    setSlot(null);
    venueSlot(slug, sessionId)
      .then(setSlot)
      .catch(() => setError("This slot could not be loaded."));
  }, [slug, sessionId, attempt]);

  return (
    <main>
      <PageSection>
        <Link to={`/${slug}/courts`} className="text-sm text-line hover:underline">Back to courts</Link>
        <h1 className="mt-3 font-display text-3xl text-white">Book this court</h1>
        {!slot && !error ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <span className="sr-only">Loading slot</span>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : slot ? (
          <article className="mt-6 max-w-xl rounded-3xl border border-white/10 bg-pine/80 p-6">
            <h2 className="font-display text-2xl text-white">{slot.courtName}</h2>
            <p className="mt-2 text-mist/75">Court {slot.courtNumber}</p>
            <p className="mt-1 text-mist/75">{formatVenueDateTime(slot.startTime, slot.venue.timeZone)} – {formatVenueDateTime(slot.endTime, slot.venue.timeZone)}</p>
            <p className="mt-4 text-lg font-semibold text-white"><Money amount={slot.price} currency={slot.venue.currency} /></p>
            {slot.incentivePoints ? <p className="mt-2 text-sm font-semibold text-line">+{slot.incentivePoints} pts after the session ends</p> : null}
            <p className="mt-6 rounded-2xl bg-white/5 px-4 py-3 text-sm text-mist/80">Checkout is not wired yet. The price shown is the server price for this slot.</p>
          </article>
        ) : null}
      </PageSection>
    </main>
  );
}
