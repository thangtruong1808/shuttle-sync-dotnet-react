import { Link, Outlet, useParams } from "react-router-dom";
import { ArrowRight, MapPinOff } from "lucide-react";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { buttonClass } from "../../components/ui";

export default function VenueGate() {
  const { slug } = useParams();
  const { venues } = useVenues();
  if (!venues || venues.some((venue) => venue.slug === slug)) {
    return <Outlet />;
  }
  return <VenueNotFound slug={slug ?? ""} venues={venues} />;
}

function VenueNotFound({ slug, venues }: { slug: string; venues: { slug: string; name: string; suburb: string | null }[] }) {
  return (
    <main>
      <PageSection>
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent-text">
            <MapPinOff className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-fg">Venue not found</h1>
          <p className="mt-2 text-fg-muted">
            There is no venue at <span className="break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-fg">/{slug}</span>. It may have moved to a new address.
          </p>
          {venues.length ? (
            <ul className="mt-8 grid gap-2 text-left sm:grid-cols-2">
              {venues.map((venue) => (
                <li key={venue.slug}>
                  <Link
                    to={`/${venue.slug}`}
                    className="group flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-accent-text/40 dark:shadow-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{venue.name}</span>
                      {venue.suburb ? <span className="block truncate text-sm text-fg-muted">{venue.suburb}</span> : null}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <Link to="/" className={buttonClass("secondary", "md", "mt-8")}>Go to the home page</Link>
        </div>
      </PageSection>
    </main>
  );
}
