import { useEffect, useState, type FormEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "../../app/store";
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

export default function AuthPanel() {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const sessions = useSelector((state: RootState) => state.auth.sessions);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void dispatch(loadCurrentUser());
    const authError = new URLSearchParams(window.location.search).get("authError");
    if (authError) {
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
        setFormMessage("Account created. Sign in with your password.");
      } else {
        await dispatch(login(email, password));
        setPassword("");
      }
    } catch (error) {
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

  if (status === "unknown") {
    return <p className="mt-3 text-slate-400">Checking your session...</p>;
  }

  if (status === "authenticated" && user) {
    return (
      <div className="mt-4 space-y-4">
        <p className="text-lg">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
            onClick={() => void dispatch(logout())}
          >
            Log out
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
            onClick={() => void dispatch(logoutAll())}
          >
            Log out everywhere
          </button>
        </div>
        <div>
          <h3 className="text-sm font-medium text-slate-400">Sessions</h3>
          <ul className="mt-3 space-y-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-xl border border-slate-800 px-4 py-3 text-sm">
                <p>{session.isCurrent ? "This device" : "Other device"}</p>
                <p className="mt-1 text-slate-400">{session.userAgent ?? "Unknown browser"}</p>
                <button
                  type="button"
                  className="mt-3 text-rose-300"
                  onClick={() => void dispatch(revokeSession(session.id))}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={onSubmit} noValidate>
      <div className="flex gap-3 text-sm">
        <button type="button" className={mode === "login" ? "text-sky-300" : "text-slate-400"} onClick={() => setMode("login")}>
          Sign in
        </button>
        <button type="button" className={mode === "register" ? "text-sky-300" : "text-slate-400"} onClick={() => setMode("register")}>
          Create account
        </button>
      </div>
      <label className="block text-sm">
        Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
        {fieldErrors.email?.[0] && <span className="mt-1 block text-rose-300">{fieldErrors.email[0]}</span>}
      </label>
      <label className="block text-sm">
        Password
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
        />
        {fieldErrors.password?.[0] && <span className="mt-1 block text-rose-300">{fieldErrors.password[0]}</span>}
      </label>
      {formMessage && <p className="text-sm text-amber-200">{formMessage}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60"
      >
        {submitting ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <div className="flex flex-col gap-2 text-sm">
        <a className="text-sky-300" href={providerStartUrl("google")}>
          Continue with Google
        </a>
        <a className="text-sky-300" href={providerStartUrl("github")}>
          Continue with GitHub
        </a>
      </div>
    </form>
  );
}
