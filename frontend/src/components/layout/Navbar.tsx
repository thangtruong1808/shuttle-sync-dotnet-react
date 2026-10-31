import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { CalendarDays, ChevronDown, Gift, House, LayoutDashboard, LogIn, MapPin, Menu, Search, UserPlus, UserRound, X } from "lucide-react";
import type { RootState } from "../../app/store";
import { initials } from "../format";
import { Dropdown, Skeleton, buttonClass, useDismiss } from "../ui";
import { ThemeToggle } from "../theme/ThemeToggle";
import { PaymentBell } from "../../features/profile/PaymentReminder";
import { RecommendationBell } from "../../features/profile/RecommendationNotice";
import { rememberVenueSlug, venueForPage } from "../../features/venues/venueApi";
import { BrandMark, Wordmark } from "./BrandMark";
import { SkipLink } from "../SkipLink";
import { useVenues } from "./SiteLayout";

const links = [
  { label: "Home", to: (slug: string) => `/${slug}`, icon: House },
  { label: "My Bookings", to: (slug: string) => (slug ? `/profile/bookings?venue=${encodeURIComponent(slug)}` : "/profile/bookings"), icon: CalendarDays },
  { label: "Rewards", to: () => "/rewards", icon: Gift },
];

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text";

type NavUser = { userAvatar: string | null; displayName: string | null; email: string; rewardPoints: number; role: string };

export function Navbar() {
  const { venues, defaultSlug } = useVenues();
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSelector((state: RootState) => state.auth.user);
  const status = useSelector((state: RootState) => state.auth.status);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const current = venues?.find((venue) => venue.slug === slug) ?? null;
  const onBookings = location.pathname === "/profile/bookings";
  const bookingsVenue = onBookings ? new URLSearchParams(location.search).get("venue") ?? undefined : undefined;
  const shown = venueForPage(venues, slug ?? bookingsVenue, defaultSlug);
  const activeSlug = shown?.slug ?? "";
  const staff = user && (user.role === "staff" || user.role === "admin");

  useEffect(() => {
    if (current) {
      rememberVenueSlug(current.slug);
    }
  }, [current]);

  useEffect(() => {
    setMenuOpen(false);
    setOpen(false);
  }, [location.pathname]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (venues ?? []).filter((venue) =>
      `${venue.name} ${venue.suburb ?? ""}`.toLowerCase().includes(needle),
    );
  }, [query, venues]);

  function chooseVenue(nextSlug: string) {
    rememberVenueSlug(nextSlug);
    setOpen(false);
    setQuery("");
    if (onBookings) {
      navigate(`/profile/bookings?venue=${encodeURIComponent(nextSlug)}`);
      return;
    }
    if (slug && (location.pathname === `/${slug}` || location.pathname.startsWith(`/${slug}/`))) {
      navigate(`/${nextSlug}${location.pathname.slice(`/${slug}`.length)}${location.search}`);
      return;
    }
    navigate(`/${nextSlug}`);
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${focusRing} ${
      isActive ? "bg-accent/15 text-accent-text" : "text-fg-muted hover:bg-fg/5 hover:text-fg"
    }`;

  const picker = (id: string) => (
    <VenuePicker
      listId={id}
      open={open}
      query={query}
      venues={filtered}
      name={shown?.name ?? null}
      suburb={shown?.suburb ?? null}
      searchRef={searchRef}
      onQuery={setQuery}
      onToggle={() => {
        setOpen((value) => !value);
        setQuery("");
      }}
      onClose={() => setOpen(false)}
      onChoose={chooseVenue}
    />
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70">
      <SkipLink />
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <NavLink to={activeSlug ? `/${activeSlug}` : "/"} className={`flex shrink-0 items-center gap-2.5 rounded-lg ${focusRing}`}>
          <BrandMark />
          <Wordmark />
        </NavLink>

        <div className="hidden min-w-0 flex-1 md:block md:max-w-72">{picker(listId)}</div>

        <nav className="ml-auto hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {links.map((link) => (
            <NavLink key={link.label} to={link.to(activeSlug)} className={linkClass} end={link.label === "Home"}>
              <link.icon className="h-4 w-4" aria-hidden="true" />
              {link.label}
            </NavLink>
          ))}
          {staff ? (
            <NavLink to="/dashboard" className={linkClass}><LayoutDashboard className="h-4 w-4" aria-hidden="true" />Dashboard</NavLink>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-2">
          {status === "unknown" ? (
            <div aria-busy="true">
              <span className="sr-only">Checking your session</span>
              <Skeleton className="h-9 w-16 rounded-full sm:w-28" />
            </div>
          ) : status !== "authenticated" || !user ? (
            <div className="hidden items-center gap-1.5 sm:flex">
              <NavLink to="/login" className={buttonClass("ghost", "sm", focusRing)}><LogIn className="h-4 w-4" aria-hidden="true" />Log in</NavLink>
              <NavLink to="/register" className={buttonClass("primary", "sm", focusRing)}><UserPlus className="h-4 w-4" aria-hidden="true" />Sign up</NavLink>
            </div>
          ) : (
            <>
              <RecommendationBell />
              <PaymentBell />
              <UserMenu user={user} staff={Boolean(staff)} activeSlug={activeSlug} />
            </>
          )}
          <button
            type="button"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg hover:bg-fg/5 lg:hidden ${focusRing}`}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div id="mobile-nav" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border bg-surface px-4 pb-5 pt-3 shadow-pop lg:hidden">
          <div className="mb-3 md:hidden">{picker(`${listId}-mobile`)}</div>
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {links.map((link) => (
              <NavLink key={link.label} to={link.to(activeSlug)} className={linkClass} end={link.label === "Home"}>
                <link.icon className="h-4 w-4" aria-hidden="true" />
                {link.label}
              </NavLink>
            ))}
            {staff ? (
              <NavLink to="/dashboard" className={linkClass}><LayoutDashboard className="h-4 w-4" aria-hidden="true" />Dashboard</NavLink>
            ) : null}
            {status === "unknown" ? (
              <div aria-busy="true">
                <span className="sr-only">Checking your session</span>
                <Skeleton className="h-10 w-full" />
              </div>
            ) : status !== "authenticated" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NavLink to="/login" className={buttonClass("secondary", "md", focusRing)}><LogIn className="h-4 w-4" aria-hidden="true" />Log in</NavLink>
                <NavLink to="/register" className={buttonClass("primary", "md", focusRing)}><UserPlus className="h-4 w-4" aria-hidden="true" />Sign up</NavLink>
              </div>
            ) : null}
          </nav>
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Appearance</p>
            <ThemeToggle showLabels className="w-full" />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function UserMenu({ user, staff, activeSlug }: { user: NavUser; staff: boolean; activeSlug: string }) {
  const item = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg hover:bg-fg/5 ${focusRing}`;
  return (
    <Dropdown
      label="Account"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label="Account menu"
          onClick={toggle}
          className={`flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 shadow-sm transition-colors hover:bg-surface-2 ${focusRing}`}
        >
          <Avatar user={user} />
          <span className="hidden rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-text sm:inline">{user.rewardPoints} pts</span>
          <ChevronDown className={`h-3.5 w-3.5 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
            <Avatar user={user} size="h-10 w-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{user.displayName || "Your account"}</p>
              <p className="truncate text-xs text-fg-muted">{user.email}</p>
            </div>
          </div>
          <div className="mx-2.5 mb-2 flex items-center justify-between rounded-lg bg-accent/10 px-3 py-2 text-xs">
            <span className="text-fg-muted">Reward points</span>
            <span className="font-semibold tabular-nums text-accent-text">{user.rewardPoints}</span>
          </div>
          <div className="border-t border-border pt-1.5" role="none">
            <Link role="menuitem" to="/profile" className={item} onClick={close}><UserRound className="h-4 w-4 text-fg-muted" aria-hidden="true" />Profile</Link>
            <Link role="menuitem" to={activeSlug ? `/profile/bookings?venue=${encodeURIComponent(activeSlug)}` : "/profile/bookings"} className={item} onClick={close}>
              <CalendarDays className="h-4 w-4 text-fg-muted" aria-hidden="true" />My bookings
            </Link>
            {staff ? <Link role="menuitem" to="/dashboard" className={item} onClick={close}><LayoutDashboard className="h-4 w-4 text-fg-muted" aria-hidden="true" />Dashboard</Link> : null}
          </div>
          <div className="mt-1.5 border-t border-border px-2.5 pb-1.5 pt-3">
            <p className="mb-2 text-xs font-medium text-fg-muted">Appearance</p>
            <ThemeToggle showLabels className="w-full" />
          </div>
        </>
      )}
    </Dropdown>
  );
}

