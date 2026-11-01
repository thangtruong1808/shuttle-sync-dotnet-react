import { Link, useLocation, useParams } from "react-router-dom";
import { CircleHelp, Clock, ExternalLink, Gift, Mail, MapPin, Phone, Scale, Shield, Ticket, type LucideIcon } from "lucide-react";
import { venueForPage } from "../../features/venues/venueApi";
import { ThemeToggle } from "../theme/ThemeToggle";
import { BrandMark, Wordmark } from "./BrandMark";
import { useVenues } from "./SiteLayout";

const columns: { title: string; links: { label: string; href: (slug: string) => string; icon: LucideIcon }[] }[] = [
  {
    title: "Book",
    links: [
      { label: "Promotions", href: () => "/promotions", icon: Ticket },
      { label: "Rewards", href: () => "/rewards", icon: Gift },
      { label: "Business hours", href: () => "/business-hours", icon: Clock },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "FAQ", href: () => "/faq", icon: CircleHelp },
      { label: "Contact", href: () => "/contact", icon: Phone },
      { label: "Cancellation policy", href: () => "/cancellation", icon: Scale },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: () => "/terms", icon: Scale },
      { label: "Privacy", href: () => "/privacy", icon: Shield },
    ],
  },
];

const focusRing = "rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text";

export function Footer() {
  const { slug } = useParams();
  const location = useLocation();
  const { venues, defaultSlug } = useVenues();
  const bookingsVenue = location.pathname === "/profile/bookings" ? new URLSearchParams(location.search).get("venue") ?? undefined : undefined;
  const venue = venueForPage(venues, slug ?? bookingsVenue, defaultSlug);
  const map = venue?.latitude != null && venue.longitude != null
    ? `https://maps.google.com/?q=${venue.latitude},${venue.longitude}`
    : null;
  const activeSlug = venue?.slug ?? "";

  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_2fr] lg:px-8">
        <div>
          <Link to={activeSlug ? `/${activeSlug}` : "/"} className={`inline-flex items-center gap-2.5 ${focusRing}`}>
            <BrandMark />
            <Wordmark />
          </Link>
          {venue?.name ? <p className="mt-4 font-display text-lg font-semibold leading-tight text-fg">{venue.name}</p> : null}
          <address className="mt-2 space-y-1.5 text-sm not-italic text-fg-muted">
            {venue?.address ? (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{[venue.address, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(", ")}</p>
            ) : (
              <p>Select a venue to see its address.</p>
            )}
            {venue?.phone ? <p><a className={`inline-flex items-center gap-2 hover:text-fg ${focusRing}`} href={`tel:${venue.phone}`}><Phone className="h-4 w-4" aria-hidden="true" />{venue.phone}</a></p> : null}
            {venue?.email ? <p><a className={`inline-flex items-center gap-2 hover:text-fg ${focusRing}`} href={`mailto:${venue.email}`}><Mail className="h-4 w-4" aria-hidden="true" />{venue.email}</a></p> : null}
            {map ? <p><a className={`inline-flex items-center gap-1.5 font-medium text-accent-text hover:underline ${focusRing}`} href={map} target="_blank" rel="noreferrer">Open map<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></p> : null}
          </address>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-fg">{column.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm text-fg-muted">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className={`inline-flex items-center gap-2 transition-colors hover:text-fg ${focusRing}`} to={link.href(activeSlug)}>
                      <link.icon className="h-4 w-4" aria-hidden="true" />
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Shuttle Sync</p>
          <div className="flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Powered by Stripe</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
