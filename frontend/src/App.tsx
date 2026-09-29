import { useEffect, useState } from "react";
import { Activity, CircleAlert, CircleCheck } from "lucide-react";
import AuthPanel from "./features/auth/AuthPanel";
import DashboardPage from "./features/dashboard/DashboardPage";
import HomePage from "./features/home/HomePage";
import { Skeleton } from "./components/ui";

type HealthResponse = {
  status: string;
  service: string;
};

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"home" | "login" | "dashboard">("home");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API responded with ${response.status}`);
        }
        return (await response.json()) as HealthResponse;
      })
      .then(setHealth)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setError(reason instanceof Error ? reason.message : "Unable to reach the API");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  if (view === "home") {
    return <HomePage onLogin={() => setView("login")} onDashboard={() => setView("dashboard")} />;
  }

  if (view === "dashboard") {
    return <DashboardPage onFront={() => setView("home")} />;
  }

  return (
    <main className="min-h-screen bg-ink text-mist">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(198,245,78,0.18),transparent_60%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8 lg:py-16">
        <section>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-line/30 bg-line/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-line transition hover:bg-line/20"
            onClick={() => setView("home")}
          >
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Shuttle Sync
          </button>
          <h1 className="mt-5 max-w-xl font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
            Court time, synced.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-mist/75 sm:text-lg">
            Sign in to keep your session on this device. The court API status stays visible while you do.
          </p>
          <div className="mt-8 max-w-md rounded-2xl border border-white/10 bg-pine/80 p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-mist/70">
              <Activity className="h-4 w-4 text-line" aria-hidden="true" />
              Court API
            </h2>
            {loading ? (
              <div className="mt-4 space-y-2" aria-busy="true">
                <span className="sr-only">Checking the API</span>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-28" />
              </div>
            ) : error ? (
              <p className="mt-4 flex items-start gap-2 text-sm text-rose-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-base text-mist">
                <CircleCheck className="h-5 w-5 text-line" aria-hidden="true" />
                {health?.service} is {health?.status}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-pine/90 p-5 shadow-2xl shadow-black/30 sm:p-7">
          <h2 className="font-display text-2xl font-semibold text-white">Your account</h2>
          <p className="mt-1 text-sm text-mist/65">Email, Google, or GitHub. Tokens stay in secure cookies.</p>
          <AuthPanel onLoginSuccess={() => setView("home")} />
        </section>
      </div>
    </main>
  );
}

export default App;