function Avatar({ user, size = "h-8 w-8" }: { user: { userAvatar: string | null; displayName: string | null; email: string }; size?: string }) {
  if (user.userAvatar) {
    return <img src={user.userAvatar} alt="" className={`${size} rounded-full object-cover`} />;
  }
  return (
    <span className={`grid ${size} place-items-center rounded-full bg-accent/20 text-xs font-semibold text-accent-text`} aria-hidden="true">
      {initials(user.displayName, user.email)}
    </span>
  );
}

function VenuePicker({
  listId,
  open,
  query,
  venues,
  name,
  suburb,
  searchRef,
  onQuery,
  onToggle,
  onClose,
  onChoose,
}: {
  listId: string;
  open: boolean;
  query: string;
  venues: { slug: string; name: string; suburb: string | null }[];
  name: string | null;
  suburb: string | null;
  searchRef: RefObject<HTMLInputElement>;
  onQuery: (value: string) => void;
  onToggle: () => void;
  onClose: () => void;
  onChoose: (slug: string) => void;
}) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-left shadow-sm transition-colors hover:bg-surface-2 ${focusRing}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <MapPin className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium text-fg">{name ?? "Choose a venue"}</span>
          {suburb ? <span className="block truncate text-xs text-fg-muted">{suburb}</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-40 mt-2 w-full min-w-72 rounded-2xl border border-border bg-surface p-2 shadow-pop">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Search venues"
              aria-label="Search venues"
              className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent-text focus-visible:ring-2 focus-visible:ring-accent-text/30"
            />
          </label>
          <ul id={listId} role="listbox" aria-label="Venues" className="mt-2 max-h-64 overflow-auto">
            {venues.length === 0 ? (
              <li className="px-2 py-3 text-sm text-fg-muted">No venues match.</li>
            ) : (
              venues.map((venue) => (
                <li key={venue.slug}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={venue.name === name}
                    className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-fg/5 ${focusRing} ${venue.name === name ? "bg-accent/10" : ""}`}
                    onClick={() => onChoose(venue.slug)}
                  >
                    <span className="text-sm font-medium text-fg">{venue.name}</span>
                    {venue.suburb ? <span className="text-xs text-fg-muted">{venue.suburb}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
