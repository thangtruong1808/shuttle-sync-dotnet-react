import { Link, useParams } from "react-router-dom";
import { useVenues } from "./SiteLayout";

const columns: { title: string; links: { label: string; href: (slug: string) => string }[] }[] = [
  {
    title: "Book",
    links: [
      { label: "Promotions", href: () => "/promotions" },
      { label: "Rewards", href: () => "/rewards" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "FAQ", href: () => "/faq" },
      { label: "Contact", href: () => "/contact" },
      { label: "Cancellation policy", href: () => "/cancellation" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: () => "/terms" },
      { label: "Privacy", href: () => "/privacy" },
    ],
  },
];

function Mark() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-line text-ink" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M7.1 13.2C7.4 8.6 8.8 4.4 9.8 2.6c.4-.7 1.5-.3 1.3.5-.6 2.6-1.8 6.4-1.9 9.1 0 .6-.5 1-1.1 1h-.1c-.5 0-.9-.4-.9-1Z" />
        <path d="M11.1 13.6c.1-4.8.9-9.2 1.5-11 .2-.6 1.1-.6 1.3 0 .6 1.8 1.4 6.2 1.4 11 0 .6-.5 1.1-1.1 1.1h-.6c-.6 0-1.1-.5-1.1-1.1Z" />
        <path d="M16.9 13.2c-.1-2.7-1.3-6.5-1.9-9.1-.2-.8.9-1.2 1.3-.5 1 1.8 2.4 6 2.7 10.6 0 .6-.4 1-.9 1h-.1c-.6 0-1.1-.4-1.1-1Z" />
        <path d="M8.2 14.8h7.6l-1.05 2.15a1.55 1.55 0 0 1-1.4.8h-2.7a1.55 1.55 0 0 1-1.4-.8L8.2 14.8Z" />
        <circle cx="12" cy="19.7" r="2.05" />
      </svg>
    </span>
  );
}

export function Footer() {
  const { slug } = useParams();
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? venues?.[0] ?? null;
  const map = venue?.latitude != null && venue.longitude != null
    ? `https://maps.google.com/?q=${venue.latitude},${venue.longitude}`
    : null;
  const activeSlug = venue?.slug ?? "";

  return (
    <footer className="mt-auto border-t border-white/10 bg-pine/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.3fr_1fr] lg:px-8">
        <div>
          <Link
            to={activeSlug ? `/${activeSlug}` : "/"}
            {...(venue?.name ? {} : { "aria-label": "Home" })}
            className="inline-flex max-w-full items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
          >
            <Mark />
            {venue?.name ? <span className="font-display text-lg font-semibold leading-tight text-white">{venue.name}</span> : null}
          </Link>
          <address className="mt-3 space-y-1 text-sm not-italic text-mist/70">
            {venue?.address ? <p>{[venue.address, venue.suburb, venue.state, venue.postcode].filter(Boolean).join(", ")}</p> : <p>Select a venue to see its address.</p>}
            {venue?.phone ? <p><a className="hover:text-white" href={`tel:${venue.phone}`}>{venue.phone}</a></p> : null}
            {venue?.email ? <p><a className="hover:text-white" href={`mailto:${venue.email}`}>{venue.email}</a></p> : null}
            {map ? <p><a className="text-line hover:underline" href={map} target="_blank" rel="noreferrer">Open map</a></p> : null}
          </address>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-sm font-semibold text-white">{column.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-mist/70">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line" to={link.href(activeSlug)}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-sm text-mist/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Shuttle Sync</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex gap-3" aria-label="Social">
              <a className="hover:text-white" href="https://instagram.com" target="_blank" rel="noreferrer">Instagram</a>
              <a className="hover:text-white" href="https://facebook.com" target="_blank" rel="noreferrer">Facebook</a>
            </span>
            <span className="rounded-full border border-white/15 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-mist/80">Powered by Stripe</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
