import { Link } from "react-router-dom";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { buttonClass } from "../../components/ui";

export function NotFoundPage() {
  const { venues, defaultSlug } = useVenues();
  const slug = defaultSlug ?? venues?.[0]?.slug ?? "";
  return (
    <main>
      <PageSection>
        <div className="mx-auto max-w-lg py-10 text-center">
          <MissingCourt />
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Page not found</h1>
          <p className="mt-3 text-fg-muted">That page is not on Shuttle Sync. Head home, or book a court if you already know where you are playing.</p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link to="/" className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}>Back home</Link>
            {slug ? <Link to={`/${slug}/book`} className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`}>Book a court</Link> : null}
          </div>
        </div>
      </PageSection>
    </main>
  );
}

function MissingCourt() {
  return (
    <svg viewBox="0 0 160 120" className="mx-auto h-28 w-40" aria-hidden="true">
      <rect x="8" y="18" width="144" height="84" rx="18" className="fill-surface stroke-border" strokeWidth="2" />
      <path d="M28 78c18-28 36-28 54 0s36 28 54 0" className="stroke-accent-text" fill="none" strokeWidth="3" strokeLinecap="round" />
      <circle cx="112" cy="46" r="10" className="fill-accent" />
      <path d="M108 46h8M112 42v8" className="stroke-accent-fg" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
