import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { ChevronDown, Menu, X } from "lucide-react";
import type { RootState } from "../../app/store";
import { initials } from "../format";
import { rememberVenueSlug } from "../../features/venues/venueApi";
import { useVenues } from "./SiteLayout";

const links = [
  { label: "Home", to: (slug: string) => `/${slug}` },
  { label: "Courts", to: (slug: string) => `/${slug}/courts` },
  { label: "My Bookings", to: () => "/profile/bookings" },
  { label: "Rewards", to: () => "/rewards" },
];

export function Navbar() {
  const { venues } = useVenues();
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
  const activeSlug = current?.slug ?? venues?.[0]?.slug ?? "";

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
    const suffix = location.pathname.startsWith(`/${slug}/`)
      ? location.pathname.slice(`/${slug}`.length)
      : location.pathname === `/${slug}`
        ? ""
        : "";
    if (slug && (location.pathname === `/${slug}` || location.pathname.startsWith(`/${slug}/`))) {
      navigate(`/${nextSlug}${suffix}${location.search}`);
      return;
    }
    navigate(`/${nextSlug}`);
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line ${
      isActive ? "bg-line/15 text-line" : "text-mist/80 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <NavLink to={activeSlug ? `/${activeSlug}` : "/"} className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-line text-sm font-bold text-ink" aria-hidden="true">S</span>
          <span className="font-display text-base font-semibold text-white">Shuttle Sync</span>
        </NavLink>

        <div className="relative hidden min-w-0 flex-1 md:block md:max-w-xs">
          <VenuePicker
            listId={listId}
            open={open}
            query={query}
            venues={filtered}
            label={current ? `${current.name}${current.suburb ? ` · ${current.suburb}` : ""}` : "Choose a venue"}
            searchRef={searchRef}
            onQuery={setQuery}
            onToggle={() => {
              setOpen((value) => !value);
              setQuery("");
            }}
            onChoose={chooseVenue}
          />
        </div>

        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Primary">
          {links.map((link) => (
            <NavLink key={link.label} to={link.to(activeSlug)} className={linkClass} end={link.label === "Home"}>
              {link.label}
            </NavLink>
          ))}
          {user && (user.role === "staff" || user.role === "admin") ? (
            <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {status !== "authenticated" || !user ? (
            <div className="hidden items-center gap-2 sm:flex">
              <NavLink to="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-mist hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line">Log in</NavLink>
              <NavLink to="/register" className="rounded-xl bg-line px-3 py-2 text-sm font-semibold text-ink hover:bg-lime-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line">Sign up</NavLink>
            </div>
          ) : (
            <NavLink
              to="/profile"
              title={`${user.displayName || user.email}\n${user.email}`}
              className="group relative flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
            >
              <Avatar user={user} />
              <span className="rounded-full bg-line/15 px-2 py-0.5 text-xs font-semibold text-line">{user.rewardPoints} pts</span>
              <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-56 rounded-xl border border-white/10 bg-pine p-3 text-left text-sm shadow-xl group-hover:block">
                <span className="block font-medium text-white">{user.displayName || "Your account"}</span>
                <span className="mt-1 block text-mist/70">{user.email}</span>
              </span>
            </NavLink>
          )}
          <button
            type="button"
            className="rounded-lg p-2 text-mist hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line lg:hidden"
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
        <div id="mobile-nav" className="border-t border-white/10 px-4 py-3 lg:hidden">
          <div className="mb-3 md:hidden">
            <VenuePicker
              listId={`${listId}-mobile`}
              open={open}
              query={query}
              venues={filtered}
              label={current ? `${current.name}${current.suburb ? ` · ${current.suburb}` : ""}` : "Choose a venue"}
              searchRef={searchRef}
              onQuery={setQuery}
              onToggle={() => setOpen((value) => !value)}
              onChoose={chooseVenue}
            />
          </div>
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {links.map((link) => (
              <NavLink key={link.label} to={link.to(activeSlug)} className={linkClass} end={link.label === "Home"}>
                {link.label}
              </NavLink>
            ))}
            {user && (user.role === "staff" || user.role === "admin") ? (
              <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
            ) : null}
            {status !== "authenticated" ? (
              <>
                <NavLink to="/login" className={linkClass}>Log in</NavLink>
                <NavLink to="/register" className={linkClass}>Sign up</NavLink>
              </>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function Avatar({ user }: { user: { userAvatar: string | null; displayName: string | null; email: string } }) {
  if (user.userAvatar) {
    return <img src={user.userAvatar} alt="" className="h-8 w-8 rounded-full object-cover" />;
  }
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white" aria-hidden="true">
      {initials(user.displayName, user.email)}
    </span>
  );
}

function VenuePicker({
  listId,
  open,
  query,
  venues,
  label,
  searchRef,
  onQuery,
  onToggle,
  onChoose,
}: {
  listId: string;
  open: boolean;
  query: string;
  venues: { slug: string; name: string; suburb: string | null }[];
  label: string;
  searchRef: RefObject<HTMLInputElement>;
  onQuery: (value: string) => void;
  onToggle: () => void;
  onChoose: (slug: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-20 mt-2 w-full min-w-64 rounded-xl border border-white/10 bg-pine p-2 shadow-2xl">
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search venues"
            aria-label="Search venues"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
          />
          <ul id={listId} role="listbox" aria-label="Venues" className="mt-2 max-h-64 overflow-auto">
            {venues.length === 0 ? (
              <li className="px-2 py-3 text-sm text-mist/60">No venues match.</li>
            ) : (
              venues.map((venue) => (
                <li key={venue.slug}>
                  <button
                    type="button"
                    role="option"
                    className="flex w-full flex-col rounded-lg px-2 py-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
                    onClick={() => onChoose(venue.slug)}
                  >
                    <span className="text-sm font-medium text-white">{venue.name}</span>
                    {venue.suburb ? <span className="text-xs text-mist/60">{venue.suburb}</span> : null}
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
