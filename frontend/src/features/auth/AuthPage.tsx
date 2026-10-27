import { useEffect } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarCheck, Gift, ShieldCheck, Users } from "lucide-react";
import type { RootState } from "../../app/store";
import { BrandMark } from "../../components/layout/BrandMark";
import AuthPanel from "./AuthPanel";

const highlights = [
  { icon: CalendarCheck, title: "Book in seconds", body: "Pick a time, tick your courts, and pay or hold the week." },
  { icon: Users, title: "Join public socials", body: "Drop in, bring friends, and get a waitlist spot when it is full." },
  { icon: Gift, title: "Earn reward points", body: "Every completed visit adds points you can spend on your next booking." },
];

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const status = useSelector((state: RootState) => state.auth.status);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const signedIn = status === "authenticated";

  useEffect(() => {
    if (signedIn && !params.get("authError")) {
      navigate(destination ?? "/", { replace: true });
    }
  }, [destination, navigate, params, signedIn]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="grid overflow-hidden rounded-3xl border border-border bg-surface shadow-card dark:shadow-none lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden overflow-hidden bg-[radial-gradient(120%_90%_at_0%_0%,rgb(var(--accent)/0.28),transparent_60%),linear-gradient(160deg,#10261c,#07140f)] p-10 text-white lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10" />
            <span className="font-display text-lg font-semibold">Shuttle Sync</span>
          </div>
          <h2 className="mt-12 max-w-md font-display text-4xl font-semibold leading-tight tracking-tight">
            Your next badminton session is a few taps away.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/70">
            Real-time court availability, weekly holds, and secure Stripe checkout for clubs and players.
          </p>
          <ul className="mt-10 space-y-5">
            {highlights.map((item) => (
              <li key={item.title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#c6f54e] ring-1 ring-white/10">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-white/65">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-auto flex items-center gap-2 pt-10 text-sm text-white/60">
            <ShieldCheck className="h-4 w-4 text-[#c6f54e]" aria-hidden="true" />
            Tokens stay in secure, HTTP-only cookies.
          </p>
        </section>
        <section className="p-6 sm:p-10">
          <div className="mx-auto max-w-sm">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              {signedIn ? "Your account" : mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              {signedIn ? "Manage where you are signed in." : "Use your email, Google, or GitHub."}
            </p>
            <div className="mt-8">
              <AuthPanel initialMode={mode} onLoginSuccess={() => navigate(destination ?? "/")} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
