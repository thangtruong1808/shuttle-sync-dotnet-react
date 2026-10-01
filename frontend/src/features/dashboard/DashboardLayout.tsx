import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarCheck, CreditCard, Gift, House, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, ScrollText, Sparkles, Ticket, Users } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Skeleton, Spinner } from "../../components/ui";
import { loadCurrentUser, logout } from "../auth/authSlice";
import { recordPageView } from "./dashboardApi";

const links = [
  { to: "/dashboard", label: "Overview", end: true, icon: LayoutDashboard },
  { to: "/dashboard/venues", label: "Venues", end: false, icon: Building2 },
  { to: "/dashboard/users", label: "Users", end: false, admin: true, icon: Users },
  { to: "/dashboard/bookings", label: "Bookings", end: false, icon: CalendarCheck },
  { to: "/dashboard/promotions", label: "Promotions", end: false, icon: Ticket },
  { to: "/dashboard/payments", label: "Payments", end: false, icon: CreditCard },
  { to: "/dashboard/rewards", label: "Rewards", end: false, icon: Gift },
  { to: "/dashboard/activity", label: "Activity", end: false, icon: ScrollText },
  { to: "/dashboard/recommendations", label: "Recommendations", end: false, icon: Sparkles },
];

function pageTitle(path: string): string {
  const match = links.find((link) => (link.end ? path === link.to : path.startsWith(link.to)));
  if (path.includes("/incentives")) return "Incentives";
  if (path.includes("/closures")) return "Closures";
  if (path.includes("/slots")) return "Slots";
  if (path.includes("/courts")) return "Courts";
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
      <div className="min-h-screen px-4 py-8" aria-busy="true">
        <span className="sr-only">Checking your session</span>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (user.role !== "staff" && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${isActive ? "bg-line/15 text-line" : "text-mist/80 hover:bg-white/5"}`;

  return (
    <div className="flex min-h-screen flex-col bg-[#07140f]">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#07140f]/95 px-4 backdrop-blur">
        <button
          type="button"
          title={open ? "Close sidebar" : "Open sidebar"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-mist hover:bg-white/5"
          aria-expanded={open}
          aria-controls="dashboard-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
          <span className="sr-only">{open ? "Close sidebar" : "Open sidebar"}</span>
        </button>
        <p className="font-display text-lg text-white">Dashboard</p>
        <p className="ml-auto truncate text-sm text-mist/70">{user.email}</p>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          id="dashboard-nav"
          className={`${open ? "fixed bottom-0 top-14 z-30 flex w-64 flex-col border-r border-white/10 bg-pine lg:sticky lg:bottom-auto lg:top-14 lg:h-[calc(100vh-3.5rem)]" : "hidden"}`}
        >
          <nav className="flex flex-1 flex-col gap-1 overflow-auto px-3 py-4" aria-label="Dashboard">
            {links
              .filter((link) => !link.admin || user.role === "admin")
              .map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink key={link.to} to={link.to} end={link.end} title={link.label} className={linkClass} onClick={() => setOpen(window.innerWidth >= 1024)}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {link.label}
                  </NavLink>
                );
              })}
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t border-white/10 px-3 py-3">
            <button
              type="button"
              title="Log out"
              disabled={leaving}
              aria-busy={leaving}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
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
            <NavLink to="/" title="Back to HomePage" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-mist/70 hover:bg-white/5">
              <House className="h-4 w-4 shrink-0" aria-hidden="true" />
              Back to HomePage
            </NavLink>
          </div>
        </aside>
        {open ? (
          <button type="button" className="fixed inset-0 z-20 bg-black/50 lg:hidden" aria-label="Close sidebar" onClick={() => setOpen(false)} />
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
