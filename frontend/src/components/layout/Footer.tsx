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
      { label: "Business hours", href: () => "/business-hours", icon: Clock },
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
        <div className="reveal-left">
          <Link to={activeSlug ? `/${activeSlug}` : "/"} className={`inline-flex items-center gap-2.5 ${focusRing}`}>
            <BrandMark />
            <Wordmark />
          </Link>
          {venue?.name ? <p className="mt-4 font-display text-lg font-semibold leading-tight text-fg">{venue.name}</p> : null}
          <address className="mt-2 space-y-1.5 text-sm not-italic text-fg-muted">
            {venue?.address ? (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{[venue.address, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(", ")}</span></p>
            ) : (
              <p>Select a venue to see its address.</p>
            )}
            {venue?.phone ? <p><a className={`inline-flex min-h-9 items-center gap-2 hover:text-fg ${focusRing}`} href={`tel:${venue.phone}`}><Phone className="h-4 w-4 shrink-0" aria-hidden="true" />{venue.phone}</a></p> : null}
            {venue?.email ? <p><a className={`inline-flex min-h-9 items-center gap-2 break-all hover:text-fg sm:break-normal ${focusRing}`} href={`mailto:${venue.email}`}><Mail className="h-4 w-4 shrink-0" aria-hidden="true" />{venue.email}</a></p> : null}
            {map ? <p><a className={`inline-flex min-h-9 items-center gap-1.5 font-medium text-accent-text hover:underline ${focusRing}`} href={map} target="_blank" rel="noreferrer">Open map<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></a></p> : null}
          </address>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 reveal-stagger">
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-fg">{column.title}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className={`inline-flex min-h-10 items-center gap-2 py-1 transition-colors hover:text-fg ${focusRing}`} to={link.href(activeSlug)}>
                      <link.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
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
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" aria-labelledby="meet-developer">
          <div className="flex flex-col gap-6 rounded-3xl border border-border bg-surface-2 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-6 reveal-scale">
            <img
              src="/ThangTruong.jpg"
              alt="Thang Truong, the developer of Shuttle Sync"
              className="h-36 w-36 shrink-0 rounded-2xl object-cover object-top shadow-card sm:h-40 sm:w-40 reveal-left"
            />
            <div className="min-w-0 reveal-right">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">Meet the developer</p>
              <h2 id="meet-developer" className="mt-1 font-display text-2xl font-semibold text-fg">Thang Truong</h2>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                Thang built Shuttle Sync so a badminton club can take bookings without a spreadsheet. Players see which courts are free, hold a weekly time, and pay by card. Each venue keeps its own hours, weekday and weekend rates, and social sessions.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                An AI chatbot supports the booking itself. It asks whether the player wants a court today or on a later date, then a start time, and it calls the live booking API so the suggested courts match the hours and rates that are actually open.
              </p>
              <ul className="mt-4 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
                <li>
                  <a className={`inline-flex min-h-10 items-center gap-2 break-all font-medium text-fg hover:text-accent-text sm:break-normal ${focusRing}`} href="mailto:thangtruong1808@gmail.com">
                    <Mail className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                    thangtruong1808@gmail.com
                  </a>
                </li>
                <li>
                  <a className={`inline-flex min-h-10 items-center gap-2 font-medium text-fg hover:text-accent-text ${focusRing}`} href="tel:+61466828649">
                    <Phone className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                    0466 828 649
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 reveal-up">
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
