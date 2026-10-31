import { useEffect, useState, type FormEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
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
import { Alert, Button, Field, Input, PasswordInput, Skeleton } from "../../components/ui";
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

export default function AuthPanel({
  onLoginSuccess,
  initialMode = "login",
}: {
  onLoginSuccess?: () => void;
  initialMode?: "login" | "register";
}) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const sessions = useSelector((state: RootState) => state.auth.sessions);
  const sessionsStatus = useSelector((state: RootState) => state.auth.sessionsStatus);
  const [mode, setMode] = useState<"login" | "register">(initialMode);
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
    const errors = validateCredentials(email, password, mode);
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
        <div className="flex items-start gap-3 rounded-2xl bg-fg/5 p-4">
          <span className="mt-0.5 rounded-full bg-accent/15 p-2 text-accent-text">
            <CircleCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm text-fg/70">Signed in</p>
            <p className="font-medium text-fg">{user.email}</p>
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
          <h3 className="flex items-center gap-2 text-sm font-medium text-fg/70">
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
                <li key={session.id} className="rounded-2xl border border-fg/10 px-4 py-3 text-sm">
                  <p className="font-medium text-fg">{session.isCurrent ? "This device" : "Other device"}</p>
                  <p className="mt-1 text-fg/60">{session.userAgent ?? "Unknown browser"}</p>
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
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-2 rounded-xl border border-border bg-surface-2 p-1 text-sm">
        {(["login", "register"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium transition-colors ${mode === value ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
            onClick={() => {
              setMode(value);
              setFieldErrors({});
              setFormMessage(null);
            }}
          >
            {value === "login" ? <LogIn className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
            {value === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <Field label="Email" error={fieldErrors.email?.[0]}>
        {({ id, describedBy, invalid }) => (
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <Input
              id={id}
              type="email"
              autoComplete="email"
              value={email}
              disabled={submitting}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => setEmail(event.target.value)}
              className="pl-10"
              placeholder="you@example.com"
            />
          </span>
        )}
      </Field>
      <Field label="Password" hint={mode === "register" ? "Use at least 12 characters." : undefined} error={fieldErrors.password?.[0]}>
        {({ id, describedBy, invalid }) => (
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <PasswordInput
              key={mode}
              id={id}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              disabled={submitting}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => setPassword(event.target.value)}
              className="pl-10"
              placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"}
            />
          </span>
        )}
      </Field>
      {formMessage ? (
        <Alert tone={messageTone === "success" ? "success" : "warning"}>{formMessage}</Alert>
      ) : null}
      <Button
        type="submit"
        size="lg"
        loading={submitting}
        className="w-full"
        icon={mode === "login" ? <LogIn className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-fg-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or continue with
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" loading={startingProvider === "google"} disabled={startingProvider !== null} icon={<GoogleIcon />} onClick={() => void startProvider("google")}>
          Google
        </Button>
        <Button variant="secondary" loading={startingProvider === "github"} disabled={startingProvider !== null} icon={<GitHubIcon />} onClick={() => void startProvider("github")}>
          GitHub
        </Button>
      </div>
    </form>
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
