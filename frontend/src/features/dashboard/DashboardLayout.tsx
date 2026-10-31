import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarCheck, ChevronRight, CreditCard, Gift, House, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, ScrollText, Sparkles, Ticket, Users, type LucideIcon } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Skeleton, Spinner } from "../../components/ui";
import { BrandMark, Wordmark } from "../../components/layout/BrandMark";
import { SkipLink } from "../../components/SkipLink";
import { ThemeToggle } from "../../components/theme/ThemeToggle";
import { initials } from "../../components/format";
import { loadCurrentUser, logout } from "../auth/authSlice";
import { recordPageView } from "./dashboardApi";

type DashLink = { to: string; label: string; end: boolean; icon: LucideIcon; admin?: boolean };

const groups: { title: string; links: DashLink[] }[] = [
  { title: "General", links: [{ to: "/dashboard", label: "Overview", end: true, icon: LayoutDashboard }] },
  { title: "Venues", links: [{ to: "/dashboard/venues", label: "Venues", end: false, icon: Building2 }] },
  {
    title: "People",
    links: [
      { to: "/dashboard/users", label: "Users", end: false, admin: true, icon: Users },
      { to: "/dashboard/bookings", label: "Bookings", end: false, icon: CalendarCheck },
    ],
  },
  {
    title: "Money",
    links: [
      { to: "/dashboard/promotions", label: "Promotions", end: false, icon: Ticket },
      { to: "/dashboard/payments", label: "Payments", end: false, icon: CreditCard },
      { to: "/dashboard/rewards", label: "Rewards", end: false, icon: Gift },
    ],
  },
  {
    title: "Insights",
    links: [
      { to: "/dashboard/activity", label: "Activity", end: false, icon: ScrollText },
      { to: "/dashboard/recommendations", label: "Recommendations", end: false, icon: Sparkles },
    ],
  },
];

const links = groups.flatMap((group) => group.links);

function pageTitle(path: string): string {
  const match = links.find((link) => (link.end ? path === link.to : path.startsWith(link.to)));
  if (path.includes("/incentives")) return "Incentives";
  if (path.includes("/closures")) return "Closures";
  if (path.includes("/slots")) return "Slots";
  if (path.includes("/rates")) return "Rates";
  if (path.includes("/courts")) return "Courts";
  if (/^\/dashboard\/venues\/[^/]+$/.test(path)) return "Details";
  if (path.startsWith("/dashboard/venues/")) return "Venue";
  if (path.startsWith("/dashboard/users/")) return "User";
  return match?.label ?? "Dashboard";
}

export default function DashboardLayout() {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void dispatch(loadCurrentUser());
  }, [dispatch]);

  useEffect(() => {
    if (user?.role !== "staff") return;
    const venue = location.pathname.match(/\/dashboard\/venues\/([0-9a-f-]{36})/i)?.[1] ?? null;
    recordPageView(location.pathname, pageTitle(location.pathname), venue);
  }, [location.pathname, user?.role]);

  if (status === "unknown") {
    return (
      <div className="min-h-screen bg-canvas px-4 py-8" aria-busy="true">
        <span className="sr-only">Checking your session</span>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }

  if (user.role !== "staff" && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const title = pageTitle(location.pathname);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-accent/15 text-accent-text" : "text-fg-muted hover:bg-fg/5 hover:text-fg"}`;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <SkipLink />
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-canvas/85 px-4 backdrop-blur-md">
        <button
          type="button"
          title={open ? "Close sidebar" : "Open sidebar"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-fg shadow-sm hover:bg-surface-2"
          aria-expanded={open}
          aria-controls="dashboard-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close sidebar" : "Open sidebar"}</span>
        </button>
        <NavLink to="/dashboard" className="hidden items-center gap-2.5 sm:flex" aria-label="Dashboard home">
          <BrandMark />
          <Wordmark />
        </NavLink>
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="hidden text-fg-muted sm:block">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </li>
            <li className="truncate text-fg-muted">Dashboard</li>
            <li aria-hidden="true"><ChevronRight className="h-4 w-4 text-fg-muted" /></li>
            <li className="truncate font-medium text-fg" aria-current="page">{title}</li>
          </ol>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 shadow-sm">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/20 text-xs font-semibold text-accent-text" aria-hidden="true">{initials(user.displayName, user.email)}</span>
            <span className="hidden min-w-0 leading-tight md:block">
              <span className="block max-w-44 truncate text-sm font-medium text-fg">{user.displayName || user.email}</span>
              <span className="block text-xs capitalize text-fg-muted">{user.role}</span>
            </span>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-text">{user.rewardPoints} pts</span>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          id="dashboard-nav"
          className={`${open ? "fixed bottom-0 top-16 z-30 flex w-64 flex-col border-r border-border bg-surface lg:sticky lg:bottom-auto lg:top-16 lg:h-[calc(100vh-4rem)]" : "hidden"}`}
        >
          <nav className="flex flex-1 flex-col gap-5 overflow-auto px-3 py-5" aria-label="Dashboard">
            {groups.map((group) => {
              const visible = group.links.filter((link) => !link.admin || user.role === "admin");
              if (!visible.length) return null;
              return (
                <div key={group.title}>
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted/80">{group.title}</p>
                  <div className="flex flex-col gap-0.5">
                    {visible.map((link) => {
                      const Icon = link.icon;
                      return (
                        <NavLink key={link.to} to={link.to} end={link.end} title={link.label} className={linkClass} onClick={() => setOpen(window.innerWidth >= 1024)}>
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {link.label}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t border-border px-3 py-3">
            <ThemeToggle showLabels className="mb-2 w-full sm:hidden" />
            <NavLink to="/" title="Back to HomePage" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-fg/5 hover:text-fg">
              <House className="h-4 w-4 shrink-0" aria-hidden="true" />
              Back to HomePage
            </NavLink>
            <button
              type="button"
              title="Log out"
              disabled={leaving}
              aria-busy={leaving}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200"
              onClick={() => {
                setLeaving(true);
                void dispatch(logout())
                  .then(() => navigate("/"))
                  .finally(() => setLeaving(false));
              }}
            >
              {leaving ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              Log out
            </button>
          </div>
        </aside>
        {open ? (
          <button type="button" className="fixed inset-0 z-20 bg-black/50 lg:hidden" aria-label="Close sidebar" onClick={() => setOpen(false)} />
        ) : null}
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
