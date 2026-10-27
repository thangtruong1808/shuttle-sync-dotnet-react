import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { CalendarDays, SlidersHorizontal, Users, X } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Card, controlClass, Field, PickerInput, Skeleton } from "../../components/ui";
import { CourtImage, EmptyState, addDays, formatVenueRange, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { useNow } from "../courts/CourtSchedule";
import { loadCurrentUser } from "../auth/authSlice";
import { openSocials, rememberVenueSlug, venueAvailability, venuePromotions, type Availability, type Promotion } from "../venues/venueApi";
import { HomeCourts } from "./HomeCourts";
import { HomeHero } from "./HomeHero";
import { HomePromos } from "./HomePromos";
import { SupportChat } from "./SupportChat";

function openHours(availability: Availability | null): string {
  if (!availability) return "—";
  const span = new Date(availability.windowEnd).getTime() - new Date(availability.windowStart).getTime();
  if (span >= 23 * 60 * 60 * 1000) return "Open all day";
  return formatVenueRange(availability.windowStart, availability.windowEnd, availability.venue.timeZone);
}

export default function HomePage() {
  const { slug = "" } = useParams();
  const { venues, error: venueError, reload, defaultSlug, setDefaultVenue } = useVenues();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const [draft, setDraft] = useState({ date: "", from: "", to: "" });
  const [applied, setApplied] = useState({ date: "", from: "", to: "" });
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "filter" | "clear" | "next">(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hasSocials, setHasSocials] = useState(false);
  const navigate = useNavigate();
  const now = useNow();

  useEffect(() => {
    if (!slug) return;
    let active = true;
    setHasSocials(false);
    openSocials(slug)
      .then((result) => { if (active) setHasSocials(result.socials.length > 0); })
      .catch(() => { if (active) setHasSocials(false); });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (venue) {
      const today = venueToday(venue.timeZone);
      setDraft((current) => ({ ...current, date: current.date || today }));
      setApplied((current) => (current.date ? current : { date: today, from: "", to: "" }));
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !applied.date) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([venueAvailability(slug, applied.date, applied.from, applied.to), venuePromotions(slug)])
      .then(([nextAvailability, nextPromotions]) => {
        if (!controller.signal.aborted) {
          setAvailability(nextAvailability);
          setPromotions(nextPromotions);
          if (status === "authenticated") void dispatch(loadCurrentUser());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Courts could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRetrying(false);
          setBusy(null);
        }
      });
    return () => controller.abort();
  }, [slug, applied, attempt, status, dispatch]);

  function onFilter(event: FormEvent) {
    event.preventDefault();
    setBusy("filter");
    setApplied({ date: draft.date, from: draft.from, to: draft.to });
    setAttempt((value) => value + 1);
  }

  function onClear() {
    const today = venue ? venueToday(venue.timeZone) : draft.date || applied.date;
    if (!today) {
      return;
    }
    setBusy("clear");
    setDraft({ date: today, from: "", to: "" });
    setApplied({ date: today, from: "", to: "" });
    setAttempt((value) => value + 1);
  }

  if (venues && !venue) {
    return (
      <PageSection>
        <EmptyState title="Venue not found" body="Choose another venue from the menu." />
      </PageSection>
    );
  }

  const others = (venues ?? []).filter((item) => item.slug !== slug);
  const nextDay = applied.date ? addDays(applied.date, 1) : "";
  const today = venue ? venueToday(venue.timeZone) : "";
  const filtered = Boolean(applied.from || applied.to || (today && applied.date && applied.date !== today));
  const hours = openHours(availability);
  const cancelPercent = venue ? String(Number(venue.lateCancelFeePercent.toFixed(2))) : "0";

  return (
    <main>
      <PageSection>
        {venue ? (
          <HomeHero
            venue={venue}
            slug={slug}
            hasSocials={hasSocials}
            showDefault={(venues?.length ?? 0) > 1}
            isDefault={defaultSlug === venue.slug}
            onDefault={(checked) => setDefaultVenue(checked ? venue.slug : null)}
            hours={hours}
            courts={availability ? String(availability.courts.length) : "—"}
            cancelPercent={cancelPercent}
          />
        ) : (
          <Skeleton className="h-80 rounded-3xl" />
        )}

        <Card className="mt-8" title="Find a court" description="Choose a day to find a free court. A court with no bookings is available. Booked times are shown on that court.">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onFilter}>
            <Field label="Date" required>
              {({ id }) => (
                <PickerInput id={id} type="date" required value={draft.date} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className={controlClass} />
              )}
            </Field>
            <Field label="From">
              {({ id }) => (
                <PickerInput id={id} type="time" value={draft.from} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className={controlClass} />
              )}
            </Field>
            <Field label="To">
              {({ id }) => (
                <PickerInput id={id} type="time" value={draft.to} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className={controlClass} />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" className="w-full sm:w-auto" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />} loading={busy === "filter"} disabled={!draft.date || (busy !== null && busy !== "filter")}>Filter</Button>
              <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate(`/${slug}/book`)}>Book a court</Button>
              {hasSocials ? <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<Users className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate(`/${slug}/social`)}>Register for public social</Button> : null}
              {filtered || busy === "clear" ? (
                <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={busy === "clear"} disabled={busy !== null && busy !== "clear"} onClick={onClear}>Clear</Button>
              ) : null}
            </div>
          </form>
        </Card>

        <HomePromos promotions={promotions} loading={loading} currency={venue?.currency ?? "AUD"} timeZone={venue?.timeZone ?? "Australia/Melbourne"} />

        <HomeCourts
          availability={availability}
          loading={loading || !applied.date}
          error={error}
          venueError={venueError}
          onRetryVenue={reload}
          retrying={retrying}
          onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }}
          nextDay={nextDay}
          nextLoading={busy === "next"}
          nextDisabled={busy !== null && busy !== "next"}
          onNext={() => {
            setDraft((current) => ({ ...current, date: nextDay }));
            setBusy("next");
            setApplied((current) => ({ ...current, date: nextDay }));
            setAttempt((value) => value + 1);
          }}
          now={now}
        />

        {others.length > 0 ? (
          <section className="mt-10" aria-labelledby="other-venues">
            <h2 id="other-venues" className="font-display text-2xl text-fg">Other venues</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((item) => (
                <li key={item.id}>
                  <Link to={`/${item.slug}`} className="block rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-accent-text/40 dark:shadow-none">
                    <CourtImage src={item.imageUrl} alt="" />
                    <p className="mt-3 font-medium text-fg">{item.name}</p>
                    <p className="text-sm text-fg-muted">{item.suburb ?? "View courts"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageSection>
      <SupportChat venueName={venue?.name ?? "this venue"} venueSlug={slug} date={applied.date} />
    </main>
  );
}
