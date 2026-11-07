import { useState, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, Gift, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, Shield, Sparkles, UserRound, Users, Wallet } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { logout } from "../auth/authSlice";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { initials } from "../../components/format";
import { Skeleton, Spinner } from "../../components/ui";
import { PaymentNotice } from "./PaymentReminder";
import { useUnreadRecommendations } from "./RecommendationNotice";

const sections = [
  { to: "/profile", label: "Overview", end: true, icon: LayoutDashboard },
  { to: "/profile/details", label: "Personal info", end: false, icon: UserRound },
  { to: "/profile/bookings", label: "My bookings", end: false, icon: CalendarDays },
  { to: "/profile/friend-spots", label: "Friend spots", end: false, icon: Users },
  { to: "/profile/rewards", label: "Reward points", end: false, icon: Gift },
  { to: "/profile/payments", label: "Payments & refunds", end: false, icon: Wallet },
  { to: "/profile/recommendations", label: "Recommendations", end: false, icon: Sparkles },
  { to: "/profile/security", label: "Security", end: false, icon: Shield },
];

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative flex min-w-0 shrink-0 lg:w-full">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-fg/15 bg-surface-2 px-2 py-1 text-xs font-medium text-fg shadow-lg group-hover/tip:block group-focus-within/tip:block lg:left-full lg:top-1/2 lg:ml-2 lg:mt-0 lg:-translate-y-1/2 lg:translate-x-0"
      >
        {label}
      </span>
    </span>
  );
}

export default function ProfileLayout() {
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(true);
  const unreadRecommendations = useUnreadRecommendations();

  if (status === "unknown") {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
        <span className="sr-only">Checking your session</span>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium ${isActive ? "bg-accent/15 text-accent-text" : "text-fg-muted hover:bg-fg/5 hover:text-fg"} ${open ? "lg:w-full" : "lg:h-12 lg:w-full lg:justify-center lg:px-0"}`;

  return (
    <div className={`mx-auto grid w-full max-w-7xl min-w-0 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 ${open ? "lg:grid-cols-[16rem_minmax(0,1fr)]" : "lg:grid-cols-[4.5rem_minmax(0,1fr)]"}`}>
      <aside className={`min-w-0 rounded-2xl border border-border bg-surface shadow-card dark:shadow-none lg:min-h-[32rem] ${open ? "p-3 lg:p-4" : "p-3"}`}>
        <button
          type="button"
          title={open ? "Close sidebar" : "Open sidebar"}
          className={`hidden items-center justify-center rounded-xl border border-border text-fg hover:bg-fg/5 lg:flex ${open ? "h-11 w-11" : "h-12 w-full"}`}
          aria-expanded={open}
          aria-controls="profile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-6 w-6" />}
          <span className="sr-only">{open ? "Close sidebar" : "Open sidebar"}</span>
        </button>
        <div className={`mt-0 flex items-center gap-3 lg:mt-4 ${open ? "" : "lg:hidden"}`}>
            {user.userAvatar ? (
              <img src={user.userAvatar} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-full bg-fg/10 font-semibold text-fg">{initials(user.displayName, user.email)}</span>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{user.displayName || "Your account"}</p>
              <p className="truncate text-sm text-fg/65">{user.email}</p>
              <p className="text-sm font-semibold text-accent-text">{user.rewardPoints} pts</p>
            </div>
          </div>
        <nav id="profile-nav" className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Profile">
          {sections.map((section) => {
            const Icon = section.icon;
            const link = (
              <NavLink key={section.to} to={section.to} end={section.end} title={section.label} className={linkClass}>
                <span className="relative">
                  <Icon className={open ? "h-4 w-4 shrink-0" : "h-6 w-6 shrink-0"} aria-hidden="true" />
                  {!open && section.to === "/profile/recommendations" && unreadRecommendations > 0 ? <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-accent" /> : null}
                </span>
                <span className={open ? "" : "lg:sr-only"}>{section.label}</span>
                {open && section.to === "/profile/recommendations" && unreadRecommendations > 0 ? (
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">{unreadRecommendations}</span>
                ) : null}
              </NavLink>
            );
            return open ? link : <Tip key={section.to} label={section.label}>{link}</Tip>;
          })}
          <button
            type="button"
            title="Log out"
            disabled={leaving}
            aria-busy={leaving}
            className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-700 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200 ${open ? "lg:w-full" : "lg:h-12 lg:w-full lg:justify-center lg:px-0"}`}
            onClick={() => {
              setLeaving(true);
              void dispatch(logout())
                .then(() => navigate("/"))
                .finally(() => setLeaving(false));
            }}
          >
            {leaving ? <Spinner className="h-4 w-4" /> : <LogOut className={open ? "h-4 w-4" : "h-4 w-4 lg:h-6 lg:w-6"} aria-hidden="true" />}
            <span className={open ? "" : "lg:sr-only"}>Log out</span>
          </button>
        </nav>
      </aside>
      <main className="min-w-0">
        <PaymentNotice />
        <Outlet />
      </main>
    </div>
  );
}
