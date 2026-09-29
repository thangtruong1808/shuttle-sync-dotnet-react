import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CircleCheck, House, LayoutDashboard, LogOut } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { loadCurrentUser, logout } from "../auth/authSlice";

export default function DashboardPage({ onFront }: { onFront: () => void }) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void dispatch(loadCurrentUser());
  }, [dispatch]);

  async function onLogout() {
    setLeaving(true);
    try {
      await dispatch(logout());
      onFront();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-mist md:grid md:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col gap-6 border-b border-white/10 bg-pine/95 p-5 md:min-h-screen md:border-b-0 md:border-r">
        <p className="font-display text-lg font-semibold text-white">Shuttle Sync</p>
        <nav className="flex flex-1 flex-col gap-2" aria-label="Dashboard">
          <span className="inline-flex items-center gap-2 rounded-xl bg-line/15 px-3 py-2.5 text-sm font-semibold text-line">
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </span>
        </nav>
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            className="w-full"
            icon={<House className="h-4 w-4" aria-hidden="true" />}
            onClick={onFront}
          >
            Frontend
          </Button>
          <Button
            variant="danger"
            className="w-full"
            loading={leaving}
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void onLogout()}
          >
            Log out
          </Button>
        </div>
      </aside>
      <main className="px-4 py-8 sm:px-8">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-line">
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
          Dashboard
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Authentication check
        </h1>
        <section className="mt-6 max-w-xl rounded-3xl border border-white/10 bg-pine/80 p-6">
          {status === "unknown" ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Checking your session</span>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : status === "authenticated" && user ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-base text-mist">
                <CircleCheck className="h-5 w-5 text-line" aria-hidden="true" />
                Signed in
              </p>
              <p className="text-sm text-mist/70">
                Email <span className="font-medium text-mist">{user.email}</span>
              </p>
              <p className="text-sm text-mist/70">
                Email verified <span className="font-medium text-mist">{user.emailVerified ? "Yes" : "No"}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-mist/75">No active session. Sign in from the home page to test again.</p>
          )}
        </section>
      </main>
    </div>
  );
}
