import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  CircleAlert,
  CircleCheck,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  MonitorSmartphone,
  ShieldOff,
  UserPlus,
} from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { AuthRequestError, providerStartUrl } from "./authApi";
import {
  fetchSessions,
  loadCurrentUser,
  login,
  logout,
  logoutAll,
  register,
  revokeSession,
} from "./authSlice";
import { validateCredentials, type FieldErrors } from "./validation";

const authErrorMessages: Record<string, string> = {
  password_account: "An account with this email already exists. Sign in with your password.",
  email_unverified: "That provider did not return a verified email address.",
  oauth_failed: "Sign-in with the provider could not be completed.",
};

export default function AuthPanel({ onLoginSuccess }: { onLoginSuccess?: () => void }) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const sessions = useSelector((state: RootState) => state.auth.sessions);
  const sessionsStatus = useSelector((state: RootState) => state.auth.sessionsStatus);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [submitting, setSubmitting] = useState(false);
  const [startingProvider, setStartingProvider] = useState<"google" | "github" | null>(null);
  const [pendingAction, setPendingAction] = useState<"logout" | "logout-all" | string | null>(null);

  useEffect(() => {
    void dispatch(loadCurrentUser());
    const authError = new URLSearchParams(window.location.search).get("authError");
    if (authError) {
      setMessageTone("error");
      setFormMessage(authErrorMessages[authError] ?? authErrorMessages.oauth_failed);
    }
  }, [dispatch]);

  useEffect(() => {
    if (status === "authenticated") {
      void dispatch(fetchSessions());
    }
  }, [dispatch, status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateCredentials(email, password);
    setFieldErrors(errors);
    setFormMessage(null);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "register") {
        await dispatch(register(email, password));
        setMode("login");
        setPassword("");
        setMessageTone("success");
        setFormMessage("Account created. Sign in with your password.");
      } else {
        await dispatch(login(email, password));
        setPassword("");
        onLoginSuccess?.();
      }
    } catch (error) {
      setMessageTone("error");
      if (error instanceof AuthRequestError) {
        setFieldErrors(error.fieldErrors);
        setFormMessage(error.fieldErrors.form?.[0] ?? null);
      } else {
        setFormMessage("The request could not be completed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function startProvider(provider: "google" | "github") {
    setFormMessage(null);
    setStartingProvider(provider);
    try {
      const response = await fetch(providerStartUrl(provider), {
        credentials: "include",
        redirect: "manual",
      });
      if (response.type === "opaqueredirect" || response.status === 0) {
        window.location.assign(providerStartUrl(provider));
        return;
      }

      const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
      setMessageTone("error");
      setFormMessage(body?.errors?.form?.[0] ?? authErrorMessages.oauth_failed);
      setStartingProvider(null);
    } catch {
      setMessageTone("error");
      setFormMessage(authErrorMessages.oauth_failed);
      setStartingProvider(null);
    }
  }

  async function runAction(action: "logout" | "logout-all" | string) {
    setPendingAction(action);
    try {
      if (action === "logout") {
        await dispatch(logout());
      } else if (action === "logout-all") {
        await dispatch(logoutAll());
      } else {
        await dispatch(revokeSession(action));
      }
    } finally {
      setPendingAction(null);
    }
  }

  if (status === "unknown") {
    return (
      <div className="mt-5 space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Checking your session</span>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-32" />
      </div>
    );
  }

  if (status === "authenticated" && user) {
    return (
      <div className="mt-5 space-y-5">
        <div className="flex items-start gap-3 rounded-2xl bg-white/5 p-4">
          <span className="mt-0.5 rounded-full bg-line/15 p-2 text-line">
            <CircleCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm text-mist/70">Signed in</p>
            <p className="font-medium text-mist">{user.email}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            loading={pendingAction === "logout"}
            disabled={pendingAction !== null}
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void runAction("logout")}
          >
            Log out
          </Button>
          <Button
            variant="danger"
            className="w-full sm:w-auto"
            loading={pendingAction === "logout-all"}
            disabled={pendingAction !== null}
            icon={<ShieldOff className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void runAction("logout-all")}
          >
            Log out everywhere
          </Button>
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-mist/70">
            <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
            Sessions
          </h3>
          {sessionsStatus === "loading" ? (
            <div className="mt-3 space-y-3" aria-busy="true">
              <span className="sr-only">Loading sessions</span>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {sessions.map((session) => (
                <li key={session.id} className="rounded-2xl border border-white/10 px-4 py-3 text-sm">
                  <p className="font-medium text-mist">{session.isCurrent ? "This device" : "Other device"}</p>
                  <p className="mt-1 text-mist/60">{session.userAgent ?? "Unknown browser"}</p>
                  <Button
                    variant="danger"
                    className="mt-3 px-3 py-1.5"
                    loading={pendingAction === session.id}
                    disabled={pendingAction !== null}
                    onClick={() => void runAction(session.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-2 rounded-xl bg-black/20 p-1 text-sm">
        <button
          type="button"
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 ${mode === "login" ? "bg-white/10 text-mist" : "text-mist/55"}`}
          onClick={() => setMode("login")}
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in
        </button>
        <button
          type="button"
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 ${mode === "register" ? "bg-white/10 text-mist" : "text-mist/55"}`}
          onClick={() => setMode("register")}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Create account
        </button>
      </div>
      <Field label="Email" icon={<Mail className="h-4 w-4" aria-hidden="true" />} error={fieldErrors.email?.[0]}>
        <input
          type="email"
          autoComplete="email"
          value={email}
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full bg-transparent py-2.5 pr-3 text-mist outline-none placeholder:text-mist/35"
          placeholder="you@example.com"
        />
      </Field>
      <Field
        label="Password"
        icon={<LockKeyhole className="h-4 w-4" aria-hidden="true" />}
        error={fieldErrors.password?.[0]}
      >
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full bg-transparent py-2.5 pr-3 text-mist outline-none placeholder:text-mist/35"
          placeholder="At least 12 characters"
        />
      </Field>
      {formMessage && (
        <p className={`flex items-start gap-2 text-sm ${messageTone === "success" ? "text-line" : "text-amber-200"}`}>
          {messageTone === "success" ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {formMessage}
        </p>
      )}
      <Button
        type="submit"
        loading={submitting}
        className="w-full"
        icon={mode === "login" ? <LogIn className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={startingProvider !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-mist transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
          onClick={() => void startProvider("google")}
        >
          <GoogleIcon />
          Google
        </button>
        <button
          type="button"
          disabled={startingProvider !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-mist transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
          onClick={() => void startProvider("github")}
        >
          <GitHubIcon />
          GitHub
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  icon,
  error,
  children,
}: {
  label: string;
  icon: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-mist/80">{label}</span>
      <span className={`flex items-center gap-2 rounded-xl border bg-black/25 px-3 ${error ? "border-rose-400/70" : "border-white/10 focus-within:border-line"}`}>
        <span className="text-mist/45">{icon}</span>
        {children}
      </span>
      {error && (
        <span className="mt-1.5 flex items-center gap-1.5 text-rose-300">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </span>
      )}
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8A6.4 6.4 0 1 1 12 5.6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.8 3.1 14.6 2 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.9H12Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.6s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c2-1.3 2.8-1 2.8-1a3.6 3.6 0 0 1 .1 2.6 3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  );
}
