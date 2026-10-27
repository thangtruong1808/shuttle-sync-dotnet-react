import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { ErrorState } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { PageHeader, Skeleton } from "../../components/ui";
import type { Venue } from "../venues/venueApi";

function mapHref(venue: Venue): string | null {
  if (venue.latitude != null && venue.longitude != null) {
    return `https://maps.google.com/?q=${venue.latitude},${venue.longitude}`;
  }
  const query = [venue.address, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(", ");
  return query ? `https://maps.google.com/?q=${encodeURIComponent(query)}` : null;
}

export function ContactPage() {
  const { venues, error, reload } = useVenues();
  return (
    <main>
      <PageSection>
        <PageHeader title="Contact" description="Use the phone or email for the venue you selected. Those details come from that venue's record." />
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : venues === null ? (
          <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading venues</span>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : venues.length === 0 ? (
          <p className="text-sm text-fg-muted">No venues are open right now.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {venues.map((venue) => {
              const map = mapHref(venue);
              const address = [venue.address, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(", ");
              return (
                <li key={venue.id} className="rounded-2xl border border-border bg-surface p-5 shadow-card dark:shadow-none">
                  <h2 className="font-display text-xl font-semibold text-fg">{venue.name}</h2>
                  <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
                    {address ? <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{address}</li> : null}
                    {venue.phone ? <li><a className="inline-flex items-center gap-2 hover:text-fg" href={`tel:${venue.phone}`}><Phone className="h-4 w-4" aria-hidden="true" />{venue.phone}</a></li> : null}
                    {venue.email ? <li><a className="inline-flex items-center gap-2 hover:text-fg" href={`mailto:${venue.email}`}><Mail className="h-4 w-4" aria-hidden="true" />{venue.email}</a></li> : null}
                    {map ? (
                      <li>
                        <a className="inline-flex items-center gap-1.5 font-medium text-accent-text hover:underline" href={map} target="_blank" rel="noreferrer">
                          Open map
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </main>
  );
}
