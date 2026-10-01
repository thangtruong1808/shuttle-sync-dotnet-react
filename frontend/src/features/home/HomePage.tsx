import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Home, LayoutDashboard, LogIn, UserRound } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { loadCurrentUser } from "../auth/authSlice";

export default function HomePage({
  onLogin,
  onDashboard,
}: {
  onLogin: () => void;
  onDashboard: () => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const username = user?.displayName || user?.email;

  useEffect(() => {
    if (status === "unknown") {
      void dispatch(loadCurrentUser());
    }
  }, [dispatch, status]);

  return (
    <main className="min-h-screen bg-ink text-mist">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(198,245,78,0.18),transparent_60%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-lg items-center px-4 py-10 sm:px-6">
        <section className="w-full rounded-3xl border border-white/10 bg-pine/90 p-6 shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-0.5 active:scale-[0.98] sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-line/30 bg-line/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-line">
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            Home
          </p>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Court time, synced.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-mist/75 sm:text-lg">
            Book and follow your court from one place. Sign in when you are ready.
          </p>


          {status === "unknown" ? (
            <Skeleton className="mt-8 h-11 w-36" />
          ) : status === "authenticated" && username ? (
            <div className="mt-8 space-y-4">
              <p className="flex items-center gap-2 text-base text-mist">
                <UserRound className="h-5 w-5 text-line" aria-hidden="true" />
                <span>
                  Signed in as <span className="font-medium text-white">{username}</span>
                </span>
              </p>
              <Button
                icon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
                onClick={onDashboard}
              >
                Dashboard
              </Button>
            </div>
          ) : (
            <Button
              className="mt-8"
              icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
              onClick={onLogin}
            >
              Sign in
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
