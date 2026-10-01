import { useState } from "react";
import { useDispatch } from "react-redux";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { AppDispatch } from "../../app/store";
import { logout } from "../auth/authSlice";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { initials } from "../../components/format";
import { Skeleton, Spinner } from "../../components/ui";

const sections = [
  { to: "/profile", label: "Overview", end: true },
  { to: "/profile/details", label: "Personal info", end: false },
  { to: "/profile/bookings", label: "My bookings", end: false },
  { to: "/profile/rewards", label: "Reward points", end: false },
  { to: "/profile/payments", label: "Payments & refunds", end: false },
  { to: "/profile/security", label: "Security", end: false },
];

export default function ProfileLayout() {
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [leaving, setLeaving] = useState(false);

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
    `rounded-xl px-3 py-2 text-sm font-medium ${isActive ? "bg-line/15 text-line" : "text-mist/80 hover:bg-white/5"}`;

  return (
    <div className="grid w-full gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[16rem_1fr] lg:px-8">
      <aside className="rounded-3xl border border-white/10 bg-pine/80 p-4 lg:min-h-[32rem]">
        <div className="flex items-center gap-3">
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
        <nav className="mt-4 flex gap-2 overflow-auto lg:flex-col" aria-label="Profile">
          {sections.map((section) => (
            <NavLink key={section.to} to={section.to} end={section.end} className={linkClass}>
              {section.label}
            </NavLink>
          ))}
          <button
            type="button"
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
            {leaving ? <Spinner className="h-4 w-4" /> : null}
            Log out
          </button>
        </nav>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
