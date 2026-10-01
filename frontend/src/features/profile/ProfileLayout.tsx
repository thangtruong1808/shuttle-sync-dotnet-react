import { useState, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, Gift, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, Shield, UserRound, Wallet } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { logout } from "../auth/authSlice";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { initials } from "../../components/format";
import { Skeleton, Spinner } from "../../components/ui";

const sections = [
  { to: "/profile", label: "Overview", end: true, icon: LayoutDashboard },
  { to: "/profile/details", label: "Personal info", end: false, icon: UserRound },
  { to: "/profile/bookings", label: "My bookings", end: false, icon: CalendarDays },
  { to: "/profile/rewards", label: "Reward points", end: false, icon: Gift },
  { to: "/profile/payments", label: "Payments & refunds", end: false, icon: Wallet },
  { to: "/profile/security", label: "Security", end: false, icon: Shield },
];

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-[#10241b] px-2 py-1 text-xs font-medium text-white shadow-lg group-hover/tip:block group-focus-within/tip:block lg:left-full lg:top-1/2 lg:ml-2 lg:mt-0 lg:-translate-y-1/2 lg:translate-x-0"
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

  if (status === "unknown") {
    return (
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
        <span className="sr-only">Checking your session</span>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${isActive ? "bg-line/15 text-line" : "text-mist/80 hover:bg-white/5"} ${open ? "" : "px-2"}`;

  return (
    <div className={`grid w-full gap-6 px-4 py-8 sm:px-6 lg:px-8 ${open ? "lg:grid-cols-[16rem_1fr]" : "lg:grid-cols-[4.5rem_1fr]"}`}>
      <aside className={`rounded-3xl border border-white/10 bg-pine/80 lg:min-h-[32rem] ${open ? "p-4" : "p-2"}`}>
        <Tip label={open ? "Close sidebar" : "Open sidebar"}>
          <button
            type="button"
            title={open ? "Close sidebar" : "Open sidebar"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-mist hover:bg-white/5"
            aria-expanded={open}
            aria-controls="profile-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
            <span className="sr-only">{open ? "Close sidebar" : "Open sidebar"}</span>
          </button>
        </Tip>
        {open ? (
          <div className="mt-4 flex items-center gap-3">
            {user.userAvatar ? (
              <img src={user.userAvatar} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 font-semibold text-white">{initials(user.displayName, user.email)}</span>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{user.displayName || "Your account"}</p>
              <p className="truncate text-sm text-mist/65">{user.email}</p>
              <p className="text-sm font-semibold text-line">{user.rewardPoints} pts</p>
            </div>
          </div>
        ) : null}
        <nav id="profile-nav" className={`mt-4 flex gap-2 lg:flex-col ${open ? "overflow-auto" : "flex-wrap overflow-visible"}`} aria-label="Profile">
          {sections.map((section) => {
            const Icon = section.icon;
            const link = (
              <NavLink key={section.to} to={section.to} end={section.end} title={section.label} className={linkClass}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {open ? section.label : <span className="sr-only">{section.label}</span>}
              </NavLink>
            );
            return open ? link : <Tip key={section.to} label={section.label}>{link}</Tip>;
          })}
          {open ? (
            <button
              type="button"
              title="Log out"
              disabled={leaving}
              aria-busy={leaving}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
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
          ) : (
            <Tip label="Log out">
              <button
                type="button"
                title="Log out"
                disabled={leaving}
                aria-busy={leaving}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  setLeaving(true);
                  void dispatch(logout())
                    .then(() => navigate("/"))
                    .finally(() => setLeaving(false));
                }}
              >
                {leaving ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                <span className="sr-only">Log out</span>
              </button>
            </Tip>
          )}
        </nav>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
