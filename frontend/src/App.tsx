import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
  service: string;
};

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-400">
          Shuttle Sync
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Frontend and API are running together.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-slate-300">
          React 18, TypeScript, and Tailwind CSS v3 on the client. ASP.NET Core on the server.
        </p>

        <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-sm font-medium text-slate-400">Backend health</h2>
          {health ? (
            <p className="mt-3 text-lg">
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
              {health.service} is {health.status}
            </p>
          ) : error ? (
            <p className="mt-3 text-rose-300">{error}</p>
          ) : (
            <p className="mt-3 text-slate-400">Checking the API...</p>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
